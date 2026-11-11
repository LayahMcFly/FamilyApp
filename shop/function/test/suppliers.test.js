import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierOfProduct, supplierOfLine, supplierOfOrder, sectionOfSupplier, sectionIsOpen, PUBLIC_SECTIONS } from '../src/suppliers.js';

const line = { designId: 'd1', blueprintId: 7, providerId: 3, variantId: 101, quantity: 1 };

test('sections: Photo Gifts is open, Family Shop is coming soon, and supplier ids are not in the public list', () => {
  assert.deepEqual(PUBLIC_SECTIONS.map((s) => s.title), ['Photo Gifts', 'Family Shop']);
  assert.equal(sectionIsOpen('photo-gifts'), true);
  assert.equal(sectionIsOpen('family-shop'), false);
  assert.equal(sectionIsOpen('anything-else'), false);
  assert.equal(JSON.stringify(PUBLIC_SECTIONS).includes('printify'), false);
  assert.equal(JSON.stringify(PUBLIC_SECTIONS).includes('cj'), false);
});

test('an old product row with Printify ids is Printify; a row without them is unknown, never relabeled', () => {
  assert.equal(supplierOfProduct({ blueprintId: 7, providerId: 3 }, null), 'printify');
  assert.equal(supplierOfProduct({ blueprintId: 7, providerId: 3 }, { kind: 'photo' }), 'printify');
  assert.equal(supplierOfProduct({}, null), 'unknown');
  assert.equal(supplierOfProduct({ blueprintId: 0, providerId: 3 }, null), 'unknown');
  assert.equal(supplierOfProduct({ blueprintId: 7, providerId: 3 }, { supplier: 'cj' }), 'cj', 'an explicit tag wins');
  assert.equal(supplierOfProduct({ blueprintId: 7, providerId: 3 }, { supplier: 'bogus' }), 'unknown');
});

test('order lines: tagged lines keep their tag; old lines are Printify only with every Printify fact', () => {
  assert.equal(supplierOfLine({ ...line, supplier: 'printify' }), 'printify');
  assert.equal(supplierOfLine(line), 'printify');
  assert.equal(supplierOfLine({ ...line, supplier: 'cj' }), 'cj');
  assert.equal(supplierOfLine({ designId: 'd1', quantity: 1 }), 'unknown');
  assert.equal(supplierOfLine({ ...line, blueprintId: undefined }), 'unknown');
  assert.equal(supplierOfLine(null), 'unknown');
});

test('whole orders: lines must agree; a Printify order id proves an otherwise unreadable order', () => {
  const o = (items, extra = {}) => ({ items: JSON.stringify(items), ...extra });
  assert.equal(supplierOfOrder(o([line, line])), 'printify');
  assert.equal(supplierOfOrder(o([line, { ...line, supplier: 'cj' }])), 'mixed');
  assert.equal(supplierOfOrder(o([{ title: 'x' }])), 'unknown');
  assert.equal(supplierOfOrder(o([{ title: 'x' }], { printifyOrderId: 'pf_1' })), 'printify');
  assert.equal(supplierOfOrder({ items: 'not json' }), 'unknown');
  assert.equal(supplierOfOrder({}), 'unknown');
  assert.equal(sectionOfSupplier('printify'), 'photo-gifts');
  assert.equal(sectionOfSupplier('cj'), 'family-shop');
  assert.equal(sectionOfSupplier('unknown'), '');
});
