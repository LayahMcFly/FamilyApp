import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const VE = createRequire(import.meta.url)('../../video-editor.js');
const M = VE.model;

test('editor: the 60-second example. Remove 10-15 and 30-35 and 50 seconds remain', () => {
  let st = M.normalize({ inT: 0, outT: 60, cuts: [] }, 60);
  st = M.removeSection(st, 10, 15, 60); st = M.removeSection(st, 30, 35, 60);
  assert.deepEqual(M.keepSegments(st), [[0, 10], [15, 30], [35, 60]]);
  assert.equal(M.editedDuration(st), 50);
  assert.equal(M.toEdited(M.keepSegments(st), 20), 15);            // 20 s of the original is 15 s into the edit
  assert.equal(M.toSource(M.keepSegments(st), 12), 17);
  assert.equal(M.toEdited(M.keepSegments(st), 12), 10);            // a moment inside a removed part snaps to the next kept moment
});
test('editor: trim both ends, overlapping removals merge, removals are clamped to the trim', () => {
  let st = M.normalize({ inT: 5, outT: 50, cuts: [] }, 60);
  st = M.removeSection(st, 10, 20, 60); st = M.removeSection(st, 18, 25, 60); st = M.removeSection(st, 0, 7, 60); st = M.removeSection(st, 48, 60, 60);
  assert.deepEqual(st.cuts, [[5, 7], [10, 25], [48, 50]]);
  assert.deepEqual(M.keepSegments(st), [[7, 10], [25, 48]]);
});
test('editor: refuses to remove everything; undo, redo and restore', () => {
  let st = M.normalize({ inT: 0, outT: 10, cuts: [] }, 10);
  assert.equal(M.removeSection(st, 0, 10, 10), null);
  assert.equal(M.removeSection(st, 0, 9.9, 10), null);                // leaves 0.1 s: less than the minimum
  const hist = M.History(st);
  const a = M.removeSection(st, 2, 4, 10); hist.push(a);
  const b = M.removeSection(a, 6, 8, 10); hist.push(b);
  assert.deepEqual(hist.undo().cuts, [[2, 4]]);
  assert.deepEqual(hist.redo().cuts, [[2, 4], [6, 8]]);
  assert.equal(hist.push(b), false);                                  // no change is not a new step
  assert.deepEqual(M.restoreSection(b, 0, 10).cuts, [[6, 8]]);
});
test('editor: time text', () => {
  assert.equal(M.parseTime('12.5'), 12.5); assert.equal(M.parseTime('1:05.3'), 65.3); assert.equal(M.parseTime('0:01:05'), 65);
  assert.ok(Number.isNaN(M.parseTime('abc'))); assert.ok(Number.isNaN(M.parseTime('1:2:3:4'))); assert.ok(Number.isNaN(M.parseTime('-3')));
  assert.equal(M.fmtTime(65.34), '1:05.3');
});
test('editor: size choices never upscale and estimates respect the limit', () => {
  const o = M.qualityOptions(1920, 1080, 50, 25 * 1048576);
  assert.deepEqual(o.map((x) => x.w + 'x' + x.h), ['854x480', '1280x720', '1920x1080']);
  assert.ok(M.qualityOptions(320, 180, 10, 1e7).length === 1);          // small video: only its own size
  assert.deepEqual(M.qualityOptions(1080, 1920, 20, 1e7).map((x) => x.w + 'x' + x.h), ['480x854', '720x1280', '1080x1920']);
  const pick = M.pickQuality(o, 6 * 1048576); assert.ok(pick.bytes <= 6 * 1048576 * 0.85 || pick === o[0]);
});
test('editor: WebM duration writer adds a Duration and keeps the file valid', () => {
  // EBML header, then Segment (unknown size) containing Info (TimecodeScale only) and a Cluster
  const info = [0x15, 0x49, 0xA9, 0x66, 0x84, 0x2A, 0xD7, 0xB1, 0x80 | 0, 0x00].slice(0, 9);
  const infoBytes = [0x15, 0x49, 0xA9, 0x66, 0x87, 0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40];   // size 8: TimecodeScale = 1,000,000
  const ebml = [0x1A, 0x45, 0xDF, 0xA3, 0x80];
  const seg = [0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
  const cluster = [0x1F, 0x43, 0xB6, 0x75, 0x80];
  void info;
  const src = Uint8Array.from([...ebml, ...seg, ...infoBytes, ...cluster]);
  const out = VE.fixWebmDuration(src, 12.5);
  assert.equal(out.length, src.length + 11);
  const dv = new DataView(out.buffer);
  const at = ebml.length + seg.length + 5 + 7;                          // where the Info data ends
  assert.deepEqual([...out.slice(at, at + 3)], [0x44, 0x89, 0x88]);
  assert.equal(dv.getFloat64(at + 3), 12500);
  assert.equal(out[ebml.length + seg.length + 4], 0x80 | 18);          // Info size grew from 7 to 18
  assert.deepEqual([...out.slice(out.length - 5)], cluster);
  assert.equal(VE.fixWebmDuration(out, 12.5), out);                     // already has one: untouched
  assert.equal(VE.fixWebmDuration(Uint8Array.from([1, 2, 3, 4]), 5).length, 4);   // not WebM: untouched
});
