/*
 * Family Shop (CJdropshipping) logic. Kept apart from the Photo Gifts / Printify code on purpose:
 *  - products live in their own table (shopCj), cart in shopCjCart, and orders are the shared shopOrders rows with every line tagged supplier "cj";
 *  - supplier facts (cost, stock, images, variant ids) and the owner's storefront choices (title, text, category, prices) are stored apart,
 *    so a sync only ever rewrites the supplier facts;
 *  - nothing here calls Square directly. It asks createShop for the shared Square checkout step, and createShop's payment code calls fulfillCj
 *    only after Square has confirmed the payment.
 * The CJ client (cj.js) is the only thing that talks to CJ. In tests it is a fake.
 */
import { Query, Permission, Role } from 'node-appwrite';
import { ApiError, bad, forbidden, missing, conflict, idOf, intIn, rowId, money } from './util.js';
import { CjError, CJ_STATUS_TO_OURS } from './cj.js';
import { supplierOfOrder } from './suppliers.js';

export const CJ_CATEGORIES = [
  { id: 'reunion', title: 'Reunion Supplies' }, { id: 'party', title: 'Party and gatherings' }, { id: 'home', title: 'Home and kitchen' },
  { id: 'outdoor', title: 'Outdoor and travel' }, { id: 'kids', title: 'Kids and games' }, { id: 'other', title: 'More finds' }
];
const CAT_IDS = CJ_CATEGORIES.map((c) => c.id);
export const cleanCategory = (x) => (CAT_IDS.includes(x) ? x : 'other');
export const CJ_LIMITS = { maxQty: 10, maxLines: 10, maxSelected: 60, titleMax: 120, descMax: 3000 };
const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const COUNTRY_NAMES = { US: 'United States' };
const json = (s, d) => { try { const v = JSON.parse(s || ''); return v == null ? d : v; } catch { return d; } };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const sdkCode = (e) => (e && typeof e.code === 'number' ? e.code : 0);
const FORWARD = ['not_started', 'creating', 'created', 'sending', 'in_production', 'shipped', 'delivered'];

/** Owner's pricing rule: markup percent over CJ's cost, optionally rounded up to the next .99. A price typed for one variant always wins. */
export function retailFor(variant, retail) {
  const manual = retail && retail.manual && Number.isInteger(retail.manual[variant.vid]) ? retail.manual[variant.vid] : null;
  if (manual !== null) return manual;
  const pct = Number(retail && retail.percent);
  if (!Number.isFinite(pct) || pct < 0 || variant.costCents == null) return null;
  let c = Math.ceil(variant.costCents * (1 + pct / 100));
  if (retail && retail.round99) c = Math.ceil((c + 1) / 100) * 100 - 1;
  return c;
}

export function createCjShop(ctx) {
  const { cfg, cj, T, listRows, createRow, updateRow, deleteRow, getRowOrNull, requireMember, requireAdmin, cleanAddress, beginSquare, closeUnpaid, now, nowIso, log, CUR, currency, taxPercent } = ctx;
  const ownerRead = (uid) => [Permission.read(Role.user(uid))];
  const configured = () => !!(cj && cfg.cjConfigured);
  const needCj = () => { if (!configured()) throw new ApiError(503, 'cj_not_ready', 'The Family Shop is not set up yet.'); };
  const sandbox = () => cfg.cjSandbox !== false;                         // default: sandbox ON
  const idFor = (pid) => rowId('cjp', pid);

  function cjProblem(e, what = 'CJ') {
    if (e instanceof ApiError) return e;
    if (e instanceof CjError) {
      if (e.kind === 'not_found') return new ApiError(404, 'cj_not_found', `${what} has no product with that SKU or ID. Check it on CJ's site and try again.`);
      if (e.rateLimited) return new ApiError(429, 'cj_rate_limit', 'CJ says we are asking too fast. Wait about a minute and try again.');
      if (e.authProblem) return new ApiError(502, 'cj_auth', e.code === 'api_inactive' ? e.cjMessage : 'CJ did not accept the shop\'s login. Check CJ_API_KEY in the function settings, or make a new key on CJ.');
      if (e.kind === 'network') return new ApiError(502, 'cj_network', 'CJ could not be reached. Try again in a moment.');
      return new ApiError(502, 'cj_error', `CJ did not accept that${e.cjMessage ? ` (it said: ${e.cjMessage.slice(0, 120)})` : ''}.`);
    }
    return new ApiError(502, 'cj_error', 'CJ did not answer correctly. Try again in a moment.');
  }

  /* ---------- the stored product ---------- */
  const supplierOf = (row) => json(row.supplierData, { variants: [], images: [] });
  const retailOf = (row) => json(row.retail, { percent: null, round99: true, manual: {}, selected: [] });
  const stockFor = (v, country) => (v.stockKnown ? (Number(v.stock && v.stock[country]) || 0) : null);
  function sellable(row) {
    const sup = supplierOf(row), rt = retailOf(row);
    return (sup.variants || []).filter((v) => !v.gone && (rt.selected || []).includes(v.vid) && retailFor(v, rt) > 0).map((v) => ({ ...v, retailCents: retailFor(v, rt), stockNow: stockFor(v, row.fromCountry) }));
  }
  function publicProduct(row) {
    const sup = supplierOf(row); const vs = sellable(row);
    const prices = vs.map((v) => v.retailCents);
    const anyStockKnown = vs.some((v) => v.stockNow !== null);
    const avail = !vs.length ? 'unavailable' : !anyStockKnown ? 'unknown' : vs.some((v) => v.stockNow > 0) ? 'in_stock' : 'out_of_stock';
    return {
      id: row.$id, section: 'family-shop', title: row.title, description: row.description || '', category: cleanCategory(row.category), featured: row.featured === true,
      images: (sup.images || []).filter((u) => typeof u === 'string' && u.startsWith('https://')).slice(0, 12),
      image: (sup.images || [])[0] || '', specs: Array.isArray(sup.specs) ? sup.specs.slice(0, 8) : [],
      shipsFrom: row.fromCountry || '', availability: avail, availabilityCheckedAt: row.lastSyncAt || '',
      fromCents: prices.length ? Math.min(...prices) : 0, hasRange: prices.length > 1 && Math.min(...prices) !== Math.max(...prices), currency: CUR,
      variants: vs.map((v) => ({ id: v.vid, label: v.name || v.sku || 'Standard', image: v.image || '', priceCents: v.retailCents, inStock: v.stockNow === null ? null : v.stockNow > 0, maxQty: v.stockNow === null ? CJ_LIMITS.maxQty : Math.min(CJ_LIMITS.maxQty, v.stockNow) }))
    };
  }
  function adminProduct(row) {
    const sup = supplierOf(row), rt = retailOf(row), vs = sup.variants || [];
    const costs = vs.map((v) => v.costCents).filter((n) => Number.isInteger(n));
    const sel = sellable(row).map((v) => v.retailCents);
    return {
      id: row.$id, pid: row.pid, sku: row.sku, title: row.title, cjTitle: sup.title || '', status: row.status, category: cleanCategory(row.category), featured: row.featured === true,
      fromCountry: row.fromCountry || '', variantCount: vs.length, selectedCount: (rt.selected || []).length, minCostCents: costs.length ? Math.min(...costs) : 0, maxCostCents: costs.length ? Math.max(...costs) : 0,
      minRetailCents: sel.length ? Math.min(...sel) : 0, image: (sup.images || [])[0] || '', lastSyncAt: row.lastSyncAt || '', syncNote: row.syncNote || ''
    };
  }
  async function allCjRows() {
    const out = []; let cursor = null;
    for (let i = 0; i < 10; i++) {
      const q = [Query.limit(100)]; if (cursor) q.push(Query.cursorAfter(cursor));
      const page = (await listRows(T.cjProducts, q)).rows; out.push(...page);
      if (page.length < 100) break; cursor = page[page.length - 1].$id;
    }
    return out;
  }
  const missingTable = (e) => sdkCode(e) === 404 || /could not be found|not found/i.test(String(e && e.message));
  async function publishedRows() {
    try { return (await allCjRows()).filter((r) => r.status === 'published' && sellable(r).length); }
    catch (e) { if (missingTable(e)) return []; throw e; }
  }

  /* ================= ADMIN: connection test, lookup, search, save, sync ================= */
  async function adminCheck({ user, body }) {
    requireAdmin(user);
    const out = { configured: configured(), sandbox: sandbox(), autoPay: cfg.cjAutoPay === true, squareEnvironment: cfg.squareEnvironment, loginOk: false, problem: '' };
    if (!out.configured) { out.problem = 'CJ_API_KEY is not set in the shop-api function settings.'; return out; }
    try { await cj.checkLogin(); out.loginOk = true; } catch (e) { out.problem = cjProblem(e).message; return out; }
    const q = clean(body && body.sku, 80);
    if (q) {
      try {
        const p = await cj.product(q);
        out.product = { found: true, pid: p.pid, sku: p.sku, title: p.title, variantCount: p.variants.length, imageCount: p.images.length, hasPrices: p.variants.every((v) => v.costCents !== null), stockShownFor: [...new Set(p.variants.flatMap((v) => Object.keys(v.stock)))], descriptionChars: p.description.length };
      } catch (e) { out.product = { found: false, problem: cjProblem(e).message }; }
    }
    return out;
  }
  async function adminLookup({ user, body }) {
    requireAdmin(user); needCj();
    let p; try { p = await cj.product(body.query); } catch (e) { throw cjProblem(e); }
    if (!p.pid) throw new ApiError(502, 'cj_error', 'CJ answered, but without a product ID, so it cannot be saved.');
    const existing = await getRowOrNull(T.cjProducts, idFor(p.pid));
    const countries = {};
    for (const v of p.variants) for (const [cc, n] of Object.entries(v.stock)) countries[cc] = (countries[cc] || 0) + n;
    return { product: p, warehouses: countries, existing: existing ? { ...adminProduct(existing), titleSaved: existing.title, description: existing.description, retail: retailOf(existing) } : null, sandbox: sandbox() };
  }
  async function adminSearch({ user, body }) {
    requireAdmin(user); needCj();
    const kw = clean(body.keyword, 100); if (kw.length < 2) throw bad('Type at least 2 letters to search CJ.');
    try { return await cj.search(kw, intIn(body.page || 1, 'page', 1, 1000)); } catch (e) { throw cjProblem(e); }
  }
  function validateRetail(variants, retail) {
    const bad0 = [];
    for (const v of variants) {
      const r = retailFor(v, retail);
      if (!Number.isInteger(r) || r < 100) bad0.push(`${v.name || v.sku}: set a price`);
      else if (v.costCents != null && r <= v.costCents) bad0.push(`${v.name || v.sku}: ${money(r)} is not above CJ's cost of ${money(v.costCents)}`);
    }
    return bad0;
  }
  /** Saves (or edits) a product. Supplier facts are fetched again from CJ here. Nothing about cost, stock or ids is taken from the browser. */
  async function adminSave({ user, body }) {
    requireAdmin(user); needCj();
    const pidIn = clean(body.pid, 64); if (!pidIn) throw bad('Choose a product first.');
    let p; try { p = await cj.product(pidIn); } catch (e) { throw cjProblem(e); }
    if (!p.pid) throw new ApiError(502, 'cj_error', 'CJ answered, but without a product ID.');
    const id = idFor(p.pid);
    const prev = await getRowOrNull(T.cjProducts, id);
    const status = ['draft', 'published', 'disabled'].includes(body.status) ? body.status : 'draft';
    const sel = Array.isArray(body.selected) ? body.selected.slice(0, CJ_LIMITS.maxSelected) : [];
    const known = new Set(p.variants.map((v) => v.vid));
    const manual = {}; const selected = [];
    for (const s of sel) {
      const vid = clean(s && s.vid, 64); if (!known.has(vid) || selected.includes(vid)) continue;
      selected.push(vid);
      if (s.retailCents !== undefined && s.retailCents !== null && s.retailCents !== '') { const c = Number(s.retailCents); if (!Number.isInteger(c) || c < 0 || c > 1000000) throw bad('A price is not a valid amount.'); manual[vid] = c; }
    }
    const pct = body.percent === undefined || body.percent === null || body.percent === '' ? null : Number(body.percent);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 1000)) throw bad('The markup must be a number from 0 to 1000.');
    const retail = { percent: pct, round99: body.round99 !== false, manual, selected };
    const supplierData = { title: p.title, description: p.description, images: p.images, specs: p.specs, categoryName: p.categoryName, variants: p.variants.slice(0, 100) };
    const chosen = supplierData.variants.filter((v) => selected.includes(v.vid));
    const country = clean(body.fromCountry, 2).toUpperCase() || (Object.keys((chosen[0] && chosen[0].stock) || {})[0] || 'CN');
    const title = clean(body.title, CJ_LIMITS.titleMax) || p.title.slice(0, CJ_LIMITS.titleMax);
    const description = clean(body.description, CJ_LIMITS.descMax) || p.description.slice(0, CJ_LIMITS.descMax);
    if (!title) throw bad('Give the product a title.');
    if (status === 'published') {
      if (!chosen.length) throw bad('Choose at least one variant to sell before publishing.');
      const problems = validateRetail(chosen, retail);
      if (problems.length) throw bad('Fix the prices first. ' + problems.slice(0, 3).join('; ') + '.');
    }
    const data = {
      pid: p.pid, sku: p.sku, supplier: 'cj', title, description, category: cleanCategory(body.category), status, featured: body.featured === true, fromCountry: country,
      supplierData: JSON.stringify(supplierData), retail: JSON.stringify(retail), lastSyncAt: nowIso(), syncNote: ''
    };
    if (prev) { const row = await updateRow(T.cjProducts, id, data); return { product: adminProduct(row), preview: publicProduct(row), updated: true }; }
    const dup = (await listRows(T.cjProducts, [Query.equal('pid', [p.pid]), Query.limit(1)])).rows[0];      // belt and braces: same CJ product under another row id
    if (dup) throw conflict('duplicate', 'That CJ product is already in your shop. Open it from the list to edit it.');
    const row = await createRow(T.cjProducts, id, data, []);
    return { product: adminProduct(row), preview: publicProduct(row), updated: false };
  }
  async function adminList({ user }) {
    requireAdmin(user);
    let rows = []; try { rows = await allCjRows(); } catch (e) { if (!missingTable(e)) throw e; }
    return { products: rows.map(adminProduct), categories: CJ_CATEGORIES, configured: configured(), sandbox: sandbox(), autoPay: cfg.cjAutoPay === true };
  }
  async function adminOpen({ user, body }) {
    requireAdmin(user);
    const row = await getRowOrNull(T.cjProducts, idOf(body.id, 'id'));
    if (!row) throw missing('Product not found.');
    const sup = supplierOf(row);
    return { product: { ...adminProduct(row), description: row.description || '', retail: retailOf(row), supplier: { title: sup.title, description: sup.description, images: sup.images || [], variants: sup.variants || [], specs: sup.specs || [] } }, preview: publicProduct(row) };
  }
  async function adminToggle({ user, body }) {
    requireAdmin(user);
    const row = await getRowOrNull(T.cjProducts, idOf(body.id, 'id'));
    if (!row) throw missing('Product not found.');
    const data = {};
    if (body.status !== undefined) {
      if (!['draft', 'published', 'disabled'].includes(body.status)) throw bad('Unknown status.');
      if (body.status === 'published') {
        const vs = sellable(row);
        if (!vs.length) throw bad('Choose variants and prices before publishing.');
        const problems = validateRetail(vs, retailOf(row)); if (problems.length) throw bad('Fix the prices first. ' + problems.slice(0, 3).join('; ') + '.');
      }
      data.status = body.status;
    }
    if (body.featured !== undefined) data.featured = body.featured === true;
    if (body.category !== undefined) data.category = cleanCategory(body.category);
    const next = Object.keys(data).length ? await updateRow(T.cjProducts, row.$id, data) : row;
    return { product: adminProduct(next) };
  }
  /** Refreshes ONLY supplier facts. Title, description, category, status and prices are never touched. A variant CJ removed is marked gone and stops being sold. */
  async function adminSync({ user, body }) {
    requireAdmin(user); needCj();
    const row = await getRowOrNull(T.cjProducts, idOf(body.id, 'id'));
    if (!row) throw missing('Product not found.');
    let p; try { p = await cj.product(row.pid); } catch (e) {
      const err = cjProblem(e); await updateRow(T.cjProducts, row.$id, { syncNote: `Last sync failed: ${err.message}`.slice(0, 200) }); throw err;
    }
    const old = supplierOf(row), rt = retailOf(row), notes = [];
    const fresh = new Map(p.variants.map((v) => [v.vid, v]));
    const merged = p.variants.slice(0, 100);
    for (const v of old.variants || []) {
      if (fresh.has(v.vid)) {
        const f = fresh.get(v.vid);
        if (f.costCents !== v.costCents) { const r = retailFor(f, rt); notes.push(`${v.name || v.sku} cost ${money(v.costCents || 0)} to ${money(f.costCents || 0)}`); if (r != null && f.costCents != null && r <= f.costCents) notes.push(`${v.name || v.sku} now sells at or below cost`); }
      } else if ((rt.selected || []).includes(v.vid)) { merged.push({ ...v, gone: true, stock: {}, stockKnown: true }); notes.push(`${v.name || v.sku} is no longer at CJ`); }
    }
    const supplierData = { title: p.title, description: p.description, images: p.images, specs: p.specs, categoryName: p.categoryName, variants: merged };
    const data = { supplierData: JSON.stringify(supplierData), lastSyncAt: nowIso(), syncNote: notes.join('; ').slice(0, 200) };
    const probe = { ...row, supplierData: data.supplierData };
    if (row.status === 'published' && !sellable(probe).length) { data.status = 'disabled'; data.syncNote = ('Switched off: nothing left to sell. ' + data.syncNote).slice(0, 200); }
    const next = await updateRow(T.cjProducts, row.$id, data);
    return { product: adminProduct(next), changes: notes };
  }
  async function adminDelete({ user, body }) {
    requireAdmin(user);
    const row = await getRowOrNull(T.cjProducts, idOf(body.id, 'id'));
    if (!row) throw missing('Product not found.');
    if (row.status === 'published') throw conflict('published', 'Switch it off before deleting it.');
    await deleteRow(T.cjProducts, row.$id);          // old orders keep their own copy of what was bought
    return { ok: true };
  }

  /* ================= PUBLIC: browse, cart, quote, checkout ================= */
  async function browse({ user, body }) {
    await requireMember(user, body.familyId);
    const rows = await publishedRows();
    const products = rows.map(publicProduct);
    const counts = {}; products.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
    return {
      open: configured(), products, featured: products.filter((p) => p.featured).slice(0, 8),
      categories: CJ_CATEGORIES.filter((c) => counts[c.id]).map((c) => ({ ...c, count: counts[c.id] })),
      policy: cfg.returnPolicy || '', sandbox: sandbox(), isAdmin: (cfg.adminIds || []).includes(user.$id)
    };
  }
  async function item({ user, body }) {
    await requireMember(user, body.familyId);
    const row = await getRowOrNull(T.cjProducts, idOf(body.id, 'id'));
    if (!row || row.status !== 'published' || !sellable(row).length) throw missing('That product is not available.');
    return { product: publicProduct(row), policy: cfg.returnPolicy || '' };
  }
  const cartId = (uid, familyId, productId, vid) => rowId('cjcart', uid, familyId, productId, vid);
  async function cartRows(user, familyId) {
    try { return (await listRows(T.cjCart, [Query.equal('ownerId', [user.$id]), Query.equal('familyId', [familyId]), Query.limit(50)])).rows; }
    catch (e) { if (missingTable(e)) return []; throw e; }
  }
  /** The cart as it stands in OUR data. No CJ call. Anything that cannot be sold any more is flagged, never silently removed. */
  async function cartView(user, familyId) {
    const rows = await cartRows(user, familyId);
    const lines = [];
    for (const r of rows) {
      const prod = await getRowOrNull(T.cjProducts, r.productId);
      const v = prod && prod.status === 'published' ? sellable(prod).find((x) => x.vid === r.vid) : null;
      lines.push({
        productId: r.productId, vid: r.vid, quantity: r.quantity, title: prod ? prod.title : 'Removed product', variantLabel: v ? (v.name || v.sku) : '', image: v ? (v.image || (supplierOf(prod).images || [])[0] || '') : '',
        unitCents: v ? v.retailCents : 0, available: !!v && (v.stockNow === null || v.stockNow >= r.quantity), reason: !v ? 'No longer sold' : (v.stockNow !== null && v.stockNow < r.quantity ? (v.stockNow === 0 ? 'Out of stock' : `Only ${v.stockNow} left`) : '')
      });
    }
    return { lines, itemCount: lines.reduce((n, l) => n + l.quantity, 0), subtotalCents: lines.filter((l) => l.available).reduce((n, l) => n + l.unitCents * l.quantity, 0), currency: CUR };
  }
  async function cartGet({ user, body }) { const { familyId } = await requireMember(user, body.familyId); return cartView(user, familyId); }
  async function cartSet({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const productId = idOf(body.productId, 'productId'), vid = clean(body.vid, 64);
    const qty = intIn(body.quantity, 'Quantity', 0, CJ_LIMITS.maxQty);
    const id = cartId(user.$id, familyId, productId, vid);
    const existing = await getRowOrNull(T.cjCart, id);
    if (qty === 0) { if (existing) await deleteRow(T.cjCart, id); return cartView(user, familyId); }
    const prod = await getRowOrNull(T.cjProducts, productId);
    const v = prod && prod.status === 'published' ? sellable(prod).find((x) => x.vid === vid) : null;
    if (!v) throw conflict('unavailable', 'That item is not available.');
    if (v.stockNow !== null && v.stockNow < qty) throw conflict('out_of_stock', v.stockNow === 0 ? 'That item is out of stock.' : `Only ${v.stockNow} left.`);
    if (existing) await updateRow(T.cjCart, id, { quantity: qty });
    else {
      if ((await cartRows(user, familyId)).length >= CJ_LIMITS.maxLines) throw bad(`The Family Shop cart holds up to ${CJ_LIMITS.maxLines} different items.`);
      await createRow(T.cjCart, id, { ownerId: user.$id, familyId, productId, vid, quantity: qty }, ownerRead(user.$id));
    }
    return cartView(user, familyId);
  }

  /** Everything checked again with CJ right now: stock, cost, and shipping. Returns the lines to buy, one shipping choice, and the total. */
  async function priceCart(user, familyId, addressRaw) {
    needCj();
    const rows = await cartRows(user, familyId);
    if (!rows.length) throw bad('Your Family Shop cart is empty.');
    const address = cleanAddress(addressRaw, user);
    const lines = []; const live = new Map();
    for (const r of rows) {
      const prod = await getRowOrNull(T.cjProducts, r.productId);
      const v = prod && prod.status === 'published' ? sellable(prod).find((x) => x.vid === r.vid) : null;
      if (!v) throw conflict('unavailable', `${prod ? prod.title : 'An item'} is no longer sold. Remove it from your cart.`);
      if (!live.has(prod.pid)) { try { live.set(prod.pid, await cj.product(prod.pid)); } catch (e) { throw cjProblem(e); } }
      const f = (live.get(prod.pid).variants || []).find((x) => x.vid === r.vid);
      if (!f) throw conflict('unavailable', `${prod.title} (${v.name}) is no longer available from the supplier. Remove it from your cart.`);
      const stock = stockFor(f, prod.fromCountry);
      if (stock !== null && stock < r.quantity) throw conflict('out_of_stock', `${prod.title} (${v.name}): ${stock === 0 ? 'out of stock' : 'only ' + stock + ' left'}.`);
      if (f.costCents != null && v.retailCents <= f.costCents) throw conflict('price_changed', `${prod.title}: the supplier price changed, so this item is paused until the shop owner updates its price.`);
      lines.push({
        supplier: 'cj', productId: prod.$id, pid: prod.pid, vid: r.vid, sku: f.sku || v.sku, title: prod.title.slice(0, 120), variantLabel: (v.name || v.sku || 'Standard').slice(0, 80),
        quantity: r.quantity, unitCents: v.retailCents, costCents: f.costCents, fromCountry: prod.fromCountry
      });
    }
    if (new Set(lines.map((l) => l.fromCountry)).size !== 1) throw conflict('multiple_warehouses', 'These items ship from different warehouses, so they cannot be shipped together yet. Check out one at a time.');
    let options;
    try { options = await cj.freight({ from: lines[0].fromCountry, to: address.country, zip: address.zip, products: lines }); } catch (e) { throw cjProblem(e); }
    if (!options.length) throw conflict('shipping_unavailable', 'The supplier cannot ship these items to that address.');
    const ship = options.slice().sort((a, b) => a.priceCents - b.priceCents)[0];
    const subtotalCents = lines.reduce((n, l) => n + l.unitCents * l.quantity, 0);
    for (const l of lines) l.logisticName = ship.name;
    return { lines, address, ship, subtotalCents, shippingCents: ship.priceCents, totalCents: subtotalCents + ship.priceCents };
  }
  const quoteShape = (q) => ({
    lines: q.lines.map(({ title, variantLabel, quantity, unitCents }) => ({ title, variantLabel, quantity, unitCents })),
    subtotalCents: q.subtotalCents, shippingCents: q.shippingCents, totalCents: q.totalCents, currency: CUR,
    shipping: { method: q.ship.name, supplierEstimate: q.ship.aging ? `${q.ship.aging} days (the supplier's estimate, not a promise)` : '' },
    taxNote: taxPercent > 0 ? `Sales tax of ${taxPercent}% is added on Square's payment page.` : 'No sales tax is added by this shop.'
  });
  async function quote({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    return quoteShape(await priceCart(user, familyId, body.address));
  }
  const signature = (lines) => lines.map((l) => `${l.vid}:${l.quantity}`).sort().join(',');
  async function checkout({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    if (body.consentDelivery !== true) throw bad('Please confirm the delivery permission box before paying.');
    needCj();
    if (!ctx.squareReady()) throw new ApiError(503, 'payments_not_ready', 'Payments are not set up yet. Please try again later.');
    const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId) ? body.requestId : null;
    if (!requestId) throw bad('Missing request id.');
    const orderId = rowId('order', user.$id, requestId);
    const existing = await getRowOrNull(T.orders, orderId);
    if (existing) { if (existing.ownerId !== user.$id) throw forbidden(); return { orderId, url: existing.paymentStatus === 'pending_payment' ? existing.checkoutUrl : '', reused: true }; }
    const q = await priceCart(user, familyId, body.address);
    // The total can change between "see total" and "pay" (stock moved, a shipping rate changed). Never charge a different number without asking again.
    if (!Number.isInteger(body.expectedTotalCents) || body.expectedTotalCents !== q.totalCents) {
      throw Object.assign(new ApiError(409, 'total_changed', `The total is now ${money(q.totalCents)}. Please review it and confirm again.`), { extra: { totalCents: q.totalCents, quote: quoteShape(q) } });
    }
    // Another unpaid Family Shop order for the same cart: reuse it. A different cart: close the old unpaid one first (Square is asked before closing).
    const recent = (await listRows(T.orders, [Query.equal('ownerId', [user.$id]), Query.orderDesc('$createdAt'), Query.limit(10)])).rows;
    for (const o of recent) {
      if (o.familyId !== familyId || o.paymentStatus !== 'pending_payment' || supplierOfOrder(o) !== 'cj') continue;
      if (signature(json(o.items, [])) === signature(q.lines) && o.checkoutUrl && o.totalCents === q.totalCents) return { orderId: o.$id, url: o.checkoutUrl, reused: true };
      const closed = await closeUnpaid(o); if (closed.paymentStatus !== 'pending_payment') continue;
    }
    const row = {
      ownerId: user.$id, familyId, paymentStatus: 'pending_payment', fulfillmentStatus: 'not_started', items: JSON.stringify(q.lines), address: JSON.stringify(q.address),
      subtotalCents: q.subtotalCents, shippingCents: q.shippingCents, taxCents: 0, totalCents: q.totalCents, currency, paymentProvider: 'square', squarePaymentLinkId: '', squareOrderId: '', squarePaymentId: '', refundedCents: 0,
      checkoutUrl: '', printifyOrderId: '', tracking: '[]', lastError: '', consentAt: nowIso(), consentVersion: 2, needsReview: ''
    };
    await createRow(T.orders, orderId, row, ownerRead(user.$id));
    return ctx.beginSquare({ orderId, lines: q.lines, address: q.address, user, familyId, subtotalCents: q.subtotalCents, shippingCents: q.shippingCents });
  }

  /* ================= FULFILLMENT (only after Square confirmed the payment) ================= */
  async function clearCart(o) {
    for (const l of json(o.items, [])) { try { await deleteRow(T.cjCart, cartId(o.ownerId, o.familyId, l.productId, l.vid)); } catch (e) { if (sdkCode(e) !== 404) log('cart clear failed', String(e && e.message)); } }
  }
  const hold = (o, why) => updateRow(T.orders, o.$id, { fulfillmentStatus: 'needs_review', lastError: why.slice(0, 590) });
  function cjOrderBody(o) {
    const a = json(o.address, {}), lines = json(o.items, []);
    const st = STATE_NAMES[a.region] || a.region;
    return {
      orderNumber: o.$id, shippingCountryCode: a.country, shippingCountry: COUNTRY_NAMES[a.country] || a.country, shippingProvince: st, shippingCity: a.city,
      shippingCustomerName: `${a.first_name} ${a.last_name}`.trim(), shippingAddress: a.address1, ...(a.address2 ? { shippingAddress2: a.address2 } : {}), shippingZip: a.zip,
      ...(a.phone ? { shippingPhone: a.phone } : {}), email: a.email, logisticName: lines[0].logisticName, fromCountryCode: lines[0].fromCountry,
      products: lines.map((l) => ({ vid: l.vid, quantity: l.quantity })), payType: 3, remark: `FamilyCircle ${o.$id.slice(0, 8)}`,
      ...(sandbox() ? { isSandbox: 1 } : {})
    };
  }
  const centsOf = (x) => { const t = String(x == null ? '' : x).replace(/[^0-9.\-]/g, ''); if (!/\d/.test(t)) return null; const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  /** Looks for an order CJ already has under our order number. Used before any retry, so an uncertain create never makes a second order. */
  async function findAtCj(o) {
    try { const d = await cj.orderDetail(o.$id); return d && (d.orderId || d.id) ? d : null; }
    catch (e) { if (e instanceof CjError && (e.notFound || e.kind === 'api')) return null; throw e; }
  }
  async function recordCreated(o, d) {
    const total = centsOf(d.orderAmount != null ? d.orderAmount : (d.productAmount != null || d.postageAmount != null ? (Number(d.productAmount) || 0) + (Number(d.postageAmount) || 0) : null));
    const data = { supplierOrderId: String(d.orderId || d.id), supplierStatus: String(d.orderStatus || d.status || 'CREATED').slice(0, 40), fulfillmentStatus: 'created', lastError: '' };
    const paidFor = o.subtotalCents + o.shippingCents;
    if (total !== null && total > paidFor) { data.fulfillmentStatus = 'needs_review'; data.lastError = `CJ's price for this order (${money(total)}) is higher than the customer paid for items and shipping (${money(paidFor)}). The CJ order exists but was NOT paid.`; }
    else if (!cfg.cjAutoPay) data.lastError = 'Waiting for you to pay CJ. Open the order in the shop admin and press "Pay supplier".';
    return updateRow(T.orders, o.$id, data);
  }
  async function fulfillCj(o, { force = false } = {}) {
    if (o.paymentStatus !== 'paid') return o;
    await clearCart(o);
    if (['creating', 'created', 'sending', 'in_production', 'shipped', 'delivered', 'canceled'].includes(o.fulfillmentStatus)) return o;
    if (o.fulfillmentStatus === 'needs_review' && !force) return o;
    if (!configured()) return hold(o, 'The Family Shop supplier is not set up, so nothing was ordered from CJ.');
    // A practice payment must never buy real goods, and a real payment must not silently become a CJ sandbox order that never ships.
    if (!sandbox() && cfg.squareEnvironment !== 'production') return hold(o, 'Square is in test mode, so a real CJ order was blocked. Nothing was ordered.');
    if (sandbox() && cfg.squareEnvironment === 'production') return hold(o, 'CJ is still in sandbox mode, so this paid order was not sent to a real warehouse. Set CJ_SANDBOX=false when you are ready, then press Retry.');
    let cur = await updateRow(T.orders, o.$id, { fulfillmentStatus: 'creating', lastError: '' });
    let d;
    try { d = await cj.createOrder(cjOrderBody(cur)); }
    catch (e) {
      // The answer is unknown: CJ may or may not have the order. Look it up by our order number before anything else. Never create blindly twice.
      let found = null; try { found = await findAtCj(cur); } catch { found = null; }
      if (found) return recordAfterCreate(cur, found);
      const why = e instanceof CjError ? `CJ said: ${e.cjMessage || 'error ' + e.code}.` : 'CJ could not be reached.';
      log('cj create failed', o.$id, e && e.code, e && e.status);
      return hold(cur, `${why} It is not certain whether CJ received the order, so it was NOT retried automatically. Press "Check CJ" to look for it by order number ${o.$id.slice(0, 12)}…, then Retry if CJ does not have it.`);
    }
    if (!d || !(d.orderId || d.id)) return hold(cur, 'CJ answered without an order number. Press "Check CJ" before retrying so a second order is not made.');
    return recordAfterCreate(cur, d);
  }
  async function recordAfterCreate(cur, d) {
    let o = await recordCreated(cur, d);
    if (o.fulfillmentStatus === 'created' && cfg.cjAutoPay) o = await payCj(o);
    return o;
  }
  async function payCj(o) {
    if (!o.supplierOrderId) throw conflict('no_cj_order', 'There is no CJ order to pay yet.');
    if (o.paymentStatus !== 'paid') throw conflict('not_paid', 'This order has not been paid by the customer, or it was refunded.');
    if (o.paymentProvider === 'square') { const cur = await ctx.refreshRefunds(o); if (cur.paymentStatus !== 'paid') throw conflict('refunded', 'This order was refunded in Square, so CJ was not paid.'); o = cur; }
    if (!sandbox() && cfg.squareEnvironment !== 'production') throw conflict('test_mode', 'Square is in test mode, so paying a real CJ order is blocked.');
    if (o.fulfillmentStatus === 'sending' || o.fulfillmentStatus === 'in_production' || o.fulfillmentStatus === 'shipped') return o;
    try { await cj.payBalance(o.supplierOrderId); }
    catch (e) {
      const why = e instanceof CjError ? (e.cjMessage || `error ${e.code}`) : 'no answer';
      return hold(o, `CJ did not take the payment (${why}). This often means the CJ wallet balance is too low. Add funds in your CJ wallet, then press "Pay supplier" again. Nothing was charged twice.`);
    }
    return updateRow(T.orders, o.$id, { fulfillmentStatus: 'sending', supplierStatus: 'PAID_REQUESTED', lastError: '' });
  }
  const rank = (s) => FORWARD.indexOf(s);
  /** Reads the order from CJ (the authenticated API, never a push message) and moves our status forward only. A CJ cancel of a paid order is held for you, not hidden. */
  async function syncFromCj(o) {
    if (!o.supplierOrderId) return o;
    let d; try { d = await cj.orderDetail(o.supplierOrderId); } catch (e) { if (e instanceof CjError) throw cjProblem(e); throw e; }
    if (!d) return o;
    const status = String(d.orderStatus || d.status || '').toUpperCase();
    const mapped = CJ_STATUS_TO_OURS[status];
    const data = { supplierStatus: status.slice(0, 40) };
    const tn = d.trackNumber || d.trackingNumber;
    if (tn) data.tracking = JSON.stringify([{ carrier: String(d.trackingProvider || d.logisticName || '').slice(0, 60), number: String(tn).slice(0, 80), url: /^https:\/\//.test(String(d.trackingUrl || '')) ? String(d.trackingUrl).slice(0, 300) : '', deliveredAt: status === 'DELIVERED' ? nowIso() : null }]);
    const cur = o.fulfillmentStatus;
    if (mapped === 'cj_canceled') {
      if (cur !== 'canceled') { data.fulfillmentStatus = 'needs_review'; data.lastError = 'CJ canceled this order after the customer paid. Refund the customer in Square, or place the order again at CJ.'; }
    } else if (mapped && cur !== 'canceled' && cur !== 'delivered') {
      if (mapped === 'shipped' && !tn) { /* CJ says shipped without a tracking number: do not tell the customer yet */ }
      else if (rank(mapped) > rank(cur) || (cur === 'needs_review' && rank(mapped) >= rank('created') && !String(o.lastError || '').includes('canceled this order'))) data.fulfillmentStatus = mapped;
    }
    return updateRow(T.orders, o.$id, data);
  }
  /** Admin buttons on a Family Shop order. Printify buttons are refused for these orders by the caller. */
  async function adminAct(o, act) {
    if (act === 'cj_pay') return payCj(o);
    if (act === 'cj_refresh') { o = await ctx.reconcile(o); return syncFromCj(o); }
    if (act === 'cj_check') {
      const found = await findAtCj(o).catch((e) => { throw cjProblem(e); });
      if (!found) throw conflict('not_at_cj', 'CJ has no order under this order number, so it is safe to press Retry.');
      return recordAfterCreate(o, found);
    }
    if (act === 'cj_retry') {
      if (o.supplierOrderId) throw conflict('already_created', 'A CJ order already exists. Use Refresh or Pay supplier.');
      const found = await findAtCj(o).catch(() => null);
      if (found) return recordAfterCreate(o, found);
      if (!['failed', 'needs_review'].includes(o.fulfillmentStatus) && !(o.fulfillmentStatus === 'creating' && now() - new Date(o.$updatedAt).getTime() > 10 * 60e3)) throw conflict('not_retryable', 'This order is not waiting for a retry.');
      const reset = await updateRow(T.orders, o.$id, { fulfillmentStatus: 'not_started' });
      return fulfillCj(reset, { force: true });
    }
    if (act === 'cj_cancel') {
      if (!o.supplierOrderId) throw conflict('no_cj_order', 'There is no CJ order to cancel.');
      let r; try { r = await cj.cancelOrder(o.supplierOrderId); } catch (e) { throw cjProblem(e); }
      const st = String(r.status || '').toUpperCase();
      if (st === 'SUCCESS') return updateRow(T.orders, o.$id, { fulfillmentStatus: 'canceled', supplierStatus: 'CANCELLED', lastError: '' });
      throw conflict('cj_cancel_refused', 'CJ did not cancel it (CJ only cancels orders that have not been paid at CJ). Nothing changed.');
    }
    throw bad('Unknown action.');
  }

  /* Which Photo Gifts products the owner features. Kept in its own settings row so a Printify sync can never undo it. */
  async function photoFeatured() {
    const r = await getRowOrNull(T.settings, 'featured').catch(() => null);
    const list = json(r && r.value, { photo: [] }).photo;
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string').slice(0, 40) : [];
  }
  async function adminFeaturePhoto({ user, body }) {
    requireAdmin(user);
    const key = clean(body.key, 60);
    if (!(await getRowOrNull(T.catalog, key))) throw missing('Product not found.');
    const cur = await photoFeatured();
    const next = body.featured === true ? [...new Set([...cur, key])].slice(0, 40) : cur.filter((k) => k !== key);
    const data = { value: JSON.stringify({ photo: next }) };
    try { await updateRow(T.settings, 'featured', data); } catch (e) { if (sdkCode(e) === 404) await createRow(T.settings, 'featured', data, []); else throw e; }
    return { featured: next };
  }

  const actions = {
    shopAdminFeaturePhoto: adminFeaturePhoto,
    shopCjBrowse: browse, shopCjItem: item, shopCjCart: cartGet, shopCjCartSet: cartSet, shopCjQuote: quote, shopCjCheckout: checkout,
    shopAdminCjCheck: adminCheck, shopAdminCjLookup: adminLookup, shopAdminCjSearch: adminSearch, shopAdminCjSave: adminSave, shopAdminCjList: adminList,
    shopAdminCjOpen: adminOpen, shopAdminCjToggle: adminToggle, shopAdminCjSync: adminSync, shopAdminCjDelete: adminDelete
  };
  return { actions, photoFeatured, fulfillCj, syncFromCj, adminAct, publishedCount: async () => (await publishedRows()).length, configured };
}
