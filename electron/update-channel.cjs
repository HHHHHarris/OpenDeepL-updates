'use strict';

// Static, signed update feed. This module never runs a timer or starts a check by itself.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const {canonicalManifest, compareVersions} = require('./runtime-updates.cjs');

const MAX_FEED = 32 * 1024;
const MAX_PACKAGE = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const HASH = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const GITHUB_ASSET_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
function assertNoSymlinkFrom(base, target) {
  const root = path.resolve(base), full = path.resolve(target);
  if (!full.startsWith(root + path.sep)) throw new Error('Update download path escapes user data');
  let current = full;
  while (current.startsWith(root)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink in update download path');
    if (current === root) break;
    current = path.dirname(current);
  }
}

function validatedURL(raw, {feedOrigin, testOnlyAllowHttpLoopback = false} = {}) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Invalid update URL');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid update URL'); }
  const loopbackTest = testOnlyAllowHttpLoopback && process.env.NODE_ENV === 'test' &&
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopbackTest) throw new Error('HTTPS required for update channel');
  if (url.username || url.password || url.search || url.hash) throw new Error('Update URL must not contain credentials, query, or fragment');
  if (feedOrigin && url.origin !== feedOrigin) throw new Error('Update package must share feed origin');
  return url;
}
function releasePrefix(url) {
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\//);
  return match ? `/${match[1]}/${match[2]}/releases/` : null;
}
function validateRedirect(current, location, anchor, {testOnlyAllowHttpLoopback = false} = {}) {
  if (typeof location !== 'string' || location.length > 4096) throw new Error('Invalid update redirect');
  let next;
  try { next = new URL(location, current); } catch { throw new Error('Invalid update redirect'); }
  if (next.username || next.password || next.hash) throw new Error('Unsafe update redirect');
  const githubPrefix = releasePrefix(anchor);
  if (githubPrefix) {
    if (next.protocol !== 'https:') throw new Error('Update redirect must stay HTTPS');
    if (next.origin === anchor.origin && next.pathname.startsWith(githubPrefix) && !next.search) return next;
    if (GITHUB_ASSET_HOSTS.has(next.hostname) && next.port === '') return next; // GitHub asset CDN uses short-lived signed query.
    throw new Error('Update redirect leaves pinned GitHub release hosts');
  }
  if (next.origin !== anchor.origin || next.search || next.protocol !== anchor.protocol) throw new Error('Update redirect leaves feed origin');
  validatedURL(next.href, {testOnlyAllowHttpLoopback});
  return next;
}

function verifyFeed(envelope, {key, platform, appVersion, feedOrigin, feedURL, testOnlyAllowHttpLoopback = false}) {
  if (!envelope || typeof envelope !== 'object' || !envelope.manifest ||
      typeof envelope.signature !== 'string' || !BASE64.test(envelope.signature)) throw new Error('Invalid signed update feed');
  const m = envelope.manifest;
  if (m.format !== 1 || m.platform !== platform || !m.compatibleBase ||
      typeof m.packageURL !== 'string' || typeof m.sha256 !== 'string' || !HASH.test(m.sha256) ||
      !Number.isSafeInteger(m.size) || m.size < 1 || m.size > MAX_PACKAGE) throw new Error('Unsupported update feed');
  compareVersions(m.version, m.version);
  compareVersions(m.compatibleBase.minApp, m.compatibleBase.maxApp);
  if (compareVersions(m.compatibleBase.minApp, m.compatibleBase.maxApp) > 0 ||
      compareVersions(appVersion, m.compatibleBase.minApp) < 0 ||
      compareVersions(appVersion, m.compatibleBase.maxApp) > 0) throw new Error('Update feed incompatible with base App');
  const packageURL = validatedURL(m.packageURL, {feedOrigin, testOnlyAllowHttpLoopback});
  if (feedURL && releasePrefix(feedURL) && releasePrefix(packageURL) !== releasePrefix(feedURL)) throw new Error('Update package leaves pinned GitHub repository');
  if (!packageURL.pathname.endsWith('.odup')) throw new Error('Update URL must end in .odup');
  if (!crypto.verify(null, Buffer.from(canonicalManifest(m)), key, Buffer.from(envelope.signature, 'base64'))) throw new Error('Update feed signature rejected');
  return m;
}

function requestBytes(url, {limit, timeoutMs, testOnlyAllowHttpLoopback}) {
  const anchor = url, deadline = Date.now() + timeoutMs;
  function requestOne(current, redirects) { return new Promise((resolve, reject) => {
    const client = current.protocol === 'https:' ? https : http;
    if (client === http && !testOnlyAllowHttpLoopback) return reject(new Error('HTTPS required'));
    let settled = false;
    let timer;
    const done = (error, bytes) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(bytes); };
    const req = client.get(current, {headers: {'Accept': 'application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'OpenDeepL-Update/1'}}, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        if (redirects >= 3 || !res.headers.location) return done(new Error('Update redirect limit or missing location'));
        let next;
        try { next = validateRedirect(current, res.headers.location, anchor, {testOnlyAllowHttpLoopback}); }
        catch (e) { return done(e); }
        return requestOne(next, redirects + 1).then(bytes => done(null, bytes), done);
      }
      if (res.statusCode !== 200) { res.resume(); return done(new Error(`Update HTTP status ${res.statusCode}`)); }
      const declared = Number(res.headers['content-length']);
      if (res.headers['content-length'] !== undefined && (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)) {
        res.destroy(); return done(new Error('Update response exceeds size limit'));
      }
      let count = 0;
      const chunks = [];
      res.on('data', chunk => {
        count += chunk.length;
        if (count > limit) { res.destroy(); return done(new Error('Update response exceeds size limit')); }
        chunks.push(chunk);
      });
      res.on('end', () => done(null, Buffer.concat(chunks)));
      res.on('error', done);
    });
    timer = setTimeout(() => { req.destroy(); done(new Error('Update request timed out')); }, Math.max(1, deadline - Date.now()));
    req.on('error', done);
  }); }
  return requestOne(url, 0);
}

function createUpdateChannel({userData, publicKeyPath, appVersion, platform = process.platform,
  feedURL, timeoutMs = DEFAULT_TIMEOUT_MS, testOnlyAllowHttpLoopback = false}) {
  if (!userData || !publicKeyPath || !feedURL || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid update channel configuration');
  compareVersions(appVersion, appVersion);
  const feed = validatedURL(feedURL, {testOnlyAllowHttpLoopback});
  if (feed.hostname === 'github.com' && !releasePrefix(feed)) throw new Error('GitHub feed must be under repository releases');
  const key = fs.readFileSync(publicKeyPath);
  const userDataRoot = path.resolve(userData);
  const downloadDir = path.join(userDataRoot, 'runtime-updates', 'downloads');
  const verification = {key, platform, appVersion, feedOrigin: feed.origin, feedURL: feed, testOnlyAllowHttpLoopback};

  async function check({currentVersion = appVersion} = {}) {
    compareVersions(currentVersion, currentVersion);
    const bytes = await requestBytes(feed, {limit: MAX_FEED, timeoutMs, testOnlyAllowHttpLoopback});
    let envelope;
    try { envelope = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid update feed JSON'); }
    const manifest = verifyFeed(envelope, verification);
    if (compareVersions(manifest.version, currentVersion) <= 0) return {status: 'up-to-date', version: currentVersion};
    return {status: 'available', update: {manifest, signature: envelope.signature}};
  }

  async function download(update, {currentVersion = appVersion} = {}) {
    compareVersions(currentVersion, currentVersion);
    const manifest = verifyFeed(update, verification);
    if (compareVersions(manifest.version, currentVersion) <= 0) throw new Error('Update version must advance');
    const url = validatedURL(manifest.packageURL, {feedOrigin: feed.origin, testOnlyAllowHttpLoopback});
    const bytes = await requestBytes(url, {limit: MAX_PACKAGE, timeoutMs, testOnlyAllowHttpLoopback});
    if (bytes.length !== manifest.size || crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Downloaded update hash or size mismatch');
    assertNoSymlinkFrom(userDataRoot, downloadDir);
    fs.mkdirSync(downloadDir, {recursive: true, mode: 0o700});
    assertNoSymlinkFrom(userDataRoot, downloadDir);
    const file = path.join(downloadDir, `${manifest.version}-${manifest.sha256.slice(0, 16)}.odup`);
    const tmp = path.join(downloadDir, `.download-${crypto.randomBytes(12).toString('hex')}.part`);
    try {
      fs.writeFileSync(tmp, bytes, {flag: 'wx', mode: 0o600});
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return {file, version: manifest.version};
  }
  return {check, download};
}

module.exports = {createUpdateChannel, verifyFeed, validatedURL, validateRedirect};
