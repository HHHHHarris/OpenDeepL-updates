'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {planBatch}=require('../electron/document-batch.cjs');
test('batch output names avoid existing files and duplicate basenames',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opendeepl-batch-'));
  try{
    const old=path.join(dir,'sample.translated.docx');fs.writeFileSync(old,'keep');
    const jobs=planBatch([{file:'/first/sample.docx'},{file:'/second/sample.docx'}],dir);
    assert.equal(path.basename(jobs[0].output),'sample.translated (1).docx');
    assert.equal(path.basename(jobs[1].output),'sample.translated (2).docx');
    assert.equal(fs.readFileSync(old,'utf8'),'keep');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('batch never plans an output over another source',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opendeepl-batch-'));
  try{
    const jobs=planBatch([{file:path.join(dir,'a.docx')},{file:path.join(dir,'a.translated.docx')}],dir);
    assert.equal(path.basename(jobs[0].output),'a.translated (1).docx');
    assert.notEqual(jobs[0].output,jobs[1].input);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('batch rejects unsupported formats and oversized queues',()=>{
  assert.throws(()=>planBatch([],os.tmpdir()));
  assert.throws(()=>planBatch(Array(21).fill({file:'/a.pdf'}),os.tmpdir()));
  assert.throws(()=>planBatch([{file:'/a.exe'}],os.tmpdir()));
});
