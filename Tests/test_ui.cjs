'use strict';
// Deterministic renderer-state regression, not a substitute for native GUI QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function fixture({earlyEvent = false, restoredDraft = null} = {}) {
  const nodes = new Map();
  const element = () => ({value:'', textContent:'', hidden:false, disabled:false, checked:false,
    children:[], listeners:{}, classList:{toggle(){}}, dataset:{},
    addEventListener(name, fn){this.listeners[name]=fn;},
    setAttribute(){}, append(...children){this.children.push(...children);},
    replaceChildren(){this.children=[];}, focus(){}});
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], element());
  nodes.get('sourceLanguage').value='auto'; nodes.get('targetLanguage').value='Chinese';
  nodes.get('tone').value='default'; nodes.get('autoTranslate').checked=/id="autoTranslate" checked/.test(html);
  const calls={translate:[],cancel:[],status:0,documents:[]}; let onEvent; const timers=new Map(); let timer=0;
  const api={appInfo:async()=>({platform:'darwin'}),glossary:async()=>[],restorePermissionDraft:async()=>restoredDraft,
    status:async()=>{calls.status++;return 'sleeping';},
    translate:async request=>{calls.translate.push(request);const id='req-'+calls.translate.length;
      if(earlyEvent)onEvent({id,type:'delta',text:'早'});return id;},
    cancel:async id=>{calls.cancel.push(id);return true;},onEvent:fn=>{onEvent=fn;},
    history:async()=>[],copy:async()=>{},exportText:async()=>{},saveGlossary:async()=>{},chooseDocument:async()=>({token:'test-doc',name:'sample.docx',extension:'.docx',size:1024}),translateDocument:async(token,options)=>{calls.documents.push({token,options});return 'doc-'+calls.documents.length;},revealDocument:async()=>true};
  const context={document:{getElementById:id=>nodes.get(id),body:element(),createElement:element,addEventListener(){}},
    window:{openDeepL:api,confirm:()=>false},performance:{now:()=>1000},crypto:{randomUUID:()=>String(++timer)},
    setInterval:()=>0,setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(code,context,{filename:'ui/app.js'}); await flush();
  return {nodes,calls,context,emit:event=>onEvent(event),
    async input(value){nodes.get('sourceText').value=value;nodes.get('sourceText').listeners.input();await flush();},
    async timers(){const due=[...timers.values()];timers.clear();for(const fn of due){await fn();}await flush();},
    async translate(){await nodes.get('translateButton').onclick();await flush();}};
}

test('opening an empty app probes status without loading or translating',async()=>{
  const f=await fixture();assert.equal(f.calls.translate.length,0);assert.equal(f.calls.status,1);
  assert.equal(f.nodes.get('autoTranslate').checked,true);assert.equal(f.nodes.get('translateButton').disabled,true);
});
test('hot-update restored output uses context-neutral wording and retains fast mode',async()=>{
  const f=await fixture({restoredDraft:{sourceText:'Hello',resultText:'你好',resultComplete:true,modelMode:'fast',lastResultModel:'fast',lastCompletedRequest:{text:'Hello',modelMode:'fast'}}});
  assert.equal(f.nodes.get('translationMeta').textContent,'已恢复 · 上次完成的译文');
  assert.equal(f.nodes.get('modelMode').value,'fast');
  assert.equal(f.nodes.get('retranslateButton').hidden,false);
  assert.equal(f.calls.translate.length,0);
});
test('hot-update restored document completion restores its progress bar',async()=>{
  const file={token:'d',name:'sample.docx',extension:'.docx',size:1024};
  const f=await fixture({restoredDraft:{workspace:'document',documentFiles:[file],documentItems:[{...file,status:'completed',resultId:'done'}]}});
  assert.equal(f.nodes.get('documentProgressBar').value,100);
  assert.equal(f.nodes.get('documentTotalCount').textContent,'1 / 1 已完成');
});
test('cached available update is only offered when numerically newer than current',async()=>{
  const f=await fixture();
  assert.equal(vm.runInNewContext("newerFeatureVersion('0.6.1','0.6.1')",f.context),false);
  assert.equal(vm.runInNewContext("newerFeatureVersion('0.6.1','0.6.2')",f.context),false);
  assert.equal(vm.runInNewContext("newerFeatureVersion('0.10.0','0.6.2')",f.context),true);
  assert.equal(vm.runInNewContext("newerFeatureVersion('invalid','0.6.2')",f.context),false);
});
test('disabling automatic translation clears a scheduled request',async()=>{
  const f=await fixture();await f.input('Hello');f.nodes.get('autoTranslate').checked=false;
  f.nodes.get('autoTranslate').onchange();await f.timers();assert.equal(f.calls.translate.length,0);
});
test('whitespace is not a translation request',async()=>{
  const f=await fixture();await f.input('  \n ');await f.timers();
  assert.equal(f.nodes.get('translateButton').disabled,true);assert.equal(f.calls.translate.length,0);
});
test('changing language in manual mode clears the previous result',async()=>{
  const f=await fixture();f.nodes.get('autoTranslate').checked=false;await f.input('Hello');await f.translate();
  f.emit({id:'req-1',type:'final',text:'你好'});f.nodes.get('targetLanguage').value='Japanese';
  f.nodes.get('targetLanguage').onchange();await f.timers();
  assert.equal(f.nodes.get('resultText').textContent,'');assert.equal(f.calls.translate.length,1);
});
test('tone change triggers a fresh request with the new option',async()=>{
  const f=await fixture();await f.input('Hello');f.nodes.get('tone').value='formal';
  f.nodes.get('tone').onchange();await f.timers();assert.equal(f.calls.translate.length,1);
  assert.equal(f.calls.translate[0].tone,'formal');
});
test('streamed events before request-id resolution are retained',async()=>{
  const f=await fixture({earlyEvent:true});await f.input('Hello');await f.translate();
  assert.equal(f.nodes.get('resultText').textContent,'早');
  f.emit({id:'req-1',type:'final',text:'你好'});assert.equal(f.nodes.get('resultText').textContent,'你好');
});
test('cancelled old events do not overwrite the new input',async()=>{
  const f=await fixture();await f.input('Hello');await f.translate();await f.input('New text');
  f.emit({id:'req-1',type:'final',text:'stale'});assert.equal(f.nodes.get('resultText').textContent,'');
  assert.deepEqual(f.calls.cancel,['req-1']);
});
test('source selector can represent every target after a swap',()=>{
  const options=id=>[...html.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)</select>'))[1].matchAll(/value="([^"]+)"/g)].map(m=>m[1]);
  const source=options('sourceLanguage');for(const target of options('targetLanguage'))assert.ok(source.includes(target),target);
});
test('swap blocks an in-progress partial result',async()=>{
  const f=await fixture();f.nodes.get('sourceLanguage').value='English';await f.input('Hello');await f.translate();
  f.emit({id:'req-1',type:'delta',text:'部分'});f.nodes.get('swapButton').onclick();
  assert.equal(f.nodes.get('sourceText').value,'Hello');assert.equal(f.nodes.get('sourceLanguage').value,'English');
});
test('partial and failed output is never offered as a completed export',async()=>{
  const f=await fixture();await f.input('Hello');await f.translate();
  f.emit({id:'req-1',type:'delta',text:'部分'});
  assert.equal(f.nodes.get('copyButton').disabled,true);assert.equal(f.nodes.get('exportButton').disabled,true);
  f.emit({id:'req-1',type:'error',message:'Local model stopped before completion.'});
  assert.equal(f.nodes.get('copyButton').disabled,true);assert.match(f.nodes.get('translationMeta').textContent,/未完成/);
});
test('only a final event enables copy and export',async()=>{
  const f=await fixture();await f.input('Hello');await f.translate();
  f.emit({id:'req-1',type:'final',text:'你好'});
  assert.equal(f.nodes.get('copyButton').disabled,false);assert.equal(f.nodes.get('exportButton').disabled,false);
});
test('a saved glossary edit invalidates the old result in manual mode',async()=>{
  const f=await fixture();f.nodes.get('autoTranslate').checked=false;await f.input('Hello');await f.translate();
  f.emit({id:'req-1',type:'final',text:'你好'});await f.nodes.get('glossaryButton').onclick();
  const form=f.nodes.get('drawerContent').children.find(x=>typeof x.onsubmit==='function');
  form.children[0].value='Hello';form.children[1].value='您好';
  await form.onsubmit({preventDefault(){}});await flush();
  assert.equal(f.nodes.get('resultText').textContent,'');assert.equal(f.nodes.get('copyButton').disabled,true);
});

test('document workspace has a real choose/translate/progress workflow',async()=>{
 const f=await fixture();await f.nodes.get('docTab').onclick();assert.equal(f.nodes.get('textWorkspace').hidden,true);
 await f.nodes.get('chooseDocument').onclick();assert.equal(f.nodes.get('translateButton').disabled,false);
 await f.translate();assert.equal(f.calls.documents.length,1);assert.equal(f.calls.documents[0].token,'test-doc');
 f.emit({id:'doc-1',type:'documentProgress',progress:{completed:1,total:2,part:'page1'}});assert.equal(f.nodes.get('documentProgressBar').value,50);
 f.emit({id:'doc-1',type:'documentFinal',report:{translatedSegments:2,unresolved:[]}});assert.equal(f.nodes.get('documentProgressBar').value,100);assert.equal(f.nodes.get('revealDocument').disabled,false);
});
test('switching workspaces cancels a pending automatic text timer',async()=>{
 const f=await fixture();await f.input('Hello');await f.nodes.get('docTab').onclick();await f.timers();assert.equal(f.calls.translate.length,0);assert.equal(f.calls.documents.length,0);
});

test('mode selection alone does not load or translate; default is quality',async()=>{
 const f=await fixture();assert.equal(f.nodes.get('modelMode').value,'quality');
 f.nodes.get('modelMode').value='fast';f.nodes.get('modelMode').onchange();await flush();
 assert.equal(f.calls.translate.length,0);await f.input('Hello');await f.translate();
 assert.equal(f.calls.translate[0].modelMode,'fast');assert.equal(f.nodes.get('modelMode').disabled,true);
});
test('7B retranslation repeats original request once while retaining fast selection',async()=>{
 const f=await fixture();f.nodes.get('autoTranslate').checked=false;
 f.nodes.get('modelMode').value='fast';f.nodes.get('modelMode').onchange();
 await f.input('Price: $19.99.');await f.translate();f.emit({id:'req-1',type:'final',text:'价格：19.99美元。',modelMode:'fast'});
 assert.equal(f.nodes.get('retranslateButton').hidden,false);
 await f.nodes.get('retranslateButton').onclick();await flush();
 assert.equal(f.calls.translate[1].modelMode,'quality');assert.equal(f.calls.translate[1].text,'Price: $19.99.');
 assert.equal(f.calls.translate[1].targetLanguage,f.calls.translate[0].targetLanguage);
 f.emit({id:'req-2',type:'final',text:'价格：19.99美元。',modelMode:'quality'});
 assert.match(f.nodes.get('translationMeta').textContent,/7B/);assert.equal(f.nodes.get('retranslateButton').hidden,true);
 assert.equal(f.nodes.get('modelMode').value,'fast');
});
test('document mode stays quality and switching back restores text preference without inference',async()=>{
 const f=await fixture();f.nodes.get('modelMode').value='fast';f.nodes.get('modelMode').onchange();
 await f.nodes.get('docTab').onclick();assert.equal(f.nodes.get('modelMode').value,'quality');assert.equal(f.nodes.get('modelMode').disabled,true);
 await f.nodes.get('chooseDocument').onclick();await f.translate();assert.equal(f.calls.documents[0].options.modelMode,'quality');
 f.emit({id:'doc-1',type:'documentFinal',report:{}});f.nodes.get('textTab').onclick();assert.equal(f.nodes.get('modelMode').value,'fast');assert.equal(f.calls.translate.length,0);
});
