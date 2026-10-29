'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createInterfaceLocale,systemLocale}=require('../electron/interface-locale.cjs');
async function fixture(fn){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'opendeepl-locale-'));try{return await fn(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('system default, persisted choice, and atomic file',()=>fixture(async directory=>{
  const changes=[];const locale=createInterfaceLocale({directory,system:'en-US',onChange:value=>changes.push(value)});
  assert.equal(await locale.load(),'en');assert.equal(locale.t('clipboard'),'Translate clipboard text');
  assert.equal(await locale.set('zh-CN'),'zh-CN');assert.deepEqual(changes,['zh-CN']);
  assert.equal(JSON.parse(await fs.readFile(locale.file,'utf8')).locale,'zh-CN');
  assert.deepEqual(await fs.readdir(directory),['interface-locale.json']);
  assert.equal(await createInterfaceLocale({directory,system:'en-US'}).load(),'zh-CN');
}));
test('invalid locale rejected without changing memory or disk',()=>fixture(async directory=>{
  const locale=createInterfaceLocale({directory,system:'zh-CN'});await locale.set('en');
  for(const value of ['fr','EN','zh',null,{},'en\n'])await assert.rejects(locale.set(value),/Invalid interface locale/);
  assert.equal(locale.get(),'en');assert.equal(JSON.parse(await fs.readFile(locale.file)).locale,'en');
}));
test('bad JSON falls back to OS locale',()=>fixture(async directory=>{
  await fs.writeFile(path.join(directory,'interface-locale.json'),'{bad');
  const locale=createInterfaceLocale({directory,system:'zh-Hans-CN'});
  assert.equal(await locale.load(),'zh-CN');assert.equal(systemLocale('fr-FR'),'en');
}));
test('menus change while user text is not transformed',()=>fixture(async directory=>{
  const locale=createInterfaceLocale({directory,system:'zh-CN'});const userText='中文 user-authored text';
  const menu=()=>({label:locale.t('clipboard'),payload:{text:userText}});
  assert.equal(menu().label,'翻译剪贴板文字');await locale.set('en');
  assert.equal(menu().label,'Translate clipboard text');assert.equal(menu().payload.text,userText);
}));
