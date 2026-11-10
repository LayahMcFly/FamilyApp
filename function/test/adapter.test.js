import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const A = createRequire(import.meta.url)('../../tree-adapter.js');

let n = 0;
const P = (id, name, o = {}) => ({ $id: id, name, $createdAt: new Date(1_700_000_000_000 + ++n * 1000).toISOString(), parentIds: [], partnerIds: [], ...o });

test('adapter: two parents, mirrored partners and derived children', () => {
  const people = [P('a', 'A', { gender: 'Female', partnerIds: ['b'] }), P('b', 'B', { gender: 'Male' }), P('k', 'K', { parentIds: ['a', 'b'] })];
  const { data, notes } = A.buildChartData(people);
  const by = Object.fromEntries(data.map((d) => [d.id, d]));
  assert.deepEqual(by.k.rels.parents, ['a', 'b']);
  assert.deepEqual(by.a.rels.children, ['k']);
  assert.deepEqual(by.b.rels.spouses, ['a']);   // only a lists b, the link is still two-way
  assert.equal(by.a.data.gender, 'F');
  assert.equal(notes.length, 0);
});

test('adapter: gender other than female/male becomes neutral, never an error', () => {
  const { data } = A.buildChartData([P('a', 'A', { gender: 'Nonbinary' }), P('b', 'B', { gender: '' }), P('c', 'C', { gender: 'male' })]);
  assert.deepEqual(data.map((d) => d.data.gender), ['', '', 'M']);
});

test('adapter: three or more parents are reported, the couple is the pair that gets drawn', () => {
  const people = [P('a', 'A', { partnerIds: ['b'] }), P('b', 'B'), P('c', 'C'), P('k', 'K', { parentIds: ['c', 'a', 'b'], relKinds: JSON.stringify({ 'p:c': 'step' }) })];
  const r = A.buildChartData(people);
  const k = r.data.find((d) => d.id === 'k');
  assert.equal(k.rels.parents.length, 2);
  assert.deepEqual(k.rels.parents.sort(), ['a', 'b']);
  assert.deepEqual(r.hiddenParents.k, ['c']);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0].text, /C is not drawn/);
  // the saved link is still visible in the details list
  assert.deepEqual(A.relativesOf(people, 'k').parents.map((x) => [x.id, x.kind]).sort(), [['a', 'biological'], ['b', 'biological'], ['c', 'step']]);
});

test('adapter: every parent link is either drawn or reported, never silently dropped', () => {
  const people = [P('p1', '1'), P('p2', '2'), P('p3', '3'), P('p4', '4'), P('k', 'K', { parentIds: ['p1', 'p2', 'p3', 'p4'] }), P('j', 'J', { parentIds: ['p1', 'ghost'] })];
  const r = A.buildChartData(people);
  for (const p of people) {
    const drawn = r.data.find((d) => d.id === p.$id).rels.parents;
    const hidden = r.hiddenParents[p.$id] || [];
    for (const q of p.parentIds.filter((x) => people.some((y) => y.$id === x))) assert.ok(drawn.includes(q) || hidden.includes(q), `${p.$id} -> ${q}`);
  }
});

test('adapter: one-sided and unknown links never reach the library', () => {
  const r = A.buildChartData([P('a', 'A', { partnerIds: ['a', 'nobody'], parentIds: ['a', 'nobody'] })]);
  assert.deepEqual(r.data[0].rels, { parents: [], spouses: [], children: [] });
});

test('adapter: partner status and adoptive labels are available from either side', () => {
  const people = [P('a', 'A', { partnerIds: ['b'], relKinds: JSON.stringify({ 's:b': 'divorced' }) }), P('b', 'B'), P('k', 'K', { parentIds: ['a'], relKinds: JSON.stringify({ 'p:a': 'adoptive' }) })];
  const r = A.buildChartData(people);
  assert.equal(r.partnerKind['a|b'], 'divorced');
  assert.equal(r.parentKind['k>a'], 'adoptive');
  assert.equal(A.relativesOf(people, 'b').partners[0].kind, 'divorced');
  assert.equal(A.relativesOf(people, 'a').children[0].kind, 'adoptive');
});

test('adapter: broken relKinds text is ignored', () => {
  const r = A.buildChartData([P('a', 'A', { relKinds: '{not json' }), P('b', 'B', { relKinds: '[1,2]' })]);
  assert.equal(r.data.length, 2);
});

test('adapter: no ids from another family can appear, only the rows it is given', () => {
  const famA = [P('a1', 'A1'), P('a2', 'A2', { parentIds: ['a1'] })];
  const r = A.buildChartData(famA.concat([]).map((x) => ({ ...x, parentIds: [...x.parentIds, 'b1'] })));   // b1 belongs to another family and is not supplied
  assert.deepEqual(r.data.map((d) => d.id).sort(), ['a1', 'a2']);
  assert.ok(!JSON.stringify(r).includes('b1'));
});
