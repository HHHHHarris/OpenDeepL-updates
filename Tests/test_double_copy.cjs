'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DoubleCopy,readTranslationClipboard}=require('../electron/double-copy.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('ordinary copies and incomplete native messages never read clipboard',async()=>{
  let reads=0;const h=new DoubleCopy({root:'.',python:()=>'',onTrigger:()=>reads++});h.enabled=true;
  h.receive({type:'status',ready:true});h.receive({type:'copy'});h.receive({type:'trigger'});
  h.receive({type:'trigger',clipboardIsFresh:false});await flush();assert.equal(reads,0);
});
test('one verified double-copy triggers once and burst duplicates are ignored',async()=>{
  let reads=0;const h=new DoubleCopy({root:'.',python:()=>'',onTrigger:()=>reads++});h.enabled=true;
  h.receive({type:'status',ready:true});h.receive({type:'trigger',clipboardIsFresh:true});
  h.receive({type:'trigger',clipboardIsFresh:true});await flush();assert.equal(reads,1);
});
test('permission-denied or focused-app triggers do not read clipboard',async()=>{
  let reads=0;const h=new DoubleCopy({root:'.',python:()=>'',onTrigger:()=>reads++,shouldIgnore:()=>true});h.enabled=true;
  h.receive({type:'status',ready:false,permission:'input-monitoring'});
  assert.equal(h.status().reason,'input-monitoring');h.receive({type:'trigger',clipboardIsFresh:true});
  h.receive({type:'status',ready:true});h.receive({type:'trigger',clipboardIsFresh:true});
  await flush();assert.equal(reads,0);
});
test('closed observer rejects late events without reads',async()=>{
  let reads=0;const h=new DoubleCopy({root:'.',python:()=>'',onTrigger:()=>reads++});h.enabled=true;
  h.receive({type:'status',ready:true});await h.close();h.receive({type:'trigger',clipboardIsFresh:true});await flush();assert.equal(reads,0);
});
test('quit between receiving and dispatching a valid pair prevents a read',async()=>{
  let reads=0;const h=new DoubleCopy({root:'.',python:()=>'',onTrigger:()=>reads++});h.enabled=true;
  h.receive({type:'status',ready:true});h.receive({type:'trigger',clipboardIsFresh:true});await h.close();await flush();assert.equal(reads,0);
});
test('clipboard reads preserve content and do not write anything',async()=>{
  let reads=0;assert.equal(await readTranslationClipboard({has:async()=>false,readText:async()=>{reads++;return 'Price: $19.99';}}),'Price: $19.99');assert.equal(reads,1);
});
test('sensitive formats are excluded before reading any contents',async()=>{
  let reads=0;await assert.rejects(()=>readTranslationClipboard({has:async format=>format.includes('ConcealedType'),readText:async()=>{reads++;return 'secret';}}));assert.equal(reads,0);
});
test('empty and oversized text are not translation requests',async()=>{
  for(const text of ['  ','x'.repeat(100001)])await assert.rejects(()=>readTranslationClipboard({has:async()=>false,readText:async()=>text}));
});
test('snapshot validation rejects replaced clipboard, foreground switch, and quit',async()=>{
  let current={sequence:8,foreground:42};const h=new DoubleCopy({root:'.',python:()=>'',readSnapshot:async()=>current});h.enabled=true;
  assert.equal(await h.matchesSnapshot({sequence:8,foreground:42}),true);
  current={sequence:9,foreground:42};assert.equal(await h.matchesSnapshot({sequence:8,foreground:42}),false);
  current={sequence:8,foreground:43};assert.equal(await h.matchesSnapshot({sequence:8,foreground:42}),false);
  await h.close();assert.equal(await h.matchesSnapshot({sequence:8,foreground:43}),false);
});
