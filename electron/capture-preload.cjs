'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('capture',Object.freeze({
  image:()=>ipcRenderer.invoke('opendeepl:captureImage'),
  choose:rect=>ipcRenderer.invoke('opendeepl:captureRect',rect),
  cancel:()=>ipcRenderer.invoke('opendeepl:captureCancel')
}));
