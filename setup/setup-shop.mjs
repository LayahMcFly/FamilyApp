/*
 * One-time Appwrite setup for the optional Photo Gifts shop.
 * Adds the shop tables (shopCatalog, shopDesigns, shopOrders, shopEvents, giftPermissions, and for the Family Shop: shopCj, shopCjCart, shopSettings) to the
 * existing `family` database and an index so the family-api cleanup can recognise gift designs. No bucket is created: the free plan allows one, so designs live in `family-media`.
 * Safe to run again: anything that already exists is skipped.
 *
 *   APPWRITE_ENDPOINT=... APPWRITE_PROJECT=... APPWRITE_KEY=... node setup-shop.mjs
 *
 * The API key is temporary and only for this script. It needs the scopes in SHOP-GUIDE.md (step 21).
 * Table permissions are empty on purpose: the browser can never read or write these tables directly.
 * Only the shop-api function (using its own key) writes them. Orders and designs are readable by their owner only.
 */
import { Client, TablesDB } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT, projectId = process.env.APPWRITE_PROJECT, apiKey = process.env.APPWRITE_KEY;
if (!endpoint || !projectId || !apiKey) { console.error('Missing APPWRITE_ENDPOINT, APPWRITE_PROJECT or APPWRITE_KEY. See SHOP-GUIDE.md step 21.'); process.exit(1); }
const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const db = new TablesDB(client);
const databaseId = 'family';

const S = (key, size, required, def) => ({ type: 'string', key, size, required: !!required, def });
const TX = (key, required) => ({ type: 'text', key, required: !!required });
const I = (key, required, def) => ({ type: 'integer', key, required: !!required, def, min: 0, max: 2000000000 });
const MT = (key, required) => ({ type: 'mediumtext', key, required: !!required });
const B = (key, required, def) => ({ type: 'boolean', key, required: !!required, def });
const schema = {
  shopCatalog: {
    columns: [S('title', 80, true), S('blurb', 300, false), B('enabled', false, false), I('blueprintId', true), I('providerId', true), S('position', 40, true), TX('variants', true), S('verifiedAt', 32, false)],
    indexes: []
  },
  shopDesigns: {
    columns: [S('ownerId', 36, true), S('familyId', 36, true), S('postId', 36, true), S('productKey', 40, true), I('variantId', true), S('fileId', 36, true), S('fileSha', 64, true), I('width', true), I('height', true), TX('spec', true), I('quantity', true), S('orderId', 40, false, '')],
    indexes: [['idx_ownerId', 'key', ['ownerId']], ['idx_familyId', 'key', ['familyId']], ['idx_orderId', 'key', ['orderId']], ['idx_fileId', 'key', ['fileId']]]
  },
  shopOrders: {
    columns: [S('ownerId', 36, true), S('familyId', 36, true), S('paymentStatus', 24, true), S('fulfillmentStatus', 24, true), TX('items', true), TX('address', true),
      I('subtotalCents', true), I('shippingCents', true), I('taxCents', false, 0), I('totalCents', true), S('currency', 3, true), S('stripeSessionId', 120, false, ''), S('stripePaymentIntent', 120, false, ''), TX('checkoutUrl', false),
      S('printifyOrderId', 40, false, ''), S('printifyStatus', 40, false, ''), I('printifyCostCents', false, 0), TX('tracking', false), S('lastError', 600, false, ''), S('consentAt', 32, false), I('consentVersion', false, 1), S('needsReview', 24, false, ''), S('paidAt', 32, false),
      S('paymentProvider', 12, false, ''), S('squarePaymentLinkId', 60, false, ''), S('squareOrderId', 60, false, ''), S('squarePaymentId', 60, false, ''), I('refundedCents', false, 0),
      S('supplierOrderId', 60, false, ''), S('supplierStatus', 40, false, '')],
    indexes: [['idx_ownerId', 'key', ['ownerId']], ['idx_printifyOrderId', 'key', ['printifyOrderId']]]
  },
  shopCj: {
    columns: [S('pid', 64, true), S('sku', 80, false, ''), S('supplier', 12, false, 'cj'), S('title', 120, true), TX('description', false), S('category', 24, false, 'other'), S('status', 12, true), B('featured', false, false), S('fromCountry', 2, false, ''), MT('supplierData', true), TX('retail', true), S('lastSyncAt', 32, false, ''), S('syncNote', 200, false, '')],
    indexes: [['idx_pid', 'key', ['pid']], ['idx_status', 'key', ['status']]]
  },
  shopCjCart: {
    columns: [S('ownerId', 36, true), S('familyId', 36, true), S('productId', 40, true), S('vid', 64, true), I('quantity', true)],
    indexes: [['idx_ownerId', 'key', ['ownerId']]]
  },
  shopSettings: {
    columns: [TX('value', false)],
    indexes: []
  },
  shopEvents: {
    columns: [S('source', 12, true), S('eventId', 80, true), S('type', 80, false), S('note', 200, false)],
    indexes: []
  },
  giftPermissions: {
    columns: [S('familyId', 36, true), S('postId', 36, true), S('ownerId', 36, true), B('allowed', true)],
    indexes: [['idx_familyId', 'key', ['familyId']], ['idx_postId', 'key', ['postId']]]
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(label, fn) {
  try { await fn(); console.log('  created  ' + label); }
  catch (e) {
    if (e && e.code === 409) console.log('  exists   ' + label);
    else { console.error('\nFAILED: ' + label + '\n  ' + (e.message || e) + (e.code ? ' (code ' + e.code + ')' : '')); if (e.code === 401) console.error('  The API key is missing a scope. See SHOP-GUIDE.md step 21.'); process.exit(1); }
  }
}
async function waitForColumns(tableId, keys) {
  for (let i = 0; i < 90; i++) {
    const res = await db.listColumns({ databaseId, tableId });
    const by = Object.fromEntries(res.columns.map((c) => [c.key, c.status]));
    if (keys.some((k) => by[k] === 'failed' || by[k] === 'stuck')) throw new Error('A column failed to build in ' + tableId);
    if (keys.every((k) => by[k] === 'available')) return;
    await sleep(2000);
  }
  throw new Error('Timed out waiting for columns in ' + tableId);
}

for (const [tableId, def] of Object.entries(schema)) {
  console.log('\nTable ' + tableId);
  await step('table', () => db.createTable({ databaseId, tableId, name: tableId, permissions: [], rowSecurity: true }));
  for (const c of def.columns) {
    await step('column ' + c.key, () => {
      const base = { databaseId, tableId, key: c.key, required: c.required };
      if (c.type === 'text') return db.createTextColumn(base);
      if (c.type === 'mediumtext') return db.createMediumtextColumn(base);
      if (c.type === 'string') return db.createStringColumn({ ...base, size: c.size, ...(c.def !== undefined && !c.required ? { xdefault: c.def } : {}) });
      if (c.type === 'boolean') return db.createBooleanColumn({ ...base, ...(c.def !== undefined && !c.required ? { xdefault: c.def } : {}) });
      return db.createIntegerColumn({ ...base, min: c.min, max: c.max, ...(c.def !== undefined && !c.required ? { xdefault: c.def } : {}) });
    });
  }
  process.stdout.write('  waiting for columns to finish building');
  await waitForColumns(tableId, def.columns.map((c) => c.key));
  console.log(' ... ready');
  for (const [key, type, columns] of def.indexes) await step('index ' + key, () => db.createIndex({ databaseId, tableId, key, type, columns, orders: columns.map(() => 'asc') }));
}

console.log('\nDone. Next: update family-api and create the shop-api Function (SHOP-GUIDE.md steps 22-23).');
