'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
const code=fs.readFileSync(path.join(root,'ui/app.js'),'utf8');
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function fixture(){
 const nodes=new Map();
 function el(){return {value:'',textContent:'',hidden:false,disabled:false,checked:false,children:[],listeners:{},dataset:{},classList:{toggle(){}},addEventListener(n,fn){this.listeners[n]=fn;},setAttribute(){},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=[...x];},focus(){}};}
 for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set(match[1],el());
 nodes.get('sourceLanguage').value='auto';nodes.get('targetLanguage').value='Chinese';nodes.get('tone').value='default';nodes.get('autoTranslate').checked=true;
 const calls={runs:[],cancel:[],revealed:[]};let emit;
 const api={appInfo:async()=>({platform:'darwin'}),glossary:async()=>[],status:async()=> 'sleeping',onEvent:fn=>emit=fn,translate:async()=> 'text-1',cancel:async id=>{calls.cancel.push(id);},chooseDocuments:async()=>[
  {token:'A',name:'A.docx',extension:'.docx',size:1024},
  {token:'B',name:'B.pdf',extension:'.pdf',size:2048},
  {token:'C',name:'C.pptx',extension:'.pptx',size:3072}],
  translateDocuments:async(tokens,options)=>{calls.runs.push({tokens,options});return 'batch-'+calls.runs.length;},
  revealDocument:async id=>{calls.revealed.push(id);}};
 const ctx={document:{getElementById:id=>nodes.get(id),body:el(),createElement:el,addEventListener(){}},window:{openDeepL:api},performance:{now:()=>0},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0};
 vm.runInNewContext(code,ctx);await tick();await nodes.get('docTab').onclick();await nodes.get('chooseDocument').onclick();await tick();
 return {nodes,calls,emit};
}
test('batch selection, per-file progress, partial failure and targeted retry preserve completed output',async()=>{
 const f=await fixture();const n=f.nodes;
 assert.equal(n.get('documentList').children.length,3);
 assert.match(n.get('documentName').textContent,/3 个文档/);
 await n.get('translateButton').onclick();await tick();assert.deepEqual(Array.from(f.calls.runs[0].tokens),['A','B','C']);
 f.emit({id:'batch-1',type:'documentProgress',progress:{fileIndex:1,fileCount:3,fileName:'A.docx',phase:'翻译中',part:'段落',completed:1,total:2}});
 assert.match(n.get('documentProgress').textContent,/1 \/ 3/);assert.equal(n.get('documentCurrentProgressBar').value,50);
 f.emit({id:'batch-1',type:'documentBatchItem',fileIndex:1,fileCount:3,item:{name:'A.docx',status:'completed',resultId:'out-A'}});
 f.emit({id:'batch-1',type:'documentBatchItem',fileIndex:2,fileCount:3,item:{name:'B.pdf',status:'failed',message:'PDF translated text overflow at page 2'}});
 f.emit({id:'batch-1',type:'documentBatchItem',fileIndex:3,fileCount:3,item:{name:'C.pptx',status:'completed',resultId:'out-C'}});
 f.emit({id:'batch-1',type:'documentBatchFinal',report:{total:3,completed:2,failed:1,items:[{name:'A.docx',status:'completed',resultId:'out-A'},{name:'B.pdf',status:'failed',message:'PDF translated text overflow at page 2'},{name:'C.pptx',status:'completed',resultId:'out-C'}]}});
 assert.equal(n.get('documentTotalCount').textContent,'2 / 3 已完成');assert.equal(n.get('retryDocuments').hidden,false);
 assert.match(n.get('documentList').children[1].children.at(-1).textContent,/超出版面/);
 await n.get('documentList').children[0].children.at(-1).onclick();assert.deepEqual(f.calls.revealed,['out-A']);
 await n.get('retryDocuments').onclick();await tick();assert.deepEqual(Array.from(f.calls.runs[1].tokens),['B']);
 f.emit({id:'batch-2',type:'documentBatchItem',fileIndex:1,fileCount:1,item:{name:'B.pdf',status:'completed',resultId:'out-B'}});
 f.emit({id:'batch-2',type:'documentBatchFinal',report:{total:1,completed:1,failed:0,items:[{name:'B.pdf',status:'completed',resultId:'out-B'}]}});
 assert.equal(n.get('documentTotalCount').textContent,'3 / 3 已完成');assert.equal(n.get('retryDocuments').hidden,true);
});
test('stopping a batch retains completed files and retries only unfinished files',async()=>{
 const f=await fixture();const n=f.nodes;await n.get('translateButton').onclick();await tick();
 f.emit({id:'batch-1',type:'documentBatchItem',fileIndex:1,fileCount:3,item:{name:'A.docx',status:'completed',resultId:'out-A'}});
 await n.get('cancelButton').onclick();await tick();assert.deepEqual(f.calls.cancel,['batch-1']);
 assert.equal(n.get('documentTotalCount').textContent,'1 / 3 已完成');assert.equal(n.get('revealDocument').disabled,false);
  assert.equal(n.get('retryDocuments').hidden,false);
 await n.get('retryDocuments').onclick();await tick();assert.deepEqual(Array.from(f.calls.runs[1].tokens),['B','C']);
});
test('completed files with source echoes retain reveal and show an explicit review warning',async()=>{
 const f=await fixture();const n=f.nodes;await n.get('translateButton').onclick();await tick();
 const items=[{name:'A.docx',status:'completed',resultId:'out-A',report:{unresolved:['word/document.xml:p1:g1']}},{name:'B.pdf',status:'failed',message:'PDF page 2 has no extractable text layer.'},{name:'C.pptx',status:'completed',resultId:'out-C',report:{unresolved:[]}}];
 f.emit({id:'batch-1',type:'documentBatchFinal',report:{total:3,completed:2,failed:1,items}});
 const row=n.get('documentList').children[0];
 assert.match(row.children.map(x=>x.textContent).join(' '),/已完成 · 需核对/);
 assert.match(row.children.map(x=>x.textContent).join(' '),/1 段保留原文，请核对是否漏译/);
 assert.match(n.get('documentProgress').textContent,/1 个需核对原文保留段/);
 await row.children.at(-1).onclick();assert.deepEqual(f.calls.revealed,['out-A']);
 assert.equal(n.get('retryDocuments').hidden,false);
});
test('engine timeout retains an actionable message and fixed stage diagnostic',async()=>{
 const f=await fixture();const n=f.nodes;await n.get('translateButton').onclick();await tick();
 f.emit({id:'batch-1',type:'documentBatchFinal',report:{items:[{name:'A.docx',status:'failed',message:'Local model request timed out.',errorCode:'LOCAL_TIMEOUT',phase:'translating'}]}});
 const message=n.get('documentList').children[0].children.map(x=>x.textContent).join(' ');
 assert.match(message,/本地模型响应超时/);assert.match(message,/诊断：LOCAL_TIMEOUT \/ translating/);
 assert.doesNotMatch(message,/内存/);assert.equal(n.get('retryDocuments').hidden,false);
});
