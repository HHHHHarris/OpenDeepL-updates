'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pixelRect}=require('../electron/capture-geometry.cjs');
test('HiDPI conversion uses screenshot dimensions, not display global origin',()=>{
 assert.deepEqual(pixelRect({x:10,y:20,width:100,height:50},{width:900,height:600},{width:1800,height:1200}),{x:20,y:40,width:200,height:100});
});
test('fractional scale stays within image edge',()=>{
 const r=pixelRect({x:890,y:590,width:10,height:10},{width:900,height:600},{width:1125,height:750});assert.ok(r.x+r.width<=1125);assert.ok(r.y+r.height<=750);
});
test('capture rejects tiny, invalid and out-of-range rectangles',()=>{
 for(const r of [{x:0,y:0,width:1,height:10},{x:-1,y:0,width:10,height:10},{x:895,y:0,width:30,height:10},{x:NaN,y:0,width:10,height:10}])assert.throws(()=>pixelRect(r,{width:900,height:600},{width:900,height:600}));
});
