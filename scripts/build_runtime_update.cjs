#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {canonicalManifest, validUpdatePath, compareVersions, verifyManifest} = require('../electron/runtime-updates.cjs');

function usage() {
  console.log('Usage: node scripts/build_runtime_update.cjs --init-key [--private-key FILE]');
  console.log('   or: node scripts/build_runtime_update.cjs --version X.Y.Z --platform darwin|win32 --min-app X.Y.Z --max-app X.Y.Z --out FILE.odup [--root DIR] [--private-key FILE]');
  console.log('Builds a signed offline ui/* + core/*.py package; release key stays outside the app bundle.');
}
function args(argv) {
  const out = {};
  if (argv[0] === '--init-key') { out['init-key'] = true; argv = argv.slice(1); }
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || i + 1 >= argv.length) throw new Error('Invalid arguments');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
function walk(root, rel = '') {
  const files = [];
  for (const e of fs.readdirSync(path.join(root, rel), {withFileTypes: true})) {
    const child = path.posix.join(rel, e.name);
    if (e.isSymbolicLink()) throw new Error(`Symlink not allowed: ${child}`);
    if(e.name==='__pycache__'||e.name.endsWith('.pyc'))continue;
    if (e.isDirectory()) files.push(...walk(root, child));
    else if (e.isFile() && validUpdatePath(child)) files.push(child);
    else throw new Error(`Unsupported runtime resource: ${child}`);
  }
  return files;
}
function releaseKeyPath(opt) {
  return path.resolve(opt['private-key'] || path.join(os.homedir(), 'Library/Application Support/OpenDeepL-release/runtime-update-ed25519-private.pem'));
}
function initializeKey(privateKeyPath) {
  const publicKeyPath = path.join(__dirname, '../electron/update-public-key.pem');
  fs.mkdirSync(path.dirname(privateKeyPath), {recursive: true, mode: 0o700});
  if (!fs.existsSync(privateKeyPath) && !fs.existsSync(publicKeyPath)) {
    const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privateKeyPath, privateKey.export({format: 'pem', type: 'pkcs8'}), {flag: 'wx', mode: 0o600});
    fs.writeFileSync(publicKeyPath, publicKey.export({format: 'pem', type: 'spki'}), {flag: 'wx', mode: 0o644});
  }
  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) throw new Error('Release key pair incomplete; restore the matching key or perform an explicit key rotation');
  const actual = crypto.createPublicKey(fs.readFileSync(privateKeyPath)).export({format: 'pem', type: 'spki'});
  const pinned = fs.readFileSync(publicKeyPath, 'utf8');
  if (actual !== pinned) throw new Error('Release private key does not match pinned public key');
  console.log(`Release key pair ready: private key ${privateKeyPath}, public key ${publicKeyPath}`);
}
function build(opt) {
  const root = path.resolve(opt.root || path.join(__dirname, '..'));
  const privateKeyPath = releaseKeyPath(opt);
  if (!opt.version || !opt.platform || !opt['min-app'] || !opt['max-app'] || !opt.out ||
      !['darwin', 'win32'].includes(opt.platform)) throw new Error('Missing or invalid required argument');
  compareVersions(opt.version, opt.version);
  if (compareVersions(opt['min-app'], opt['max-app']) > 0) throw new Error('App compatibility range inverted');
  initializeKey(privateKeyPath);
  const entries = [...walk(root, 'ui'), ...walk(root, 'core')].sort();
  const payload = {}, files = [];
  for (const rel of entries) {
    const bytes = fs.readFileSync(path.join(root, rel));
    payload[rel] = bytes.toString('base64');
    files.push({path: rel, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  const manifest = {format: 1, version: opt.version, platform: opt.platform,
    compatibility: {minApp: opt['min-app'], maxApp: opt['max-app']}, files};
  const key = fs.readFileSync(privateKeyPath);
  const signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), key).toString('base64');
  verifyManifest(manifest,signature,crypto.createPublicKey(key),opt.platform,opt['min-app']);
  const packageData = JSON.stringify({manifest, signature, payload});
  if (Buffer.byteLength(packageData) > 12 * 1024 * 1024) throw new Error('Package exceeds 12 MiB');
  fs.writeFileSync(path.resolve(opt.out), packageData, {flag: 'wx', mode: 0o600});
  console.log(`Signed ${files.length} runtime files to ${path.resolve(opt.out)} (${opt.version}, ${opt.platform}).`);
}
if (require.main === module) {
  try { if (process.argv.includes('--help')) usage(); else { const opt = args(process.argv.slice(2)); if (opt['init-key']) initializeKey(releaseKeyPath(opt)); else build(opt); } }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = {build};
