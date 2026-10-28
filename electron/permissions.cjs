'use strict';

// No clipboard payload, model process, TCC writes or startup permission prompts.
// OS consent is requested only from an explicit feature action.
class PermissionCoordinator {
  constructor({platform=process.platform,probe,request,openSettings,onChange=()=>{},onRecovered=async()=>{},now=()=>Date.now()}) {
    Object.assign(this,{platform,probe,request,openSettings,onChange,onRecovered,now});
    this.permissions={inputMonitoring:{state:platform==='darwin'?'not-determined':'unsupported'},screen:{state:platform==='darwin'?'not-determined':'unsupported'}};
    this.flow=null;this.refreshing=null;this.opening=null;this.closed=false;this.lastAction=-Infinity;
  }
  status(){return {platform:this.platform,permissions:structuredClone(this.permissions),permissionFlow:this.flow?{...this.flow}:null};}
  publish(){if(!this.closed)this.onChange(this.status());}
  async refresh() {
    if(this.closed)return this.status();
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.refreshNow().finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
  async refreshNow() {
    const previous=structuredClone(this.permissions);
    try {
      const values=await this.probe();
      if(this.closed)return this.status();
      for(const kind of ['inputMonitoring','screen']) {
        const state=values?.[kind];
        this.permissions[kind]={state:['granted','denied','not-determined','unsupported','restart-required'].includes(state)?state:'unavailable'};
      }
    } catch {for(const kind of ['inputMonitoring','screen'])this.permissions[kind]={state:this.platform==='darwin'?'unavailable':'unsupported'};}
    if(this.closed)return this.status();
    if(this.flow) {
      const state=this.permissions[this.flow.kind]?.state;
      if(state==='granted')this.flow={kind:this.flow.kind,state:'ready',message:this.flow.kind==='screen'?'截图权限已就绪，请再次点击截图并框选。':'输入监控权限已就绪，正在检查双击复制。'};
      else if(state==='restart-required')this.flow={kind:this.flow.kind,state:'restart-required',message:'权限已更新，请保存当前内容后重启 OpenDeepL 生效。'};
    }
    // Also stop a previously working observer when its permission is revoked.
    await this.onRecovered(this.permissions,previous);
    this.publish();return this.status();
  }
  async ensure(kind,{direct=false}={}) {
    if(!['inputMonitoring','screen'].includes(kind))throw new Error('Invalid permission kind.');
    await this.refresh();
    if(this.closed)return false;
    if(this.platform!=='darwin')return this.platform==='win32';
    const state=this.permissions[kind].state;
    if(state==='granted')return true;
    if(state==='unavailable') {
      this.flow={kind,state:'error',message:'权限检测组件未就绪，请检查 App 安装完整性。'};this.publish();return false;
    }
    if(state==='restart-required') {
      this.flow={kind,state:'restart-required',message:'系统权限已更新，请重启 OpenDeepL 生效。'};this.publish();return false;
    }
    // A single explicit action opens at most one request/settings route. Focus,
    // status polling, startup and native status callbacks never enter this path.
    if(this.opening||this.now()-this.lastAction<1200)return false;
    this.lastAction=this.now();
    this.flow={kind,state:'waiting',message:kind==='screen'?'请在系统权限页面开启 OpenDeepL 的屏幕录制；返回后会自动检测。':'请在系统权限页面开启 OpenDeepL 的输入监控；返回后会自动检测。'};this.publish();
    this.opening=(async()=>{
      try {
        // Register the actual packaged app with the OS before linking its page.
        // These requests are never made by status checks or on startup.
        const result=await this.request(kind);
        if(this.closed)return;
        if(!result?.granted)await this.openSettings(kind);
        await this.refresh();
      } catch {
        if(!this.closed){this.flow={kind,state:'error',message:'系统设置尚未打开，请点“前往开启”重试。'};this.publish();}
      }
    })().finally(()=>{this.opening=null;});
    await this.opening;return this.permissions[kind]?.state==='granted';
  }
  close(){this.closed=true;}
}
module.exports={PermissionCoordinator};
