'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {CaptureTasks}=require('../electron/capture-tasks.cjs');
const {CoreRegistry}=require('../electron/document-temp.cjs');
test('closing during capture preparation prevents a late screenshot job',async()=>{
 const scope=new CaptureTasks();let ran=false;
 const pending=scope.run(()=>{ran=true;});await scope.close();await pending;
 assert.equal(ran,false);assert.equal(await scope.run(()=>true),null);assert.equal(scope.size,0);
});
test('quit waits for real OCR child close and exact screenshot directory cleanup',async()=>{
 const scope=new CaptureTasks(),cores=new CoreRegistry();
 let ready;const started=new Promise(resolve=>{ready=resolve;});let directory,closed=false;
 const pending=scope.run(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'OpenDeepL-capture-test-'));
  await fs.writeFile(path.join(directory,'region.png'),'private fixture',{mode:0o600});
  const child=cores.track(spawn(process.execPath,['-e','setInterval(()=>{},1000)']));
  try{await new Promise(resolve=>{child.once('close',()=>{closed=true;resolve();});ready();});}
  finally{await fs.rm(directory,{recursive:true,force:true});}
 });
 await started;assert.equal(cores.size,1);
 const quit=Promise.all([scope.close(),cores.stopAll()]);await quit;await pending;
 assert.equal(closed,true);assert.equal(cores.size,0);assert.equal(scope.size,0);
 await assert.rejects(fs.stat(directory),{code:'ENOENT'});
});
