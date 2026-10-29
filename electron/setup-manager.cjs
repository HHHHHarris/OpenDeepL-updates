'use strict';
// The desktop setup manager never installs packages or starts a model server.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const catalog = require('./model-catalog.json');
const ALLOWED = new Set(['huggingface.co','cdn-lfs.hf.co','cdn-lfs-us-1.hf.co','cas-bridge.xethub.hf.co','cas-server.xethub.hf.co','cas-server.xethub-eu.hf.co','transfer.xethub.hf.co','transfer.xethub-eu.hf.co','us.aws.cdn.hf.co','us.gcp.cdn.hf.co','cdn-lfs-eu-1.hf.co']);
const BLOCK = 1024 * 1024;
function failure(code) { const e = new Error(code); e.code = code; return e; }
function checkMode(mode, entries=catalog) { if (!Object.hasOwn(entries, mode)) throw failure('INVALID_MODE'); return entries[mode]; }
function allowedURL(raw) { let u; try { u = new URL(raw); } catch { throw failure('UNTRUSTED_URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !ALLOWED.has(u.hostname.toLowerCase())) throw failure('UNTRUSTED_URL');
  return u;
}
function defaultTransport(url, {headers, signal}) {
  allowedURL(url);
  return new Promise((resolve,reject) => {
    const req = https.get(url, {headers, signal, timeout: 30000, agent: false}, res => resolve({statusCode:res.statusCode, headers:res.headers, body:res}));
    req.on('timeout',()=>req.destroy(failure('NETWORK_TIMEOUT')));
    req.on('error',reject);
  });
}
async function fileStat(file) { try { return await fsp.stat(file); } catch (e) { if (e.code==='ENOENT') return null; throw e; } }
function identity(s) { return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
async function shaFile(file,signal) { const h=crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file,{highWaterMark:BLOCK,signal})) h.update(chunk); return h.digest('hex'); }
function event(cb,value) { if (typeof cb==='function') { try { cb(value); } catch { /* UI callback cannot interrupt setup */ } } }
function abortError(err) { return err?.name==='AbortError' || err?.code==='ABORT_ERR'; }
async function atomicCopy(source,dest) {
  const temp=dest+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try { await fsp.copyFile(source,temp,fs.constants.COPYFILE_EXCL); await fsp.rename(temp,dest); }
  finally { await fsp.rm(temp,{force:true}).catch(()=>{}); }
}
function createSetupManager({dataDir,runtimeDir,templatePath,platform=process.platform,arch=process.arch,fetchTransport=defaultTransport,onProgress,modelCatalog=catalog}={}) {
  if (typeof dataDir!=='string'||!path.isAbsolute(dataDir)||typeof runtimeDir!=='string'||!path.isAbsolute(runtimeDir)) throw failure('INVALID_CONFIG');
  const root=path.resolve(dataDir), runtime=path.resolve(runtimeDir);
  const models=path.join(root,'models'), staging=path.join(root,'model-downloads');
  const python=path.join(runtime,'python',platform==='win32'?'python.exe':'bin/python3');
  const llama=path.join(runtime,'llama',platform==='win32'?'llama-server.exe':'llama-server');
  const templateSource=templatePath||path.resolve(__dirname,'..','platform','templates','hunyuan-translation.jinja');
  const templateDest=path.join(root,'runtime','hunyuan-translation.jinja');
  const referenceFile=path.join(root,'model-references.json');
  async function references(){try{const raw=await fsp.readFile(referenceFile,'utf8');if(raw.length>8192)throw failure('INVALID_MODEL_REFERENCE');const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch(e){if(e.code==='ENOENT')return {};throw failure('INVALID_MODEL_REFERENCE');}}
  async function modelPath(mode){const ref=(await references())[mode];if(ref!==undefined&&(typeof ref!=='string'||!path.isAbsolute(ref)))throw failure('INVALID_MODEL_REFERENCE');return ref||path.join(models,checkMode(mode,modelCatalog).filename);}
  async function saveReference(mode,file){const refs=await references();if(file)refs[mode]=file;else delete refs[mode];const tmp=referenceFile+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';try{await fsp.writeFile(tmp,JSON.stringify(refs),{flag:'wx',mode:0o600});await fsp.rename(tmp,referenceFile);}finally{await fsp.rm(tmp,{force:true}).catch(()=>{});}}
  const verified=new Map(); let transfer=null, initialized=false, initializing=null;
  function paths() { return {python,llama,template:templateDest,models}; }
  async function health() {
    const [py,server,tmpl]=await Promise.all([fileStat(python),fileStat(llama),fileStat(templateDest)]);
    const inventory={};
    for (const [mode,item] of Object.entries(modelCatalog)) {
      const location=await modelPath(mode);const s=await fileStat(location);
      inventory[mode]={filename:item.filename,requiredBytes:item.size,license:item.license,licenseUrl:item.licenseUrl,
        present:!!s?.isFile(),referenced:location!==path.join(models,item.filename),bytes:s?.size||0,verified:!!s&&verified.get(mode)===identity(s)};
    }
    return {platform,arch,runtime:{ready:initialized,python:!!py?.isFile(),llama:!!server?.isFile(),template:!!tmpl?.isFile()},models:inventory,activeTransfer:transfer?.mode||null};
  }
  async function initializeOnce() {
    const [py,server]=await Promise.all([fileStat(python),fileStat(llama)]);
    if (!py?.isFile()||!server?.isFile()) throw failure('RUNTIME_MISSING');
    await new Promise((resolve,reject)=>{
      const child=spawn(python,['-c','import lxml, pypdf, reportlab, pypdfium2'],{stdio:'ignore',shell:false,windowsHide:true});
      const timer=setTimeout(()=>child.kill(),30000);
      child.on('error',()=>{clearTimeout(timer);reject(failure('RUNTIME_INVALID'));});
      child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(failure('RUNTIME_INVALID'));});
    });
    const t=await fileStat(templateSource); if(!t?.isFile()||t.size>1024*1024) throw failure('TEMPLATE_MISSING');
    await fsp.mkdir(path.dirname(templateDest),{recursive:true,mode:0o700});
    const prior=await fileStat(templateDest);
    if(!prior?.isFile()||prior.size!==t.size||!(await fsp.readFile(templateDest)).equals(await fsp.readFile(templateSource))) await atomicCopy(templateSource,templateDest);
    initialized=true;event(onProgress,{phase:'ready'});
    return health();
  }
  function initialize(){if(!initializing)initializing=initializeOnce().finally(()=>{initializing=null;});return initializing;}
  async function verifiedExisting(mode,signal) {
    const item=checkMode(mode,modelCatalog), target=await modelPath(mode), s=await fileStat(target);
    if (!s||!s.isFile()||s.size!==item.size) return false;
    const id=identity(s); if (verified.get(mode)===id) return true;
    if ((await shaFile(target,signal))!==item.sha256) return false;
    verified.set(mode,id); return true;
  }
  async function freeSpace(required) {
    if (typeof fsp.statfs!=='function') return;
    try { const s=await fsp.statfs(staging); if (Number(s.bavail)*Number(s.bsize)<required) throw failure('INSUFFICIENT_DISK'); }
    catch(e) { if(e.code==='INSUFFICIENT_DISK') throw e; /* statfs unavailable: stream will surface ENOSPC */ }
  }
  async function response(url,headers,signal) {
    let next=url;
    for(let i=0;i<6;i++) {
      allowedURL(next);
      const r=await fetchTransport(next,{headers,signal});
      if ([301,302,303,307,308].includes(r.statusCode)) {
        const location=r.headers.location; r.body?.resume?.();
        if (!location) throw failure('INVALID_REDIRECT');
        next=new URL(location,next).href; allowedURL(next); continue;
      }
      return r;
    }
    throw failure('TOO_MANY_REDIRECTS');
  }
  async function start(mode,source) {
    const item=checkMode(mode,modelCatalog); if(transfer) throw failure('TRANSFER_BUSY');
    const controller=new AbortController(); transfer={mode,controller};
    const part=path.join(staging,item.filename+'.part'), target=path.join(models,item.filename);
    try {
      await fsp.mkdir(models,{recursive:true,mode:0o700}); await fsp.mkdir(staging,{recursive:true,mode:0o700});
      for(const dir of [models,staging]) { const st=await fsp.lstat(dir); if(!st.isDirectory()||st.isSymbolicLink()) throw failure('INVALID_DATA_DIR'); }
      if(!source&&await verifiedExisting(mode,controller.signal)) { event(onProgress,{phase:'ready',mode,bytes:item.size,total:item.size,percent:100}); return {mode,alreadyPresent:true,path:await modelPath(mode)}; }
      let offset=0;
      if(source) {
        const sourceStat=await fsp.lstat(source);if(!sourceStat.isFile()||sourceStat.isSymbolicLink())throw failure('INVALID_SOURCE');
        if(sourceStat.size!==item.size)throw failure('SIZE_MISMATCH');
        event(onProgress,{phase:'verifying',mode,bytes:item.size,total:item.size,percent:100});
        if((await shaFile(source,controller.signal))!==item.sha256)throw failure('HASH_MISMATCH');
        const after=await fsp.stat(source);if(identity(sourceStat)!==identity(after))throw failure('MODEL_CHANGED');
        if(controller.signal.aborted)throw failure('CANCELLED');
        await saveReference(mode,path.resolve(source));verified.set(mode,identity(after));
        event(onProgress,{phase:'ready',mode,bytes:item.size,total:item.size,percent:100});
        return {mode,alreadyPresent:false,referenced:true,path:path.resolve(source)};
      }
      else {
        const s=await fsp.lstat(part).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(s) {if(s.isSymbolicLink()||!s.isFile())throw failure('INVALID_DATA_DIR');if(s.size===0||s.size>item.size)await fsp.rm(part,{force:true});else offset=s.size;}
        await freeSpace(item.size-offset);
        if(offset<item.size){
          let r=await response(item.url,offset?{Range:`bytes=${offset}-`}:{},controller.signal);
          if(offset && r.statusCode===200) {r.body?.destroy?.();await fsp.rm(part,{force:true});offset=0;r=await response(item.url,{},controller.signal);}
          try{
            if(Number(r.headers['content-length']||0)>item.size-offset)throw failure('SIZE_MISMATCH');
            if(offset){const cr=String(r.headers['content-range']||'');if(r.statusCode!==206||cr!==`bytes ${offset}-${item.size-1}/${item.size}`)throw failure('INVALID_RANGE');}
            else if(r.statusCode!==200)throw failure('HTTP_ERROR');
            r.body?.setTimeout?.(30000,()=>r.body.destroy(failure('NETWORK_TIMEOUT')));
            let bytes=offset,lastProgress=0;
            const meter=new Transform({transform(chunk,_encoding,callback){
              bytes+=chunk.length;if(bytes>item.size){callback(failure('SIZE_MISMATCH'));return;}
              const now=Date.now();if(now-lastProgress>200||bytes===item.size){lastProgress=now;event(onProgress,{phase:'downloading',mode,bytes,total:item.size,percent:Math.floor(bytes/item.size*100)});}
              callback(null,chunk);
            }});
            await pipeline(r.body,meter,fs.createWriteStream(part,{flags:offset?'a':'wx',mode:0o600}),{signal:controller.signal});
          }catch(e){r.body?.destroy?.();throw e;}
        }
      }
      const s=await fileStat(part); if(!s||s.size!==item.size) throw failure('SIZE_MISMATCH');
      event(onProgress,{phase:'verifying',mode,bytes:item.size,total:item.size,percent:100});
      if((await shaFile(part,controller.signal))!==item.sha256) { await fsp.rm(part,{force:true}); throw failure('HASH_MISMATCH'); }
      if(controller.signal.aborted) throw failure('CANCELLED');
      // Replace only a corrupt or absent target. A verified target is returned above.
      await fsp.rename(part,target);await saveReference(mode,null); const final=await fsp.stat(target); verified.set(mode,identity(final));
      event(onProgress,{phase:'ready',mode,bytes:item.size,total:item.size,percent:100});
      return {mode,alreadyPresent:false,path:target};
    } catch(e) {
      const code=controller.signal.aborted||abortError(e)?'CANCELLED':e.code||'SETUP_FAILED';
      event(onProgress,{phase:'error',mode,error:code}); throw failure(code);
    } finally { transfer=null; }
  }
  return {status:health,initialize,downloadModel:mode=>start(mode,null),importModel:(mode,file)=>start(mode,file),cancelDownload:()=>{if(!transfer)return false;transfer.controller.abort();return true;},paths,modelCatalog};
}
module.exports={createSetupManager,allowedURL};
