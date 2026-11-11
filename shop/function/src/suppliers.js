/*
 * Which supplier makes and ships a product or an order line, and which shop section it appears in.
 *
 * Customers only ever see the SECTION names (Photo Gifts, Family Shop). Supplier ids are internal and never sent to the browser.
 * Nothing here talks to a supplier. Printify's own code stays in printify.js and the Printify parts of shop.js.
 *
 * Old records have no supplier tag, and the database is not migrated. A record is called Printify only when it carries
 * facts that only a Printify record has. Anything else is 'unknown' and is never relabeled or sent anywhere.
 */
export const SUPPLIERS = {
  printify: { id: 'printify', section: 'photo-gifts', ready: true },
  cj: { id: 'cj', section: 'family-shop', ready: false }      // reserved for the CJdropshipping integration. Not connected.
};

/** What customers see. `ready: false` means "Coming soon": nothing can be bought there. */
export const PUBLIC_SECTIONS = [
  { id: 'photo-gifts', title: 'Photo Gifts', blurb: 'Turn your memories into personalized gifts.', ready: true },
  { id: 'family-shop', title: 'Family Shop', blurb: 'Shop useful finds for family life and gatherings.', ready: false }
];
export const sectionIsOpen = (id) => PUBLIC_SECTIONS.some((s) => s.id === id && s.ready);

const known = (s) => (typeof s === 'string' && Object.prototype.hasOwnProperty.call(SUPPLIERS, s) ? s : '');
const pos = (n) => Number.isInteger(Number(n)) && Number(n) > 0;

/** A saved catalog row. `meta` is the small JSON block kept beside its variants. */
export function supplierOfProduct(row, meta) {
  const tagged = meta && meta.supplier;
  if (tagged) return known(tagged) || 'unknown';
  return row && pos(row.blueprintId) && pos(row.providerId) ? 'printify' : 'unknown';
}
/** One line of an order (saved as JSON inside the order row). */
export function supplierOfLine(line) {
  if (!line || typeof line !== 'object') return 'unknown';
  if (line.supplier) return known(line.supplier) || 'unknown';
  return line.designId && pos(line.blueprintId) && pos(line.providerId) && pos(line.variantId) ? 'printify' : 'unknown';
}
/** A whole order: its lines must agree. A Printify order id also proves it, because only the Printify code ever writes one. */
export function supplierOfOrder(order) {
  let lines = []; try { lines = JSON.parse((order && order.items) || '[]'); } catch { lines = []; }
  const set = [...new Set((Array.isArray(lines) ? lines : []).map(supplierOfLine))];
  if (set.length === 1 && set[0] !== 'unknown') return set[0];
  if (set.length > 1) return 'mixed';
  return order && order.printifyOrderId ? 'printify' : 'unknown';
}
export const sectionOfSupplier = (s) => (SUPPLIERS[s] && SUPPLIERS[s].section) || '';
