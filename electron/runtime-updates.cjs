'use strict';

// Offline, signed source-code runtime updates. The app executable and its TCC identity stay put.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PACKAGE = 12 * 1024 * 1024;
const MAX_TOTAL = 8 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_FILES = 100;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ID = /^[a-f0-9]{64}$/;
const REQUIRED = ['ui/index.html', 'ui/app.js', 'ui/style.css', 'core/open_deepl_core.py', 'core/__init__.py'];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function cmpVersion(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error('Invalid version');
  const av = a.split('.').map(Number), bv = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return Math.sign(av[i] - bv[i]);
  return 0;
}
function validName(name) {
  if (typeof name !== 'string' || name.length > 180 || name.includes('\\') || name.includes('\0')) return false;
  const parts = name.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(s))) return false;
  if (parts.some(s => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) return false;
  if (parts[0] === 'ui') return parts.length >= 2 && /\.(?:html|css|js)$/.test(name);
  if (parts[0] === 'core') return parts.length >= 2 && name.endsWith('.py');
  return false;
}
function noSymlinkTree(p, base) {
  let cur = path.resolve(p), stop = path.resolve(base);
  if (cur !== stop && !cur.startsWith(stop + path.sep)) throw new Error('Path escapes update root');
  while (cur.startsWith(stop)) {
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) throw new Error('Symlink in update root');
    if (cur === stop) break;
    cur = path.dirname(cur);
  }
}
function atomicJson(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), {mode: 0o600, flag: 'wx'});
  fs.renameSync(tmp, file);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function createRuntimeUpdateManager({bundleRoot, userData, appVersion, publicKeyPath, platform = process.platform}) {
  if (!bundleRoot || !userData || !VERSION.test(appVersion)) throw new Error('Invalid update manager configuration');
  const bundled = path.resolve(bundleRoot);
  const root = path.join(path.resolve(userData), 'runtime-updates');
  const releases = path.join(root, 'releases');
  const stateFile = path.join(root, 'state.json');
  const requiredBundleFiles=[];
  function bundleFiles(rel){const p=path.join(bundled,rel);if(!fs.existsSync(p))return;for(const e of fs.readdirSync(p,{withFileTypes:true})){const child=rel+'/'+e.name;if(e.isDirectory()&&!e.name.startsWith('__'))bundleFiles(child);else if(e.isFile()&&validName(child))requiredBundleFiles.push(child);}}
  bundleFiles('ui');bundleFiles('core');
  function completeManifest(manifest){if(requiredBundleFiles.some(name=>!manifest.files.some(f=>f.path===name)))throw new Error('Update omits a bundled runtime file');}
  const key = fs.readFileSync(publicKeyPath || path.join(__dirname, 'update-public-key.pem'));
  if (!fs.existsSync(root)) fs.mkdirSync(root, {recursive: true, mode: 0o700});
  noSymlinkTree(root, path.resolve(userData));
  fs.mkdirSync(releases, {recursive: true, mode: 0o700});
  noSymlinkTree(releases, root);

  function readState() {
    if (!fs.existsSync(stateFile)) return {active: null, previous: null, pending: false};
    noSymlinkTree(stateFile, root);
    const s = readJson(stateFile);
    if (!s || typeof s !== 'object' || (s.active !== null && !ID.test(s.active)) ||
        (s.previous !== null && !ID.test(s.previous)) || typeof s.pending !== 'boolean') throw new Error('Invalid update state');
    return s;
  }
  function writeState(s) { atomicJson(stateFile, s); }
  function verifiedRelease(id) {
    if (!ID.test(id)) throw new Error('Invalid release ID');
    const dir = path.join(releases, id);
    noSymlinkTree(dir, root);
    const metaPath = path.join(dir, 'package.json');
    noSymlinkTree(metaPath, root);
    if(fs.statSync(metaPath).size>MAX_PACKAGE)throw new Error('Oversized release metadata');
    const meta = readJson(metaPath);
    const {manifest, signature} = meta;
    verifyManifest(manifest, signature, key, platform, appVersion);
    if(cmpVersion(manifest.version,appVersion)<=0)throw new Error('Release superseded by base App');
    const listed=new Set(['package.json',...manifest.files.map(f=>f.path)]);
    const dirs=new Set();for(const name of listed){let parent=path.posix.dirname(name);while(parent!=='.'){dirs.add(parent);parent=path.posix.dirname(parent);}}
    function scan(relative=''){for(const entry of fs.readdirSync(path.join(dir,relative),{withFileTypes:true})){
      const name=relative?relative+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink())throw new Error('Unexpected release symlink');
      if(entry.isDirectory()){if(!dirs.has(name))throw new Error('Unlisted release directory');scan(name);}
      else if(!entry.isFile()||!listed.has(name)||fs.lstatSync(path.join(dir,name)).nlink!==1)throw new Error('Unlisted release file');
    }}scan();
    completeManifest(manifest);
    if (sha(Buffer.from(canonical(manifest) + signature)) !== id) throw new Error('Release ID mismatch');
    for (const file of manifest.files) {
      const p = path.join(dir, file.path);
      noSymlinkTree(p, root);
      const st = fs.lstatSync(p);
      if (!st.isFile() || st.size !== file.size || sha(fs.readFileSync(p)) !== file.sha256) throw new Error(`Release file mismatch: ${file.path}`);
    }
    return {dir, manifest};
  }
  function resolveActive() {
    const s = readState();
    if (!s.active) return {ui: path.join(bundled, 'ui'), core: path.join(bundled, 'core'), version: appVersion, source: 'bundle'};
    const {dir, manifest} = verifiedRelease(s.active);
    return {ui: path.join(dir, 'ui'), core: path.join(dir, 'core'), version: manifest.version, source: 'update'};
  }
  function rollback({tentative=false}={}) {
    const s = readState();
    let previous = s.previous;
    if (previous) { try { verifiedRelease(previous); } catch { previous = null; } }
    writeState({active:previous,previous:tentative?s.active:null,pending:tentative});
    return status();
  }
  function status() {
    try {
      const s = readState(), roots = resolveActive();
      return {version: roots.version, source: roots.source, active: s.active, pending: s.pending, previous: s.previous};
    } catch (e) { return {version: appVersion, source: 'bundle', active: null, pending: false, error: e.message}; }
  }
  function importPackage(file) {
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_PACKAGE) throw new Error('Update package exceeds size limit or is a symlink');
    const pkg = readJson(file);
    if (!pkg || typeof pkg !== 'object' || !pkg.payload || typeof pkg.payload !== 'object') throw new Error('Invalid update package');
    verifyManifest(pkg.manifest, pkg.signature, key, platform, appVersion);completeManifest(pkg.manifest);
    if (cmpVersion(pkg.manifest.version, currentVersion()) <= 0) throw new Error('Update version must advance');
    // Validate the incoming bytes even when this signed release is already cached.
    // A matching manifest/signature identifies the release, not the package payload.
    if (Object.keys(pkg.payload).length !== pkg.manifest.files.length) throw new Error('Unexpected payload files');
    const payloadBytes = new Map();
    for (const entry of pkg.manifest.files) {
      const b64 = pkg.payload[entry.path];
      if (typeof b64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) throw new Error('Invalid payload encoding');
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length !== entry.size || sha(bytes) !== entry.sha256) throw new Error(`Payload hash mismatch: ${entry.path}`);
      payloadBytes.set(entry.path, bytes);
    }
    const id = sha(Buffer.from(canonical(pkg.manifest) + pkg.signature));
    const dest = path.join(releases, id);
    if (fs.existsSync(dest)) { verifiedRelease(id); return {version: pkg.manifest.version, packageId: id}; }
    const stage = path.join(root, `.stage-${crypto.randomBytes(12).toString('hex')}`);
    fs.mkdirSync(stage, {mode: 0o700});
    try {
      for (const entry of pkg.manifest.files) {
        const out = path.join(stage, entry.path);
        fs.mkdirSync(path.dirname(out), {recursive: true, mode: 0o700});
        fs.writeFileSync(out, payloadBytes.get(entry.path), {mode: 0o600, flag: 'wx'});
      }
      fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({manifest: pkg.manifest, signature: pkg.signature}), {mode: 0o600, flag: 'wx'});
      fs.renameSync(stage, dest);
      verifiedRelease(id);
      return {version: pkg.manifest.version, packageId: id};
    } finally { if (fs.existsSync(stage)) fs.rmSync(stage, {recursive: true, force: true}); }
  }
  function activate(packageId) {
    if (!ID.test(packageId)) throw new Error('Select a verified package ID');
    const {manifest} = verifiedRelease(packageId);
    if (cmpVersion(manifest.version, currentVersion()) <= 0) throw new Error('Update version must advance');
    const s = readState();
    if (s.pending) throw new Error('Confirm or rollback pending update first');
    writeState({active: packageId, previous: s.active, pending: true});
    return status();
  }
  function confirmHealthy() {
    const s = readState();
    if (!s.pending) throw new Error('No pending update');
    if(s.active)verifiedRelease(s.active);
    writeState({...s, pending: false});
    return status();
  }
  function currentVersion() { return resolveActive().version; }
  // A pending switch was not confirmed before process exit: restore the last good roots.
  try { const s = readState(); if (s.pending) rollback(); else if (s.active) verifiedRelease(s.active); }
  catch { writeState({active: null, previous: null, pending: false}); }
  return {status, importPackage, activate, activeRoots: resolveActive, currentVersion, confirmHealthy, rollback};
}

function verifyManifest(m, signature, key, platform, appVersion) {
  if (!m || typeof m !== 'object' || m.format !== 1 || !VERSION.test(m.version) ||
      m.platform !== platform || !m.compatibility || !VERSION.test(m.compatibility.minApp) ||
      !VERSION.test(m.compatibility.maxApp) || cmpVersion(appVersion, m.compatibility.minApp) < 0 ||
      cmpVersion(appVersion, m.compatibility.maxApp) > 0 || !Array.isArray(m.files) ||
      m.files.length < REQUIRED.length || m.files.length > MAX_FILES || typeof signature !== 'string') throw new Error('Unsupported update manifest');
  if (!crypto.verify(null, Buffer.from(canonical(m)), key, Buffer.from(signature, 'base64'))) throw new Error('Update signature rejected');
  let total = 0, last = '';
  const folded = new Set();
  for (const f of m.files) {
    if (!f || !validName(f.path) || f.path <= last || !Number.isSafeInteger(f.size) ||
        f.size < 0 || f.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Invalid update file manifest');
    if (folded.has(f.path.toLowerCase())) throw new Error('Case-colliding update paths');
    folded.add(f.path.toLowerCase());
    last = f.path; total += f.size;
  }
  if (total > MAX_TOTAL || REQUIRED.some(name => !m.files.some(f => f.path === name))) throw new Error('Incomplete or oversized runtime update');
  return true;
}

module.exports = {createRuntimeUpdateManager, canonicalManifest: canonical, compareVersions: cmpVersion, validUpdatePath: validName, verifyManifest};
