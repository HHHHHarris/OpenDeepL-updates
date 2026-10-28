'use strict';
let start=null,rect=null,submitted=false;
const region=document.getElementById('region');
window.capture.image().then(value=>{document.getElementById('screen').style.backgroundImage='url('+value.image+')';}).catch(()=>window.capture.cancel());
document.addEventListener('pointerdown',event=>{if(event.button!==0||submitted)return;start={x:event.clientX,y:event.clientY};region.hidden=false;});
document.addEventListener('pointermove',event=>{if(!start||submitted)return;rect={x:Math.max(0,Math.min(start.x,event.clientX)),y:Math.max(0,Math.min(start.y,event.clientY)),width:Math.abs(event.clientX-start.x),height:Math.abs(event.clientY-start.y)};Object.assign(region.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});});
document.addEventListener('pointerup',async event=>{if(!start||submitted)return;start=null;if(!rect||rect.width<8||rect.height<8){region.hidden=true;rect=null;return;}submitted=true;await window.capture.choose(rect).catch(()=>window.capture.cancel());});
document.addEventListener('keydown',event=>{if(event.key==='Escape')window.capture.cancel();});
document.addEventListener('contextmenu',event=>{event.preventDefault();window.capture.cancel();});
