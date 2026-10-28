'use strict';
const fs=require('node:fs/promises'),constants=require('node:fs').constants;
const path=require('node:path'),crypto=require('node:crypto');
const fields=['sourceText','resultText','sourceLanguage','targetLanguage','tone'];
function validateDraft(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid permission draft.');
  const draft={};
  for(const key of fields){const limit=key.endsWith('Text')?100000:100;
    if(typeof value[key]!=='string'||value[key].length>limit)throw new Error('Invalid permission draft.');draft[key]=value[key];}
  for(const key of ['autoTranslate','resultComplete']){if(typeof value[key]!=='boolean')throw new Error('Invalid permission draft.');draft[key]=value[key];}
  if(value.workspace==='text'||value.workspace==='document')draft.workspace=value.workspace;
  return draft;
}
function checkedDocument(input){
  if(!input)return null;
  if(typeof input.file!=='string'||!path.isAbsolute(input.file)||!['.pdf','.docx','.pptx'].includes(input.extension)||path.extname(input.file).toLowerCase()!==input.extension)return null;
  return {file:input.file,extension:input.extension};
}
async function saveDraft(directory,value,{documentInput,documentInputs}={}){
  const draft={...validateDraft(value),savedAt:Date.now()};
  const input=checkedDocument(documentInput);if(input)draft.documentInput=input;
  if(Array.isArray(documentInputs))draft.documentInputs=documentInputs.slice(0,20).map(checkedDocument).filter(Boolean);
  await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'permission-restart-draft.json');
  const temp=file+'.'+crypto.randomUUID();
  try{await fs.writeFile(temp,JSON.stringify(draft)+'\n',{flag:'wx',mode:0o600});await fs.rename(temp,file);}
  finally{await fs.unlink(temp).catch(()=>{});}
}
async function consumeDraft(directory){
  const file=path.join(directory,'permission-restart-draft.json');let fd;
  try{
    fd=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const stat=await fd.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size>1200000||(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o077))))throw new Error('Invalid permission draft file.');
    const raw=JSON.parse(await fd.readFile('utf8'));const value=validateDraft(raw);
    const current=await fs.lstat(file);if(current.ino===stat.ino&&current.dev===stat.dev)await fs.unlink(file);
    if(!Number.isFinite(raw.savedAt)||Date.now()-raw.savedAt>3600000||raw.savedAt>Date.now()+10000)return null;
    const input=checkedDocument(raw.documentInput);
    const inputs=Array.isArray(raw.documentInputs)?raw.documentInputs.slice(0,20).map(checkedDocument).filter(Boolean):[];
    return {...value,savedAt:raw.savedAt,...(input?{documentInput:input}:{}),...(inputs.length?{documentInputs:inputs}:{})};
  }catch(error){if(error.code==='ENOENT')return null;throw new Error('权限重启草稿读取未完成。');}
  finally{await fd?.close();}
}
module.exports={validateDraft,saveDraft,consumeDraft};
