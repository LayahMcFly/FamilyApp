/*
 * shop-api: all trusted shop logic. No network or SDK construction happens in this file, so it is tested with fakes.
 *
 * Trust model
 *  - `user` is the account Appwrite returns for the caller's own JWT. It is never read from the request body.
 *  - Prices, variants, shipping and totals are decided here. The browser only says WHICH saved designs and WHERE to ship.
 *  - Printify and Square secrets exist only in this function's environment.
 *  - Payment and fulfillment are two separate states. A browser redirect proves nothing: payment is confirmed by asking
 *    Square's API for the Payment and its Order (webhook events only tell us WHEN to ask).
 *  - Only payments for OUR location, tied to an order WE created (reference_id + saved Square order id), are ever looked at.
 *  - A Printify order is created only AFTER payment is verified, so nothing can enter production for an unpaid order.
 */
import { Query, Permission, Role } from 'node-appwrite';
import { ApiError, bad, forbidden, missing, conflict, idOf, intIn, rowId, sha256hex, money, publicError } from './util.js';
import { verifySquareSignature, SquareError } from './square.js';
import { PrintifyError, verifyPrintifySignature } from './printify.js';
import { planImport, packVariants, unpack, importedKey, isImportedKey, explainPrintifyFailure } from './sync.js';
import { imageSize } from './images.js';

export const T = {
  families: 'families', posts: 'posts',
  catalog: 'shopCatalog', designs: 'shopDesigns', orders: 'shopOrders', events: 'shopEvents', gifts: 'giftPermissions'
};

/** The only product slots that can ever be sold. The Printify blueprint/provider/variant IDs for each are saved by the owner
 *  through the admin screen after the server has checked them against Printify's live catalog. No ID is hard-coded here. */
export const SLOTS = {
  'framed-print': { title: 'Framed photo print', hint: 'framed', frameNote: true, section: 'gifts' },
  magnet: { title: 'Photo magnet', hint: 'magnet', section: 'gifts' },
  mug: { title: 'Photo mug', hint: 'mug', section: 'gifts' },
  blanket: { title: 'Photo blanket', hint: 'blanket', section: 'gifts' },
  puzzle: { title: 'Photo puzzle', hint: 'puzzle', section: 'gifts' },
  necklace: { title: 'Photo necklace', hint: 'necklace', section: 'jewelry' },
  bracelet: { title: 'Photo bracelet', hint: 'bracelet', section: 'jewelry' }
};

/** A design made from a photo the buyer picked or took on their own phone, not from a family post. */
export const OWN_PHOTO = 'own-upload';

export const LIMITS = { maxDesignsOpen: 20, maxQty: 10, maxLines: 10, minPrint: 600, maxDesignBytes: 5 * 1024 * 1024, specMax: 3500 };

// Payment and fulfillment are tracked separately.
const PAY_RANK = { pending_payment: 0, processing: 1, expired: 1, payment_failed: 1, paid: 3, partially_refunded: 4, refunded: 5 };
const UNFULFILLED = ['not_started', 'creating', 'created', 'failed', 'needs_review', 'has_issues'];
const FULFILL_FORWARD = ['not_started', 'creating', 'created', 'sending', 'in_production', 'shipped', 'delivered'];
const rankOf = (s) => FULFILL_FORWARD.indexOf(s);
const PRINTIFY_TO_OURS = {
  pending: 'created', 'on-hold': 'created', 'cost-calculation': 'created',
  'sending-to-production': 'sending', 'in-production': 'in_production',
  fulfilled: 'shipped', 'partially-fulfilled': 'shipped',
  canceled: 'canceled',
  'has-issues': 'has_issues', unfulfillable: 'has_issues', 'source-check-failed': 'has_issues', 'payment-not-received': 'has_issues'
};
const PRINTIFY_TOPICS = ['order:updated', 'order:sent-to-production', 'order:shipment:created', 'order:shipment:delivered', 'order:line-item:canceled'];
const sdkCode = (e) => (e && typeof e.code === 'number' ? e.code : 0);

export function stageOf(o) {
  const p = o.paymentStatus; const f = o.fulfillmentStatus;
  if (p === 'pending_payment') return { label: 'Waiting for payment', tone: 'wait' };
  if (p === 'processing') return { label: 'Payment is processing', tone: 'wait' };
  if (p === 'expired' || p === 'payment_failed') return { label: 'Payment was not completed. You were not charged for this order.', tone: 'stop' };
  if (p === 'refunded') return { label: 'Refunded', tone: 'stop' };
  const part = p === 'partially_refunded' ? ' A partial refund was issued.' : '';
  const r = stageByFulfillment(f);
  return part ? { ...r, label: r.label + part } : r;
}
function stageByFulfillment(f) {
  if (f === 'canceled') return { label: 'Canceled. The shop owner will handle any refund.', tone: 'stop' };
  if (f === 'delivered') return { label: 'Delivered', tone: 'ok' };
  if (f === 'shipped') return { label: 'Shipped', tone: 'ok' };
  if (f === 'in_production' || f === 'sending') return { label: 'In production', tone: 'ok' };
  if (f === 'created') return { label: 'Payment received. Your order is waiting to go into production.', tone: 'ok' };
  if (f === 'failed' || f === 'needs_review' || f === 'has_issues') return { label: 'Payment received. We are checking something on your order and will email you.', tone: 'warn' };
  return { label: 'Payment received. We are preparing your order.', tone: 'ok' };
}

export function createShop({ users, db, storage, square, printify, cfg, now = () => Date.now(), log = () => {} }) {
  const databaseId = cfg.databaseId;
  const listRows = (tableId, queries) => db.listRows({ databaseId, tableId, queries });
  const createRow = (tableId, id, data, permissions) => db.createRow({ databaseId, tableId, rowId: id, data, permissions });
  const updateRow = (tableId, id, data) => db.updateRow({ databaseId, tableId, rowId: id, data });
  async function getRowOrNull(tableId, id) {
    try { return await db.getRow({ databaseId, tableId, rowId: id }); } catch (e) { if (sdkCode(e) === 404) return null; throw e; }
  }
  const ownerRead = (uid) => [Permission.read(Role.user(uid))];
  const isAdmin = (user) => (cfg.adminIds || []).includes(user.$id);
  const countries = cfg.countries && cfg.countries.length ? cfg.countries : ['US'];
  const currency = (cfg.currency || 'usd').toLowerCase();
  const nowIso = () => new Date(now()).toISOString();
  const CUR = currency.toUpperCase();
  const taxPercent = Number(cfg.taxPercent || 0);
  const squareReady = () => !!(square && cfg.squareConfigured && cfg.squareLocationId);
  const notificationUrl = () => cfg.squareNotificationUrl || (cfg.webhookBase ? `${cfg.webhookBase.replace(/\/$/, '')}/webhooks/square` : '');

  /* ---------- identity ---------- */
  function requireVerifiedUser(user) {
    if (!user || !user.$id) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
    if (user.status === false) throw new ApiError(403, 'blocked', 'This account is disabled.');
    if (!user.emailVerification) throw new ApiError(403, 'email_not_verified', 'Verify your email first.');
  }
  async function requireMember(user, familyIdRaw) {
    const familyId = idOf(familyIdRaw, 'familyId');
    const res = await users.listMemberships({ userId: user.$id, queries: [Query.limit(100)] });
    const m = res.memberships.find((x) => x.confirm === true && x.teamId === familyId);
    if (!m) throw forbidden('You are not a member of this family.');
    if (!(await getRowOrNull(T.families, familyId))) throw forbidden('This family is not set up.');
    return { familyId };
  }
  function requireAdmin(user) { if (!isAdmin(user)) throw forbidden('Only the shop owner can do that.'); }

  /* ---------- photo access ---------- */
  async function loadPhoto(familyId, postIdRaw) {
    const postId = idOf(postIdRaw, 'postId');
    const post = await getRowOrNull(T.posts, postId);
    if (!post || post.familyId !== familyId || post.kind !== 'photo' || !post.mediaFileId) throw missing('That photo is not available.');
    return post;
  }
  /** The uploader decides. Family membership alone is never permission to print a photo. The uploader can always order their own. */
  async function giftAllowed(post, userId) {
    if (post.authorId === userId) return true;
    const g = await getRowOrNull(T.gifts, post.$id);
    return !!(g && g.allowed === true && g.familyId === post.familyId);
  }

  /* ---------- catalog (our saved allowlist) ---------- */
  function parseVariants(row) { return unpack(row.variants).variants; }
  const metaOf = (row) => unpack(row.variants).meta;
  const knownKey = (key) => !!SLOTS[key] || isImportedKey(key);
  const titleOf = (row, key) => (row && row.title) || (SLOTS[key] && SLOTS[key].title) || 'Product';
  /** Saved rows from the owner's own Printify shop carry a flag saying whether our photo editor can fill them. Older hand-set-up rows have no flag and are fine. */
  const sellable = (row) => { const m = metaOf(row); return !(m && (m.ok === false || m.missing === true)); };
  async function allCatalogRows() {
    const out = []; let cursor = null;
    for (let i = 0; i < 20; i++) {
      const q = [Query.limit(100)]; if (cursor) q.push(Query.cursorAfter(cursor));
      const page = (await listRows(T.catalog, q)).rows;
      out.push(...page); if (page.length < 100) break; cursor = page[page.length - 1].$id;
    }
    return out;
  }
  async function enabledProducts() {
    const rows = await allCatalogRows();
    return rows.filter((r) => r.enabled === true && knownKey(r.$id) && r.blueprintId && r.providerId && sellable(r)).map((r) => ({ row: r, variants: parseVariants(r) }));
  }
  async function productByKey(key) {
    if (!knownKey(key)) throw bad('Unknown product.');
    const row = await getRowOrNull(T.catalog, key);
    if (!row || row.enabled !== true || !sellable(row)) throw conflict('unavailable', 'That product is not available right now.');
    return { row, variants: parseVariants(row) };
  }
  const publicProduct = ({ row, variants }) => ({
    key: row.$id, title: titleOf(row, row.$id), blurb: row.blurb || '', frameNote: !!(SLOTS[row.$id] && SLOTS[row.$id].frameNote),
    position: row.position,
    variants: variants.map((v) => ({ id: v.id, label: v.label, options: v.options || {}, priceCents: v.priceCents, width: v.width, height: v.height }))
  });

  /* ---------- gift permission ---------- */
  async function setGift({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const post = await loadPhoto(familyId, body.postId);
    if (post.authorId !== user.$id) throw forbidden('Only the person who posted a photo can change this.');
    const allowed = body.allowed === true;
    const existing = await getRowOrNull(T.gifts, post.$id);
    const data = { familyId, postId: post.$id, ownerId: user.$id, allowed };
    if (existing) await updateRow(T.gifts, post.$id, data);
    else await createRow(T.gifts, post.$id, data, [Permission.read(Role.team(familyId))]);
    return { allowed };
  }
  async function giftStatus({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const ids = Array.isArray(body.postIds) ? body.postIds.slice(0, 100).map((x) => idOf(x, 'postId')) : [];
    if (!ids.length) return { allowed: {} };
    const rows = (await listRows(T.gifts, [Query.equal('familyId', [familyId]), Query.equal('postId', ids), Query.limit(100)])).rows;
    const out = {};
    rows.forEach((r) => { out[r.postId] = r.allowed === true; });
    return { allowed: out };
  }

  /* ---------- catalog action ---------- */
  async function catalogAction({ user, body }) {
    await requireMember(user, body.familyId);
    const enabled = await enabledProducts();
    const products = enabled.map(publicProduct);
    try {
      const byId = new Map(enabled.some((e) => !(metaOf(e.row) || {}).image) ? (await printify.listBlueprints()).map((b) => [Number(b.id), b]) : []);
      enabled.forEach(({ row }, i) => {
        const own = (metaOf(row) || {}).image;
        const b = byId.get(Number(row.blueprintId));
        const img = own || (b && Array.isArray(b.images) ? b.images.find((u) => typeof u === 'string' && u.startsWith('https://images.printify.com/')) : '');
        if (img) products[i].image = img;
      });
    } catch (e) { /* pictures are optional */ }
    return {
      products,
      slots: [
        ...Object.entries(SLOTS).map(([key, s]) => ({ key, title: s.title, section: s.section || 'gifts', available: products.some((p) => p.key === key) })),
        ...enabled.filter(({ row }) => isImportedKey(row.$id)).map(({ row }) => ({ key: row.$id, title: titleOf(row, row.$id), section: (metaOf(row) || {}).section === 'jewelry' ? 'jewelry' : 'gifts', available: true }))
      ],
      config: { countries, currency, maxQty: LIMITS.maxQty, supportEmail: cfg.supportEmail || '', taxPercent, testMode: cfg.squareEnvironment !== 'production', paymentsReady: squareReady() },
      isAdmin: isAdmin(user)
    };
  }

  /* ---------- designs (saved print-ready images; also the cart) ---------- */
  async function toBuffer(x) {
    if (!x) return Buffer.alloc(0);
    if (Buffer.isBuffer(x)) return x;
    if (x instanceof ArrayBuffer) return Buffer.from(x);
    if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
    return Buffer.from(x);
  }
  async function releaseIfStale(d) {
    if (!d.orderId) return d;
    let o = await getRowOrNull(T.orders, d.orderId);
    const age = o ? now() - new Date(o.$createdAt).getTime() : Infinity;
    // A Square payment link does not expire by itself, so before freeing a design we ask Square whether it was paid, and close the link.
    if (o && o.paymentStatus === 'pending_payment' && age > 35 * 60e3) { try { o = await closeUnpaid(o); } catch (e) { log('stale close failed', String(e && e.message)); return d; } }
    const dead = !o || ['expired', 'payment_failed'].includes(o.paymentStatus);
    if (dead) { await updateRow(T.designs, d.$id, { orderId: '' }); return { ...d, orderId: '' }; }
    return d;
  }
  async function saveDesign({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const own = body.postId === OWN_PHOTO;
    let post = null;
    if (own) {
      if (body.ownPhoto !== true) throw bad('Please confirm the photo is yours to use.');
    } else {
      post = await loadPhoto(familyId, body.postId);
      if (!(await giftAllowed(post, user.$id))) throw forbidden('The person who posted this photo has not allowed it to be used for gifts.');
    }
    const { row, variants } = await productByKey(String(body.productKey || ''));
    const variant = variants.find((v) => v.id === Number(body.variantId));
    if (!variant) throw conflict('unavailable', 'That size or style is not available.');
    const quantity = intIn(body.quantity ?? 1, 'Quantity', 1, LIMITS.maxQty);
    const fileId = idOf(body.fileId, 'fileId');
    const spec = JSON.stringify(body.spec && typeof body.spec === 'object' ? body.spec : {});
    if (spec.length > LIMITS.specMax) throw bad('The design details are too long.');

    const open = (await listRows(T.designs, [Query.equal('ownerId', [user.$id]), Query.equal('familyId', [familyId]), Query.equal('orderId', ['']), Query.limit(LIMITS.maxDesignsOpen + 1)])).rows;
    if (open.length >= LIMITS.maxDesignsOpen) throw bad('Your cart is full. Remove a design first.');

    let file;
    try { file = await storage.getFile({ bucketId: cfg.designBucketId, fileId }); } catch (e) { if (sdkCode(e) === 404) throw bad('The design image was not found.'); throw e; }
    const perms = file.$permissions || [];
    if (!perms.includes(Permission.update(Role.user(user.$id)))) throw forbidden('That image is not yours to use.');
    if (String(file.mimeType).toLowerCase() !== 'image/jpeg') throw bad('The design image must be a JPEG.');
    if (Number(file.sizeOriginal) > LIMITS.maxDesignBytes) throw bad('The design image is too large.');
    const bytes = await toBuffer(await storage.getFileDownload({ bucketId: cfg.designBucketId, fileId }));
    const size = imageSize(bytes);
    if (!size || size.type !== 'jpeg') throw bad('The design image could not be read.');
    const wantRatio = variant.width / variant.height;
    if (Math.abs(size.width / size.height - wantRatio) / wantRatio > 0.01) throw bad('The design image does not match the print area of this product.');
    if (size.width > variant.width || size.width < Math.min(LIMITS.minPrint, variant.width)) throw bad('The design image has the wrong size.');
    const fileSha = sha256hex(bytes);
    // Freeze the file: from now on the buyer can read it but can no longer replace or delete it, so what they approved is what is printed.
    await storage.updateFile({ bucketId: cfg.designBucketId, fileId, permissions: ownerRead(user.$id) });
    const id = rowId('design', user.$id, fileId);
    const data = { ownerId: user.$id, familyId, postId: own ? OWN_PHOTO : post.$id, productKey: row.$id, variantId: variant.id, fileId, fileSha, width: size.width, height: size.height, spec, quantity, orderId: '' };
    const created = await createRow(T.designs, id, data, ownerRead(user.$id));
    return { design: publicDesign(created, { row, variants }) };
  }
  function publicDesign(d, prod) {
    const variant = prod ? prod.variants.find((v) => v.id === d.variantId) : null;
    let spec = {}; try { spec = JSON.parse(d.spec || '{}'); } catch { spec = {}; }
    return {
      id: d.$id, postId: d.postId, productKey: d.productKey, variantId: d.variantId, quantity: d.quantity, spec, fileId: d.fileId, width: d.width, height: d.height,
      title: titleOf(prod && prod.row, d.productKey),
      variantLabel: variant ? variant.label : '', unitCents: variant ? variant.priceCents : 0, available: !!(prod && variant)
    };
  }
  async function listDesigns({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const rows = (await listRows(T.designs, [Query.equal('ownerId', [user.$id]), Query.equal('familyId', [familyId]), Query.orderDesc('$createdAt'), Query.limit(50)])).rows;
    const products = new Map((await enabledProducts()).map((p) => [p.row.$id, p]));
    const out = [];
    for (const d0 of rows) { const d = await releaseIfStale(d0); if (!d.orderId) out.push(publicDesign(d, products.get(d.productKey))); }
    return { designs: out };
  }
  async function updateDesign({ user, body }) {
    const d = await getRowOrNull(T.designs, idOf(body.designId, 'designId'));
    if (!d || d.ownerId !== user.$id) throw missing('Design not found.');
    const fresh = await releaseIfStale(d);
    if (fresh.orderId) throw conflict('in_order', 'This design is part of an order already.');
    if (body.remove === true) {
      await db.deleteRow({ databaseId, tableId: T.designs, rowId: d.$id });
      try { await storage.deleteFile({ bucketId: cfg.designBucketId, fileId: d.fileId }); } catch (e) { if (sdkCode(e) !== 404) throw e; }
      return { removed: true };
    }
    await updateRow(T.designs, d.$id, { quantity: intIn(body.quantity, 'Quantity', 1, LIMITS.maxQty) });
    return { updated: true };
  }

  /* ---------- pricing, address, shipping ---------- */
  function cleanAddress(a, user) {
    if (!a || typeof a !== 'object') throw bad('Add a delivery address.');
    const t = (v, label, max, required = true) => {
      const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
      if (required && !s) throw bad(`${label} is required.`);
      if (s.length > max) throw bad(`${label} is too long.`);
      return s;
    };
    const country = t(a.country || 'US', 'Country', 2).toUpperCase();
    if (!countries.includes(country)) throw bad('Delivery to that country is not available yet.');
    const out = {
      first_name: t(a.first_name, 'First name', 40), last_name: t(a.last_name, 'Last name', 40),
      address1: t(a.address1, 'Street address', 80), address2: t(a.address2, 'Apartment or suite', 80, false),
      city: t(a.city, 'City', 60), region: t(a.region, 'State', 40).toUpperCase(), zip: t(a.zip, 'ZIP code', 12), country,
      phone: t(a.phone, 'Phone', 25, false), email: String(user.email || '')
    };
    if (country === 'US') {
      if (!/^[A-Z]{2}$/.test(out.region)) throw bad('Use the two-letter state code, like GA.');
      if (!/^\d{5}(-\d{4})?$/.test(out.zip)) throw bad('Enter a 5-digit ZIP code.');
    }
    if (!out.email) throw bad('Your account needs an email address.');
    return out;
  }
  async function priceDesigns(user, familyId, designIdsRaw) {
    const ids = Array.isArray(designIdsRaw) ? [...new Set(designIdsRaw.map((x) => idOf(x, 'designId')))] : [];
    if (!ids.length) throw bad('Your cart is empty.');
    if (ids.length > LIMITS.maxLines) throw bad(`An order can have up to ${LIMITS.maxLines} designs.`);
    const rows = (await listRows(T.designs, [Query.equal('$id', ids), Query.limit(ids.length)])).rows;
    if (rows.length !== ids.length) throw missing('A design in your cart was not found.');
    const lines = [];
    for (let d of rows) {
      if (d.ownerId !== user.$id || d.familyId !== familyId) throw forbidden('That design is not yours.');
      d = await releaseIfStale(d);
      if (d.orderId) throw conflict('in_order', 'A design in your cart is already part of another order.');
      const prod = await productByKey(d.productKey);
      const variant = prod.variants.find((v) => v.id === d.variantId);
      if (!variant) throw conflict('unavailable', `${titleOf(prod.row, d.productKey)}: that size or style is no longer available.`);
      const post = d.postId === OWN_PHOTO ? OWN_PHOTO : await loadPhoto(familyId, d.postId).catch(() => null);
      if (!post || (post !== OWN_PHOTO && !(await giftAllowed(post, user.$id)))) throw conflict('photo_not_allowed', 'One of the photos can no longer be used for gifts. Remove that design from your cart.');
      lines.push({
        designId: d.$id, postId: d.postId, productKey: d.productKey, title: titleOf(prod.row, d.productKey), variantId: variant.id, variantLabel: variant.label,
        blueprintId: prod.row.blueprintId, providerId: prod.row.providerId, position: prod.row.position, quantity: d.quantity,
        unitCents: variant.priceCents, fileId: d.fileId, fileSha: d.fileSha, width: d.width, height: d.height
      });
    }
    const subtotalCents = lines.reduce((n, l) => n + l.unitCents * l.quantity, 0);
    return { lines, subtotalCents };
  }
  async function shippingFor(lines, address) {
    let res;
    try {
      res = await printify.shippingCost(lines.map((l) => ({ print_provider_id: l.providerId, blueprint_id: l.blueprintId, variant_id: l.variantId, quantity: l.quantity })), address);
    } catch (e) {
      if (e instanceof PrintifyError && (e.status === 400 || e.status === 422)) throw conflict('shipping_unavailable', 'We could not get shipping for that address. Check it and try again.');
      throw publicError(e, 'Shipping could not be calculated right now. Please try again.');
    }
    const cents = Number(res && res.standard);
    if (!Number.isInteger(cents) || cents < 0) throw conflict('shipping_unavailable', 'Standard shipping is not available to that address.');
    return cents;
  }
  async function quote({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const address = cleanAddress(body.address, user);
    const { lines, subtotalCents } = await priceDesigns(user, familyId, body.designIds);
    const shippingCents = await shippingFor(lines, address);
    return { lines: lines.map(({ title, variantLabel, quantity, unitCents }) => ({ title, variantLabel, quantity, unitCents })), subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents, currency, taxNote: taxPercent > 0 ? `Sales tax of ${taxPercent}% is added on Square\u2019s payment page.` : 'No sales tax is added by this shop.' };
  }

  /* ---------- checkout ---------- */
  const publicOrder = (o, { withAddress = false } = {}) => {
    let items = []; try { items = JSON.parse(o.items || '[]'); } catch { items = []; }
    let tracking = []; try { tracking = JSON.parse(o.tracking || '[]'); } catch { tracking = []; }
    let address = null; if (withAddress) { try { address = JSON.parse(o.address || 'null'); } catch { address = null; } }
    return {
      id: o.$id, familyId: o.familyId, createdAt: o.$createdAt, currency: o.currency, subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents || 0, totalCents: o.totalCents,
      paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus, stage: stageOf(o),
      items: items.map((i) => ({ title: i.title, variantLabel: i.variantLabel, quantity: i.quantity, unitCents: i.unitCents, designId: i.designId })),
      tracking, address
    };
  };
  /** What Square built must match what we priced: our location, our reference id, our amounts, and only a tax we expect. Returns '' when fine. */
  function squareOrderProblem(sq, orderId, subtotalCents, shippingCents) {
    if (!sq || typeof sq !== 'object') return 'no order returned';
    if (sq.location_id !== cfg.squareLocationId) return 'location';
    if (sq.reference_id !== orderId) return 'reference';
    const total = Number(sq.total_money && sq.total_money.amount);
    const tax = Number((sq.total_tax_money && sq.total_tax_money.amount) || 0);
    if (!Number.isInteger(total) || String((sq.total_money || {}).currency).toUpperCase() !== CUR) return 'currency';
    if (total !== subtotalCents + shippingCents + tax) return 'total';
    if (taxPercent === 0 && tax !== 0) return 'unexpected tax';
    if (taxPercent > 0 && (tax > Math.ceil((subtotalCents + shippingCents) * taxPercent / 100) + 1 || tax < Math.floor(subtotalCents * taxPercent / 100) - 1)) return 'tax amount';
    const lines = Array.isArray(sq.line_items) ? sq.line_items : [];
    if (lines.length) {
      const sum = lines.reduce((n, l) => n + Number(l.quantity) * Number(l.base_price_money && l.base_price_money.amount), 0);
      if (sum !== subtotalCents) return 'items';
    }
    return '';
  }
  async function failCheckout(orderId, lines, why, e) {
    log('square checkout failed', why, e instanceof SquareError ? `${e.status} ${e.codes.join(',')}` : String(e && e.message));
    await updateRow(T.orders, orderId, { paymentStatus: 'payment_failed', lastError: 'Checkout could not be started.' });
    for (const l of lines) await updateRow(T.designs, l.designId, { orderId: '' });
    throw new ApiError(502, 'checkout_failed', 'Payment could not be started. You were not charged. Please try again.');
  }
  async function checkout({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    if (body.consentImage !== true || body.consentDelivery !== true) throw bad('Please confirm both permission boxes before paying.');
    if (!squareReady()) throw new ApiError(503, 'payments_not_ready', 'Payments are not set up yet. Please try again later.');
    const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId) ? body.requestId : null;
    if (!requestId) throw bad('Missing request id.');
    const orderId = rowId('order', user.$id, requestId);
    const existing = await getRowOrNull(T.orders, orderId);
    if (existing) {
      if (existing.ownerId !== user.$id) throw forbidden();
      return { orderId, url: existing.paymentStatus === 'pending_payment' ? existing.checkoutUrl : '', reused: true };
    }
    const address = cleanAddress(body.address, user);
    const { lines, subtotalCents } = await priceDesigns(user, familyId, body.designIds);
    const shippingCents = await shippingFor(lines, address);
    const row = {
      ownerId: user.$id, familyId, paymentStatus: 'pending_payment', fulfillmentStatus: 'not_started', items: JSON.stringify(lines), address: JSON.stringify(address),
      subtotalCents, shippingCents, taxCents: 0, totalCents: subtotalCents + shippingCents, currency, paymentProvider: 'square', squarePaymentLinkId: '', squareOrderId: '', squarePaymentId: '', refundedCents: 0,
      checkoutUrl: '', printifyOrderId: '', tracking: '[]', lastError: '', consentAt: nowIso(), consentVersion: 2, needsReview: ''
    };
    await createRow(T.orders, orderId, row, ownerRead(user.$id));
    for (const l of lines) await updateRow(T.designs, l.designId, { orderId });
    const short = orderId.slice(0, 8);
    const request = {
      idempotency_key: orderId,
      description: `FamilyCircle order ${short}`,
      payment_note: `FamilyCircle order ${short}`,
      order: {
        location_id: cfg.squareLocationId,
        reference_id: orderId,
        metadata: { orderId, familyId },
        line_items: lines.map((l) => ({ name: `${l.title} (${l.variantLabel})`.slice(0, 500), quantity: String(l.quantity), base_price_money: { amount: l.unitCents, currency: CUR }, metadata: { designId: l.designId } })),
        ...(taxPercent > 0 ? { taxes: [{ uid: 'sales-tax', name: 'Sales tax', type: 'ADDITIVE', percentage: String(taxPercent), scope: 'ORDER' }] } : {})
      },
      checkout_options: {
        redirect_url: `${cfg.siteUrl}#/orders/${orderId}/done`,
        ask_for_shipping_address: false,                 // the address was collected in the app, so shipping could be priced BEFORE payment
        allow_tipping: false, enable_coupon: false, enable_loyalty: false,
        ...(shippingCents > 0 ? { shipping_fee: { name: 'Standard shipping', charge: { amount: shippingCents, currency: CUR } } } : {}),
        ...(cfg.supportEmail ? { merchant_support_email: cfg.supportEmail } : {})
      },
      pre_populated_data: { buyer_email: user.email }
    };
    let link;
    try { link = await square.createPaymentLink(request); } catch (e) { return failCheckout(orderId, lines, 'create', e); }
    const pl = (link && link.payment_link) || {};
    const url = String(pl.url || pl.long_url || '');
    if (!pl.id || !pl.order_id || !/^https:\/\//.test(url)) return failCheckout(orderId, lines, 'unexpected response');
    let sq = ((link.related_resources && link.related_resources.orders) || []).find((x) => x && x.id === pl.order_id);
    try { if (!sq) sq = (await square.retrieveOrder(pl.order_id)).order; } catch (e) { sq = null; }
    const problem = squareOrderProblem(sq, orderId, subtotalCents, shippingCents);
    if (problem) { try { await square.deletePaymentLink(pl.id); } catch { /* the order row is already marked failed below, and a payment for it would be held */ } return failCheckout(orderId, lines, `order check: ${problem}`); }
    const taxCents = Number((sq.total_tax_money && sq.total_tax_money.amount) || 0);
    await updateRow(T.orders, orderId, { squarePaymentLinkId: pl.id, squareOrderId: pl.order_id, checkoutUrl: url, taxCents, totalCents: Number(sq.total_money.amount) });
    return { orderId, url };
  }
  async function cancelOrder({ user, body }) {
    let o = await getRowOrNull(T.orders, idOf(body.orderId, 'orderId'));
    if (!o || o.ownerId !== user.$id) throw missing('Order not found.');
    if (o.paymentStatus !== 'pending_payment') throw conflict('not_cancelable', 'This order was already paid or closed. Contact the shop owner to cancel it.');
    o = await closeUnpaid(o);
    return { order: publicOrder(o) };
  }
  /** A Square payment link has no expiry of its own. Before an unpaid order is closed we ask Square whether it was paid, then delete the link. */
  async function closeUnpaid(o) {
    if (o.paymentStatus !== 'pending_payment') return o;
    let note = '';
    if (o.paymentProvider === 'square' && o.squareOrderId && squareReady()) {
      const cur = await reconcile(o);
      if (cur.paymentStatus !== 'pending_payment') return cur;           // it was paid (or is processing): do not close it
      if (o.squarePaymentLinkId) { try { await square.deletePaymentLink(o.squarePaymentLinkId); } catch (e) { if (!(e instanceof SquareError && e.status === 404)) log('link delete failed', String(e && e.message)); } }
    } else if (o.paymentProvider !== 'square') note = 'Closed after the shop moved to Square. If this order was paid through the old payment provider, tell the shop owner.';
    const closed = await updateRow(T.orders, o.$id, { paymentStatus: 'expired', lastError: note });
    await releaseOrderDesigns(closed);
    return closed;
  }

  /* ---------- payment: Square is asked, never believed from the browser or from an event body ---------- */
  function orderIsHeld(o) { return o.fulfillmentStatus === 'needs_review'; }
  async function releaseOrderDesigns(o) {
    let items = []; try { items = JSON.parse(o.items || '[]'); } catch { items = []; }
    for (const i of items) { try { await updateRow(T.designs, i.designId, { orderId: '' }); } catch (e) { if (sdkCode(e) !== 404) throw e; } }
  }
  const notFound = (e) => e instanceof SquareError && e.status === 404;
  /** Fetches the payment and its order from Square, and returns our order only when it is one of ours at our location. Otherwise null (ignored). */
  async function locate(paymentId, known) {
    let payment;
    try { payment = (await square.retrievePayment(paymentId)).payment; } catch (e) { if (notFound(e)) return null; throw e; }
    if (!payment || payment.location_id !== cfg.squareLocationId || !payment.order_id) return null;
    let sq = known && known.id === payment.order_id ? known : null;
    try { if (!sq) sq = (await square.retrieveOrder(payment.order_id)).order; } catch (e) { if (notFound(e)) return null; throw e; }
    const ref = sq && sq.reference_id;
    if (!sq || typeof ref !== 'string' || !/^[a-f0-9]{35}$/.test(ref) || sq.location_id !== cfg.squareLocationId) return null;
    const o = await getRowOrNull(T.orders, ref);
    if (!o || o.paymentProvider !== 'square' || o.squareOrderId !== sq.id) return null;           // an unrelated payment on this Square account
    return { o, payment, sq };
  }
  async function applyPayment(paymentId, known) {
    const hit = await locate(paymentId, known);
    return hit ? applyPaymentToOrder(hit.o, hit.payment, hit.sq) : null;
  }
  async function applyPaymentToOrder(o, payment, sq) {
    const st = String(payment.status);
    if (st === 'COMPLETED') return markPaid(o, payment, sq);
    if (PAY_RANK[o.paymentStatus] >= PAY_RANK.paid) return o;
    if (st === 'APPROVED' || st === 'PENDING') {
      if (o.paymentStatus === 'pending_payment') return updateRow(T.orders, o.$id, { paymentStatus: 'processing', squarePaymentId: payment.id });
      return o;
    }
    if (st === 'FAILED' || st === 'CANCELED') {
      if (o.paymentStatus === 'processing') { const f = await updateRow(T.orders, o.$id, { paymentStatus: 'payment_failed', lastError: '' }); await releaseOrderDesigns(f); return f; }
      return o;       // one declined attempt: the Square page stays open for another try, so the order keeps waiting
    }
    return o;
  }
  async function markPaid(o, payment, sq) {
    if (PAY_RANK[o.paymentStatus] >= PAY_RANK.paid) {            // duplicate or out-of-order event
      if (o.squarePaymentId && o.squarePaymentId !== payment.id && !String(o.lastError || '').includes(payment.id)) {
        return updateRow(T.orders, o.$id, { lastError: `A second payment (${payment.id}) was received for this order. Refund the extra payment in Square.` });
      }
      return o;
    }
    const problems = [];
    const total = Number(payment.total_money && payment.total_money.amount);
    if (total !== o.totalCents) problems.push('amount');
    if (Number((payment.tip_money && payment.tip_money.amount) || 0) !== 0) problems.push('tip');
    if (String((payment.total_money || {}).currency).toUpperCase() !== CUR) problems.push('currency');
    if (!sq || Number(sq.total_money && sq.total_money.amount) !== o.totalCents) problems.push('order total');
    if (!sq || !['OPEN', 'COMPLETED'].includes(String(sq.state))) problems.push('order state');
    if (!sq || !sq.metadata || sq.metadata.orderId !== o.$id) problems.push('order reference');
    const lines = sq && Array.isArray(sq.line_items) ? sq.line_items : [];
    if (lines.length && lines.reduce((n, l) => n + Number(l.quantity) * Number(l.base_price_money && l.base_price_money.amount), 0) !== o.subtotalCents) problems.push('items');
    if (['expired', 'payment_failed'].includes(o.paymentStatus)) problems.push('order had already been closed');
    const refunded = Number((payment.refunded_money && payment.refunded_money.amount) || 0);
    const data = { paymentStatus: 'paid', paidAt: nowIso(), squarePaymentId: payment.id, refundedCents: refunded };
    if (refunded > 0) { data.paymentStatus = refunded >= o.totalCents ? 'refunded' : 'partially_refunded'; problems.push('payment was refunded'); }
    if (problems.length) { data.fulfillmentStatus = 'needs_review'; data.lastError = `Payment did not match the order (${problems.join(', ')}). Nothing was sent to production.`; }
    const paidRow = await updateRow(T.orders, o.$id, data);
    if (problems.length || paidRow.paymentStatus !== 'paid') return paidRow;
    return fulfill(paidRow.$id);
  }
  async function reconcile(o) {
    if (o.paymentProvider !== 'square' || !o.squareOrderId || !squareReady()) return o;
    let sq;
    try { sq = (await square.retrieveOrder(o.squareOrderId)).order; } catch (e) { if (notFound(e)) return o; throw e; }
    if (!sq) return o;
    let cur = o;
    for (const t of sq.tenders || []) { const pid = t && (t.payment_id || t.id); if (pid) cur = (await applyPayment(String(pid), sq)) || cur; }
    return cur;
  }
  /* ---------- refunds (made by the owner in Square; we only record them) ---------- */
  async function recordRefund(o, payment, refund) {
    const prior = Number(o.refundedCents || 0);
    const total = Math.max(prior, Number((payment.refunded_money && payment.refunded_money.amount) || 0), refund ? Number((refund.amount_money && refund.amount_money.amount) || 0) : 0);
    if (total <= prior && PAY_RANK[o.paymentStatus] >= PAY_RANK.partially_refunded) return o;
    const next = total >= o.totalCents ? 'refunded' : 'partially_refunded';
    const data = { refundedCents: total };
    if (PAY_RANK[next] > PAY_RANK[o.paymentStatus]) data.paymentStatus = next;
    if (next === 'refunded' && UNFULFILLED.includes(o.fulfillmentStatus)) { data.fulfillmentStatus = 'needs_review'; data.lastError = 'Refunded in Square. If production has not started, cancel the order at Printify.'; }
    return updateRow(T.orders, o.$id, data);
  }
  async function applyRefund(refundId) {
    let refund;
    try { refund = (await square.retrieveRefund(refundId)).refund; } catch (e) { if (notFound(e)) return null; throw e; }
    if (!refund || !refund.payment_id) return null;
    const hit = await locate(String(refund.payment_id));
    if (!hit) return null;
    let { o } = hit;
    if (PAY_RANK[o.paymentStatus] < PAY_RANK.paid) o = await applyPaymentToOrder(o, hit.payment, hit.sq);      // events can arrive out of order: payment first
    if (String(refund.status) !== 'COMPLETED') return o;
    return recordRefund(o, hit.payment, refund);
  }
  async function refreshRefunds(o) {
    if (o.paymentProvider !== 'square' || !o.squarePaymentId || !squareReady()) return o;
    const payment = (await square.retrievePayment(o.squarePaymentId)).payment;
    return payment && Number((payment.refunded_money && payment.refunded_money.amount) || 0) > Number(o.refundedCents || 0) ? recordRefund(o, payment, null) : o;
  }

  /* ---------- fulfillment: only ever after verified payment ---------- */
  function printifyFailure(e) {
    if (e instanceof PrintifyError) return `Printify answered with error ${e.status}.`;
    return 'The printing service could not be reached.';
  }
  async function fulfill(orderId, { force = false } = {}) {
    let o = await getRowOrNull(T.orders, orderId);
    if (!o) throw missing('Order not found.');
    if (o.paymentStatus !== 'paid') return o;
    if (['creating', 'created', 'sending', 'in_production', 'shipped', 'delivered', 'canceled'].includes(o.fulfillmentStatus)) return o;
    if (orderIsHeld(o) && !force) return o;
    o = await updateRow(T.orders, o.$id, { fulfillmentStatus: 'creating', lastError: '' });
    let items = JSON.parse(o.items || '[]');
    const address = JSON.parse(o.address || '{}');
    try {
      for (const it of items) {
        // Rechecked now, not just when the cart was built: the uploader may have turned gifts off, or deleted the photo.
        const post = it.postId === OWN_PHOTO ? OWN_PHOTO : await loadPhoto(o.familyId, it.postId).catch(() => null);
        if (!post || (post !== OWN_PHOTO && !(await giftAllowed(post, o.ownerId)))) {
          return await updateRow(T.orders, o.$id, { fulfillmentStatus: 'needs_review', lastError: 'A photo in this order is no longer allowed for gifts. Nothing was sent to production.' });
        }
        if (!it.printifyImageUrl) {
          const bytes = await toBuffer(await storage.getFileDownload({ bucketId: cfg.designBucketId, fileId: it.fileId }));
          if (sha256hex(bytes) !== it.fileSha) return await updateRow(T.orders, o.$id, { fulfillmentStatus: 'needs_review', lastError: 'A design file changed after it was approved. Nothing was sent to production.' });
          if (bytes.length > LIMITS.maxDesignBytes) return await updateRow(T.orders, o.$id, { fulfillmentStatus: 'needs_review', lastError: 'A design file is too large to send.' });
          const up = await printify.uploadImageBase64(`familycircle-${o.$id.slice(0, 8)}-${it.designId.slice(0, 8)}.jpg`, bytes.toString('base64'));
          it.printifyImageUrl = up && up.preview_url; it.printifyImageId = up && up.id;
          if (!it.printifyImageUrl) throw new Error('upload_no_url');
          await updateRow(T.orders, o.$id, { items: JSON.stringify(items) });      // keep it: a retry will not upload again
        }
      }
      const order = {
        external_id: o.$id,
        label: `FC-${o.$id.slice(0, 8)}`,
        line_items: items.map((it) => ({
          print_provider_id: it.providerId, blueprint_id: it.blueprintId, variant_id: it.variantId, quantity: it.quantity, external_id: it.designId,
          print_areas: { [it.position]: [{ src: it.printifyImageUrl, scale: 1, x: 0.5, y: 0.5, angle: 0 }] }
        })),
        shipping_method: 1,
        send_shipping_notification: true,
        address_to: address
      };
      let created;
      try { created = await printify.createOrder(order); }
      catch (e) {
        if (e instanceof PrintifyError && e.status === 409 && e.body && (e.body.id || (e.body.errors && e.body.errors.id))) created = { id: e.body.id || e.body.errors.id };     // same external_id: it already exists
        else throw e;
      }
      const costCents = Number(created.total_price || 0) + Number(created.total_shipping || 0);
      const paidForProduction = o.subtotalCents + o.shippingCents;
      const data = { printifyOrderId: String(created.id), printifyStatus: String(created.status || 'pending'), fulfillmentStatus: 'created', printifyCostCents: costCents || 0 };
      if (costCents && costCents > paidForProduction) { data.fulfillmentStatus = 'needs_review'; data.lastError = `Printify's cost (${money(costCents)}) is higher than the customer paid for items and shipping (${money(paidForProduction)}). The Printify order was created but NOT approved.`; }
      o = await updateRow(T.orders, o.$id, data);
      if (o.fulfillmentStatus === 'created' && cfg.autoSubmit) o = await submitToProduction(o);
      return o;
    } catch (e) {
      log('fulfill failed', orderId, e && e.status, e && e.message);
      return updateRow(T.orders, o.$id, { fulfillmentStatus: 'failed', lastError: `${printifyFailure(e)} Nothing was charged by Printify for a failed request. You can retry from the admin screen.` });
    }
  }
  async function submitToProduction(o) {
    if (!o.printifyOrderId) throw conflict('no_printify_order', 'There is no Printify order to approve yet.');
    if (o.paymentStatus !== 'paid') throw conflict('not_paid', 'This order has not been paid, or it was refunded.');
    if (o.paymentProvider === 'square') {            // a refund made after payment must stop approval, so ask Square again right now
      const cur = await refreshRefunds(o);
      if (cur.paymentStatus !== 'paid') throw conflict('refunded', 'This order was refunded in Square, so it was not sent to production.');
      o = cur;
    }
    await printify.sendToProduction(o.printifyOrderId);
    return updateRow(T.orders, o.$id, { fulfillmentStatus: 'sending', lastError: '' });
  }

  /* ---------- keeping our status in step with Printify (always from the authenticated API, never from a webhook body) ---------- */
  async function syncFromPrintify(o) {
    if (!o.printifyOrderId) return o;
    const p = await printify.getOrder(o.printifyOrderId);
    const mapped = PRINTIFY_TO_OURS[String(p.status)] || null;
    const shipments = (Array.isArray(p.shipments) ? p.shipments : []).map((s) => ({ carrier: s.carrier || '', number: s.number || '', url: s.url || '', deliveredAt: s.delivered_at || null }));
    let next = mapped;
    if (next === 'shipped' && shipments.length && shipments.every((s) => s.deliveredAt)) next = 'delivered';
    if (!next) return o;
    const cur = o.fulfillmentStatus;
    const data = { printifyStatus: String(p.status), tracking: JSON.stringify(shipments) };
    const moveAllowed = () => {
      if (cur === 'canceled' || cur === 'delivered') return false;
      if (next === 'canceled' || next === 'has_issues') return true;
      if (cur === 'needs_review' || cur === 'failed' || cur === 'has_issues') return rankOf(next) >= rankOf('created');   // an admin or Printify moved it on
      return rankOf(next) > rankOf(cur);                                                    // never backwards (events can arrive late or twice)
    };
    if (moveAllowed() && cur !== next) data.fulfillmentStatus = next;
    if (cur === 'needs_review' && !data.fulfillmentStatus) delete data.fulfillmentStatus;
    return updateRow(T.orders, o.$id, data);
  }

  /* ---------- orders (buyer only) ---------- */
  async function myOrders({ user }) {
    const rows = (await listRows(T.orders, [Query.equal('ownerId', [user.$id]), Query.orderDesc('$createdAt'), Query.limit(50)])).rows;
    return { orders: rows.map((o) => publicOrder(o)) };
  }
  async function getOrder({ user, body }) {
    let o = await getRowOrNull(T.orders, idOf(body.orderId, 'orderId'));
    if (!o || o.ownerId !== user.$id) throw missing('Order not found.');     // not even other family members, or tree admins, can open it
    if (body.refresh === true) {
      try {
        if (o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing') o = await reconcile(o);
        else if (o.printifyOrderId && now() - new Date(o.$updatedAt).getTime() > 20000) o = await syncFromPrintify(o);
      } catch (e) { log('refresh failed', String(e && e.message)); }
    }
    return { order: publicOrder(o, { withAddress: true }), supportEmail: cfg.supportEmail || '' };
  }

  /* ---------- webhooks ---------- */
  async function seenEvent(source, eventId) { return !!(await getRowOrNull(T.events, rowId(source, eventId))); }
  async function recordEvent(source, eventId, type, note) {
    try { await createRow(T.events, rowId(source, eventId), { source, eventId: String(eventId).slice(0, 80), type: String(type).slice(0, 80), note: String(note || '').slice(0, 200) }, []); }
    catch (e) { if (sdkCode(e) !== 409) throw e; }
  }
  let merchantOk = null;     // cached: does the event's merchant match the merchant that owns our location?
  async function merchantMatches(merchantId) {
    if (!merchantId) return true;
    if (!merchantOk) { try { const loc = (await square.retrieveLocation(cfg.squareLocationId)).location; merchantOk = loc && loc.merchant_id ? loc.merchant_id : ''; } catch { return true; } }
    return !merchantOk || merchantOk === merchantId;
  }
  async function squareWebhook(raw, headers) {
    if (!cfg.squareWebhookSignatureKey || !notificationUrl() || !squareReady()) return { status: 503, json: { ok: false, error: 'not_configured' } };
    if (!verifySquareSignature(raw, headers['x-square-hmacsha256-signature'], cfg.squareWebhookSignatureKey, notificationUrl())) return { status: 400, json: { ok: false, error: 'bad_signature' } };
    let ev; try { ev = JSON.parse(raw); } catch { return { status: 400, json: { ok: false, error: 'bad_json' } }; }
    if (!ev || typeof ev.event_id !== 'string' || typeof ev.type !== 'string') return { status: 400, json: { ok: false, error: 'bad_event' } };
    if (await seenEvent('square', ev.event_id)) return { status: 200, json: { ok: true, duplicate: true } };
    let note = 'ignored';
    if (!(await merchantMatches(ev.merchant_id))) note = 'other merchant';
    else {
      // The event only says WHICH payment or refund changed. Square is asked for the facts.
      const obj = ev.data && ev.data.object;
      if ((ev.type === 'payment.created' || ev.type === 'payment.updated') && obj && obj.payment && typeof obj.payment.id === 'string') {
        note = (await applyPayment(obj.payment.id)) ? '' : 'not one of our orders';
      } else if ((ev.type === 'refund.created' || ev.type === 'refund.updated') && obj && obj.refund && typeof obj.refund.id === 'string') {
        note = (await applyRefund(obj.refund.id)) ? '' : 'not one of our orders';
      }
    }
    await recordEvent('square', ev.event_id, ev.type, note);
    return { status: 200, json: { ok: true } };
  }
  async function printifyWebhook(raw, headers) {
    if (!cfg.printifyWebhookSecret) return { status: 503, json: { ok: false, error: 'not_configured' } };
    if (!verifyPrintifySignature(raw, headers['x-pfy-signature'], cfg.printifyWebhookSecret)) return { status: 400, json: { ok: false, error: 'bad_signature' } };
    let ev; try { ev = JSON.parse(raw); } catch { return { status: 400, json: { ok: false, error: 'bad_json' } }; }
    const printifyId = ev && ev.resource && ev.resource.id ? String(ev.resource.id) : '';
    const evId = ev && ev.id ? String(ev.id) : '';
    if (!evId || !printifyId || typeof ev.type !== 'string') return { status: 200, json: { ok: true, ignored: true } };
    if (await seenEvent('printify', evId)) return { status: 200, json: { ok: true, duplicate: true } };
    if (ev.type.startsWith('order:')) {
      // The body only tells us WHICH Printify order changed. Current facts come from the authenticated API.
      let o = (await listRows(T.orders, [Query.equal('printifyOrderId', [printifyId]), Query.limit(1)])).rows[0];
      let live = null;
      if (!o) {
        // Can arrive before we saved the Printify id (the shop order id travels as metadata.shop_order_id).
        live = await printify.getOrder(printifyId);
        const mine = live && live.metadata && live.metadata.shop_order_id;
        if (mine) o = await getRowOrNull(T.orders, String(mine));
        if (o && !o.printifyOrderId) o = await updateRow(T.orders, o.$id, { printifyOrderId: printifyId });
      }
      if (o) await syncFromPrintify(o);
      else { await recordEvent('printify', evId, ev.type, 'unmatched order'); return { status: 200, json: { ok: true, unmatched: true } }; }
    }
    await recordEvent('printify', evId, ev.type, '');
    return { status: 200, json: { ok: true } };
  }

  /* ---------- store owner only ---------- */
  const adminOrderRow = (o) => ({ ...publicOrder(o), buyerId: o.ownerId, printifyOrderId: o.printifyOrderId || '', printifyStatus: o.printifyStatus || '', printifyCostCents: o.printifyCostCents || 0, lastError: o.lastError || '', paymentProvider: o.paymentProvider || 'stripe (old order)', squareOrderId: o.squareOrderId || '', squarePaymentId: o.squarePaymentId || '', oldStripeRef: o.paymentProvider ? '' : (o.stripePaymentIntent || o.stripeSessionId || ''), refundedCents: o.refundedCents || 0 });
  async function adminCheck({ user }) {
    requireAdmin(user);
    let printifyShops = null, printifyShopsError = '';
    if (cfg.printifyConfigured) { try { const list = await printify.listShops(); printifyShops = (Array.isArray(list) ? list : []).map((x) => ({ id: x.id, title: String(x.title || '').slice(0, 80), channel: String(x.sales_channel || '') })); } catch (e) { printifyShopsError = 'Printify did not accept the token (or could not be reached).'; } }
    let squareLocation = null;
    if (squareReady()) { try { const l = (await square.retrieveLocation(cfg.squareLocationId)).location || {}; squareLocation = { name: String(l.name || '').slice(0, 80), status: String(l.status || ''), currency: String(l.currency || ''), country: String(l.country || '') }; } catch (e) { squareLocation = { error: e instanceof SquareError ? `Square said no (${e.status}${e.codes[0] ? ' ' + e.codes[0] : ''}). Check the access token, the environment and the location ID.` : 'Square could not be reached.' }; } }
    return {
      printifyShops, printifyShopsError,
      configured: { squareToken: !!cfg.squareConfigured, squareLocation: !!cfg.squareLocationId, squareWebhookKey: !!cfg.squareWebhookSignatureKey, printifyToken: !!cfg.printifyConfigured, printifyShop: !!cfg.printifyShopId, printifyWebhookSecret: !!cfg.printifyWebhookSecret, webhookBase: !!cfg.webhookBase, supportEmail: !!cfg.supportEmail },
      squareEnvironment: cfg.squareEnvironment === 'production' ? 'production' : 'sandbox', squareLocation,
      squareNotificationUrl: notificationUrl(), taxPercent,
      autoSubmit: !!cfg.autoSubmit, countries, webhookBase: cfg.webhookBase || ''
    };
  }
  async function adminOverview({ user }) {
    requireAdmin(user);
    const rows = (await listRows(T.orders, [Query.orderDesc('$createdAt'), Query.limit(50)])).rows;
    const catalog = await allCatalogRows();
    const imported = catalog.filter((r) => isImportedKey(r.$id)).map((r) => { const m = metaOf(r) || {}; const vs = parseVariants(r); const prices = vs.map((v) => v.priceCents); return { key: r.$id, title: r.title, enabled: r.enabled === true, supported: m.ok !== false, reason: m.reason || '', notes: m.notes || [], image: m.image || '', section: m.section === 'jewelry' ? 'jewelry' : 'gifts', visible: !!m.visible, missing: !!m.missing, variantCount: vs.length, minCents: prices.length ? Math.min(...prices) : 0, maxCents: prices.length ? Math.max(...prices) : 0, syncedAt: m.syncedAt || '', printifyId: m.pid || '', blueprintId: r.blueprintId, providerId: r.providerId, position: r.position }; });
    return { orders: rows.map(adminOrderRow), imported, products: Object.entries(SLOTS).map(([key, s]) => { const r = catalog.find((c) => c.$id === key); return { key, title: s.title, section: s.section || 'gifts', saved: !!r, enabled: !!(r && r.enabled), blueprintId: r ? r.blueprintId : null, providerId: r ? r.providerId : null, variantCount: r ? parseVariants(r).length : 0, verifiedAt: r ? r.verifiedAt : '' }; }) };
  }
  async function adminOrder({ user, body }) {
    requireAdmin(user);
    const o = await getRowOrNull(T.orders, idOf(body.orderId, 'orderId'));
    if (!o) throw missing('Order not found.');
    return { order: { ...adminOrderRow(o), address: JSON.parse(o.address || 'null'), email: (JSON.parse(o.address || '{}')).email } };
  }
  async function adminBlueprints({ user, body }) {
    requireAdmin(user);
    const q = String(body.query || '').toLowerCase().trim();
    if (q.length < 3) throw bad('Type at least 3 letters.');
    const list = await printify.listBlueprints();
    return { blueprints: list.filter((b) => `${b.title} ${b.brand} ${b.model}`.toLowerCase().includes(q)).slice(0, 25).map((b) => ({ id: b.id, title: b.title, brand: b.brand, model: b.model })) };
  }
  async function adminProviders({ user, body }) {
    requireAdmin(user);
    const list = await printify.listProviders(intIn(body.blueprintId, 'blueprintId', 1, 1e9));
    return { providers: list.map((p) => ({ id: p.id, title: p.title, location: p.location || null, productionDays: p.production_time ? p.production_time.average : null })) };
  }
  async function adminVariants({ user, body }) {
    requireAdmin(user);
    const r = await printify.listVariants(intIn(body.blueprintId, 'blueprintId', 1, 1e9), intIn(body.providerId, 'providerId', 1, 1e9));
    return { variants: (r.variants || []).map((v) => ({ id: v.id, title: v.title, options: v.options || {}, placeholders: (v.placeholders || []).map((p) => ({ position: p.position, width: p.width, height: p.height })) })) };
  }
  async function adminSaveProduct({ user, body }) {
    requireAdmin(user);
    const key = String(body.key || ''); if (!SLOTS[key]) throw bad('Unknown product slot.');
    const blueprintId = intIn(body.blueprintId, 'blueprintId', 1, 1e9); const providerId = intIn(body.providerId, 'providerId', 1, 1e9);
    const position = String(body.position || '').slice(0, 40); if (!position) throw bad('Choose the print area.');
    const wanted = Array.isArray(body.variants) ? body.variants : [];
    if (!wanted.length || wanted.length > 60) throw bad('Choose between 1 and 60 variants.');
    const live = await printify.listVariants(blueprintId, providerId);           // the server checks every ID against Printify itself
    const byId = new Map((live.variants || []).map((v) => [v.id, v]));
    const variants = [];
    for (const w of wanted) {
      const v = byId.get(Number(w.id)); if (!v) throw bad(`Variant ${w.id} is not offered by that print provider right now.`);
      const ph = (v.placeholders || []).find((p) => p.position === position); if (!ph || !ph.width || !ph.height) throw bad(`"${v.title}" has no "${position}" print area.`);
      const priceCents = intIn(w.priceCents, 'Price', 100, 100000);
      variants.push({ id: v.id, label: String(v.title).slice(0, 80), options: v.options || {}, priceCents, width: ph.width, height: ph.height });
    }
    const data = {
      title: String(body.title || SLOTS[key].title).slice(0, 80), blurb: String(body.blurb || '').slice(0, 300), blueprintId, providerId, position,
      variants: JSON.stringify(variants), enabled: body.enabled === true, verifiedAt: nowIso()
    };
    if (data.variants.length > 15000) throw bad('Too many variants for one product. Choose fewer.');
    if (await getRowOrNull(T.catalog, key)) await updateRow(T.catalog, key, data); else await createRow(T.catalog, key, data, []);
    return { saved: true, variants: variants.length };
  }
  async function adminToggle({ user, body }) {
    requireAdmin(user);
    const key = String(body.key || ''); if (!knownKey(key)) throw bad('Unknown product.');
    const row = await getRowOrNull(T.catalog, key);
    if (!row) throw conflict('not_set_up', 'Set this product up first.');
    const m = metaOf(row);
    if (body.enabled === true && m && m.ok === false) throw conflict('unsupported', `This product cannot be sold through the photo editor yet: ${m.reason}`);
    if (body.enabled === true && m && m.missing) throw conflict('missing', 'This product is no longer in your Printify shop. Sync again after you restore it there.');
    const data = { enabled: body.enabled === true };
    if (isImportedKey(key) && (body.section === 'gifts' || body.section === 'jewelry')) {
      const u = unpack(row.variants); u.meta = { ...(u.meta || {}), section: body.section, sectionLocal: true };
      data.variants = JSON.stringify({ v: u.variants, m: u.meta });
    }
    await updateRow(T.catalog, key, data);
    return { enabled: data.enabled };
  }

  /* ---------- products already created in the owner's own Printify shop ---------- */
  const SYNC_PAGE = 10;   // small pages keep each request well inside the function's time limit; the browser asks for page after page
  async function shopsOrNull() { try { const l = await printify.listShops(); return Array.isArray(l) ? l : []; } catch { return null; } }
  const shopLine = (x) => `${String(x.title || 'Untitled').slice(0, 60)} (ID ${x.id}${x.sales_channel ? ', ' + x.sales_channel : ''})`;
  async function explainProductsFailure(e) {
    const base = explainPrintifyFailure(e, 'the products in this shop');
    if (!(e instanceof PrintifyError) || ![403, 404].includes(e.status)) return base;
    const shops = await shopsOrNull();
    if (shops === null) return { code: 'missing_permission', message: `Printify refused both the product list and the shop list. The token is missing permissions (it needs shops.read and products.read). Make a new token with all permissions ticked and update PRINTIFY_API_TOKEN.` };
    if (!shops.some((x) => String(x.id) === String(cfg.printifyShopId))) {
      return { code: 'wrong_shop', message: `PRINTIFY_SHOP_ID (${cfg.printifyShopId}) is not one of the shops on this token's account. Shops it can see: ${shops.map(shopLine).join('; ') || 'none'}. Set PRINTIFY_SHOP_ID to the one that holds your products.` };
    }
    return { code: 'missing_permission', message: 'The shop ID is right, but Printify refused to list its products. The token is missing the products.read permission. Make a new token with all permissions ticked and update PRINTIFY_API_TOKEN.' };
  }
  async function explainEmpty(shops) {
    const mine = (shops || []).find((x) => String(x.id) === String(cfg.printifyShopId));
    const others = [];
    for (const x of (shops || []).filter((y) => y !== mine).slice(0, 8)) {
      try { const r = await printify.listProductsPage(1, 1, x.id); others.push({ id: x.id, title: String(x.title || '').slice(0, 60), products: Number((r && r.total) || 0) }); } catch { /* ignore: only a hint */ }
    }
    const richer = others.filter((o) => o.products > 0);
    if (shops && !mine) return { code: 'wrong_shop', message: `PRINTIFY_SHOP_ID (${cfg.printifyShopId}) is not one of the shops on this token's account.`, shops: others };
    if (richer.length) return { code: 'wrong_shop_likely', message: `Shop ${cfg.printifyShopId} has no products, but ${richer.map((o) => `"${o.title}" (ID ${o.id}) has ${o.products}`).join(' and ')}. If your products are there, change PRINTIFY_SHOP_ID to that ID.`, shops: others };
    return { code: 'no_products', message: `Shop ${cfg.printifyShopId}${mine ? ` ("${String(mine.title || '').slice(0, 60)}")` : ''} has no products yet. This sync applies no filter: drafts and published products both count. Create a product in Printify (My products), then sync again.`, shops: others };
  }
  async function adminSync({ user, body }) {
    requireAdmin(user);
    if (!cfg.printifyConfigured || !cfg.printifyShopId) throw conflict('not_configured', 'Printify is not connected yet. Add PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID to the shop-api function first.');
    const page = intIn(body.page ?? 1, 'page', 1, 200);
    let res;
    try { res = await printify.listProductsPage(page, SYNC_PAGE); }
    catch (e) { const x = await explainProductsFailure(e); throw conflict(x.code, x.message); }
    const list = Array.isArray(res) ? res : ((res && res.data) || []);
    const lastPage = Number((res && res.last_page) || 1), total = Number((res && res.total) ?? list.length);
    const out = { page, lastPage, total, results: [] };
    if (page === 1) {
      const shops = await shopsOrNull();
      const mine = (shops || []).find((x) => String(x.id) === String(cfg.printifyShopId));
      out.shop = { id: String(cfg.printifyShopId), title: mine ? String(mine.title || '') : '', channel: mine ? String(mine.sales_channel || '') : '', foundInAccount: shops === null ? null : !!mine };
      if (!list.length && total === 0) { out.diagnosis = await explainEmpty(shops); return out; }
    }
    let titles = new Map();
    try { titles = new Map((await printify.listBlueprints()).map((b) => [Number(b.id), String(b.title || '')])); } catch { /* only used to guess the section */ }
    const cats = new Map();
    await Promise.all([...new Set(list.map((p) => `${p.blueprint_id}:${p.print_provider_id}`))].map(async (k) => {
      const [bp, pr] = k.split(':');
      try { cats.set(k, await printify.listVariantsCached(bp, pr)); } catch { cats.set(k, null); }
    }));
    const syncedAt = nowIso();
    const one = async (p) => {
      const key = importedKey(p && p.id);
      const cat = cats.get(`${p.blueprint_id}:${p.print_provider_id}`);
      if (cat === null) return { key, title: String(p.title || '').slice(0, 80), action: 'skipped', supported: false, reason: 'Printify did not return the print area sizes for this product just now. Sync again in a minute.' };
      const plan = planImport(p, cat, titles.get(Number(p.blueprint_id)) || '');
      if (!plan.key) return { key: '', title: plan.title, action: 'skipped', supported: false, reason: plan.support.reason };
      const existing = await getRowOrNull(T.catalog, plan.key);
      const prev = existing ? metaOf(existing) : null;
      if (prev && prev.sectionLocal) plan.section = prev.section;
      const data = {
        title: plan.title, blurb: plan.blurb, blueprintId: plan.blueprintId, providerId: plan.providerId, position: plan.position,
        variants: packVariants(plan, { shopId: String(cfg.printifyShopId), syncedAt, sectionLocal: !!(prev && prev.sectionLocal) }),
        enabled: existing ? (existing.enabled === true && plan.support.ok) : (body.enableNew === true && plan.support.ok), verifiedAt: syncedAt
      };
      if (existing) await updateRow(T.catalog, plan.key, data); else await createRow(T.catalog, plan.key, data, []);
      return { key: plan.key, title: plan.title, action: existing ? 'updated' : 'new', supported: plan.support.ok, reason: plan.support.reason, notes: plan.notes.slice(0, 4), enabled: data.enabled, variants: plan.variants.length };
    };
    for (let i = 0; i < list.length; i += 5) out.results.push(...(await Promise.all(list.slice(i, i + 5).map(one))));
    return out;
  }
  async function adminSyncFinish({ user, body }) {
    requireAdmin(user);
    const seen = new Set((Array.isArray(body.seen) ? body.seen : []).map(String).filter(isImportedKey).slice(0, 2000));
    let missingNow = 0;
    for (const r of await allCatalogRows()) {
      if (!isImportedKey(r.$id) || seen.has(r.$id)) continue;
      const u = unpack(r.variants); if (u.meta && u.meta.missing && r.enabled !== true) continue;
      u.meta = { ...(u.meta || {}), missing: true };
      await updateRow(T.catalog, r.$id, { enabled: false, variants: JSON.stringify({ v: u.variants, m: u.meta }) });
      missingNow++;
    }
    return { missing: missingNow };
  }
  async function adminPrintifyCheck({ user }) {
    requireAdmin(user);
    if (!cfg.printifyConfigured) throw conflict('not_configured', 'PRINTIFY_API_TOKEN is not set yet.');
    const sid = cfg.printifyShopId ? encodeURIComponent(cfg.printifyShopId) : '';
    const test = async (scope, fn, needsShop) => {
      if (needsShop && !sid) return { scope, ok: null, note: 'PRINTIFY_SHOP_ID is not set.' };
      try { await fn(); return { scope, ok: true, note: '' }; } catch (e) { return { scope, ok: false, note: explainPrintifyFailure(e, scope).message }; }
    };
    const shops = await shopsOrNull();
    const infos = [];
    for (const x of (shops || []).slice(0, 8)) {
      let products = null; try { products = Number(((await printify.listProductsPage(1, 1, x.id)) || {}).total || 0); } catch { /* shown as unknown */ }
      infos.push({ id: String(x.id), title: String(x.title || '').slice(0, 60), channel: String(x.sales_channel || ''), products, configured: String(x.id) === String(cfg.printifyShopId) });
    }
    const scopes = [
      { scope: 'shops.read', ok: shops !== null, note: shops === null ? 'Printify refused the shop list.' : '' },
      await test('products.read', () => printify.listProductsPage(1, 1), true),
      await test('catalog.read', () => printify.listBlueprints(), false),
      await test('orders.read', () => printify.probe(`/shops/${sid}/orders.json?limit=1`), true),
      await test('uploads.read', () => printify.probe('/uploads.json?limit=1'), false),
      await test('webhooks.read', () => printify.listWebhooks(), true),
      { scope: 'orders.write, uploads.write, webhooks.write', ok: null, note: 'These cannot be tested without placing an order or changing something. Tick every permission when you make the token and they will work.' }
    ];
    return { configuredShopId: String(cfg.printifyShopId || ''), shopMatch: infos.some((x) => x.configured), shops: infos, scopes };
  }
  async function adminResolve({ user, body }) {
    requireAdmin(user);
    let o = await getRowOrNull(T.orders, idOf(body.orderId, 'orderId'));
    if (!o) throw missing('Order not found.');
    const act = String(body.act || '');
    try {
      if (act === 'retry') {
        if (o.printifyOrderId) throw conflict('already_created', 'A Printify order already exists. Use Approve or Refresh.');
        const stuck = o.fulfillmentStatus === 'creating' && now() - new Date(o.$updatedAt).getTime() > 10 * 60e3;
        if (!['failed', 'needs_review'].includes(o.fulfillmentStatus) && !stuck) throw conflict('not_retryable', 'This order is not waiting for a retry.');
        o = await updateRow(T.orders, o.$id, { fulfillmentStatus: 'not_started' });
        o = await fulfill(o.$id, { force: true });
      } else if (act === 'approve') {
        o = await submitToProduction(o);
      } else if (act === 'refresh') {
        o = await reconcile(o);
        if (o.paymentProvider === 'square' && o.squarePaymentId) o = await refreshRefunds(o);
        o = await syncFromPrintify(o);
      } else if (act === 'cancel_printify') {
        if (!o.printifyOrderId) throw conflict('no_printify_order', 'There is no Printify order.');
        await printify.cancelOrder(o.printifyOrderId);       // Printify only accepts this for orders still on-hold or payment-not-received
        o = await updateRow(T.orders, o.$id, { fulfillmentStatus: 'canceled' });
      } else throw bad('Unknown action.');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof SquareError) throw new ApiError(502, 'provider_error', `Square did not answer that (error ${e.status}). Nothing changed here. Check the order in the Square dashboard.`);
      throw new ApiError(502, 'provider_error', `Printify did not accept that (${e instanceof PrintifyError ? 'error ' + e.status : 'no answer'}). Nothing changed here. Check the order in the Printify dashboard.`);
    }
    return { order: adminOrderRow(o) };
  }
  async function adminRegisterWebhooks({ user }) {
    requireAdmin(user);
    if (!cfg.webhookBase || !cfg.printifyWebhookSecret) throw conflict('not_configured', 'Set WEBHOOK_BASE_URL and PRINTIFY_WEBHOOK_SECRET first.');
    const url = `${cfg.webhookBase.replace(/\/$/, '')}/webhooks/printify`;
    const existing = await printify.listWebhooks();
    const have = new Set((Array.isArray(existing) ? existing : []).filter((w) => w.url === url).map((w) => w.topic));
    const added = [];
    for (const topic of PRINTIFY_TOPICS) if (!have.has(topic)) { await printify.createWebhook(topic, url, cfg.printifyWebhookSecret); added.push(topic); }
    return { url, added, alreadyThere: [...have] };
  }

  const actions = {
    shopCatalog: catalogAction, shopSetGift: setGift, shopGiftStatus: giftStatus,
    shopSaveDesign: saveDesign, shopDesigns: listDesigns, shopUpdateDesign: updateDesign,
    shopQuote: quote, shopCheckout: checkout, shopCancelOrder: cancelOrder, shopOrders: myOrders, shopOrder: getOrder,
    shopAdminCheck: adminCheck, shopAdminOverview: adminOverview, shopAdminOrder: adminOrder, shopAdminBlueprints: adminBlueprints, shopAdminProviders: adminProviders,
    shopAdminVariants: adminVariants, shopAdminSaveProduct: adminSaveProduct, shopAdminToggle: adminToggle, shopAdminSync: adminSync, shopAdminSyncFinish: adminSyncFinish, shopAdminPrintifyCheck: adminPrintifyCheck, shopAdminResolve: adminResolve, shopAdminRegisterWebhooks: adminRegisterWebhooks
  };

  async function handle({ user, body }) {
    try {
      requireVerifiedUser(user);
      const name = body && body.action;
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(actions, name)) throw bad('Unknown action.');
      return { status: 200, json: { ok: true, ...(await actions[name]({ user, body: body || {} })) } };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, json: { ok: false, error: e.code, message: e.message } };
      return { status: 500, json: { ok: false, error: 'server_error', message: 'Something went wrong on the server.' }, cause: e };
    }
  }
  async function handleWebhook(which, raw, headers) {
    try {
      if (which === 'square') return await squareWebhook(raw, headers);
      if (which === 'stripe') return { status: 410, json: { ok: false, error: 'gone', message: 'Stripe is no longer used. Delete this webhook in Stripe.' } };
      if (which === 'printify') return await printifyWebhook(raw, headers);
      return { status: 404, json: { ok: false, error: 'not_found' } };
    } catch (e) {
      // A 500 makes the sender retry later. Events are safe to repeat.
      return { status: 500, json: { ok: false, error: 'server_error' }, cause: e };
    }
  }
  return { handle, handleWebhook, actions, fulfill, applyPayment };
}
