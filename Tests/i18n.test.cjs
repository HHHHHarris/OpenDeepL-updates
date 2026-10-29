'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const createI18n=require('../ui/i18n.js');

function fixture(language='en-US',saved=null,broken=false){const values=new Map();if(saved!==null)values.set('opendeepl.uiLocale',saved);const root={navigator:{language},localStorage:{getItem:key=>{if(broken)throw Error('storage blocked');return values.get(key)||null;},setItem:(key,value)=>{if(broken)throw Error('storage blocked');values.set(key,value);}}};return {i18n:createI18n(root),values};}

test('locale defaults to navigator, normalizes zh variants, and ignores unknown stored values',()=>{
 assert.equal(fixture('en-GB').i18n.locale,'en');assert.equal(fixture('zh-Hant-TW').i18n.locale,'zh-CN');
 assert.equal(fixture('fr-FR').i18n.locale,'en');assert.equal(fixture('zh-CN','broken').i18n.locale,'zh-CN');
 assert.equal(fixture('en-US',null,true).i18n.locale,'en');
});

test('explicit locale persists, fires once, and storage failure leaves selection usable',()=>{
 const {i18n,values}=fixture('zh-CN');const changes=[];i18n.onChange(value=>changes.push(value));
 i18n.setLocale('en');i18n.setLocale('en');assert.equal(i18n.t('翻译'),'Translate');assert.equal(values.get('opendeepl.uiLocale'),'en');
 i18n.setLocale('zh-CN');assert.equal(i18n.t('Translate'),'翻译');assert.deepEqual(changes,['en','zh-CN']);
 const blocked=fixture('zh-CN',null,true).i18n;blocked.setLocale('en');assert.equal(blocked.locale,'en');
});

test('all language selectors remain semantic values, independent of display copy',()=>{
 const fs=require('node:fs');const html=fs.readFileSync(require('node:path').join(__dirname,'../ui/index.html'),'utf8');
 for(const value of ['auto','English','Chinese','Japanese','French','German','Spanish','Korean','Portuguese','Russian','Italian','Arabic'])assert.match(html,new RegExp(`value="${value}"`));
 assert.match(html,/src="i18n\.js"/);
});

test('English glossary, document, setup and permission copy is present',()=>{
 const {i18n}=fixture('en-US');for(const key of ['术语表','批量翻译文档','正在翻译文档','启用双击复制翻译','应用更新','开始本地翻译','模型已空闲卸载','操作未完成：'])assert.notEqual(i18n.t(key),key,key);
});

test('static locale updates preserve SVG controls and never touch source or translated content',()=>{
 const {i18n}=fixture('zh-CN');
 function button(label){const icon={nodeType:1,tagName:'svg',childNodes:[{nodeType:1,tagName:'use'}]};const copy={nodeType:3,textContent:label};const el={childNodes:[icon,copy],dataset:{},querySelector:()=>icon,append(node){this.childNodes.push(node);},set textContent(value){this.childNodes=[{nodeType:3,textContent:value}];},get textContent(){return this.childNodes.map(node=>node.textContent||'').join('');},setAttribute(){}};return {el,icon,copy};}
 const controls={'#textTab':button('文本'),'#docTab':button('文档'),'#glossaryButton':button('术语表')};
 const source={value:'翻译',textContent:'翻译',dataset:{},setAttribute(){}};
 const result={value:'Translate',textContent:'Translate',dataset:{},setAttribute(){}};
 const selectors={...Object.fromEntries(Object.entries(controls).map(([key,value])=>[key,value.el])),'#sourceText':source,'#resultText':result};
 const doc={documentElement:{lang:'zh-CN'},body:{dataset:{}},querySelector:selector=>selectors[selector]||null,querySelectorAll:()=>[],createTextNode:textContent=>({nodeType:3,textContent})};
 i18n.setLocale('en');i18n.applyStatic(doc);
 assert.equal(controls['#textTab'].copy.textContent,'Text');assert.equal(controls['#docTab'].copy.textContent,'Documents');assert.equal(controls['#glossaryButton'].copy.textContent,'Glossary');
 for(const control of Object.values(controls)){assert.equal(control.el.childNodes[0],control.icon);assert.equal(control.icon.childNodes[0].tagName,'use');}
 assert.equal(source.value,'翻译');assert.equal(source.textContent,'翻译');assert.equal(result.textContent,'Translate');
 i18n.setLocale('zh-CN');i18n.applyStatic(doc);
 assert.equal(controls['#textTab'].copy.textContent,'文本');assert.equal(controls['#docTab'].copy.textContent,'文档');assert.equal(controls['#glossaryButton'].copy.textContent,'术语表');
 for(const control of Object.values(controls))assert.equal(control.el.childNodes[0],control.icon);
 assert.equal(source.value,'翻译');assert.equal(result.textContent,'Translate');
});
