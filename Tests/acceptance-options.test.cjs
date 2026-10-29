'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
const block=main.slice(main.indexOf("if(process.argv.includes('--acceptance-test')){"),main.indexOf('if (testMode) app.setPath'));
function run(args,platformPath=path){const env={};vm.runInNewContext(block,{process:{argv:['electron',...args],env},path:platformPath});return env;}
test('acceptance port is explicit, bounded, and confined to test mode',()=>{
 assert.deepEqual(run(['--acceptance-port=18086']),{});
 assert.equal(run(['--acceptance-test','--acceptance-root=/tmp/opendeepl-fixture']).OPENDEEPL_ENGINE_PORT,'18084');
 assert.equal(run(['--acceptance-test','--acceptance-root=/tmp/opendeepl-fixture','--acceptance-port=18086']).OPENDEEPL_ENGINE_PORT,'18086');
 for(const value of ['0','80','65536','1.5','2e4','abc',''])assert.throws(()=>run(['--acceptance-test','--acceptance-port='+value]),/Invalid acceptance port/);
});
test('Windows acceptance root and port remain isolated without modifying a bundle',()=>{
 const env=run(['--acceptance-test','--acceptance-root=C:\\Fixtures\\OpenDeepL','--acceptance-port=18086'],path.win32);
 assert.equal(env.OPENDEEPL_TEST_DATA,'C:\\Fixtures\\OpenDeepL\\ui');
 assert.equal(env.OPENDEEPL_DATA_DIR,'C:\\Fixtures\\OpenDeepL\\data');
 assert.equal(env.OPENDEEPL_ENGINE_PORT,'18086');
});
