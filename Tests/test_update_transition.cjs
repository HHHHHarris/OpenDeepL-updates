'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
function fixture(){const handlers=new Map();let confirmed=0;const context={handleMain:(name,fn)=>handlers.set(name,fn),runtimeGeneration:'new-page',updateSwitching:true,updateDraft:{sourceText:'keep',resultText:'保留',documentItems:[{resultId:'a'}]},updateTimer:1,clearTimeout(){},runtimeUpdates:{status:()=>({pending:true}),confirmHealthy(){confirmed++;}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function registerIPC()'),source.indexOf('function createWindow()'))+';registerIPC();',context);return {context,handlers,confirmed:()=>confirmed};}
test('late ready ack from failed page cannot consume fallback draft or commit update',()=>{const f=fixture();const ack=f.handlers.get('opendeepl:runtimeReady');assert.equal(ack({},'old-page'),false);assert.equal(f.context.updateDraft.sourceText,'keep');assert.equal(f.context.updateSwitching,true);assert.equal(f.confirmed(),0);assert.equal(ack({},'new-page'),true);assert.equal(f.context.updateDraft,null);assert.equal(f.context.updateSwitching,false);assert.equal(f.confirmed(),1);});
test('rollback and normal activation both use model-mode health gate and compensating recovery',()=>{
 assert.match(source,/rollback\(\{tentative:true\}\)/);assert.match(source,/health\.modelModes\?\.includes\(mode\)/);assert.match(source,/if\(switched\)await recoverUpdate\(\)/);
});
