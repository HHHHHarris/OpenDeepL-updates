'use strict';
const path=require('node:path');
const fs=require('node:fs');
function temporaryFor(output,id){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid document job ID.');
  return path.join(path.dirname(output),`.OpenDeepL-${id}.tmp`);
}
function cleanupTemporary(file){
  if(!file)return;
  if(!/^\.OpenDeepL-[0-9a-f-]{36}\.tmp$/i.test(path.basename(file)))throw new Error('Invalid temporary file.');
  try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
}
function coreExitDiagnostic(code,signal,stderrBytes){
  if(signal)return `Local Python stopped by ${signal}; document result was not saved.`;
  if(Number.isInteger(code)&&code!==0)return `Local Python exited with code ${code}; document result was not saved.`;
  if(stderrBytes>0)return 'Local Python response was incomplete; document result was not saved.';
  return 'Local Python response was incomplete.';
}
function stopCore(child){return new Promise((resolve,reject)=>{
  if(child.exitCode!==null||child.signalCode){try{cleanupTemporary(child.documentTemporary);resolve();}catch(error){reject(error);}return;}
  const timer=setTimeout(()=>reject(new Error('任务停止仍在进行，请稍后重试。')),6000);
  child.once('close',()=>{clearTimeout(timer);try{cleanupTemporary(child.documentTemporary);resolve();}catch{reject(new Error('文档任务已停止，临时文件清理尚待完成。'));}});
  child.kill();
});}
// UI jobs may finish/cancel before process close. Keep cleanup ownership separately.
class CoreRegistry {
  constructor(){this.children=new Set();}
  track(child){this.children.add(child);child.once('close',()=>{try{cleanupTemporary(child.documentTemporary);}catch{}finally{this.children.delete(child);}});return child;}
  get size(){return this.children.size;}
  stopAll(){return Promise.allSettled([...this.children].map(stopCore));}
}
module.exports={temporaryFor,cleanupTemporary,coreExitDiagnostic,stopCore,CoreRegistry};
