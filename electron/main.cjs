'use strict';
const { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell, Tray, Menu, nativeImage } = require('electron');
// Keep existing update/privacy preferences when changing the display name.
const previousUserData=app.getPath('userData');
app.setName('OpenDeepL');
app.setPath('userData',previousUserData);
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {temporaryFor,cleanupTemporary,coreExitDiagnostic,stopCore,CoreRegistry}=require('./document-temp.cjs');
const {consumeContextTextFile}=require('./context-input.cjs');
const {saveDraft,consumeDraft,validateDraft}=require('./permission-draft.cjs');
const {createRuntimeUpdateManager}=require('./runtime-updates.cjs');
const {createUpdateChannel}=require('./update-channel.cjs');
const updateConfig=require('./update-config.json');
const {planBatch}=require('./document-batch.cjs');
const {createInterfaceLocale}=require('./interface-locale.cjs');
const cores=new CoreRegistry();
const {readGlossary,modelStatus,dataDirectory,engineStatus}=require('./local-state.cjs');
const {createSetupManager}=require('./setup-manager.cjs');
let setupManager, setupInitialization;
const startupClock=performance.now();

const ROOT = app.getAppPath();
const MAX_TEXT = 100_000;
const MAX_FILE = 2_000_000;
const MAX_LINE = 25_000_000;
const active = new Map();
const documentInputs = new Map(), completedDocuments = new Map();
let runtimeGeneration=crypto.randomUUID();
let onlineChannel,onlineResult=null,onlineBusy=false,autoUpdateCheck=true,onlineTimer;
let mainWindow, integrations, tray, runtimeUpdates, runtimeRoots, stagedUpdate, updateDraft=null, updateSwitching=false, updateTimer=null;
let interfaceLocale, acceptanceCaptureTimer, trayShow;
const testMode = process.argv.some(arg=>['--visual-test','--smoke-test','--acceptance-test'].includes(arg));
const visualTest = process.argv.includes('--visual-test');
if(process.argv.includes('--acceptance-test')){
  const option=process.argv.find(arg=>arg.startsWith('--acceptance-root='));
  if(option){const root=option.slice('--acceptance-root='.length);if(!path.isAbsolute(root))throw new Error('Acceptance root must be absolute');process.env.OPENDEEPL_DATA_DIR=path.join(root,'data');process.env.OPENDEEPL_TEST_DATA=path.join(root,'ui');process.env.OPENDEEPL_ENGINE_PORT='18084';}
  const portOption=process.argv.find(arg=>arg.startsWith('--acceptance-port='));
  if(portOption){const value=portOption.slice('--acceptance-port='.length);const port=Number(value);if(!/^\d+$/.test(value)||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid acceptance port');process.env.OPENDEEPL_ENGINE_PORT=String(port);}
}
if (testMode) app.setPath('userData', process.env.OPENDEEPL_TEST_DATA || path.join(os.tmpdir(), `OpenDeepL-test-${process.pid}`));
const captureArg=process.argv.find(arg=>arg.startsWith('--acceptance-capture-dir='));
const acceptanceCaptureDir=testMode&&captureArg?captureArg.slice('--acceptance-capture-dir='.length):null;
if(acceptanceCaptureDir!==null&&(!path.isAbsolute(acceptanceCaptureDir)||!acceptanceCaptureDir.trim()))throw new Error('Invalid acceptance capture directory.');
function nativeText(key,values){return interfaceLocale?.t(key,values)||createInterfaceLocale({directory:app.getPath('userData'),system:app.getLocale()}).t(key,values);}

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,MediaRouter');

function bundledRuntimeRoot(){return process.env.OPENDEEPL_RUNTIME_DIR?path.resolve(process.env.OPENDEEPL_RUNTIME_DIR):path.join(process.resourcesPath,'runtime');}
function configureBundledRuntime(){
  const runtime=bundledRuntimeRoot();
  if(!fsSync.existsSync(path.join(runtime,'python')))return;
  process.env.OPENDEEPL_LLAMA_SERVER=path.join(runtime,'llama',process.platform==='win32'?'llama-server.exe':'llama-server');
  process.env.OPENDEEPL_PDF_FONT=path.join(runtime,'fonts','NotoSansSC-Regular.ttf');
  process.env.PYTHONNOUSERSITE='1';process.env.PYTHONDONTWRITEBYTECODE='1';
}
async function assertConfigured(mode='quality'){
  if(!setupManager||(!app.isPackaged&&!process.env.OPENDEEPL_RUNTIME_DIR))return;
  await setupInitialization;
  const state=await setupManager.status();
  if(!state.runtime.ready)throw new Error(nativeText('runtimeSetup'));
  const model=state.models[mode];
  if(!model||!model.present||model.bytes!==model.requiredBytes)throw new Error(nativeText('modelSetup',{mode:mode==='fast'?'1.8B':'7B'}));
}
function pythonCommand() {
  if(process.env.OPENDEEPL_PYTHON)return path.resolve(process.env.OPENDEEPL_PYTHON);
  const bundled=path.join(bundledRuntimeRoot(),'python',process.platform==='win32'?'python.exe':'bin/python3');
  if(fsSync.existsSync(bundled))return bundled;
  const base=process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support/OpenDeepL'):path.join(process.env.LOCALAPPDATA||os.homedir(),'OpenDeepL');
  const local=path.join(base,'python',process.platform==='win32'?'Scripts/python.exe':'bin/python3');
  if(fsSync.existsSync(local))return local;
  return process.platform==='darwin'?'/usr/bin/python3':'python';
}
function handleMain(channel,handler){ipcMain.handle(channel,(event,...args)=>{if(!mainWindow||event.sender.id!==mainWindow.webContents.id)throw new Error('Invalid app sender.');return handler(event,...args);});}
function runOCR(file){return new Promise((resolve,reject)=>{
  const helper=path.join(ROOT,'platform',process.platform==='darwin'?'ocr_mac.py':'ocr_windows.py');
  const child=spawn(pythonCommand(),[helper,file],{cwd:ROOT,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  cores.track(child);
  let out='',errSize=0,settled=false,failure,forceTimer;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(forceTimer);error?reject(error):resolve(value);};
  const stop=error=>{failure=error;child.kill();if(!forceTimer)forceTimer=setTimeout(()=>child.kill('SIGKILL'),2000);};
  const timer=setTimeout(()=>stop(new Error('Local OCR timed out.')),30000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk;if(out.length>MAX_FILE)stop(new Error('OCR response exceeded limit.'));});
  child.stderr.on('data',chunk=>{errSize+=chunk.length;if(errSize>MAX_FILE)child.kill();});
  child.on('error',()=>finish(new Error('Local OCR runtime failed.')));
  child.on('close',code=>{if(failure||code!==0){finish(failure||new Error('Local OCR failed.'));return;}try{const result=JSON.parse(out);finish(null,{text:cleanString(result.text)});}catch{finish(new Error('Invalid local OCR response.'));}});
});}
function err(message) { return { type: 'error', message }; }
function cleanString(value, maximum = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid text field.');
  return value;
}
function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid translation request.');
  const text = cleanString(value.text);
  if(value.modelMode!==undefined&&!['quality','fast'].includes(value.modelMode))throw new Error('Invalid model mode.');
  if (!text.trim()) throw new Error('Translation text is empty.');
  const options = {modelMode:value.modelMode||'quality'};
  for (const key of ['sourceLanguage', 'targetLanguage', 'tone']) {
    if (value[key] !== undefined) options[key] = cleanString(value[key], 100);
  }
  const glossary = value.glossary === undefined ? [] : value.glossary;
  if (!Array.isArray(glossary) || glossary.length > 200) throw new Error('Invalid glossary.');
  options.glossary = glossary.map(item => ({
    id: cleanString(item?.id ?? '', 100),
    source: cleanString(item?.source, 200),
    target: cleanString(item?.target, 200)
  }));
  return { text, ...options };
}
function startCore(payload, onEvent, timeoutMs = 20000) {
  if(runtimeUpdates)runtimeRoots=runtimeUpdates.activeRoots();
  const coreRoot=runtimeRoots?path.dirname(runtimeRoots.core):ROOT;
  const args = ['-u', '-m', 'core.open_deepl_core'];
  const env = { ...process.env, PYTHONPATH: coreRoot+path.delimiter+ROOT, OPENDEEPL_APP_ROOT:ROOT, OPENDEEPL_CORE_ROOT:coreRoot, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
  if (process.platform === 'win32' && !env.OPENDEEPL_ENGINE_LAUNCHER) {
    const localLauncher = path.join(ROOT, 'platform', 'windows_engine.py');
    if (fsSync.existsSync(localLauncher)) env.OPENDEEPL_ENGINE_LAUNCHER = localLauncher;
  }
  const child = spawn(pythonCommand(), args, { cwd: coreRoot, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  cores.track(child);
  let buffer = '';
  let stderrBytes = 0;
  let ended = false;
  let terminalEvent = false;
  const fail = message => { if(!terminalEvent){terminalEvent=true;onEvent(err(message));} };
  const timer = setTimeout(() => { fail('Local operation timed out.'); child.kill(); }, timeoutMs);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > MAX_LINE) { fail('Local response exceeded limit.'); child.kill(); return; }
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === 'object' && event.id === payload.id && typeof event.type === 'string') {
          if (['final', 'documentFinal', 'documentBatchFinal', 'error', 'status', 'history', 'glossary', 'ok'].includes(event.type)) terminalEvent = true;
          onEvent(event);
        }
        else onEvent(err('Invalid local response.'));
      } catch { onEvent(err('Invalid local response.')); }
    }
  });
  // Drain stderr without logging user text or exposing internal paths.
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 1_000_000) { fail('Local Python diagnostics exceeded limit.'); child.kill(); } });
  child.on('error', () => { if (!ended) fail('Local Python runtime did not start.'); });
  child.on('close', (code,signal) => {
    clearTimeout(timer);
    ended = true;
    try{cleanupTemporary(child.documentTemporary);}catch{onEvent(err(nativeText('temporaryCleanup')));}
    if (!terminalEvent) fail(coreExitDiagnostic(code,signal,stderrBytes));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(payload) + '\n');
  return child;
}
function coreOnce(action, fields = {}, expected = action) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false;
    startCore({ id, action, ...fields }, event => {
      if (settled) return;
      if (event.type === 'error') { settled = true; reject(new Error(event.message)); }
      else if (event.type === expected || event.type === 'ok') { settled = true; resolve(event); }
    });
  });
}
function report(id, event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('opendeepl:event', { id, ...event });
}
function updateSnapshot(){return {...runtimeUpdates.status(),staged:stagedUpdate?.version||null,baseVersion:app.getVersion(),online:onlineResult?{status:onlineResult.status,version:onlineResult.update?.manifest.version||onlineResult.version}:null,checking:onlineBusy,autoCheck:autoUpdateCheck,repository:updateConfig.repository};}
async function checkOnlineUpdate(){
  if(onlineBusy)return updateSnapshot();onlineBusy=true;
  try{onlineResult=await onlineChannel.check({currentVersion:runtimeUpdates.currentVersion()});return updateSnapshot();}
  finally{onlineBusy=false;}
}
function assertUpdateIdle(){if(active.size||cores.size||updateSwitching||integrations?.isBusy?.())throw new Error(nativeText('updateIdle'));}
function checkedUpdateDraft(raw){
  if(!raw||JSON.stringify(raw).length>1200000)throw new Error(nativeText('updateDraftLimit'));
  const checked=validateDraft(raw);
  checked.modelMode=['fast','quality'].includes(raw.modelMode)?raw.modelMode:'quality';
  checked.lastResultModel=['fast','quality'].includes(raw.lastResultModel)?raw.lastResultModel:null;
  if(raw.lastCompletedRequest)checked.lastCompletedRequest=validateRequest(raw.lastCompletedRequest);
  checked.documentFiles=(Array.isArray(raw.documentFiles)?raw.documentFiles:[]).slice(0,20).flatMap(item=>{
    const input=documentInputs.get(item.token);return input?[{token:item.token,name:path.basename(input.file),extension:input.extension,size:Number(item.size)||0}]:[];
  });
  checked.documentItems=checked.documentFiles.map((file,index)=>{
    const item=raw.documentItems?.[index];const completed=item?.status==='completed'&&completedDocuments.has(item.resultId);
    return {...file,status:completed?'completed':'queued',resultId:completed?item.resultId:null,report:completed?{unresolved:Array.isArray(item.report?.unresolved)?item.report.unresolved.slice(0,500).map(x=>String(x).slice(0,100)):[]}:undefined};
  });return checked;
}
async function loadRuntimeUI(){runtimeGeneration=crypto.randomUUID();return mainWindow.loadFile(path.join(runtimeRoots.ui,'index.html'));}
async function recoverUpdate(){
  clearTimeout(updateTimer);runtimeUpdates.rollback();runtimeRoots=runtimeUpdates.activeRoots();
  await loadRuntimeUI();
}
async function switchUpdate(draft,rollback=false){
  assertUpdateIdle();if(!rollback&&!stagedUpdate)throw new Error(nativeText('importSignedUpdate'));
  updateDraft=checkedUpdateDraft(draft);updateSwitching=true;let switched=false;
  try{
    if(rollback)runtimeUpdates.rollback({tentative:true});else runtimeUpdates.activate(stagedUpdate.packageId);switched=true;
    runtimeRoots=runtimeUpdates.activeRoots();
    const health=await coreOnce('health',{},'ok');
    if(health.protocolVersion!==1||!['quality','fast'].every(mode=>health.modelModes?.includes(mode)))throw new Error(nativeText('updateHealth'));
    updateTimer=setTimeout(()=>recoverUpdate().catch(()=>{}),15000);
    await loadRuntimeUI();stagedUpdate=null;return true;
  }catch(error){if(switched)await recoverUpdate();else{updateSwitching=false;updateDraft=null;}throw error;}
}
function registerIPC() {
  handleMain('opendeepl:setInterfaceLocale',async(_event,locale)=>interfaceLocale.set(locale));
  handleMain('opendeepl:setupStatus',()=>setupManager.status());
  handleMain('opendeepl:setupInitialize',async()=>{setupInitialization=setupManager.initialize();return setupInitialization;});
  handleMain('opendeepl:setupDownload',async(_event,mode)=>{
    if(!['quality','fast'].includes(mode))throw new Error('INVALID_MODE');
    await setupInitialization;return setupManager.downloadModel(mode);
  });
  handleMain('opendeepl:setupImport',async(_event,mode)=>{
    if(!['quality','fast'].includes(mode))throw new Error('INVALID_MODE');
    const result=await dialog.showOpenDialog(mainWindow,{title:nativeText('selectModel'),defaultPath:setupManager.paths().models,properties:['openFile'],filters:[{name:nativeText('ggufModel'),extensions:['gguf']}]});
    if(result.canceled||!result.filePaths.length)return null;
    await setupInitialization;return setupManager.importModel(mode,result.filePaths[0]);
  });
  handleMain('opendeepl:setupCancel',()=>setupManager.cancelDownload());
  handleMain('opendeepl:modelLicense',(_event,mode)=>{if(!['quality','fast'].includes(mode))throw new Error('INVALID_MODE');return shell.openExternal(setupManager.modelCatalog[mode].licenseUrl);});

  handleMain('opendeepl:translate', async (_event, request) => {
    await assertConfigured(request?.modelMode||'quality');
    if(active.size||updateSwitching)throw new Error(nativeText('currentTranslation'));
    const checked = validateRequest(request);
    const id = crypto.randomUUID();
    let finished = false;
    const child = startCore({ id, action: 'translate', request: checked }, event => {
      if (finished || active.get(id) !== child) return;
      report(id, event);
      if (event.type === 'final' || event.type === 'error') { finished = true; active.delete(id); }
    }, 310000);
    active.set(id, child);
    return id;
  });
  handleMain('opendeepl:cancel', async (_event, id) => {
    cleanString(id, 100);
    const child = active.get(id);
    if (child) { active.delete(id); await stopCore(child); report(id, { type: 'cancelled' }); return true; }
    return false;
  });
  handleMain('opendeepl:engineStatus',(_event,mode='quality')=>engineStatus(mode));
  handleMain('opendeepl:status', (_event,mode='quality') => modelStatus(mode));
  handleMain('opendeepl:history', async () => (await coreOnce('history')).items);
  handleMain('opendeepl:removeHistory', async (_event, id) => { await coreOnce('removeHistory', { id: cleanString(id, 100) }, 'ok'); return true; });
  handleMain('opendeepl:clearHistory', async () => { await coreOnce('clearHistory', {}, 'ok'); return true; });
  handleMain('opendeepl:glossary', () => readGlossary());
  handleMain('opendeepl:saveGlossary', async (_event, entries) => {
    if (!Array.isArray(entries) || entries.length > 200) throw new Error('Invalid glossary.');
    const items = entries.map(item => ({ id: cleanString(item?.id ?? '', 100), source: cleanString(item?.source, 200), target: cleanString(item?.target, 200) }));
    await coreOnce('saveGlossary', { items }, 'ok'); return true;
  });
  handleMain('opendeepl:copy', async (_event, text) => { await clipboard.writeText(cleanString(text)); return true; });
  handleMain('opendeepl:importText', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: nativeText('textFilter'), extensions: ['txt', 'md', 'srt', 'csv'] }] });
    if (selected.canceled || !selected.filePaths.length) return null;
    const file = selected.filePaths[0];
    if (!['.txt', '.md', '.srt', '.csv'].includes(path.extname(file).toLowerCase())) throw new Error(nativeText('unsupportedText'));
    if ((await fs.stat(file)).size > MAX_FILE) throw new Error(nativeText('textLimit'));
    return { name: path.basename(file), text: await fs.readFile(file, 'utf8') };
  });
  handleMain('opendeepl:exportText', async (_event, text) => {
    const checked = cleanString(text);
    const selected = await dialog.showSaveDialog(mainWindow, { defaultPath: 'translation.txt', filters: [{ name: nativeText('textFilter'), extensions: ['txt'] }] });
    if (selected.canceled || !selected.filePath) return false;
    await fs.writeFile(selected.filePath, checked, { encoding: 'utf8', flag: 'w' });
    return true;
  });
  handleMain('opendeepl:ocrFile', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: nativeText('imagesFilter'), extensions: ['png', 'jpg', 'jpeg'] }] });
    if (selected.canceled || !selected.filePaths.length) return null;
    const file = selected.filePaths[0];
    if (!['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())) throw new Error(nativeText('unsupportedImage'));
    if ((await fs.stat(file)).size > 25_000_000) throw new Error(nativeText('imageLimit'));
    return runOCR(file);
  });
  handleMain('opendeepl:integrationStatus',()=>integrations.recheckPermissions());
  handleMain('opendeepl:setDoubleCopy',(_event,enabled)=>integrations.setDoubleCopyEnabled(enabled));
  handleMain('opendeepl:retryDoubleCopy',()=>integrations.retryDoubleCopy());
  handleMain('opendeepl:translateClipboard',()=>integrations.translateClipboard());
  handleMain('opendeepl:openPermissions',(_event,kind)=>integrations.permissions(kind));
  handleMain('opendeepl:restorePermissionDraft',async()=>{
    if(updateDraft)return updateDraft;
    const draft=await consumeDraft(app.getPath('userData'));if(!draft)return null;
    const inputs=draft.documentInputs?.length?draft.documentInputs:(draft.documentInput?[draft.documentInput]:[]);delete draft.documentInput;delete draft.documentInputs;
    if(inputs.length)documentInputs.clear();
    const restored=[];
    for(const input of inputs){try{const stat=await fs.stat(input.file);if(stat.isFile()&&stat.size<=100000000){
      const token=crypto.randomUUID();documentInputs.set(token,input);
      restored.push({token,name:path.basename(input.file),extension:input.extension,size:stat.size});
    }}catch{draft.documentMissing=true;}}
    if(restored.length){draft.documentFile=restored[0];draft.documentFiles=restored;}
    return draft;
  });
  handleMain('opendeepl:restartForPermissions',async(_event,draft)=>{
    if(active.size||updateSwitching)throw new Error(nativeText('restartTranslation'));
    const checked=await integrations.recheckPermissions();
    if(!Object.values(checked.permissions||{}).some(value=>value.state==='restart-required'))throw new Error(nativeText('noRestart'));
    await saveDraft(app.getPath('userData'),draft,{documentInput:documentInputs.values().next().value,documentInputs:[...documentInputs.values()]});
    app.relaunch();app.isQuitting=true;app.quit();return true;
  });
  handleMain('opendeepl:captureScreen',()=>integrations.screenshot());
  handleMain('opendeepl:chooseDocument',async()=>{
    const selected=await dialog.showOpenDialog(mainWindow,{properties:['openFile'],filters:[{name:nativeText('documentsFilter'),extensions:['docx','pptx','pdf']}]});
    if(selected.canceled||!selected.filePaths.length)return null;
    const file=selected.filePaths[0],extension=path.extname(file).toLowerCase();
    if(!['.docx','.pptx','.pdf'].includes(extension))throw new Error(nativeText('selectDocument'));
    const size=(await fs.stat(file)).size;if(size>100_000_000)throw new Error(nativeText('documentTooLarge'));
    const token=crypto.randomUUID();documentInputs.clear();documentInputs.set(token,{file,extension});return {token,name:path.basename(file),extension,size};
  });
  handleMain('opendeepl:chooseDocuments',async()=>{
    if(active.size||updateSwitching)throw new Error(nativeText('chooseDocumentsIdle'));
    const selected=await dialog.showOpenDialog(mainWindow,{properties:['openFile','multiSelections'],filters:[{name:nativeText('documentsFilter'),extensions:['docx','pptx','pdf']}]});
    if(selected.canceled||!selected.filePaths.length)return null;
    if(selected.filePaths.length>20)throw new Error(nativeText('documentCount'));
    const chosen=[];
    for(const file of selected.filePaths){
      const extension=path.extname(file).toLowerCase();
      if(!['.docx','.pptx','.pdf'].includes(extension))throw new Error(nativeText('selectDocument'));
      const stat=await fs.stat(file);if(!stat.isFile()||stat.size>100_000_000)throw new Error(nativeText('documentUnderLimit'));
      chosen.push({token:crypto.randomUUID(),file,extension,size:stat.size});
    }
    documentInputs.clear();for(const item of chosen)documentInputs.set(item.token,{file:item.file,extension:item.extension});
    return chosen.map(({token,file,extension,size})=>({token,name:path.basename(file),extension,size}));
  });
  handleMain('opendeepl:translateDocuments',async(_event,tokens,options)=>{
    await assertConfigured('quality');
    if(active.size||updateSwitching)throw new Error(nativeText('currentTranslation'));
    if(!Array.isArray(tokens)||tokens.length<1||tokens.length>20||new Set(tokens).size!==tokens.length)throw new Error(nativeText('documentCount'));
    const inputs=tokens.map(token=>{const input=documentInputs.get(cleanString(token,100));if(!input)throw new Error(nativeText('documentExpired'));return input;});
    const checked=validateRequest({text:'document',...options});delete checked.text;
    const selected=await dialog.showOpenDialog(mainWindow,{title:nativeText('selectOutputFolder'),properties:['openDirectory','createDirectory'],defaultPath:path.dirname(inputs[0].file)});
    if(selected.canceled||!selected.filePaths.length)return null;
    const jobs=planBatch(inputs,selected.filePaths[0]);const id=crypto.randomUUID();const temporary=temporaryFor(jobs[0].output,id);
    let finished=false;
    const child=startCore({id,action:'translateDocumentBatch',jobs,temporary,request:checked},event=>{
      if(finished||active.get(id)!==child)return;
      if(event.type==='documentBatchItem'){
        const index=event.fileIndex;
        if(!Number.isInteger(index)||index<1||index>jobs.length)return;
        if(event.item?.status==='completed'){
          const resultId=id+':'+index;completedDocuments.set(resultId,jobs[index-1].output);
          event={...event,item:{...event.item,resultId}};
        }
      }
      if(event.type==='documentBatchFinal'&&event.report?.items){event={...event,report:{...event.report,items:event.report.items.map((item,index)=>({...item,...(item.status==='completed'?{resultId:id+':'+(index+1)}:{})}))}};}
      report(id,event);
      if(event.type==='documentBatchFinal'||event.type==='error'){finished=true;active.delete(id);}
    },3600000);child.documentTemporary=temporary;active.set(id,child);return id;
  });
  handleMain('opendeepl:translateDocument',async(_event,token,options)=>{
    await assertConfigured('quality');
    const input=documentInputs.get(cleanString(token,100));if(!input)throw new Error(nativeText('reselectDocument'));
    if(active.size||updateSwitching)throw new Error(nativeText('currentTranslation'));
    const checked=validateRequest({text:'document',...options});delete checked.text;
    const selected=await dialog.showSaveDialog(mainWindow,{defaultPath:input.file.slice(0,-input.extension.length)+'.translated'+input.extension,filters:[{name:nativeText('translatedDocument'),extensions:[input.extension.slice(1)]}]});
    if(selected.canceled||!selected.filePath)return null;
    const output=selected.filePath;
    if(path.resolve(output)===path.resolve(input.file)||path.extname(output).toLowerCase()!==input.extension)throw new Error(nativeText('differentOutput'));
    const id=crypto.randomUUID();let finished=false;const temporary=temporaryFor(output,id);
    const child=startCore({id,action:'translateDocument',input:input.file,output,temporary,request:checked},event=>{
      if(finished||active.get(id)!==child)return;
      if(event.type==='documentFinal'){completedDocuments.set(id,output);}
      report(id,event);
      if(event.type==='documentFinal'||event.type==='error'){finished=true;active.delete(id);}
    },3600000);child.documentTemporary=temporary;active.set(id,child);return id;
  });
  handleMain('opendeepl:revealDocument',(_event,id)=>{const file=completedDocuments.get(cleanString(id,100));if(file)shell.showItemInFolder(file);return !!file;});
  handleMain('opendeepl:appInfo', () => ({ platform: process.platform, version: runtimeRoots?.version||app.getVersion(), appVersion:app.getVersion(), runtimeGeneration, interfaceLocale:interfaceLocale.get(), offline: true }));
  handleMain('opendeepl:updateStatus',()=>updateSnapshot());
  handleMain('opendeepl:checkUpdates',()=>checkOnlineUpdate());
  handleMain('opendeepl:setAutoUpdateCheck',async(_event,value)=>{
    if(typeof value!=='boolean')throw new Error('Invalid update preference.');autoUpdateCheck=value;
    const file=path.join(app.getPath('userData'),'update-preferences.json');await fs.mkdir(path.dirname(file),{recursive:true});
    const tmp=file+'.'+crypto.randomUUID();await fs.writeFile(tmp,JSON.stringify({autoCheck:value}),{mode:0o600});await fs.rename(tmp,file);return updateSnapshot();
  });
  handleMain('opendeepl:downloadUpdate',async()=>{
    if(onlineBusy)throw new Error(nativeText('updateBusy'));
    if(onlineResult?.status!=='available')throw new Error(nativeText('checkUpdateFirst'));onlineBusy=true;
    try{const downloaded=await onlineChannel.download(onlineResult.update,{currentVersion:runtimeUpdates.currentVersion()});
      stagedUpdate=runtimeUpdates.importPackage(downloaded.file);return updateSnapshot();
    }finally{onlineBusy=false;}
  });
  handleMain('opendeepl:importUpdate',async()=>{
    assertUpdateIdle();const selected=await dialog.showOpenDialog(mainWindow,{title:nativeText('importUpdate'),properties:['openFile'],filters:[{name:nativeText('updatePackage'),extensions:['odup']}]});
    if(selected.canceled||!selected.filePaths.length)return null;assertUpdateIdle();
    stagedUpdate=runtimeUpdates.importPackage(selected.filePaths[0]);return {version:stagedUpdate.version};
  });
  handleMain('opendeepl:applyUpdate',(_event,draft)=>switchUpdate(draft));
  handleMain('opendeepl:rollbackUpdate',(_event,draft)=>switchUpdate(draft,true));
  handleMain('opendeepl:runtimeReady',(_event,token)=>{
    if(token!==runtimeGeneration)return false;
    if(updateSwitching){clearTimeout(updateTimer);if(runtimeUpdates.status().pending)runtimeUpdates.confirmHealthy();updateSwitching=false;}
    updateDraft=null;return true;
  });
}
function refreshNativeMenus(){
  if(!tray)return;
  tray.setToolTip(nativeText('trayTooltip'));
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:nativeText('openApp'),click:trayShow},
    {label:nativeText('clipboard'),click:()=>integrations.translateClipboard()},
    {label:nativeText('screenshot'),click:()=>integrations.screenshot().then(value=>{if(value)mainWindow.webContents.send('opendeepl:externalText',value);}).catch(error=>{trayShow();mainWindow.webContents.send('opendeepl:externalText',{error:error.message});})},
    {type:'separator'},
    {label:nativeText('quit'),click:()=>{app.isQuitting=true;app.quit();}}
  ]));
}
async function writeCaptureFrame(directory){
  const png=(await mainWindow.webContents.capturePage()).toPNG();
  const temp=path.join(directory,`current.${process.pid}.${crypto.randomUUID()}.tmp`);
  try{await fs.writeFile(temp,png,{mode:0o600});await fs.rename(temp,path.join(directory,'current.png'));}
  catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
}
function startAcceptanceCapture(){
  if(!acceptanceCaptureDir)return;
  let busy=false;
  const capture=async()=>{if(busy||!mainWindow||mainWindow.isDestroyed())return;busy=true;try{await writeCaptureFrame(acceptanceCaptureDir);}catch{clearInterval(acceptanceCaptureTimer);acceptanceCaptureTimer=null;process.stderr.write('Acceptance capture failed.\n');app.exit(1);}finally{busy=false;}};
  fs.mkdir(acceptanceCaptureDir,{recursive:true}).then(()=>{capture();acceptanceCaptureTimer=setInterval(capture,2000);}).catch(()=>{process.stderr.write('Acceptance capture failed.\n');app.exit(1);});
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 620,
    title: 'OpenDeepL', backgroundColor: '#282829',
    icon: path.join(ROOT, 'assets', process.platform === 'win32' ? 'AppIcon.ico' : 'AppIcon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.session.on('will-download', event => event.preventDefault());
  mainWindow.webContents.on('context-menu',(_event,params)=>{
    const text=params.selectionText;
    const items=[];
    if(text?.trim()&&text.length<=MAX_TEXT)items.push({label:nativeText('contextSelection'),click:()=>integrations.deliver({text,source:'context-menu'})},{type:'separator'});
    items.push({role:'copy',enabled:!!text},{role:'paste',enabled:!!params.isEditable},
      {type:'separator'},{label:nativeText('clipboard'),click:()=>integrations.translateClipboard()});
    Menu.buildFromTemplate(items).popup({window:mainWindow});
  });
  const page = path.join(runtimeRoots?.ui||path.join(ROOT,'ui'), 'index.html');
  const loading = mainWindow.loadFile(page);
  mainWindow.webContents.once('did-finish-load',()=>{app.startupLoadMs=performance.now()-startupClock;if(acceptanceCaptureDir)acceptanceCaptureTimer=setTimeout(startAcceptanceCapture,2000);});
  if (visualTest) {
    loading.then(async () => {
      const directory = process.env.OPENDEEPL_VISUAL_DIR || path.join(ROOT, 'evidence', 'visual');
      await fs.mkdir(directory, { recursive: true });
      const captures = [];
      await mainWindow.webContents.executeJavaScript(`(async()=>{if(typeof startupReady!=='undefined')await startupReady;if(typeof refreshStatus==='function')await refreshStatus();})()`);
      for (const [width, height] of [[1180,760],[900,620]]) {
        mainWindow.setSize(width,height);
        for(const scenario of ['text','document','settings']){
          await mainWindow.webContents.executeJavaScript(`(()=>{const d=document.getElementById('drawer');if(!d.hidden)document.getElementById('closeDrawer').click();document.getElementById('${scenario==='document'?'docTab':'textTab'}').click();${scenario==='settings'?"document.getElementById('settingsButton').click();":''}})()`);
          await new Promise(resolve=>setTimeout(resolve,350));
          const layout=await mainWindow.webContents.executeJavaScript(`(()=>{const rect=el=>{if(!el||el.hidden)return null;const r=el.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};};return{viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight},panes:{source:rect(document.querySelector('.source-pane')),result:rect(document.querySelector('.result-pane')),document:rect(document.getElementById('documentWorkspace')),drawer:rect(document.getElementById('drawer'))},header:rect(document.querySelector('.appbar')),footer:rect(document.querySelector('footer')),engineState:document.getElementById('engineState')?.textContent||''};})()`);
          const png=(await mainWindow.webContents.capturePage()).toPNG();
          const file=path.join(directory,`OpenDeepL-${scenario}-${width}x${height}.png`);await fs.writeFile(file,png);
          if(scenario==='text')await fs.writeFile(path.join(directory,`OpenDeepL-${width}x${height}.png`),png);
          captures.push({scenario,window:{width,height},file,layout});
        }
      }
      const report = path.join(directory, 'visual-report.json');
      await fs.writeFile(report, JSON.stringify({version:app.getVersion(),platform:process.platform,captures}, null, 2) + '\n');
      app.exit(0);
    }).catch(async error => {
      const directory = process.env.OPENDEEPL_VISUAL_DIR || path.join(ROOT, 'evidence', 'visual');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'visual-error.json'), JSON.stringify({error:'Visual test failed.'}) + '\n');
      app.exit(1);
    });
  }
  if (process.argv.includes('--smoke-test')) {
    loading.then(async () => {
      const bridge = await mainWindow.webContents.executeJavaScript(`(async () => {
        if (typeof window.openDeepL !== 'object') return {present:false};
        const checked = await Promise.race([
          Promise.all([window.openDeepL.status(), window.openDeepL.glossary()]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('bridge timeout')), 15000))
        ]);
        if(typeof startupReady!=='undefined')await startupReady;
        if(typeof refreshStatus==='function')await refreshStatus();
        return {present:true, status:checked[0], glossaryArray:Array.isArray(checked[1]),
          renderedState:document.getElementById('engineState')?.textContent || '', appReady:typeof startupReady!=='undefined'};
      })()`);
      const scriptPresent = await fs.access(path.join(ROOT, 'ui', 'app.js')).then(() => true, () => false);
      const uiReady = bridge.appReady;
      const result = { loaded: !!(bridge.present && scriptPresent && bridge.glossaryArray && uiReady), bridge, scriptPresent, url: mainWindow.webContents.getURL(), version: app.getVersion(), loadMs:app.startupLoadMs, readyMs:performance.now()-startupClock };
      if (process.env.OPENDEEPL_SMOKE_REPORT) await fs.writeFile(process.env.OPENDEEPL_SMOKE_REPORT, JSON.stringify(result) + '\n');
      app.exit(result.loaded ? 0 : 1);
    }).catch(async () => {
      const result = { loaded: false, version: app.getVersion() };
      if (process.env.OPENDEEPL_SMOKE_REPORT) await fs.writeFile(process.env.OPENDEEPL_SMOKE_REPORT, JSON.stringify(result) + '\n');
      app.exit(1);
    });
  }
}
function contextFileArgument(argv){const combined=argv.find(value=>typeof value==='string'&&value.startsWith('--context-text-file='));if(combined)return combined.slice('--context-text-file='.length);const index=argv.indexOf('--context-text-file');return index<0?undefined:argv[index+1];}
const primaryInstance=testMode||app.requestSingleInstanceLock({contextTextFile:contextFileArgument(process.argv)});
if(!primaryInstance)app.quit();
const waitingContextArguments=[];
function receiveContextArguments(argv){
  const file=contextFileArgument(argv);if(file===undefined)return;
  if(!integrations){if(waitingContextArguments.length<8)waitingContextArguments.push(argv);return;}
  try{const text=consumeContextTextFile(file);integrations.deliver({text,source:'context-menu'});}
  catch(error){integrations.deliver({error:nativeText('contextReceive')+error.message});}
}
app.on('second-instance',(_event,argv,_cwd,data)=>{if(mainWindow){mainWindow.show();mainWindow.focus();}receiveContextArguments(typeof data?.contextTextFile==='string'?['--context-text-file',data.contextTextFile]:argv);});
app.on('activate',()=>{if(mainWindow){mainWindow.show();mainWindow.focus();}integrations?.returned();});
app.on('browser-window-focus',()=>integrations?.returned());
app.whenReady().then(async () => {
  if(!primaryInstance)return;
  const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
  session.defaultSession.enableNetworkEmulation({ offline: true });
  session.defaultSession.webRequest.onBeforeRequest(filter, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  runtimeUpdates=createRuntimeUpdateManager({bundleRoot:ROOT,userData:app.getPath('userData'),appVersion:app.getVersion()});
  runtimeRoots=runtimeUpdates.activeRoots();
  onlineChannel=createUpdateChannel({userData:app.getPath('userData'),publicKeyPath:path.join(__dirname,'update-public-key.pem'),appVersion:app.getVersion(),feedURL:updateConfig.feeds[process.platform],timeoutMs:30000});
  interfaceLocale=createInterfaceLocale({directory:app.getPath('userData'),system:app.getLocale(),onChange:refreshNativeMenus});
  await interfaceLocale.load();
  try{const prefs=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'update-preferences.json'),'utf8'));autoUpdateCheck=prefs.autoCheck!==false;}catch{}
  configureBundledRuntime();
  setupManager=createSetupManager({dataDir:dataDirectory(),runtimeDir:bundledRuntimeRoot(),templatePath:path.join(ROOT,'platform/templates/hunyuan-translation.jinja'),onProgress:progress=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('opendeepl:setupProgress',progress);}});
  setupInitialization=Promise.resolve(null);
  registerIPC();
  createWindow();
  integrations=require('./integrations.cjs').createIntegrations({root:ROOT,python:pythonCommand,getWindow:()=>mainWindow,ocr:runOCR,getLocale:()=>interfaceLocale.get()});
  if(!testMode){
    // Update metadata is outside the renderer and off the critical startup path.
    onlineTimer=setTimeout(async()=>{if(!autoUpdateCheck||active.size)return;try{const result=await checkOnlineUpdate();if(result.online?.status==='available')mainWindow?.webContents.send('opendeepl:updateAvailable',{version:result.online.version});}catch{/* Offline use is unaffected. Manual check displays errors. */}},30000);
    await integrations.register();
    tray=new Tray(nativeImage.createFromPath(path.join(ROOT,'assets/AppIcon.png')).resize({width:20,height:20}));
    trayShow=()=>{if(mainWindow){mainWindow.show();mainWindow.focus();}};
    refreshNativeMenus();
    tray.on('click',trayShow);
    mainWindow.on('close',event=>{if(!app.isQuitting){event.preventDefault();mainWindow.hide();}});
    receiveContextArguments(process.argv);
    for(const argv of waitingContextArguments.splice(0))receiveContextArguments(argv);
  }
});
app.on('before-quit',event=>{
  app.isQuitting=true;setupManager?.cancelDownload();clearTimeout(updateTimer);clearTimeout(onlineTimer);clearInterval(acceptanceCaptureTimer);
  if(!app.quittingCleaned){event.preventDefault();if(app.cleaningQuit)return;app.cleaningQuit=true;active.clear();const screenshots=integrations?.destroy();Promise.all([cores.stopAll(),screenshots]).finally(()=>{app.quittingCleaned=true;app.exit(0);});}
});
app.on('window-all-closed',()=>{if(testMode)app.quit();});
