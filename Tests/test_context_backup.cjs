'use strict';
const nativeTest = require('node:test');
const test = (name,fn) => nativeTest(name,{skip:process.platform==='win32'},fn);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { consumeContextTextFile, MAX_CHARS } = require('../electron/context-input.cjs');

const id = '01234567-89ab-4cde-8fab-0123456789ab';
function fixture(t, text = '你好 world') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-test-root-'));
  const dir = path.join(root, `OpenDeepL-context-${id}`);
  fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, 'selection.txt');
  fs.writeFileSync(file, text, { mode: 0o600 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir, file };
}
test('consumes selected UTF-8 text and removes only its exact empty directory', t => {
  const { root, dir, file } = fixture(t);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
  assert.equal(consumeContextTextFile(file, { temporaryRoot: root }), '你好 world');
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'keep');
});
test('rejects paths outside one named private context directory', t => {
  const { root, file } = fixture(t);
  assert.throws(() => consumeContextTextFile(path.join(root, 'other.txt'), { temporaryRoot: root }));
  assert.throws(() => consumeContextTextFile('selection.txt', { temporaryRoot: root }));
  assert.equal(fs.existsSync(file), true);
});
test('rejects group-accessible dir and file', t => {
  const { root, dir, file } = fixture(t);
  fs.chmodSync(dir, 0o755);
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
  fs.chmodSync(dir, 0o700); fs.chmodSync(file, 0o644);
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
});
test('rejects symlinks and hard links', t => {
  const { root, dir, file } = fixture(t);
  const original = path.join(root, 'original'); fs.writeFileSync(original, 'secret');
  fs.unlinkSync(file); fs.symlinkSync(original, file);
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
  fs.unlinkSync(file); fs.linkSync(original, file); fs.chmodSync(original, 0o600);
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
  assert.equal(fs.readFileSync(original, 'utf8'), 'secret');
});
test('enforces scalar length and strict UTF-8', t => {
  const { root, file } = fixture(t, 'x'.repeat(MAX_CHARS + 1));
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
  fs.writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
});
test('unexpected neighboring file prevents directory deletion', t => {
  const { root, dir, file } = fixture(t);
  fs.writeFileSync(path.join(dir, 'other'), 'keep');
  assert.throws(() => consumeContextTextFile(file, { temporaryRoot: root }));
  assert.equal(fs.readFileSync(path.join(dir, 'other'), 'utf8'), 'keep');
});
