#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {canonicalManifest, verifyManifest} = require('../electron/runtime-updates.cjs');
const {validatedURL, verifyFeed} = require('../electron/update-channel.cjs');

function usage() {
  console.log('Usage: node scripts/build_update_feed.cjs --package FILE.odup --feed-url https://HOST/path/feed.json --package-url https://HOST/path/FILE.odup --out FILE.json [--private-key FILE]');
  console.log('Signs static feed metadata derived from the exact local .odup bytes. Does not publish or upload.');
}
function parse(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1]) throw new Error('Invalid arguments');
    opt[argv[i].slice(2)] = argv[i + 1];
  }
  return opt;
}
function build(opt) {
  if (!opt.package || !opt['feed-url'] || !opt['package-url'] || !opt.out) throw new Error('Missing required argument');
  const feedURL = validatedURL(opt['feed-url']);
  const packageURL = validatedURL(opt['package-url'], {feedOrigin: feedURL.origin});
  if (!packageURL.pathname.endsWith('.odup')) throw new Error('Package URL must end in .odup');
  const packageFile = path.resolve(opt.package);
  if (fs.lstatSync(packageFile).isSymbolicLink() || fs.statSync(packageFile).size > 12 * 1024 * 1024) throw new Error('Invalid or oversized .odup');
  const bytes = fs.readFileSync(packageFile);
  let pkg;
  try { pkg = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid .odup JSON'); }
  if (!pkg || !pkg.manifest || !pkg.signature) throw new Error('Invalid .odup envelope');
  const privateKeyFile = path.resolve(opt['private-key'] || path.join(os.homedir(), 'Library/Application Support/OpenDeepL-release/runtime-update-ed25519-private.pem'));
  const privateKey = fs.readFileSync(privateKeyFile);
  const publicKey = crypto.createPublicKey(privateKey);
  const pinned = fs.readFileSync(path.join(__dirname, '../electron/update-public-key.pem'), 'utf8');
  if (publicKey.export({format: 'pem', type: 'spki'}) !== pinned) throw new Error('Release key does not match pinned public key');
  verifyManifest(pkg.manifest, pkg.signature, publicKey, pkg.manifest.platform, pkg.manifest.compatibility.minApp);
  if (!pkg.payload || typeof pkg.payload !== 'object' || Object.keys(pkg.payload).length !== pkg.manifest.files.length) throw new Error('Invalid .odup payload');
  for (const entry of pkg.manifest.files) {
    const encoded = pkg.payload[entry.path];
    if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid .odup payload encoding');
    const content = Buffer.from(encoded, 'base64');
    if (content.length !== entry.size || crypto.createHash('sha256').update(content).digest('hex') !== entry.sha256) throw new Error(`Tampered .odup payload: ${entry.path}`);
  }
  const manifest = {format: 1, version: pkg.manifest.version, platform: pkg.manifest.platform,
    compatibleBase: {minApp: pkg.manifest.compatibility.minApp, maxApp: pkg.manifest.compatibility.maxApp},
    packageURL: packageURL.href, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length};
  const signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64');
  verifyFeed({manifest, signature}, {key: publicKey, platform: manifest.platform,
    appVersion: manifest.compatibleBase.minApp, feedOrigin: feedURL.origin, feedURL});
  fs.writeFileSync(path.resolve(opt.out), JSON.stringify({manifest, signature}), {flag: 'wx', mode: 0o600});
  console.log(`Signed static feed for ${manifest.version} (${manifest.platform}); package SHA-256 ${manifest.sha256}. No upload performed.`);
}
if (require.main === module) {
  try { if (process.argv.includes('--help')) usage(); else build(parse(process.argv.slice(2))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = {build};
