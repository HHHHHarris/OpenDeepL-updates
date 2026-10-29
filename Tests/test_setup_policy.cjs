'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {modelControls}=require('../ui/setup-policy.js');
const existing={present:true,bytes:10,requiredBytes:10,verified:false};
test('same-size unverified or corrupt model retains both repair paths',()=>{const s=modelControls('quality',existing,true,false);assert.equal(s.downloadDisabled,false);assert.equal(s.importDisabled,false);assert.match(s.downloadLabel,/重新下载/);});
test('verified models skip duplicate downloads but may be reselected',()=>{const s=modelControls('quality',{...existing,verified:true},true,false);assert.equal(s.downloadDisabled,true);assert.equal(s.importDisabled,false);});
test('wrong-size files trigger setup and remain repairable',()=>{const s=modelControls('fast',{...existing,bytes:9},true,false);assert.equal(s.sizeMatches,false);assert.equal(s.downloadDisabled,false);assert.match(s.stateText,/大小不符/);});
test('runtime and transfer gates disable both model actions',()=>{for(const [ready,busy] of [[false,false],[true,true]]){const s=modelControls('fast',existing,ready,busy);assert.equal(s.downloadDisabled,true);assert.equal(s.importDisabled,true);}});
