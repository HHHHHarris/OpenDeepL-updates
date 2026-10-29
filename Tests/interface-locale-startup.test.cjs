'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
const code=fs.readFileSync(path.join(root,'ui/app.js'),'utf8');
const flush=async()=>{for(let n=0;n<24;n++)await Promise.resolve();};

function fixture(initialLocale='en',hasNativeSetter=true){
 const ids=new Map();let active=null,resolveInfo,eventHandler,clock=0;const calls={native:[],translate:0};
 function element(){return {id:'',value:'',textContent:'',hidden:false,disabled:false,checked:false,scrollTop:0,children:[],dataset:{},classList:{toggle(){}},append(...parts){this.children.push(...parts);},replaceChildren(...parts){this.children=[...parts];},addEventListener(){},setAttribute(){},focus(){active=this;},querySelectorAll(){return [];}};}
 for(const match of html.matchAll(/id="([^"]+)"/g))ids.set(match[1],element());
 const document={body:element(),getElementById(id){if(ids.has(id))return ids.get(id);for(const node of ids.values()){let found;function visit(parent){for(const child of parent.children){if(child.id===id){found=child;return;}visit(child);}}visit(node);if(found)return found;}return null;},createElement:element,addEventListener(){},get activeElement(){return active;}};
 ids.get('sourceLanguage').value='auto';ids.get('targetLanguage').value='Chinese';ids.get('tone').value='default';
 const listeners=[];const i18n={locale:initialLocale,t:value=>value,tFragments:value=>value,applyStatic(){},onChange(fn){listeners.push(fn);},setLocale(value){if(value!==this.locale){this.locale=value;listeners.forEach(fn=>fn(value));}}};
 const api={appInfo:()=>new Promise(resolve=>{resolveInfo=resolve;}),glossary:async()=>[],status:async()=> 'sleeping',onEvent(fn){eventHandler=fn;},integrationStatus:async()=>({platform:'darwin',permissions:{},doubleCopy:{}}),history:async()=>[],translateClipboard:async()=>{},copy:async()=>{},exportText:async()=>{},cancel:async()=>{},translate:async()=>{calls.translate++;return 'req';}};
 if(hasNativeSetter)api.setInterfaceLocale=async value=>{calls.native.push(value);};
 const context={document,window:{openDeepL:api,openDeepLI18n:i18n},performance:{now:()=>clock},setInterval(){},setTimeout(){return 1;},clearTimeout(){},crypto:{randomUUID:()=> 'id'}};
 vm.runInNewContext(code,context,{filename:'ui/app.js'});
 return {i18n,ids,calls,flush,advance:ms=>{clock+=ms;},emit:event=>eventHandler(event),resolve:info=>resolveInfo({platform:'darwin',...info}),async settings(){await ids.get('settingsButton').onclick();await flush();return document.getElementById('interfaceLocale');}};
}

test('native persisted locale wins over renderer fallback without writing it back or translating',async()=>{
 const f=fixture('en');f.resolve({interfaceLocale:'zh-CN'});await f.flush();
 assert.equal(f.i18n.locale,'zh-CN');assert.deepEqual(f.calls.native,[]);assert.equal(f.calls.translate,0);
});

test('older bridge without locale field or setter keeps renderer fallback',async()=>{
 const f=fixture('en',false);f.resolve({});await f.flush();
 assert.equal(f.i18n.locale,'en');assert.deepEqual(f.calls.native,[]);assert.equal(f.calls.translate,0);
});

test('manual switch while appInfo is pending is not overwritten by stale native locale',async()=>{
 const f=fixture('en');const choice=await f.settings();assert.ok(choice);choice.value='zh-CN';choice.onchange();await f.flush();
 f.resolve({interfaceLocale:'en'});await f.flush();
 assert.equal(f.i18n.locale,'zh-CN');assert.deepEqual(f.calls.native,['zh-CN']);assert.equal(f.calls.translate,0);
});


test('completed duration is frozen across a later locale switch without changing source or translation',async()=>{
 const f=fixture('en');f.resolve({interfaceLocale:'en'});await f.flush();
 f.ids.get('sourceText').value='Hello';f.advance(1000);await f.ids.get('translateButton').onclick();
 f.advance(42000);f.emit({id:'req',type:'final',text:'你好',modelMode:'quality'});
 const before=f.ids.get('translationMeta').textContent;assert.match(before,/42\.0/);
 f.advance(61000);const choice=await f.settings();choice.value='zh-CN';choice.onchange();await f.flush();
 assert.equal(f.ids.get('translationMeta').textContent,before);
 assert.equal(f.ids.get('sourceText').value,'Hello');assert.equal(f.ids.get('resultText').textContent,'你好');
 assert.equal(f.calls.translate,1);
});
