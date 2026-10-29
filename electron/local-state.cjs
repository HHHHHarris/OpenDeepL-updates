'use strict';
// Cheap read-only startup operations. Never start Python, a router or model weights.
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const ALIASES={quality:'hy-mt2-7b-q8_0',fast:'hy-mt2-1.8b-q8_0'};
function dataDirectory(platform=process.platform,env=process.env,home=os.homedir()){
  if(env.OPENDEEPL_DATA_DIR)return path.resolve(env.OPENDEEPL_DATA_DIR);
  return platform==='darwin'?path.join(home,'Library/Application Support/OpenDeepL'):
    platform==='win32'?path.join(env.LOCALAPPDATA||path.join(home,'AppData/Local'),'OpenDeepL'):
    path.join(env.XDG_DATA_HOME||path.join(home,'.local/share'),'OpenDeepL');
}
async function readGlossary(directory=dataDirectory()){
  try{const file=path.join(directory,'glossary.json');const s=await fs.stat(file);if(s.size>200000)throw new Error('Local glossary exceeds limit.');
    const value=JSON.parse(await fs.readFile(file,'utf8'));
    if(!Array.isArray(value)||value.length>200)throw new Error('Invalid local glossary.');
    if(value.some(x=>!x||typeof x.source!=='string'||typeof x.target!=='string'||x.source.length>200||x.target.length>200))throw new Error('Invalid local glossary.');
    return value;
  }catch(e){if(e.code==='ENOENT')return [];throw e;}
}
function probeModels({port=Number(process.env.OPENDEEPL_ENGINE_PORT||18082),timeout=500}={}){
  return new Promise(resolve=>{let settled=false;const done=v=>{if(!settled){settled=true;resolve(v);}};
    const req=http.get({host:'127.0.0.1',port,path:'/v1/models',agent:false},res=>{
      if(res.statusCode!==200){res.resume();done([]);return;}
      let data='';res.on('data',chunk=>{data+=chunk;if(data.length>65536){req.destroy();done([]);}});
      res.on('error',()=>done([]));res.on('end',()=>{try{const value=JSON.parse(data);done(Array.isArray(value.data)?value.data:[]);}catch{done([]);}});
    });req.setTimeout(timeout,()=>{req.destroy();done([]);});req.on('error',()=>done([]));
  });
}
async function modelStatus(mode='quality',options){
  if(!Object.hasOwn(ALIASES,mode))throw new Error('Invalid model mode.');
  const item=(await probeModels(options)).find(x=>x.id===ALIASES[mode]);
  const value=typeof item?.status==='object'?item.status.value:item?.status;
  return ['unloaded','sleeping','loading','loaded'].includes(value)?value:item?'available':'offline';
}
async function engineStatus(mode='quality',options){
  if(!Object.hasOwn(ALIASES,mode))throw new Error('Invalid model mode.');
  const models=await probeModels(options);
  const state=item=>typeof item?.status==='object'?item.status.value:item?.status;
  const active=models.find(item=>Object.values(ALIASES).includes(item.id)&&['loaded','loading'].includes(state(item)));
  const sleeping=models.find(item=>Object.values(ALIASES).includes(item.id)&&state(item)==='sleeping');
  const current=active||sleeping||models.find(item=>item.id===ALIASES[mode]);
  return {mode:current?Object.keys(ALIASES).find(key=>ALIASES[key]===current.id):mode,state:state(current)||'offline'};
}
module.exports={engineStatus,ALIASES,dataDirectory,readGlossary,probeModels,modelStatus};
