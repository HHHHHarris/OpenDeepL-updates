'use strict';
// Overlay coordinates are display-local logical pixels; screenshot pixels can be HiDPI.
function pixelRect(rect, viewport, bitmap) {
  for (const n of [rect?.x,rect?.y,rect?.width,rect?.height,viewport?.width,viewport?.height,bitmap?.width,bitmap?.height]) {
    if (!Number.isFinite(n)) throw new Error('Invalid capture coordinates.');
  }
  if(viewport.width<=0||viewport.height<=0||bitmap.width<=0||bitmap.height<=0)throw new Error('Invalid capture dimensions.');
  if(rect.x<0||rect.y<0||rect.width<8||rect.height<8||rect.x+rect.width>viewport.width+1||rect.y+rect.height>viewport.height+1)throw new Error('Select a region at least 8 pixels wide and high.');
  const sx=bitmap.width/viewport.width,sy=bitmap.height/viewport.height;
  const x=Math.floor(rect.x*sx),y=Math.floor(rect.y*sy);
  return {x,y,width:Math.min(bitmap.width-x,Math.ceil(rect.width*sx)),height:Math.min(bitmap.height-y,Math.ceil(rect.height*sy))};
}
module.exports={pixelRect};
