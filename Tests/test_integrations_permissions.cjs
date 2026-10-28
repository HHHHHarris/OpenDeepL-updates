'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),fsSync=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const code=fsSync.readFileSync(path.join(__dirname,'../electron/integrations.cjs'),'utf8');
async function fixture(platform='darwin'){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'opendeepl-integration-'));
 const calls={open:[],request:[],messages:[],capture:0,ocr:0,clipboard:0,start:0,stop:0};
 const grants={inputMonitoring:false,screen:false,screenInProcess:'denied'};
 const win={isDestroyed:()=>false,isMinimized:()=>false,isFocused:()=>false,show(){},focus(){},hide(){},webContents:{isLoadingMainFrame:()=>false,send:(channel,value)=>calls.messages.push({channel,value})}};
 class DC{constructor(options){this.options=options;this.state={enabled:false,ready:false,reason:'disabled'};}status(){return {...this.state};}async setEnabled(enabled){calls[enabled?'start':'stop']++;this.enabled=enabled;this.state={enabled,ready:enabled&&(platform==='win32'||grants.inputMonitoring),reason:enabled?(platform==='win32'||grants.inputMonitoring?'ready':'input-monitoring'):'disabled'};this.options.onStatus();return this.status();}async close(){this.enabled=false;}}
 const electron={app:{isPackaged:false,getPath:()=>directory},BrowserWindow:function(){throw Error('Unexpected overlay');},desktopCapturer:{getSources:()=>{calls.capture++;throw Error('Unexpected capture');}},screen:{},
  globalShortcut:{register:()=>true,unregister(){}},ipcMain:{handle(){}},systemPreferences:{getMediaAccessStatus:()=>grants.screenInProcess},shell:{openExternal:async url=>calls.open.push(url)},clipboard:{readText:()=>{calls.clipboard++;return '';}}};
 function spawn(_cmd,args){const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.kill=()=>{};
  setImmediate(()=>{let value;if(args[0]==='--permission-status')value={inputMonitoring:grants.inputMonitoring,screen:grants.screen};else{calls.request.push(args[1]);value={requested:true,granted:grants[args[1]]};}child.stdout.emit('data',JSON.stringify(value));child.emit('close',0);});return child;}
 const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>name==='electron'?electron:name==='node:child_process'?{spawn}:name==='./double-copy.cjs'?{DoubleCopy:DC,readTranslationClipboard:async()=>{calls.clipboard++;return '';}}:name==='./permissions.cjs'?{PermissionCoordinator:class extends require('../electron/permissions.cjs').PermissionCoordinator{constructor(options){super({...options,platform});}}}:require(name.startsWith('./')?path.join(__dirname,'../electron',name):name),process:{platform,resourcesPath:'/fixture/resources',env:{}},setTimeout,clearTimeout,Promise,JSON,structuredClone},{filename:'integrations.cjs'});
 const integration=mod.exports.createIntegrations({root:path.join(__dirname,'..'),python:()=>'/python',getWindow:()=>win,ocr:()=>{calls.ocr++;}});
 return {integration,calls,grants,async close(){await integration.destroy();await fs.rm(directory,{recursive:true,force:true});}};
}

test('Mac restored feature preference does not open Settings at launch; enabling does',async()=>{
 const f=await fixture();try{await f.integration.register();assert.equal(f.integration.status().doubleCopy.requested,true);assert.equal(f.integration.status().doubleCopy.ready,false);assert.equal(f.calls.open.length,0);assert.equal(f.calls.request.length,0);
  await f.integration.setDoubleCopyEnabled(false);await f.integration.setDoubleCopyEnabled(true);assert.deepEqual(f.calls.request,['inputMonitoring']);assert.match(f.calls.open[0],/Privacy_ListenEvent$/);
  assert.equal(f.calls.clipboard,0);assert.equal(f.calls.capture,0);assert.equal(f.calls.ocr,0);
 }finally{await f.close();}
});
test('return refresh restarts observer after grant and stops it after revocation',async()=>{
 const f=await fixture();try{await f.integration.register();f.grants.inputMonitoring=true;await f.integration.recheckPermissions();assert.equal(f.integration.status().doubleCopy.ready,true);assert.equal(f.calls.open.length,0);
  f.grants.inputMonitoring=false;await f.integration.recheckPermissions();assert.equal(f.integration.status().doubleCopy.ready,false);assert.equal(f.integration.status().doubleCopy.requested,true);assert.equal(f.calls.open.length,0);
 }finally{await f.close();}
});
test('missing screenshot grant opens only its page, with no screen/clipboard/OCR access',async()=>{
 const f=await fixture();try{await f.integration.register();assert.equal(await f.integration.screenshot(),null);assert.deepEqual(f.calls.request,['screen']);assert.match(f.calls.open[0],/Privacy_ScreenCapture$/);assert.equal(f.calls.capture,0);assert.equal(f.calls.ocr,0);assert.equal(f.calls.clipboard,0);
  f.grants.screen=true;await f.integration.recheckPermissions();assert.equal(f.integration.status().permissions.screen.state,'restart-required');assert.equal(f.calls.capture,0);
 }finally{await f.close();}
});
test('Windows ready state is automatic after enable and never enters Mac privacy routes',async()=>{
 const f=await fixture('win32');try{await f.integration.register();assert.equal(f.integration.status().doubleCopy.ready,true);await f.integration.setDoubleCopyEnabled(false);assert.equal(f.integration.status().doubleCopy.ready,false);await f.integration.setDoubleCopyEnabled(true);assert.equal(f.integration.status().doubleCopy.ready,true);assert.equal(f.integration.status().permissions.inputMonitoring.state,'unsupported');assert.equal(f.calls.open.length,0);assert.equal(f.calls.request.length,0);
 }finally{await f.close();}
});
