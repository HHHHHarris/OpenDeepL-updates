'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {createUpdateChannel, validateRedirect} = require('../electron/update-channel.cjs');
const {canonicalManifest} = require('../electron/runtime-updates.cjs');

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odup-channel-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
  const keyPath = path.join(dir, 'key.pem');
  fs.writeFileSync(keyPath, publicKey.export({format: 'pem', type: 'spki'}));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const packageBytes = Buffer.from('{"signed":"package fixture"}');
  const sign = manifest => ({manifest, signature: crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64')});
  const manifest = {format: 1, version: '0.6.1', platform: 'darwin',
    compatibleBase: {minApp: '0.6.0', maxApp: '0.6.0'}, packageURL: `${origin}/release.odup`,
    sha256: crypto.createHash('sha256').update(packageBytes).digest('hex'), size: packageBytes.length};
  const channel = (feed = `${origin}/feed.json`, options = {}) => createUpdateChannel({userData: dir, publicKeyPath: keyPath,
    appVersion: '0.6.0', platform: 'darwin', feedURL: feed, testOnlyAllowHttpLoopback: true, timeoutMs: 500, ...options});
  return {dir, origin, packageBytes, sign, manifest, channel};
}

test('signed feed check, replay handling, and hash-verified download', async t => {
  let feed, bytes;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/feed.json') { res.writeHead(302, {Location: '/actual.json'}); return res.end(); }
    res.end(req.url === '/actual.json' ? JSON.stringify(feed) : bytes);
  });
  bytes = f.packageBytes; feed = f.sign(f.manifest);
  const c = f.channel();
  const result = await c.check();
  assert.equal(result.status, 'available');
  assert.equal((await c.check({currentVersion: '0.6.1'})).status, 'up-to-date');
  const downloaded = await c.download(result.update);
  assert.deepEqual(fs.readFileSync(downloaded.file), bytes);
  assert.equal(downloaded.version, '0.6.1');
  await assert.rejects(c.download(result.update, {currentVersion: '0.6.1'}), /advance/);
});

test('forged/tampered and cross-platform feeds are rejected', async t => {
  let feed;
  const f = await fixture(t, (_req, res) => res.end(JSON.stringify(feed)));
  feed = f.sign(f.manifest);
  feed.manifest.version = '0.6.2';
  await assert.rejects(f.channel().check(), /signature/);
  feed = f.sign({...f.manifest, platform: 'win32'});
  await assert.rejects(f.channel().check(), /Unsupported/);
  feed = f.sign({...f.manifest, packageURL: 'https://other.example/release.odup'});
  await assert.rejects(f.channel().check(), /origin/);
});

test('production HTTP, credentials, query tokens, redirects and response bounds fail closed', async t => {
  let mode = 'redirect';
  const f = await fixture(t, (_req, res) => {
    if (mode === 'redirect') { res.writeHead(302, {Location: 'https://example.com/feed.json'}); res.end(); }
    else if (mode === 'large') res.end('x'.repeat(33 * 1024));
    else { res.writeHead(200, {'Content-Length': String(12 * 1024 * 1024 + 1)}); res.end(); }
  });
  assert.throws(() => createUpdateChannel({userData: f.dir, publicKeyPath: path.join(f.dir, 'key.pem'),
    appVersion: '0.6.0', platform: 'darwin', feedURL: `${f.origin}/feed.json`}), /HTTPS/);
  assert.throws(() => f.channel(`${f.origin}/feed.json?token=SECRET`), /query/);
  assert.throws(() => f.channel(`http://user:pass@127.0.0.1:${new URL(f.origin).port}/feed.json`), /credentials/);
  await assert.rejects(f.channel().check(), /origin/);
  mode = 'large'; await assert.rejects(f.channel().check(), /size limit/);
  mode = 'oversized-header'; await assert.rejects(f.channel().check(), /size limit/);
});

test('GitHub release redirect policy allows pinned CDN only', () => {
  const feed = new URL('https://github.com/example/OpenDeepL/releases/latest/download/update-darwin.json');
  const sameRepo = validateRedirect(feed, '/example/OpenDeepL/releases/download/v0.6.1/update-darwin.json', feed);
  assert.equal(sameRepo.hostname, 'github.com');
  const asset = validateRedirect(sameRepo, 'https://release-assets.githubusercontent.com/123/file?token=SIGNED', feed);
  assert.equal(asset.hostname, 'release-assets.githubusercontent.com');
  assert.equal(validateRedirect(asset, 'https://objects.githubusercontent.com/asset?token=SIGNED', feed).hostname, 'objects.githubusercontent.com');
  assert.throws(() => validateRedirect(feed, 'https://evil.example/file', feed), /pinned/);
  assert.throws(() => validateRedirect(feed, 'http://release-assets.githubusercontent.com/file', feed), /HTTPS/);
  assert.throws(() => validateRedirect(feed, 'https://github.com/other/repo/releases/download/file', feed), /pinned/);
  assert.throws(() => validateRedirect(feed, 'https://release-assets.githubusercontent.com.evil.example/file', feed), /pinned/);
});

test('download digest mismatch and timeout are rejected', async t => {
  let mode = 'feed', feed;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/feed.json') return res.end(JSON.stringify(feed));
    if (mode === 'slow') return setTimeout(() => res.end(f.packageBytes), 150);
    if (mode === 'oversize') { res.writeHead(200, {'Content-Length': String(12 * 1024 * 1024 + 1)}); return res.end(); }
    return res.end('tampered package');
  });
  feed = f.sign(f.manifest);
  const c = f.channel(); const result = await c.check();
  await assert.rejects(c.download(result.update), /hash or size/);
  mode = 'slow';
  const fast = f.channel(undefined, {timeoutMs: 20});
  await assert.rejects(fast.download(result.update), /timed out/);
  mode = 'oversize';
  await assert.rejects(c.download(result.update), /size limit/);
});
