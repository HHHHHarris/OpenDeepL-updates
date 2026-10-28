'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {saveDraft,consumeDraft,validateDraft}=require('../electron/permission-draft.cjs');
const value={sourceText:'Price: $19.99',resultText:'价格：19.99美元',sourceLanguage:'auto',targetLanguage:'Chinese',tone:'default',autoTranslate:true,resultComplete:true};
test('permission restart draft retains text/options once and has private mode',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opendeepl-draft-'));
  try{await saveDraft(dir,value);const stat=await fs.stat(path.join(dir,'permission-restart-draft.json'));if(process.platform!=='win32')assert.equal(stat.mode&0o777,0o600);
    const result=await consumeDraft(dir);const {savedAt,...draft}=result;assert.deepEqual(draft,value);assert.ok(Number.isFinite(savedAt));assert.equal(await consumeDraft(dir),null);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('draft validates bounded text and strips commands, paths and document tokens',()=>{
  assert.deepEqual(validateDraft({...value,path:'/other',command:'anything',token:'bad'}),value);
  assert.throws(()=>validateDraft({...value,sourceText:'x'.repeat(100001)}));assert.throws(()=>validateDraft({...value,resultComplete:'true'}));
});
test('expired draft is removed without restoring or retranslation',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opendeepl-draft-'));
  try{await fs.writeFile(path.join(dir,'permission-restart-draft.json'),JSON.stringify({...value,savedAt:1}),{mode:0o600});assert.equal(await consumeDraft(dir),null);assert.equal((await fs.readdir(dir)).length,0);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('only main-process selected document path survives restart, not renderer-injected path',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opendeepl-draft-'));
  try{await saveDraft(dir,{...value,workspace:'document',documentInput:{file:'/injected.pdf',extension:'.pdf'}},{documentInput:{file:path.join(dir,'sample.docx'),extension:'.docx'}});
    const result=await consumeDraft(dir);assert.equal(result.workspace,'document');assert.deepEqual(result.documentInput,{file:path.join(dir,'sample.docx'),extension:'.docx'});
    await saveDraft(dir,{...value,documentInput:{file:'/injected.pdf',extension:'.pdf'}});assert.equal((await consumeDraft(dir)).documentInput,undefined);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
