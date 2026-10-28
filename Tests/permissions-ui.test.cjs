'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
const code=fs.readFileSync(path.join(root,'ui/app.js'),'utf8');
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(platform='darwin',restored=null){
  const ids=new Map();let active=null, updateStatus, sourceStatus={
    platform,doubleCopy:{requested:false,enabled:false,ready:false},
    permissions:{inputMonitoring:{state:'not-determined'},screen:{state:'not-determined'}}
  };
  const calls={set:[],opened:[],capture:0,translate:0,restart:[],restore:0};
  function element(){return {id:'',value:'',textContent:'',hidden:false,disabled:false,checked:false,scrollTop:0,
    children:[],dataset:{},classList:{toggle(){}},listeners:{},
    append(...parts){this.children.push(...parts);},replaceChildren(...parts){this.children=[...parts];},
    addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(){},focus(){active=this;},
    querySelectorAll(selector){const result=[];function walk(node){for(const child of node.children){if(selector==='[data-permission-focus]'&&child.dataset?.permissionFocus)result.push(child);walk(child);}}walk(this);return result;}};}
  for(const match of html.matchAll(/id="([^"]+)"/g))ids.set(match[1],element());
  const document={getElementById(id){if(ids.has(id))return ids.get(id);for(const node of ids.values()){let found;function walk(parent){for(const child of parent.children){if(child.id===id){found=child;return;}walk(child);}}walk(node);if(found)return found;}return null;},
    body:element(),createElement:element,addEventListener(){},get activeElement(){return active;}};
  ids.get('sourceLanguage').value='auto';ids.get('targetLanguage').value='Chinese';ids.get('tone').value='default';
  const api={appInfo:async()=>({platform}),glossary:async()=>[],status:async()=> 'sleeping',
    onEvent(){},onIntegrationStatus(fn){updateStatus=fn;},integrationStatus:async()=>sourceStatus,
    restorePermissionDraft:async()=>{calls.restore++;return restored;},restartForPermissions:async draft=>{calls.restart.push(draft);},
    setDoubleCopy:async value=>{calls.set.push(value);sourceStatus={...sourceStatus,doubleCopy:{requested:value,enabled:value,ready:false}};return sourceStatus;},
    openPermissions:async kind=>{calls.opened.push(kind);},captureScreen:async()=>{calls.capture++;return null;},
    history:async()=>[],translateClipboard:async()=>{},copy:async()=>{},exportText:async()=>{},cancel:async()=>{},
    translate:async()=>{calls.translate++;return 'req';},chooseDocument:async()=>null};
  const context={document,window:{openDeepL:api},performance:{now:()=>0},
    setInterval(){},setTimeout(){return 1;},clearTimeout(){},crypto:{randomUUID:()=> 'id'}};
  vm.runInNewContext(code,context,{filename:'ui/app.js'});
  return {ids,calls,document,api,flush,
    emit(status){sourceStatus=status;updateStatus(status);},
    async settings(){await ids.get('settingsButton').onclick();await flush();},
    all(){const out=[];function walk(node){out.push(node);for(const child of node.children)walk(child);}walk(ids.get('drawerContent'));return out;},
    findButton(label){return this.all().find(node=>node.textContent===label&&node.onclick);}};
}
const macStatus=(input='denied',screen='not-determined',flow)=>({platform:'darwin',
  doubleCopy:{requested:true,enabled:true,ready:false,reason:'input-monitoring'},
  permissions:{inputMonitoring:{state:input},screen:{state:screen}},permissionFlow:flow});

test('Mac requested switch stays on while permission is pending; only click opens settings',async()=>{
  const f=fixture();await f.flush();f.emit(macStatus());await f.settings();
  const toggle=f.all().find(node=>node.dataset.permissionFocus==='doubleCopy');
  assert.equal(toggle.checked,true);assert.match(f.all().map(node=>node.textContent).join(' '),/双击复制/);
  assert.deepEqual(f.calls.opened,[]);
  await f.findButton('打开输入监控设置').onclick();assert.deepEqual(f.calls.opened,['inputMonitoring']);
});

test('Windows has no macOS privacy navigation and can change the requested switch',async()=>{
  const f=fixture('win32');await f.flush();await f.settings();
  assert.equal(f.findButton('打开输入监控设置'),undefined);
  assert.equal(f.findButton('打开屏幕录制设置'),undefined);
  const toggle=f.all().find(node=>node.dataset.permissionFocus==='doubleCopy');toggle.checked=true;await toggle.onchange();
  assert.deepEqual(f.calls.set,[true]);
});

test('screen grant flow is nonmodal and does not discard text or result on a cancelled capture',async()=>{
  const f=fixture();await f.flush();f.ids.get('sourceText').value='Original';f.ids.get('resultText').textContent='Translation';
  await f.ids.get('screenshotButton').onclick();
  f.emit(macStatus('granted','denied',{kind:'screen',state:'waiting',message:'请授权屏幕录制'}));
  assert.equal(f.calls.capture,1);assert.equal(f.ids.get('sourceText').value,'Original');
  assert.equal(f.ids.get('resultText').textContent,'Translation');
  assert.equal(f.ids.get('permissionNotice').hidden,false);
  await f.ids.get('permissionNoticeSettings').onclick();assert.equal(f.ids.get('drawer').hidden,false);
  f.emit(macStatus('granted','granted',{kind:'screen',state:'ready'}));
  assert.match(f.ids.get('permissionNoticeText').textContent,/再次点击框选截图/);
  assert.equal(f.calls.capture,1);
});

test('focus status refresh updates settings in place and preserves drawer scroll',async()=>{
  const f=fixture();await f.flush();f.emit(macStatus());await f.settings();
  f.ids.get('drawer').scrollTop=120;
  f.emit({...macStatus('granted','granted'),doubleCopy:{requested:true,enabled:true,ready:true}});
  assert.equal(f.ids.get('drawer').scrollTop,120);
  assert.match(f.all().map(node=>node.textContent).join(' '),/双击复制：已就绪/);
  assert.equal(f.findButton('打开输入监控设置'),undefined);
});


test('one-time startup draft restores completed text without translating or loading model',async()=>{
  const draft={sourceText:'Hello',resultText:'你好',sourceLanguage:'English',targetLanguage:'Chinese',
    tone:'formal',autoTranslate:true,resultComplete:true,savedAt:'2026-10-21T00:00:00Z'};
  const f=fixture('darwin',draft);await f.flush();
  assert.equal(f.calls.restore,1);assert.equal(f.calls.translate,0);
  assert.equal(f.ids.get('sourceText').value,'Hello');assert.equal(f.ids.get('resultText').textContent,'你好');
  assert.equal(f.ids.get('sourceLanguage').value,'English');assert.equal(f.ids.get('tone').value,'formal');
  assert.equal(f.ids.get('copyButton').disabled,false);assert.equal(f.ids.get('exportButton').disabled,false);
  assert.equal(f.ids.get('autoTranslate').checked,true);
});

test('restart sends only text and selected options; active translation blocks restart',async()=>{
  const f=fixture('darwin',{sourceText:'Hello',resultText:'你好',sourceLanguage:'English',
    targetLanguage:'Chinese',tone:'formal',autoTranslate:false,resultComplete:true});
  await f.flush();f.emit(macStatus('restart-required','granted'));await f.settings();
  await f.findButton('重新启动应用以应用权限').onclick();
  assert.equal(f.calls.restart.length,1);
  assert.deepEqual(Object.keys(f.calls.restart[0]).sort(),['autoTranslate','resultComplete','resultText','sourceLanguage','sourceText','targetLanguage','tone','workspace'].sort());
  assert.equal(f.calls.restart[0].sourceText,'Hello');assert.equal(f.calls.restart[0].resultText,'你好');
  f.emit(macStatus('restart-required','granted'));await f.ids.get('translateButton').onclick();await f.flush();
  await f.findButton('重新启动应用以应用权限').onclick();
  assert.equal(f.calls.restart.length,1);assert.match(f.ids.get('notice').textContent,/先完成或停止/);
});

test('manual screen change offers restart even when a different permission flow is ready',async()=>{
  const f=fixture();await f.flush();f.emit(macStatus('granted','restart-required',{kind:'inputMonitoring',state:'ready'}));await f.settings();
  assert.ok(f.findButton('重新启动应用以应用权限'));
  assert.equal(f.findButton('打开屏幕录制设置'),undefined);
});
test('permission restart retains document selection/workspace without running translation',async()=>{
  const f=fixture('darwin',{sourceText:'Text',resultText:'文字',sourceLanguage:'English',targetLanguage:'Chinese',tone:'default',autoTranslate:true,resultComplete:true,
    workspace:'document',documentFile:{token:'restored',name:'sample.docx',extension:'.docx',size:1200}});
  await f.flush();assert.equal(f.document.body.dataset.workspace,'document');assert.equal(f.ids.get('documentName').textContent,'sample.docx');assert.equal(f.ids.get('translateButton').disabled,false);
  assert.equal(f.calls.translate,0);assert.equal(f.ids.get('sourceText').value,'Text');
});
