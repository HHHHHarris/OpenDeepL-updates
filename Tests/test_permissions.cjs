'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PermissionCoordinator}=require('../electron/permissions.cjs');
function fixture({platform='darwin',states={inputMonitoring:'denied',screen:'denied'},request=async()=>({granted:false}),openSettings=async()=>{}}={}) {
  const calls={probe:0,request:[],open:[],changes:[],recovered:[]};let time=10000;
  const c=new PermissionCoordinator({platform,now:()=>time,probe:async()=>{calls.probe++;return {...states};},
    request:async k=>{calls.request.push(k);return request(k);},openSettings:async k=>{calls.open.push(k);return openSettings(k);},
    onChange:s=>calls.changes.push(s),onRecovered:async(s,p)=>calls.recovered.push({s:structuredClone(s),p})});
  return {c,calls,states,tick:()=>time+=2000};
}
test('startup/focus/polling only probe; never prompt, open settings, or translate',async()=>{
  const {c,calls}=fixture();await c.refresh();await c.refresh();await c.refresh();
  assert.equal(calls.probe,3);assert.deepEqual(calls.request,[]);assert.deepEqual(calls.open,[]);
  assert.equal(c.status().permissions.inputMonitoring.state,'denied');
});
test('explicit missing feature asks just that permission and locates its page once',async()=>{
  const {c,calls}=fixture();assert.equal(await c.ensure('inputMonitoring'),false);
  assert.deepEqual(calls.request,['inputMonitoring']);assert.deepEqual(calls.open,['inputMonitoring']);
  assert.equal(c.status().permissionFlow.state,'waiting');await c.refresh();await c.ensure('inputMonitoring');
  assert.equal(calls.open.length,1);
});
test('return after granting recovers automatically without another settings jump',async()=>{
  const f=fixture();await f.c.ensure('inputMonitoring');f.states.inputMonitoring='granted';await f.c.refresh();
  assert.equal(f.c.status().permissionFlow.state,'ready');assert.equal(f.calls.open.length,1);
  assert.equal(f.calls.recovered.at(-1).s.inputMonitoring.state,'granted');
  assert.equal(f.calls.recovered.at(-1).p.inputMonitoring.state,'denied');
});
test('screen flow never captures automatically on return and distinguishes stale main process',async()=>{
  const f=fixture();await f.c.ensure('screen');f.states.screen='restart-required';await f.c.refresh();
  assert.equal(f.c.status().permissionFlow.state,'restart-required');assert.equal(await f.c.ensure('screen'),false);
  assert.deepEqual(f.calls.request,['screen']);assert.deepEqual(f.calls.open,['screen']);
  f.states.screen='granted';await f.c.refresh();assert.match(f.c.status().permissionFlow.message,/再次点击截图/);
});
test('Windows does not request Mac permissions or launch irrelevant settings',async()=>{
  const f=fixture({platform:'win32',states:{inputMonitoring:'unsupported',screen:'unsupported'}});
  assert.equal(await f.c.ensure('inputMonitoring'),true);assert.equal(await f.c.ensure('screen'),true);
  assert.deepEqual(f.calls.open,[]);assert.deepEqual(f.calls.request,[]);
});
test('component failure is not misreported as a missing permission',async()=>{
  const f=fixture({states:{}});assert.equal(await f.c.ensure('screen'),false);
  assert.equal(f.c.status().permissions.screen.state,'unavailable');assert.equal(f.c.status().permissionFlow.state,'error');assert.deepEqual(f.calls.open,[]);
});
test('concurrent return probes coalesce without repeated requests',async()=>{
  let release;const pending=new Promise(r=>release=r);let probes=0;
  const c=new PermissionCoordinator({probe:async()=>{probes++;await pending;return {inputMonitoring:'denied',screen:'denied'};}});
  const a=c.refresh(),b=c.refresh();release();await Promise.all([a,b]);assert.equal(probes,1);
});
test('concurrent explicit requests open at most one page',async()=>{
  let release;const pending=new Promise(r=>release=r);const f=fixture({request:async()=>{await pending;return {granted:false};}});
  const a=f.c.ensure('screen'),b=f.c.ensure('screen');await new Promise(r=>setImmediate(r));release();await Promise.all([a,b]);assert.equal(f.calls.open.length,1);
});
test('closing while awaiting consent never launches a late settings page',async()=>{
  let release;const pending=new Promise(r=>release=r);const f=fixture({request:()=>pending});
  const action=f.c.ensure('screen');await new Promise(r=>setImmediate(r));f.c.close();release({granted:false});await action;
  assert.deepEqual(f.calls.open,[]);
});
test('OS grant on first request avoids a redundant settings jump',async()=>{
  let states;const f=fixture({request:async()=>{states.screen='granted';return {granted:true};}});states=f.states;
  assert.equal(await f.c.ensure('screen'),true);assert.deepEqual(f.calls.open,[]);
});
