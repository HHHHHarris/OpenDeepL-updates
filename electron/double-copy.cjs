'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');

// A passive native observer emits metadata only. Clipboard contents are read
// exactly once, after a validated double-copy, never on ordinary copy events.
class DoubleCopy {
  constructor({root,python,resourcesPath=process.resourcesPath,packaged=false,platform=process.platform,
    spawnProcess=spawn,onTrigger,shouldIgnore=()=>false,readSnapshot,onStatus=()=>{}}){
    Object.assign(this,{root,python,resourcesPath,packaged,platform,spawnProcess,onTrigger,shouldIgnore,readSnapshot,onStatus});
    this.child=null;this.enabled=false;this.closed=false;this.lastTrigger=-Infinity;
    this.state={enabled:false,ready:false,reason:'disabled'};
  }
  status(){return {...this.state};}
  update(state){this.state=state;this.onStatus(this.status());}
  async setEnabled(enabled){
    if(typeof enabled!=='boolean')throw new Error('Invalid double-copy setting.');
    this.enabled=enabled;
    await this.stop();
    if(this.closed)return this.status();
    this.update({enabled,ready:false,reason:enabled?'starting':'disabled'});
    if(enabled)this.start();
    return this.status();
  }
  start(){
    if(this.closed||!this.enabled||this.child)return;
    if(!['darwin','win32'].includes(this.platform)){this.update({enabled:true,ready:false,reason:'unsupported'});return;}
    const command=this.platform==='darwin'?
      path.join(this.packaged?path.join(this.resourcesPath,'../Helpers'):path.join(this.root,'platform'),'double-copy-macos'):this.python();
    const args=this.platform==='darwin'?[]:['-u',path.join(this.root,'platform/double_copy_windows.py')];
    let child;
    try{child=this.spawnProcess(command,args,{cwd:this.root,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});}
    catch{this.update({enabled:true,ready:false,reason:'component-unavailable'});return;}
    this.child=child;let buffer='',stderr=0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      if(this.child!==child)return;
      buffer+=chunk;if(buffer.length>65536){child.kill();return;}
      for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{this.receive(JSON.parse(line));}catch{/* Untrusted native output never reaches the renderer. */}
      }
    });
    child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>65536)child.kill();});
    child.on('error',()=>{if(this.child===child)this.update({enabled:this.enabled,ready:false,reason:'component-unavailable'});});
    child.on('close',()=>{if(this.child===child){this.child=null;this.update({enabled:this.enabled,ready:false,reason:this.enabled?(['input-monitoring','component-unavailable'].includes(this.state.reason)?this.state.reason:'stopped'):'disabled'});}});
  }
  receive(value){
    if(!value||typeof value!=='object'||this.closed||!this.enabled)return;
    if(value.type==='status'){
      this.update({enabled:true,ready:value.ready===true,reason:value.ready===true?'ready':
        value.permission==='input-monitoring'?'input-monitoring':'component-unavailable'});return;
    }
    if(value.type!=='trigger'||value.clipboardIsFresh!==true||!this.state.ready||this.shouldIgnore())return;
    const now=performance.now();if(now-this.lastTrigger<800)return;this.lastTrigger=now;
    Promise.resolve().then(()=>{if(!this.closed&&this.enabled&&!this.shouldIgnore())return this.onTrigger(value,()=>this.matchesSnapshot(value));}).catch(()=>{});
  }
  async matchesSnapshot(expected){
    if(this.closed||!this.enabled||this.shouldIgnore()||!Number.isSafeInteger(expected.sequence)||expected.foreground===undefined)return false;
    const snapshot=await (this.readSnapshot?this.readSnapshot():this.snapshot());
    return !this.closed&&this.enabled&&!this.shouldIgnore()&&snapshot?.sequence===expected.sequence&&
      JSON.stringify(snapshot.foreground)===JSON.stringify(expected.foreground);
  }
  snapshot(){return new Promise(resolve=>{
    const command=this.platform==='darwin'?path.join(this.packaged?path.join(this.resourcesPath,'../Helpers'):path.join(this.root,'platform'),'double-copy-macos'):this.python();
    const args=this.platform==='darwin'?['--snapshot']:['-u',path.join(this.root,'platform/double_copy_windows.py'),'--snapshot'];
    let child;try{child=this.spawnProcess(command,args,{cwd:this.root,stdio:['ignore','pipe','ignore'],shell:false,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}catch{return resolve(null);}
    let out='';const timer=setTimeout(()=>{child.kill();resolve(null);},1500);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk;if(out.length>4096)child.kill();});
    child.on('error',()=>{clearTimeout(timer);resolve(null);});child.on('close',code=>{clearTimeout(timer);try{resolve(code===0&&out.length<=4096?JSON.parse(out):null);}catch{resolve(null);}});
  });}
  stop(){
    const child=this.child;this.child=null;
    if(!child)return Promise.resolve();
    return new Promise(resolve=>{
      let settled=false;let force,deadline;
      const finish=()=>{if(settled)return;settled=true;clearTimeout(force);clearTimeout(deadline);resolve();};
      child.once('close',finish);child.once('error',finish);
      child.stdin?.end();child.kill();
      force=setTimeout(()=>child.kill('SIGKILL'),1500);
      deadline=setTimeout(finish,3000);
    });
  }
  close(){this.closed=true;this.enabled=false;this.update({enabled:false,ready:false,reason:'closed'});return this.stop();}
}

async function readTranslationClipboard(clipboard){
  const markers=['org.nspasteboard.ConcealedType','org.nspasteboard.TransientType',
    'org.nspasteboard.AutoGeneratedType','com.agilebits.onepassword','com.apple.is-remote-clipboard'];
  const protectedTypes=await Promise.all(markers.map(format=>clipboard.has('electron application/osclipboard;format="'+format+'"')));
  if(protectedTypes.some(Boolean))
    throw new Error('此剪贴板内容标记为敏感或临时数据，未读取。');
  const text=await clipboard.readText();
  if(typeof text!=='string'||!text.trim())throw new Error('剪贴板没有可翻译的文字，请先复制文本。');
  if(text.length>100000)throw new Error('复制文字超过 100,000 字符，请分段翻译。');
  return text;
}
module.exports={DoubleCopy,readTranslationClipboard};
