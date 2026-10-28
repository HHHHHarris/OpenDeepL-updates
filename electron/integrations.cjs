'use strict';
const {app,BrowserWindow,desktopCapturer,screen,globalShortcut,ipcMain,systemPreferences,shell,clipboard}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pixelRect}=require('./capture-geometry.cjs');
const {CaptureTasks}=require('./capture-tasks.cjs');
const {DoubleCopy,readTranslationClipboard}=require('./double-copy.cjs');
const {PermissionCoordinator}=require('./permissions.cjs');

function createIntegrations({root,python,getWindow,ocr}) {
  let capture=null,selectionBusy=false,permissionCoordinator,requested=false,refreshTimer;
  let transition=Promise.resolve();
  const permissionChildren=new Set();
  const tasks=new CaptureTasks();
  const registrations={selection:false,screenshot:false};
  const shortcuts={selection:'CommandOrControl+Alt+T',screenshot:'CommandOrControl+Alt+S'};
  const show=()=>{if(tasks.closed)return;const win=getWindow();if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}return win;};
  function deliver(payload){const win=show();if(!win)return;if(win.webContents.isLoadingMainFrame())win.webContents.once('did-finish-load',()=>{if(!tasks.closed&&!win.isDestroyed())win.webContents.send('opendeepl:externalText',payload);});else win.webContents.send('opendeepl:externalText',payload);}
  async function translateClipboard(source='clipboard'){if(tasks.closed||tasks.size||selectionBusy)return;try{const text=await readTranslationClipboard(clipboard);if(!tasks.closed)deliver({text,source});}catch(error){if(!tasks.closed)deliver({error:error.message});}}
  const packaged=app.isPackaged||root===path.join(process.resourcesPath,'app');
  const nativeCommand=path.join(packaged?path.join(process.resourcesPath,'../Helpers'):path.join(root,'platform'),'double-copy-macos');
  const doubleCopy=new DoubleCopy({root,python,packaged,onStatus:()=>publish(),onTrigger:async(_trigger,valid)=>{if(!await valid())return;try{const text=await readTranslationClipboard(clipboard);if(await valid())deliver({text,source:'double-copy'});}catch(error){if(!tasks.closed)deliver({error:error.message});}},shouldIgnore:()=>!!getWindow()?.isFocused()||tasks.closed||!!tasks.size});
  const preferences=path.join(app.getPath('userData'),'integration-preferences.json');
  function status(){const permissionStatus=permissionCoordinator?.status()||{};return {shortcuts,registrations,doubleCopy:{...doubleCopy.status(),requested,enabled:requested},...permissionStatus,screen:permissionStatus.permissions?.screen.state||'not-determined'};}
  function publish(){const win=getWindow();if(!tasks.closed&&win&&!win.isDestroyed()&&!win.webContents.isLoadingMainFrame())win.webContents.send('opendeepl:integrationStatus',status());}
  function nativePermission(args){return new Promise((resolve,reject)=>{
    const child=spawn(nativeCommand,args,{cwd:root,stdio:['ignore','pipe','ignore'],shell:false});
    permissionChildren.add(child);child.once('close',()=>permissionChildren.delete(child));
    let out='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Permission component timed out.'));},args[0]==='--request-permission'?30000:2500);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk;if(out.length>4096){child.kill();finish(new Error('Invalid permission response.'));}});
    child.on('error',()=>finish(new Error('Permission component unavailable.')));
    child.on('close',code=>{try{if(code!==0)throw new Error();finish(null,JSON.parse(out));}catch{finish(new Error('Permission component unavailable.'));}});
  });}
  permissionCoordinator=new PermissionCoordinator({
    probe:async()=>{
      if(process.platform!=='darwin')return {inputMonitoring:'unsupported',screen:'unsupported'};
      const value=await nativePermission(['--permission-status']);
      const screenState=systemPreferences.getMediaAccessStatus('screen');
      return {inputMonitoring:value.inputMonitoring===true?'granted':'denied',
        screen:value.screen===true?(screenState==='granted'?'granted':'restart-required'):(screenState==='not-determined'?'not-determined':'denied')};
    },
    request:kind=>nativePermission(['--request-permission',kind]),
    openSettings:async kind=>{
      const names={screen:'Privacy_ScreenCapture',inputMonitoring:'Privacy_ListenEvent'};
      try{await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?'+names[kind]);}
      catch{await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');}
    },
    onChange:publish,
    onRecovered:async permissions=>{
      if(!requested||tasks.closed)return;
      const state=doubleCopy.status();
      if(process.platform==='darwin'&&permissions.inputMonitoring.state!=='granted'){
        if(state.ready)await doubleCopy.setEnabled(false);
      }else if(!state.ready&&['input-monitoring','disabled','stopped'].includes(state.reason))await doubleCopy.setEnabled(true);
    }
  });
  function setDoubleCopyEnabled(enabled,persist=true){
    if(typeof enabled!=='boolean')return Promise.reject(new Error('Invalid double-copy setting.'));
    transition=transition.catch(()=>{}).then(async()=>{
      if(tasks.closed)return status();
      if(persist){await fs.mkdir(path.dirname(preferences),{recursive:true});const temp=preferences+'.tmp';await fs.writeFile(temp,JSON.stringify({doubleCopy:enabled})+'\n',{mode:0o600});await fs.rename(temp,preferences);}
      requested=enabled;
      await doubleCopy.setEnabled(enabled);
      if(enabled&&persist)await permissionCoordinator.ensure('inputMonitoring');
      else await permissionCoordinator.refresh();
      publish();return status();
    });return transition;
  }
  async function recheckPermissions(){await permissionCoordinator.refresh();return status();}
  function helper(file){return new Promise((resolve,reject)=>{
    const child=spawn(python(),[path.join(root,'platform',file)],{cwd:root,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let out='',size=0,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('读取选词超时，请重试。'));},12000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk;if(out.length>1_000_000){child.kill();finish(new Error('选中文字超过本地限制。'));}});
    child.stderr.on('data',chunk=>{size+=chunk.length;if(size>100000)child.kill();});
    child.on('error',()=>finish(new Error('选词组件尚未就绪。')));
    child.on('close',code=>{try{const value=JSON.parse(out);if(code!==0)throw new Error(value.message||'请在其他应用选中文字后重试。');if(typeof value.text!=='string'||value.text.length>100000||!value.text.trim())throw new Error('请先在其他应用选中文字。');finish(null,{text:value.text,source:'selection'});}catch(error){finish(error);}});
  });}
  // Explicit clipboard shortcut remains a backup, without AX/UIA text scraping.
  async function selection(){return translateClipboard();}
  function closeCapture(result,error){if(!capture)return;const current=capture;capture=null;clearTimeout(current.timer);for(const entry of current.windows.values()){if(!entry.win.isDestroyed())entry.win.destroy();}current.windows.clear();show();error?current.reject(error):current.resolve(result);}
  function screenshot(){if(tasks.closed||tasks.size||selectionBusy)return Promise.resolve(null);return tasks.run(takeScreenshot);}
  async function takeScreenshot(){
    const main=getWindow();
    if(process.platform==='darwin'){
      await permissionCoordinator.refresh();
      if(permissionCoordinator.permissions.screen.state!=='granted')show();
      if(!await permissionCoordinator.ensure('screen'))return null;
    }
    main?.hide();
    try{
      await new Promise(resolve=>setTimeout(resolve,160));
      if(tasks.closed)return null;
      const displays=screen.getAllDisplays();
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.max(...displays.map(d=>Math.ceil(d.size.width*d.scaleFactor))),height:Math.max(...displays.map(d=>Math.ceil(d.size.height*d.scaleFactor)))},fetchWindowIcons:false});
      if(tasks.closed)return null;
      if(!sources.length)throw new Error('没有可用的屏幕图像。请核对屏幕录制权限。');
      const rectImage=await new Promise(async(resolve,reject)=>{
        capture={windows:new Map(),resolve,reject,timer:setTimeout(()=>closeCapture(null),120000)};
        try{
          for(const display of displays){
            if(tasks.closed||!capture)break;
            const source=sources.find(s=>s.display_id===String(display.id))||(displays.length===1?sources[0]:null);
            if(!source||source.thumbnail.isEmpty())continue;
            const win=new BrowserWindow({...display.bounds,frame:false,resizable:false,movable:false,show:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#18191b',webPreferences:{preload:path.join(root,'electron/capture-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
            win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});win.setAlwaysOnTop(true,'screen-saver');
            const entry={win,image:source.thumbnail,viewport:display.size};capture.windows.set(win.webContents.id,entry);
            win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
            win.on('closed',()=>{if(capture)closeCapture(null);});
            await win.loadFile(path.join(root,'ui/capture.html'));if(!tasks.closed&&!win.isDestroyed())win.show();
          }
          if(capture&&!capture.windows.size)closeCapture(null,new Error('截图为空。请核对屏幕录制权限。'));
        }catch(error){closeCapture(null,error);}
      });
      if(!rectImage||tasks.closed)return null;
      const directory=await fs.mkdtemp(path.join(os.tmpdir(),'OpenDeepL-capture-'));
      try{if(tasks.closed)return null;const file=path.join(directory,'region.png');await fs.writeFile(file,rectImage.toPNG(),{mode:0o600});if(tasks.closed)return null;const result=await ocr(file);if(tasks.closed)return null;if(!result.text.trim())throw new Error('框选区域未识别到文字，请重新框选。');return {text:result.text,source:'screenshot'};}
      finally{await fs.rm(directory,{recursive:true,force:true});}
    }finally{if(capture)closeCapture(null);else show();}
  }
  const overlay=(event)=>capture?.windows.get(event.sender.id);
  ipcMain.handle('opendeepl:captureImage',event=>{const entry=overlay(event);if(!entry)throw new Error('Capture expired.');return {image:entry.image.toDataURL()};});
  ipcMain.handle('opendeepl:captureRect',(event,rect)=>{const entry=overlay(event);if(!entry)throw new Error('Capture expired.');const pixels=pixelRect(rect,entry.viewport,entry.image.getSize());const image=entry.image.crop(pixels);closeCapture(image);return true;});
  ipcMain.handle('opendeepl:captureCancel',event=>{if(overlay(event))closeCapture(null);return true;});
  return {isBusy:()=>!!(tasks.size||selectionBusy),selection,screenshot,translateClipboard,deliver,setDoubleCopyEnabled,recheckPermissions,
    async retryDoubleCopy(){if(requested)await doubleCopy.setEnabled(true);await permissionCoordinator.refresh();publish();return status();},
    async register(){for(const [key,shortcut]of Object.entries(shortcuts))registrations[key]=globalShortcut.register(shortcut,()=>{if(key==='selection')selection();else screenshot().then(result=>{if(result)deliver(result);}).catch(error=>deliver({error:error.message}));});let enabled=true;try{const stored=JSON.parse(await fs.readFile(preferences,'utf8'));if(typeof stored.doubleCopy==='boolean')enabled=stored.doubleCopy;}catch{}await setDoubleCopyEnabled(enabled,false);},
    status,
    async permissions(kind){if(!['inputMonitoring','screen'].includes(kind))return false;await permissionCoordinator.ensure(kind,{direct:true});return status();},
    returned(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{recheckPermissions().catch(()=>{});},180);},
    destroy(){clearTimeout(refreshTimer);permissionCoordinator.close();for(const child of permissionChildren)child.kill();const drained=tasks.close();if(capture)closeCapture(null);for(const shortcut of Object.values(shortcuts))globalShortcut.unregister(shortcut);return Promise.all([drained,doubleCopy.close()]);}
  };
}
module.exports={createIntegrations};
