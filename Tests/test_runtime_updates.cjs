'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRuntimeUpdateManager, canonicalManifest} = require('../electron/runtime-updates.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odup-test-'));
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
  const publicKeyPath = path.join(dir, 'key.pem');
  fs.writeFileSync(publicKeyPath, publicKey.export({format: 'pem', type: 'spki'}));
  const bundleRoot = path.join(dir, 'bundle'), userData = path.join(dir, 'data');
  fs.mkdirSync(path.join(bundleRoot, 'ui'), {recursive: true});
  fs.mkdirSync(path.join(bundleRoot, 'core'));
  const manager = () => createRuntimeUpdateManager({bundleRoot, userData, appVersion: '0.5.2', publicKeyPath, platform: 'darwin'});
  const content = {'ui/index.html': '<html>updated</html>', 'ui/app.js': 'new UI', 'ui/style.css': 'body{}',
    'core/open_deepl_core.py': 'version=1\n', 'core/__init__.py': ''};
  function make(version = '0.5.3', change = {}) {
    const data = {...content, ...change};
    const files = Object.keys(data).sort().map(p => ({path: p, size: Buffer.byteLength(data[p]), sha256: crypto.createHash('sha256').update(data[p]).digest('hex')}));
    const manifest = {format: 1, version, platform: 'darwin', compatibility: {minApp: '0.5.0', maxApp: '0.5.9'}, files};
    const signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64');
    return {manifest, signature, payload: Object.fromEntries(Object.entries(data).map(([p,v]) => [p, Buffer.from(v).toString('base64')]))};
  }
  function save(pkg, name = 'update.odup') { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(pkg)); return p; }
  return {dir, manager, make, save};
}
test('signed import, pending activation, health confirmation, and persistent roots', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, {recursive: true, force: true}));
  const m = f.manager(), imported = m.importPackage(f.save(f.make()));
  assert.equal(m.currentVersion(), '0.5.2');
  assert.equal(m.activate(imported.packageId).pending, true);
  assert.equal(fs.readFileSync(path.join(m.activeRoots().ui, 'app.js'), 'utf8'), 'new UI');
  assert.equal(m.confirmHealthy().pending, false);
  assert.equal(f.manager().currentVersion(), '0.5.3');
  assert.equal(f.manager().rollback().version, '0.5.2');
});
test('cached release still rejects tampered or extra incoming payload files', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, {recursive: true, force: true}));
  const m = f.manager(), pkg = f.make();
  const imported = m.importPackage(f.save(pkg, 'original.odup'));
  m.activate(imported.packageId); m.confirmHealthy();
  const cachedApp = path.join(m.activeRoots().ui, 'app.js');
  const originalBytes = fs.readFileSync(cachedApp);
  m.rollback();

  const tampered = structuredClone(pkg);
  tampered.payload['ui/app.js'] = Buffer.from('bad UI').toString('base64');
  assert.throws(() => m.importPackage(f.save(tampered, 'cached-tamper.odup')), /Payload hash mismatch/);

  const extra = structuredClone(pkg);
  extra.payload['core/extra.py'] = Buffer.from('unexpected').toString('base64');
  assert.throws(() => m.importPackage(f.save(extra, 'cached-extra.odup')), /Unexpected payload files/);

  assert.deepEqual(fs.readFileSync(cachedApp), originalBytes);
  assert.equal(m.importPackage(f.save(pkg, 'cached-original.odup')).packageId, imported.packageId);
});
test('unconfirmed startup is rolled back', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, {recursive: true, force: true}));
  const m = f.manager(), imported = m.importPackage(f.save(f.make()));
  m.activate(imported.packageId);
  assert.equal(f.manager().currentVersion(), '0.5.2');
  assert.equal(f.manager().status().pending, false);
});
test('tamper, unsigned manifest changes, traversal and unsupported paths fail closed', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, {recursive: true, force: true}));
  const m = f.manager();
  const payloadTamper = f.make(); payloadTamper.payload['ui/app.js'] = Buffer.from('tampered').toString('base64');
  assert.throws(() => m.importPackage(f.save(payloadTamper, 'tamper.odup')), /hash mismatch/);
  const manifestTamper = f.make(); manifestTamper.manifest.version = '0.5.4';
  assert.throws(() => m.importPackage(f.save(manifestTamper, 'unsigned.odup')), /signature/);
  for (const [name, value] of [['traversal', '../outside.py'], ['executable', 'electron/main.cjs']]) {
    const pkg = f.make('0.5.4', {[value]: 'bad'});
    assert.throws(() => m.importPackage(f.save(pkg, `${name}.odup`)), /manifest/);
  }
  assert.equal(m.currentVersion(), '0.5.2');
});
test('platform, compatibility, downgrade and corruption are rejected', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, {recursive: true, force: true}));
  const m = f.manager();
  const wrongPlatform = f.make(); wrongPlatform.manifest.platform = 'win32';
  assert.throws(() => m.importPackage(f.save(wrongPlatform, 'platform.odup')), /manifest/);
  const old = f.make('0.5.1');
  assert.throws(() => m.importPackage(f.save(old, 'old.odup')), /advance/);
  const incompatible = f.make(); incompatible.manifest.compatibility.minApp = '0.6.0';
  assert.throws(() => m.importPackage(f.save(incompatible, 'compat.odup')), /manifest/);
  const imported = m.importPackage(f.save(f.make(), 'good.odup'));
  m.activate(imported.packageId); m.confirmHealthy();
  fs.writeFileSync(path.join(m.activeRoots().ui, 'app.js'), 'corrupt');
  assert.equal(f.manager().currentVersion(), '0.5.2');
});
test('unlisted Python source and bytecode never survive signed-release verification',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true}));const m=f.manager();const x=m.importPackage(f.save(f.make()));m.activate(x.packageId);m.confirmHealthy();const core=m.activeRoots().core;
 fs.writeFileSync(path.join(core,'extra.py'),'malicious=1');assert.throws(()=>m.activeRoots(),/Unlisted/);fs.unlinkSync(path.join(core,'extra.py'));
 fs.mkdirSync(path.join(core,'__pycache__'));fs.writeFileSync(path.join(core,'__pycache__','open_deepl_core.cpython-312.pyc'),'bytecode');assert.throws(()=>m.activeRoots(),/Unlisted/);
 assert.equal(f.manager().currentVersion(),'0.5.2');
});
test('new base App supersedes an older active hot update',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true}));const m=f.manager();const x=m.importPackage(f.save(f.make()));m.activate(x.packageId);m.confirmHealthy();
 const newer=createRuntimeUpdateManager({bundleRoot:path.join(f.dir,'bundle'),userData:path.join(f.dir,'data'),appVersion:'0.5.4',publicKeyPath:path.join(f.dir,'key.pem'),platform:'darwin'});
 assert.equal(newer.currentVersion(),'0.5.4');assert.equal(newer.status().source,'bundle');
});
test('full runtime package must retain all bundled optional-feature modules',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true}));fs.writeFileSync(path.join(f.dir,'bundle','core','documents.py'),'doc=1');
 assert.throws(()=>f.manager().importPackage(f.save(f.make())),/omits/);
});
test('tentative manual rollback recovers the former healthy update if health never confirms',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true}));const m=f.manager();const x=m.importPackage(f.save(f.make()));m.activate(x.packageId);m.confirmHealthy();
 m.rollback({tentative:true});assert.equal(m.currentVersion(),'0.5.2');assert.equal(m.status().pending,true);
 assert.equal(f.manager().currentVersion(),'0.5.3');
 const next=f.manager();next.rollback({tentative:true});next.confirmHealthy();assert.equal(f.manager().currentVersion(),'0.5.2');
});
