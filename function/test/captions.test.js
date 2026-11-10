import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../../captions.js');

test('captions: long phrases are split on words and keep their time', () => {
  const cues = C.shape([{ text: ' Hello everyone and welcome to the family reunion video we made at the lake house', timestamp: [1, 9] }], 20);
  assert.ok(cues.length >= 2);
  cues.forEach((c) => assert.ok(c[2].length <= 42));
  assert.equal(cues[0][0], 1); assert.equal(cues[cues.length - 1][1], 9);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i][0] >= cues[i - 1][1] - 0.001);
});
test('captions: sound labels dropped, missing end time handled, times never go backwards', () => {
  const cues = C.shape([{ text: '[BLANK_AUDIO]', timestamp: [0, 2] }, { text: 'Hi', timestamp: [3, null] }, { text: 'Again', timestamp: [2, 4] }], 10);
  assert.deepEqual(cues.map((c) => c[2]), ['Hi', 'Again']);
  assert.ok(cues[1][0] >= cues[0][0]); assert.ok(cues.every((c) => c[1] > c[0]));
});
test('captions: WebVTT output is valid and safe', () => {
  const v = C.toVtt([[0, 1.5, 'a <b> --> c'], [3661.25, 3662, 'later']]);
  assert.match(v, /^WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\n/);
  assert.match(v, /01:01:01.250 --> 01:01:02.000/);
  assert.ok(!/<b>/.test(v) && !/a .* --> c/.test(v));
});
test('captions: parse tolerates damage; fit trims an over-long transcript', () => {
  assert.deepEqual(C.parse('nonsense'), []); assert.deepEqual(C.parse(null), []);
  assert.deepEqual(C.parse('[[0,1,"x"],[1]]'), [[0, 1, 'x']]);
  const many = Array.from({ length: 500 }, (_, i) => [i, i + 1, 'word ' + i]);
  const f = C.fit(many); assert.equal(f.cut, true); assert.ok(f.cues.length <= 400); assert.ok(JSON.stringify(f.cues).length <= 16000);
});
