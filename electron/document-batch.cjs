'use strict';
const path=require('node:path');
const fs=require('node:fs');

// Plan names only; Python's atomic no-clobber publication remains authoritative.
function planBatch(inputs,directory){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>20)throw new Error('每批请选择1至20份文档。');
  if(!path.isAbsolute(directory)||!fs.statSync(directory).isDirectory())throw new Error('请选择有效的译文文件夹。');
  const occupied=new Set(inputs.map(x=>path.resolve(x.file).toLowerCase()));
  return inputs.map(input=>{
    const extension=path.extname(input.file).toLowerCase();
    if(!['.docx','.pptx','.pdf'].includes(extension))throw new Error('请选择 DOCX、PPTX 或 PDF 文件。');
    const stem=path.basename(input.file,path.extname(input.file));let suffix=0,output;
    do{output=path.join(directory,stem+'.translated'+(suffix?' ('+suffix+')':'')+extension);suffix++;}
    while(occupied.has(output.toLowerCase())||fs.existsSync(output));
    occupied.add(output.toLowerCase());return {input:input.file,output};
  });
}
module.exports={planBatch};
