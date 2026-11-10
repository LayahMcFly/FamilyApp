/*
 * shop-api: all trusted shop logic. No network or SDK construction happens in this file, so it is tested with fakes.
 *
 * Trust model
 *  - `user` is the account Appwrite returns for the caller's own JWT. It is never read from the request body.
 *  - Prices, variants, shipping and totals are decided here. The browser only says WHICH saved designs and WHERE to ship.
 *  - Printify and Stripe secrets exist only in this function's environment.
 *  - Payment and fulfillment are two separate states. A browser redirect proves nothing: payment is confirmed by asking
 *    Stripe's API for the Checkout Session (webhook events only tell us WHEN to ask).
 *  - A Printify order is created only AFTER payment is verified, so nothing can enter production for an unpaid order.
 */
import { Query, Permission, Role } from 'node-appwrite';
import { ApiError, bad, forbidden, missing, conflict, idOf, intIn, rowId, sha256hex, money, publicError } from './util.js';
import { verifyStripeSignature } from './stripe.js';
import { PrintifyError, verifyPrintifySignature } from './printify.js';
import { imageSize } from './images.js';

export const T = {
  families: 'families', posts: 'posts',
  catalog: 'shopCatalog', designs: 'shopDesigns', orders: 'shopOrders', events: 'shopEvents', gifts: 'giftPermissions'
};

/** The only product slots that can ever be sold. The Printify blueprint/provider/variant IDs for each are saved by the owner
 *  through the admin screen after the server has checked them against Printify's live catalog. No ID is hard-coded here. */
export const SLOTS = {
  'framed-print': { title: 'Framed photo print', hint: 'framed', frameNote: true },
  magnet: { title: 'Photo magnet', hint: 'magnet' },
  mug: { title: 'Photo mug', hint: 'mug' },
  blanket: { title: 'Photo blanket', hint: 'blanket' },
  puzzle: { title: 'Photo puzzle', hint: 'puzzle' }
};

export const LIMITS = { maxDesignsOpen: 20, maxQty: 10, maxLines: 10, minPrint: 600, maxDesignBytes: 5 * 1024 * 1024, specMax: 3500 };

// Payment and fulfillment are tracked separately.
const PAY_RANK = { pending_payment: 0, processing: 1, expired: 1, payment_failed: 1, paid: 3, refunded: 4 };
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
  if (f === 'canceled') return { label: 'Canceled. The shop owner will handle any refund.', tone: 'stop' };
  if (f === 'delivered') return { label: 'Delivered', tone: 'ok' };
  if (f === 'shipped') return { label: 'Shipped', tone: 'ok' };
  if (f === 'in_production' || f === 'sending') return { label: 'In production', tone: 'ok' };
  if (f === 'created') return { label: 'Payment received. Your order is waiting to go into production.', tone: 'ok' };
  if (f === 'failed' || f === 'needs_review' || f === 'has_issues') return { label: 'Payment received. We are checking something on your order and will email you.', tone: 'warn' };
  return { label: 'Payment received. We are preparing your order.', tone: 'ok' };
}

export function createShop({ users, db, storage, stripe, printify, cfg, now = () => Date.now(), log = () => {} }) {
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
  function parseVariants(row) { try { const v = JSON.parse(row.variants || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  async function enabledProducts() {
    const rows = (await listRows(T.catalog, [Query.limit(50)])).rows;
    return rows.filter((r) => r.enabled === true && SLOTS[r.$id] && r.blueprintId && r.providerId).map((r) => ({ row: r, variants: parseVariants(r) }));
  }
  async function productByKey(key) {
    if (!SLOTS[key]) throw bad('Unknown product.');
    const row = await getRowOrNull(T.catalog, key);
    if (!row || row.enabled !== true) throw conflict('unavailable', 'That product is not available right now.');
    return { row, variants: parseVariants(row) };
  }
  const publicProduct = ({ row, variants }) => ({
    key: row.$id, title: row.title || SLOTS[row.$id].title, blurb: row.blurb || '', frameNote: !!SLOTS[row.$id].frameNote,
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
    const products = (await enabledProducts()).map(publicProduct);
    return {
      products,
      slots: Object.entries(SLOTS).map(([key, s]) => ({ key, title: s.title, available: products.some((p) => p.key === key) })),
      config: { countries, currency, maxQty: LIMITS.maxQty, supportEmail: cfg.supportEmail || '', automaticTax: !!cfg.automaticTax, testMode: /^(sk|rk)_test_/.test(cfg.stripeKeyPrefix || '') },
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
    const o = await getRowOrNull(T.orders, d.orderId);
    const age = o ? now() - new Date(o.$createdAt).getTime() : Infinity;
    const dead = !o || ['expired', 'payment_failed'].includes(o.paymentStatus) || (o.paymentStatus === 'pending_payment' && age > 35 * 60e3);
    if (dead) { await updateRow(T.designs, d.$id, { orderId: '' }); return { ...d, orderId: '' }; }
    return d;
  }
  async function saveDesign({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    const post = await loadPhoto(familyId, body.postId);
    if (!(await giftAllowed(post, user.$id))) throw forbidden('The person who posted this photo has not allowed it to be used for gifts.');
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
    const data = { ownerId: user.$id, familyId, postId: post.$id, productKey: row.$id, variantId: variant.id, fileId, fileSha, width: size.width, height: size.height, spec, quantity, orderId: '' };
    const created = await createRow(T.designs, id, data, ownerRead(user.$id));
    return { design: publicDesign(created, { row, variants }) };
  }
  function publicDesign(d, prod) {
    const variant = prod ? prod.variants.find((v) => v.id === d.variantId) : null;
    let spec = {}; try { spec = JSON.parse(d.spec || '{}'); } catch { spec = {}; }
    return {
      id: d.$id, postId: d.postId, productKey: d.productKey, variantId: d.variantId, quantity: d.quantity, spec, fileId: d.fileId, width: d.width, height: d.height,
      title: prod ? (prod.row.title || SLOTS[d.productKey]?.title) : (SLOTS[d.productKey]?.title || 'Product'),
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
      if (!variant) throw conflict('unavailable', `${prod.row.title || SLOTS[d.productKey].title}: that size or style is no longer available.`);
      const post = await loadPhoto(familyId, d.postId).catch(() => null);
      if (!post || !(await giftAllowed(post, user.$id))) throw conflict('photo_not_allowed', 'One of the photos can no longer be used for gifts. Remove that design from your cart.');
      lines.push({
        designId: d.$id, postId: d.postId, productKey: d.productKey, title: prod.row.title || SLOTS[d.productKey].title, variantId: variant.id, variantLabel: variant.label,
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
    return { lines: lines.map(({ title, variantLabel, quantity, unitCents }) => ({ title, variantLabel, quantity, unitCents })), subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents, currency, taxNote: cfg.automaticTax ? 'Sales tax, if it applies, is added by our payment provider on the next page.' : 'No sales tax is added by this shop.' };
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
  async function checkout({ user, body }) {
    const { familyId } = await requireMember(user, body.familyId);
    if (body.consentImage !== true || body.consentDelivery !== true) throw bad('Please confirm both permission boxes before paying.');
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
    const totalCents = subtotalCents + shippingCents;
    const row = {
      ownerId: user.$id, familyId, paymentStatus: 'pending_payment', fulfillmentStatus: 'not_started', items: JSON.stringify(lines), address: JSON.stringify(address),
      subtotalCents, shippingCents, taxCents: 0, totalCents, currency, stripeSessionId: '', stripePaymentIntent: '', checkoutUrl: '', printifyOrderId: '', tracking: '[]', lastError: '',
      consentAt: nowIso(), consentVersion: 1, needsReview: ''
    };
    await createRow(T.orders, orderId, row, ownerRead(user.$id));
    for (const l of lines) await updateRow(T.designs, l.designId, { orderId });
    const params = {
      mode: 'payment',
      client_reference_id: orderId,
      customer_email: user.email,
      success_url: `${cfg.siteUrl}#/orders/${orderId}/done`,
      cancel_url: `${cfg.siteUrl}#/shop/cart`,
      expires_at: Math.floor(now() / 1000) + 31 * 60,
      metadata: { orderId, familyId },
      payment_intent_data: { metadata: { orderId } },
      line_items: lines.map((l) => ({ quantity: l.quantity, price_data: { currency, unit_amount: l.unitCents, product_data: { name: `${l.title} (${l.variantLabel})`.slice(0, 120) } } })),
      shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: 'Standard shipping', fixed_amount: { amount: shippingCents, currency } } }]
    };
    if (cfg.automaticTax) { params.automatic_tax = { enabled: true }; params.shipping_address_collection = { allowed_countries: countries }; }
    let session;
    try { session = await stripe.createCheckoutSession(params, orderId); }
    catch (e) {
      log('stripe checkout failed', e && e.detail ? JSON.stringify(e.detail) : String(e && e.message));
      await updateRow(T.orders, orderId, { paymentStatus: 'payment_failed', lastError: 'Checkout could not be started.' });
      for (const l of lines) await updateRow(T.designs, l.designId, { orderId: '' });
      throw new ApiError(502, 'checkout_failed', 'Payment could not be started. You were not charged. Please try again.');
    }
    await updateRow(T.orders, orderId, { stripeSessionId: session.id, checkoutUrl: session.url });
    return { orderId, url: session.url };
  }
  async function cancelOrder({ user, body }) {
    const o = await getRowOrNull(T.orders, idOf(body.orderId, 'orderId'));
    if (!o || o.ownerId !== user.$id) throw missing('Order not found.');
    if (o.paymentStatus !== 'pending_payment') throw conflict('not_cancelable', 'This order was already paid or closed. Contact the shop owner to cancel it.');
    try { if (o.stripeSessionId) await stripe.expireSession(o.stripeSessionId); } catch { /* it may already be expired or paid: the check below asks Stripe */ }
    const settled = await applyStripeSession(o.stripeSessionId, {});
    return { order: publicOrder(settled || o) };
  }

  /* ---------- payment: Stripe is asked, never believed from the browser ---------- */
  function orderIsHeld(o) { return o.fulfillmentStatus === 'needs_review'; }
  async function releaseOrderDesigns(o) {
    let items = []; try { items = JSON.parse(o.items || '[]'); } catch { items = []; }
    for (const i of items) { try { await updateRow(T.designs, i.designId, { orderId: '' }); } catch (e) { if (sdkCode(e) !== 404) throw e; } }
  }
  async function applyStripeSession(sessionId, { failed = false } = {}) {
    if (!sessionId) return null;
    const session = await stripe.retrieveSession(sessionId);
    const id = session.client_reference_id;
    if (!id) return null;
    let o = await getRowOrNull(T.orders, id);
    if (!o || o.stripeSessionId !== session.id) return null;          // a session we did not create for this order
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (paid) return markPaid(o, session);
    let next = null;
    if (failed) next = 'payment_failed';
    else if (session.status === 'expired') next = 'expired';
    else if (session.status === 'complete') next = 'processing';        // delayed payment method: waiting for the bank
    if (next && PAY_RANK[next] > PAY_RANK[o.paymentStatus]) {
      o = await updateRow(T.orders, o.$id, { paymentStatus: next });
      if (next === 'expired' || next === 'payment_failed') await releaseOrderDesigns(o);
    } else if (next && o.paymentStatus === 'processing' && (next === 'expired' || next === 'payment_failed')) {
      o = await updateRow(T.orders, o.$id, { paymentStatus: next }); await releaseOrderDesigns(o);
    }
    return o;
  }
  async function markPaid(o, session) {
    if (PAY_RANK[o.paymentStatus] >= PAY_RANK.paid) return o;           // already paid (duplicate or out-of-order event)
    const shipping = Number((session.shipping_cost && session.shipping_cost.amount_subtotal) ?? (session.total_details && session.total_details.amount_shipping) ?? 0);
    const tax = Number((session.total_details && session.total_details.amount_tax) || 0);
    const problems = [];
    if (String(session.currency).toLowerCase() !== o.currency) problems.push('currency');
    if (Number(session.amount_subtotal) !== o.subtotalCents) problems.push('items total');
    if (shipping !== o.shippingCents) problems.push('shipping');
    if (Number(session.amount_total) !== o.subtotalCents + o.shippingCents + tax) problems.push('total');
    if (cfg.automaticTax) {
      const a = JSON.parse(o.address || '{}');
      const d = (session.collected_information && session.collected_information.shipping_details && session.collected_information.shipping_details.address) || (session.shipping_details && session.shipping_details.address) || {};
      const zip5 = (z) => String(z || '').slice(0, 5);
      if (!d.country || d.country !== a.country || zip5(d.postal_code) !== zip5(a.zip) || String(d.state || '').toUpperCase() !== a.region) problems.push('delivery address');
    }
    const data = {
      paymentStatus: 'paid', paidAt: nowIso(), taxCents: tax, totalCents: Number(session.amount_total) || o.totalCents,
      stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || ''
    };
    if (problems.length) { data.fulfillmentStatus = 'needs_review'; data.lastError = `Payment did not match the order (${problems.join(', ')}). Nothing was sent to production.`; }
    const paidRow = await updateRow(T.orders, o.$id, data);
    if (problems.length) return paidRow;
    return fulfill(paidRow.$id);
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
        const post = await loadPhoto(o.familyId, it.postId).catch(() => null);
        if (!post || !(await giftAllowed(post, o.ownerId))) {
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
    if (o.paymentStatus !== 'paid') throw conflict('not_paid', 'This order has not been paid.');
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
        if (o.paymentStatus === 'pending_payment' || o.paymentStatus === 'processing') o = (await applyStripeSession(o.stripeSessionId, {})) || o;
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
  async function stripeWebhook(raw, headers) {
    if (!cfg.stripeWebhookSecret) return { status: 503, json: { ok: false, error: 'not_configured' } };
    if (!verifyStripeSignature(raw, headers['stripe-signature'], cfg.stripeWebhookSecret, { nowSec: Math.floor(now() / 1000) })) return { status: 400, json: { ok: false, error: 'bad_signature' } };
    let ev; try { ev = JSON.parse(raw); } catch { return { status: 400, json: { ok: false, error: 'bad_json' } }; }
    if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string') return { status: 400, json: { ok: false, error: 'bad_event' } };
    if (await seenEvent('stripe', ev.id)) return { status: 200, json: { ok: true, duplicate: true } };
    const sess = ev.data && ev.data.object;
    const handled = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
    if (handled.includes(ev.type) && sess && typeof sess.id === 'string') {
      await applyStripeSession(sess.id, { failed: ev.type === 'checkout.session.async_payment_failed' });
    }
    await recordEvent('stripe', ev.id, ev.type, handled.includes(ev.type) ? '' : 'ignored');
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
  const adminOrderRow = (o) => ({ ...publicOrder(o), buyerId: o.ownerId, printifyOrderId: o.printifyOrderId || '', printifyStatus: o.printifyStatus || '', printifyCostCents: o.printifyCostCents || 0, lastError: o.lastError || '' });
  async function adminCheck({ user }) {
    requireAdmin(user);
    let printifyShops = null, printifyShopsError = '';
    if (cfg.printifyConfigured) { try { const list = await printify.listShops(); printifyShops = (Array.isArray(list) ? list : []).map((x) => ({ id: x.id, title: String(x.title || '').slice(0, 80), channel: String(x.sales_channel || '') })); } catch (e) { printifyShopsError = 'Printify did not accept the token (or could not be reached).'; } }
    return {
      printifyShops, printifyShopsError,
      configured: { stripeKey: !!cfg.stripeKeyPrefix, stripeWebhookSecret: !!cfg.stripeWebhookSecret, printifyToken: !!cfg.printifyConfigured, printifyShop: !!cfg.printifyShopId, printifyWebhookSecret: !!cfg.printifyWebhookSecret, webhookBase: !!cfg.webhookBase, supportEmail: !!cfg.supportEmail },
      stripeMode: /^(sk|rk)_test_/.test(cfg.stripeKeyPrefix || '') ? 'test' : (/^(sk|rk)_live_/.test(cfg.stripeKeyPrefix || '') ? 'live' : 'unknown'),
      autoSubmit: !!cfg.autoSubmit, automaticTax: !!cfg.automaticTax, countries, webhookBase: cfg.webhookBase || ''
    };
  }
  async function adminOverview({ user }) {
    requireAdmin(user);
    const rows = (await listRows(T.orders, [Query.orderDesc('$createdAt'), Query.limit(50)])).rows;
    const catalog = (await listRows(T.catalog, [Query.limit(50)])).rows;
    return { orders: rows.map(adminOrderRow), products: Object.entries(SLOTS).map(([key, s]) => { const r = catalog.find((c) => c.$id === key); return { key, title: s.title, saved: !!r, enabled: !!(r && r.enabled), blueprintId: r ? r.blueprintId : null, providerId: r ? r.providerId : null, variantCount: r ? parseVariants(r).length : 0, verifiedAt: r ? r.verifiedAt : '' }; }) };
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
    const key = String(body.key || ''); if (!SLOTS[key]) throw bad('Unknown product slot.');
    if (!(await getRowOrNull(T.catalog, key))) throw conflict('not_set_up', 'Set this product up first.');
    await updateRow(T.catalog, key, { enabled: body.enabled === true });
    return { enabled: body.enabled === true };
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
        o = await syncFromPrintify(o);
      } else if (act === 'cancel_printify') {
        if (!o.printifyOrderId) throw conflict('no_printify_order', 'There is no Printify order.');
        await printify.cancelOrder(o.printifyOrderId);       // Printify only accepts this for orders still on-hold or payment-not-received
        o = await updateRow(T.orders, o.$id, { fulfillmentStatus: 'canceled' });
      } else throw bad('Unknown action.');
    } catch (e) {
      if (e instanceof ApiError) throw e;
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
    shopAdminVariants: adminVariants, shopAdminSaveProduct: adminSaveProduct, shopAdminToggle: adminToggle, shopAdminResolve: adminResolve, shopAdminRegisterWebhooks: adminRegisterWebhooks
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
      if (which === 'stripe') return await stripeWebhook(raw, headers);
      if (which === 'printify') return await printifyWebhook(raw, headers);
      return { status: 404, json: { ok: false, error: 'not_found' } };
    } catch (e) {
      // A 500 makes the sender retry later. Events are safe to repeat.
      return { status: 500, json: { ok: false, error: 'server_error' }, cause: e };
    }
  }
  return { handle, handleWebhook, actions, fulfill, applyStripeSession };
}
