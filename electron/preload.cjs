'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke('opendeepl:' + name, ...args);
contextBridge.exposeInMainWorld('openDeepL', Object.freeze({
  setupStatus:()=>invoke('setupStatus'),setupInitialize:()=>invoke('setupInitialize'),
  setupDownload:mode=>invoke('setupDownload',mode),setupImport:mode=>invoke('setupImport',mode),setupCancel:()=>invoke('setupCancel'),modelLicense:mode=>invoke('modelLicense',mode),
  onSetupProgress:callback=>{if(typeof callback!=='function')throw new TypeError('Callback required.');const listener=(_event,value)=>callback(value);ipcRenderer.on('opendeepl:setupProgress',listener);return()=>ipcRenderer.removeListener('opendeepl:setupProgress',listener);},
  translate: request => invoke('translate', request),
  onEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('opendeepl:event', listener);
    return () => ipcRenderer.removeListener('opendeepl:event', listener);
  },
  cancel: id => invoke('cancel', id),
  engineStatus:mode=>invoke('engineStatus',mode),
  status: mode => invoke('status',mode),
  history: () => invoke('history'),
  removeHistory: id => invoke('removeHistory', id),
  clearHistory: () => invoke('clearHistory'),
  glossary: () => invoke('glossary'),
  saveGlossary: entries => invoke('saveGlossary', entries),
  copy: text => invoke('copy', text),
  importText: () => invoke('importText'),
  exportText: text => invoke('exportText', text),
  ocrFile: () => invoke('ocrFile'),
  appInfo: () => invoke('appInfo'),
  updateStatus:()=>invoke('updateStatus'),checkUpdates:()=>invoke('checkUpdates'),downloadUpdate:()=>invoke('downloadUpdate'),setAutoUpdateCheck:value=>invoke('setAutoUpdateCheck',value),
  onUpdateAvailable:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('opendeepl:updateAvailable',listener);return()=>ipcRenderer.removeListener('opendeepl:updateAvailable',listener);},importUpdate:()=>invoke('importUpdate'),applyUpdate:draft=>invoke('applyUpdate',draft),rollbackUpdate:draft=>invoke('rollbackUpdate',draft),runtimeReady:token=>invoke('runtimeReady',token),
  integrationStatus:()=>invoke('integrationStatus'),
  onIntegrationStatus:callback=>{if(typeof callback!=='function')throw new TypeError('Callback required.');const listener=(_event,value)=>callback(value);ipcRenderer.on('opendeepl:integrationStatus',listener);return ()=>ipcRenderer.removeListener('opendeepl:integrationStatus',listener);},
  setDoubleCopy:enabled=>invoke('setDoubleCopy',enabled),
  retryDoubleCopy:()=>invoke('retryDoubleCopy'),
  translateClipboard:()=>invoke('translateClipboard'),
  openPermissions:kind=>invoke('openPermissions',kind),
  restartForPermissions:draft=>invoke('restartForPermissions',draft),
  restorePermissionDraft:()=>invoke('restorePermissionDraft'),
  captureScreen:()=>invoke('captureScreen'),
  chooseDocument:()=>invoke('chooseDocument'),
  chooseDocuments:()=>invoke('chooseDocuments'),
  translateDocuments:(tokens,options)=>invoke('translateDocuments',tokens,options),
  translateDocument:(token,options)=>invoke('translateDocument',token,options),
  revealDocument:id=>invoke('revealDocument',id),
  onExternalText:callback=>{if(typeof callback!=='function')throw new TypeError('Callback required.');const listener=(_event,value)=>callback(value);ipcRenderer.on('opendeepl:externalText',listener);return ()=>ipcRenderer.removeListener('opendeepl:externalText',listener);}
}));
