'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {temporaryFor,cleanupTemporary,stopCore,CoreRegistry}=require('../electron/document-temp.cjs');
test('managed temporary naming rejects path/ID injection',()=>{assert.throws(()=>temporaryFor('/tmp/a.docx','../a'));assert.equal(path.basename(temporaryFor('/tmp/a.docx','01234567-1234-1234-1234-123456789abc')),'.OpenDeepL-01234567-1234-1234-1234-123456789abc.tmp');});
test('cancelling a real process removes only its known temporary file',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'OpenDeepL-temp-test-'));
 const file=temporaryFor(path.join(dir,'out.docx'),'01234567-1234-1234-1234-123456789abc');fs.writeFileSync(file,'partial');const other=path.join(dir,'original.docx');fs.writeFileSync(other,'original');
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);child.documentTemporary=file;
 await stopCore(child);assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(other,'utf8'),'original');fs.rmSync(dir,{recursive:true});
});
test('cleanup never accepts an arbitrary source/output path',()=>assert.throws(()=>cleanupTemporary('/tmp/original.docx')));
test('quit registry still waits after UI timeout/cancel removes its active job',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'OpenDeepL-quit-test-'));
 const file=temporaryFor(path.join(dir,'out.docx'),'01234567-1234-1234-1234-123456789abc');fs.writeFileSync(file,'partial');
 const registry=new CoreRegistry(),active=new Map();
 const child=registry.track(spawn(process.execPath,['-e','setInterval(()=>{},1000)']));child.documentTemporary=file;active.set('job',child);
 child.kill();active.delete('job'); // Same sequence as timeout/cancel before the close event.
 assert.equal(active.size,0);assert.equal(registry.size,1);
 await registry.stopAll();assert.equal(registry.size,0);assert.equal(fs.existsSync(file),false);fs.rmSync(dir,{recursive:true});
});
