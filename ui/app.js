'use strict';
const $ = id => document.getElementById(id);
const api = window.openDeepL;
let activeId = null, generation = 0, debounce = null, glossary = [], drawerKind = null, pendingEvents = [];
let lastSource = '', startedAt = 0, resultComplete = false, drawerOpener = null;
let workspaceMode='text',documentFile=null,lastDocumentId=null,jobKind='text';
let documentFiles=[], documentItems=[], documentRunIndices=[];
let textModelMode='quality',runningModelMode='quality',lastResultModel=null,lastCompletedRequest=null,runningRequest=null,startupReady=Promise.resolve();
let integrationSnapshot=null, integrationVersion=0, permissionNoticeDismissed=false;
const stateNames = {offline:'本地引擎待机',unloaded:'模型尚未加载',sleeping:'模型已空闲卸载',loading:'正在加载本地模型',loaded:'本地模型就绪',available:'本地引擎就绪'};
function notify(message){$('notice').textContent=message;$('notice').hidden=false;}
function hideNotice(){$('notice').hidden=true;}
function setState(text,busy=false,error=false){$('engineState').textContent=text;document.body.classList.toggle('busy',busy);document.body.classList.toggle('error',error);}
function modelLabel(mode){return mode==='fast'?'1.8B':'7B';}
function update(){const length=[...$('sourceText').value].length;$('characterCount').textContent=length.toLocaleString()+' 字符';$('sourceEmpty').hidden=length>0;$('resultEmpty').hidden=!!$('resultText').textContent;const empty=!$('resultText').textContent||!resultComplete;
$('retranslateButton').hidden=workspaceMode!=='text'||empty||lastResultModel!=='fast';$('retranslateButton').disabled=!!activeId;
$('modelMode').disabled=!!activeId||workspaceMode==='document';$('copyButton').disabled=empty;$('exportButton').disabled=empty;$('translateButton').disabled=workspaceMode==='document'?(!documentFiles.length&&!documentFile)||(!!api.translateDocuments&&documentItems.length>0&&documentItems.every(item=>item.status==='completed')):!$('sourceText').value.trim();}
function setBusy(value){$('modelMode').disabled=value||workspaceMode==='document';$('retranslateButton').disabled=value;$('translateButton').hidden=value;$('cancelButton').hidden=!value;}
function messageFor(error){const text=error?.message||String(error);if(/Output must be a new file distinct from the source/i.test(text))return '译文已存在，请另取文件名。';if(/Invalid or damaged document package|Invalid or damaged PDF/i.test(text))return '文件损坏或格式不符。';if(/Placeholder mismatch at/i.test(text))return '数字/占位符校验未通过，原文保留，可重试。'+text.match(/Placeholder mismatch at[^\n]*/i)[0].replace(/^Placeholder mismatch at/i,'位置');if(/PDF translated text overflow/i.test(text))return '译文超出版面，未导出。'+text.replace(/^.*?PDF translated text overflow/i,'');if(/no extractable text layer/i.test(text))return '扫描 PDF 暂无可提取文字层。';if(/Accessibility|AXSelectedText|selected text|focused element|Focus an editable/i.test(text))return '请在其他应用选中文字，按全局选词快捷键重试；如提示权限，请在 OpenDeepL 设置中打开辅助功能设置。\n'+text;if(/Local model connection interrupted/i.test(text))return '本地模型连接中断，请重试本项；已完成译文保持不变。';if(/Local model returned invalid text encoding/i.test(text))return '本地模型返回了无效文字编码，请重试本项。';if(/offline|launcher|router/i.test(text))return '本地翻译引擎尚未就绪。Mac 请核对现有模型与引擎；Windows 请在设置中查看运行环境说明。\n'+text;if(/timed out/i.test(text))return '本地模型响应超时，请重试本项；原文件保持不变。\n'+text;return '操作未完成：'+text;}
async function refreshStatus(){if(activeId)return;try{const state=await api.status(workspaceMode==='document'?'quality':textModelMode);setState(stateNames[state]||stateNames.offline);}catch(error){setState('本地运行环境待配置',false,true);}}
function documentStatusText(status){return ({queued:'排队中',translating:'翻译中',completed:'已完成',failed:'失败',cancelled:'已停止'})[status]||'排队中';}
function renderDocumentItems(){
  const list=$('documentList');if(!list)return;list.replaceChildren();
  documentItems.forEach((item,index)=>{
    const row=node('div',undefined,'document-item');row.dataset.index=String(index);
    const name=node('span',item.name,'document-item-name');
    const reviewCount=Array.isArray(item.report?.unresolved)?item.report.unresolved.length:0;
    const status=node('span',documentStatusText(item.status)+(item.status==='completed'&&reviewCount?' · 需核对':''),'document-item-status');status.dataset.status=item.status;
    const meta=node('span',`${(item.size/1024).toFixed(1)} KB · ${item.extension.slice(1).toUpperCase()}`,'document-item-meta');
    row.append(name,status,meta);
    if(item.message)row.append(node('span',messageFor(item.message),'document-item-message'));
    if(item.status==='failed'&&item.errorCode)row.append(node('span','诊断：'+[item.errorCode,item.phase,item.errorType].filter(Boolean).join(' / '),'document-item-message'));
    if(item.status==='completed'&&reviewCount)row.append(node('span',`${reviewCount} 段保留原文，请核对是否漏译。`,'document-item-message'));
    if(item.status==='completed'&&item.resultId){const reveal=node('button','显示译文','quiet-button');reveal.setAttribute('aria-label','显示 '+item.name+' 的译文');reveal.onclick=()=>api.revealDocument(item.resultId).catch(error=>notify(messageFor(error)));row.append(reveal);}
    list.append(row);
  });
  const completed=documentItems.filter(item=>item.status==='completed').length;
  const failed=documentItems.filter(item=>item.status==='failed'||item.status==='cancelled').length;
  $('documentTotalCount').textContent=`${completed} / ${documentItems.length} 已完成`;
  $('retryDocuments').hidden=!failed||!!activeId;
  const last=[...documentItems].reverse().find(item=>item.status==='completed'&&item.resultId);
  lastDocumentId=last?.resultId||null;$('revealDocument').disabled=!lastDocumentId;
}
function setDocumentSelection(files){
  documentFiles=files.slice(0,20);documentFile=documentFiles[0]||null;documentItems=documentFiles.map(file=>({...file,status:'queued',message:'',resultId:null}));
  lastDocumentId=null;$('documentDetails').hidden=!documentFiles.length;
  $('documentName').textContent=documentFiles.length===1?documentFiles[0].name:`已选择 ${documentFiles.length} 个文档`;
  $('documentSize').textContent=documentFiles.length===1?`${(documentFiles[0].size/1024).toFixed(1)} KB · ${documentFiles[0].extension.slice(1).toUpperCase()}`:'按列表顺序逐项翻译';
  $('documentProgress').textContent='已就绪，点击下方“翻译文档”选择保存位置。';
  $('documentProgressBar').value=0;$('documentCurrentProgress').textContent='';$('documentCurrentProgressBar').hidden=true;$('documentCurrentProgressBar').value=0;
  renderDocumentItems();update();
}
function applyDocumentItem(raw,index){const global=documentRunIndices[Number.isInteger(raw?.fileIndex)?raw.fileIndex-1:index];if(global===undefined)return;const item=documentItems[global];if(!item)return;item.status=raw.item?.status||raw.status||'failed';item.message=raw.item?.message||raw.message||'';item.resultId=raw.item?.resultId||raw.resultId||item.resultId;item.report=raw.item?.report||raw.report;item.errorCode=raw.item?.errorCode||raw.errorCode||null;item.errorType=raw.item?.errorType||raw.errorType||null;item.phase=raw.item?.phase||raw.phase||null;renderDocumentItems();}
function finishDocumentBatch(event){
  const report=event.report||{};
  if(Array.isArray(report.items))report.items.forEach((item,index)=>applyDocumentItem({fileIndex:item.fileIndex,item},index));
  documentRunIndices.forEach(index=>{if(documentItems[index]?.status==='translating'||documentItems[index]?.status==='queued')documentItems[index].status='cancelled';});
  activeId=null;setBusy(false);$('documentCurrentProgressBar').hidden=true;
  const completed=documentItems.filter(item=>item.status==='completed').length;
  const failed=documentItems.filter(item=>item.status==='failed').length;
  const review=documentItems.filter(item=>item.status==='completed'&&item.report?.unresolved?.length).length;
  $('documentProgressBar').value=documentItems.length?100*completed/documentItems.length:0;
  $('documentProgress').textContent=`本批已结束：${completed} 个完成${failed?`，${failed} 个失败`:''}${review?`，${review} 个需核对原文保留段`:''}。已完成译文仍可显示。`;
  $('documentCurrentProgress').textContent='';renderDocumentItems();setState(failed?'文档批次部分未完成':'文档翻译完成 · 空闲后自动卸载',false,!!failed);update();
}
function applyEvent(event){if(event.id!==activeId)return;
if(event.type==='documentProgress'){
  const p=event.progress||{};const index=documentRunIndices[(p.fileIndex||1)-1];if(index!==undefined&&documentItems[index])documentItems[index].status='translating';
  const completed=documentItems.filter(item=>item.status==='completed').length;
  const partial=p.segmentsTotal?Math.max(0,Math.min(1,((p.completed||0)+(p.segmentsCompleted||0)/p.segmentsTotal)/(p.total||1))):p.total?Math.max(0,Math.min(1,(p.completed||0)/p.total)):0;
  $('documentProgressBar').value=documentItems.length?100*(completed+partial)/documentItems.length:0;
  $('documentProgress').textContent=`正在处理 ${p.fileIndex||1} / ${p.fileCount||documentRunIndices.length}：${p.fileName||documentItems[index]?.name||'文档'}`;
  const phase=({validating:'校验文件',translating:'翻译文本',assembling:'保存译文',complete:'完成'})[p.phase]||p.phase||'翻译中';
  $('documentCurrentProgress').textContent=`${phase} · ${p.part||'当前文件'} · ${p.segmentsTotal?`${p.segmentsCompleted||0} / ${p.segmentsTotal} 段`:`${p.completed||0} / ${p.total||'?'}`}`;
  $('documentCurrentProgressBar').hidden=false;$('documentCurrentProgressBar').value=100*partial;renderDocumentItems();setState('正在翻译文档',true);return;
}
if(event.type==='documentBatchItem'){applyDocumentItem(event,0);return;}
if(event.type==='documentBatchFinal'){finishDocumentBatch(event);return;}
if(event.type==='documentFinal'){lastDocumentId=activeId;if(documentItems[0]){documentItems[0].status='completed';documentItems[0].resultId=lastDocumentId;documentItems[0].message='';}activeId=null;setBusy(false);renderDocumentItems();const r=event.report||{};$('documentProgressBar').value=100;$('revealDocument').disabled=false;$('documentProgress').textContent='已另存译文 · '+(r.translatedSegments||0)+' 个段落/文本段'+(r.unresolved?.length?'；'+r.unresolved.length+' 项内容保持原样，请核对':'');setState('文档翻译完成 · 空闲后自动卸载');update();return;}
if((event.type==='error'||event.type==='cancelled')&&jobKind==='document'){
  if(documentFiles.length){documentRunIndices.forEach(index=>{const item=documentItems[index];if(item&&item.status!=='completed'&&item.status!=='failed'){item.status=event.type==='error'?'failed':'cancelled';item.message=event.type==='error'?event.message||'本项未完成':'';}});renderDocumentItems();}
  $('documentProgress').textContent=event.type==='error'?'文档翻译未完成：'+messageFor(event.message):'已停止，已完成译文仍可显示；原文档保持不变。';
  $('documentCurrentProgressBar').hidden=true;
  if(!documentFiles.length)$('revealDocument').disabled=true;
}
if(event.type==='delta'){resultComplete=false;$('resultText').textContent+=event.text;$('translationMeta').textContent='正在本机生成';setState('正在翻译',true);update();}else if(event.type==='final'){resultComplete=true;$('resultText').textContent=event.text;lastResultModel=event.modelMode||runningModelMode;lastCompletedRequest=runningRequest;$('translationMeta').textContent=modelLabel(lastResultModel)+' · 已完成 · '+((performance.now()-startedAt)/1000).toFixed(1)+' 秒';activeId=null;setBusy(false);setState('翻译完成 · 空闲后自动卸载');update();}else if(event.type==='error'){resultComplete=false;activeId=null;setBusy(false);setState('翻译未完成',false,true);$('translationMeta').textContent='未完成 · 请重试';notify(messageFor(event.message));update();renderDocumentItems();}else if(event.type==='cancelled'){resultComplete=false;activeId=null;setBusy(false);setState('已停止翻译');$('translationMeta').textContent='已停止 · 译文未完成';update();renderDocumentItems();}}

async function translate(modeOverride,repeat=false){
  if(workspaceMode==='document')return translateDocument();
  clearTimeout(debounce);await startupReady;
  const request=repeat&&lastCompletedRequest?{...lastCompletedRequest,modelMode:'quality'}:{text:$('sourceText').value,...requestOptions(),modelMode:modeOverride==='quality'?'quality':textModelMode};
  if(!request.text.trim())return;
  const ticket=++generation;if(activeId&&activeId!=='pending')await api.cancel(activeId).catch(()=>{});if(ticket!==generation)return;
  activeId='pending';jobKind='text';pendingEvents=[];lastSource=request.text;runningModelMode=request.modelMode;runningRequest=JSON.parse(JSON.stringify(request));resultComplete=false;
  hideNotice();$('resultText').textContent='';$('translationMeta').textContent='';startedAt=performance.now();setBusy(true);setState('正在唤醒 '+modelLabel(runningModelMode)+' 本地模型',true);update();
  try{const id=await api.translate(request);if(ticket!==generation){await api.cancel(id);return;}activeId=id;const queued=pendingEvents;pendingEvents=[];for(const event of queued)applyEvent(event);}
  catch(error){if(ticket!==generation)return;activeId=null;setBusy(false);setState('翻译未完成',false,true);notify(messageFor(error));update();}
}
async function cancel(){
  clearTimeout(debounce);const ticket=++generation;const id=activeId;
  if(jobKind==='document'&&id){documentRunIndices.forEach(index=>{const item=documentItems[index];if(item&&item.status!=='completed'&&item.status!=='failed')item.status='cancelled';});$('documentProgress').textContent='已停止，已完成译文仍可显示；原文档保持不变。';$('documentCurrentProgressBar').hidden=true;renderDocumentItems();}
  activeId=null;if(id&&jobKind!=='document')resultComplete=false;
  if(id&&id!=='pending')await api.cancel(id).catch(error=>notify(messageFor(error)));
  if(ticket!==generation)return;if(jobKind==='document')renderDocumentItems();setBusy(false);setState('已停止翻译');$('translationMeta').textContent=id&&jobKind!=='document'?'已停止 · 译文未完成':'';update();
}
function edited(){hideNotice();update();if(activeId)cancel();if(lastSource!==$('sourceText').value){$('translationMeta').textContent='';$('resultText').textContent='';resultComplete=false;update();}clearTimeout(debounce);if(workspaceMode==='text'&&$('autoTranslate').checked&&$('sourceText').value.trim())debounce=setTimeout(translate,900);}
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function permissionLabel(state){return ({granted:'已授权',denied:'尚未授权','not-determined':'待授权','restart-required':'授权后需重新启动',unsupported:'此系统不适用',unavailable:'当前不可用'})[state]||'正在检查';}
function runtimeDraft(){return {...permissionDraft(),modelMode:textModelMode,lastResultModel,lastCompletedRequest,documentFiles,documentItems};}
function permissionDraft(){return {
  sourceText:$('sourceText').value,resultText:$('resultText').textContent,
  sourceLanguage:$('sourceLanguage').value,targetLanguage:$('targetLanguage').value,
  tone:$('tone').value,autoTranslate:$('autoTranslate').checked,resultComplete,workspace:workspaceMode
};}
function restorePermissionDraft(draft){
  if(!draft||typeof draft!=='object')return;
  if(typeof draft.sourceText==='string')$('sourceText').value=draft.sourceText;
  if(typeof draft.resultText==='string')$('resultText').textContent=draft.resultText;
  for(const field of ['sourceLanguage','targetLanguage','tone']){
    const value=draft[field],select=$(field);
    if(typeof value==='string'&&(!select.options||[...select.options].some(option=>option.value===value)))select.value=value;
  }
  if(['quality','fast'].includes(draft.modelMode)){textModelMode=draft.modelMode;$('modelMode').value=textModelMode;}
  lastResultModel=draft.lastResultModel||null;lastCompletedRequest=draft.lastCompletedRequest||null;
  if(typeof draft.autoTranslate==='boolean')$('autoTranslate').checked=draft.autoTranslate;
  resultComplete=draft.resultComplete===true&&!!$('resultText').textContent;
  lastSource=$('sourceText').value;
  if($('resultText').textContent)$('translationMeta').textContent=resultComplete?'已恢复 · 上次完成的译文':'已恢复 · 译文未完成';
  if(draft.documentFiles?.length||draft.documentFile){setDocumentSelection(draft.documentFiles?.length?draft.documentFiles:[draft.documentFile]);$('documentProgress').textContent='已恢复所选文档，点击翻译后选择保存位置。';}
  if(draft.documentItems?.length===documentFiles.length&&documentFiles.length){documentItems=draft.documentItems;renderDocumentItems();$('documentProgressBar').value=100*documentItems.filter(item=>item.status==='completed').length/documentItems.length;$('documentProgress').textContent='已恢复文档队列；已完成译文仍可显示。';}
  if(draft.workspace==='document')setView('document',true);
  if(draft.documentMissing)notify('上次选择的文档已移动，请重新选择文档。');
}

function updateIntegration(status){
  if(!status||typeof status!=='object')return;
  integrationSnapshot=status;integrationVersion++;
  const flow=status.permissionFlow||{};
  const dc=status.doubleCopy||{};
  const input=status.permissions?.inputMonitoring||{};
  const screen=status.permissions?.screen||{};
  let message='';
  if(flow.state==='waiting')message=flow.message||'正在等待系统授权。完成后返回 OpenDeepL，状态会自动更新。';
  else if(flow.state==='restart-required')message=flow.message||'权限已调整，需要重新启动 OpenDeepL 才能生效。';
  else if(flow.state==='error')message=flow.message||'权限检查未完成，请打开设置查看状态。';
  else if(flow.kind==='screen'&&flow.state==='ready')message='屏幕录制已就绪。请再次点击框选截图；先前的原文和译文保持不变。';
  else if(status.platform==='darwin'&&dc.requested&&!dc.ready&&['denied','not-determined','restart-required'].includes(input.state))message='双击复制已开启，正在等待输入监控授权；当前仍可使用普通复制或剪贴板翻译。';
  else if(screen.state==='restart-required')message='屏幕录制授权后需重新启动 OpenDeepL，再次框选截图。';
  const notice=$('permissionNotice');
  if(!message){notice.hidden=true;permissionNoticeDismissed=false;}
  else{if($('permissionNoticeText').textContent!==message)permissionNoticeDismissed=false;$('permissionNoticeText').textContent=message;notice.hidden=permissionNoticeDismissed;}
  if(drawerKind==='settings'&&!$('drawer').hidden)renderIntegrationSettings(status);
}
function renderIntegrationSettings(status){
  const box=$('integrationSettings');if(!box)return;
  const focused=document.activeElement;const focusKey=focused?.dataset?.permissionFocus;
  const scroll=$('drawer').scrollTop;box.replaceChildren();
  const mac=document.body.dataset.platform==='darwin';const dc=status.doubleCopy||{};
  const permissions=status.permissions||{};const input=permissions.inputMonitoring||{};const screen=permissions.screen||{};
  const row=node('div',undefined,'setting-row permission-setting');
  const label=node('label',undefined,'permission-toggle');const toggle=document.createElement('input');toggle.type='checkbox';
  toggle.checked=dc.requested??dc.enabled??false;toggle.dataset.permissionFocus='doubleCopy';
  label.append(toggle,node('strong','启用双击复制翻译'));row.append(label);
  const requested=toggle.checked;
  const summary=dc.ready?'已就绪':!requested?'已关闭':input.state==='restart-required'?'等待重新启动':input.state==='denied'||input.state==='not-determined'?'等待输入监控授权':dc.reason==='input-monitoring'?'等待输入监控授权':'组件尚未就绪';
  row.append(node('span','双击复制：'+summary));
  toggle.onchange=async()=>{const next=toggle.checked;toggle.disabled=true;try{const latest=await api.setDoubleCopy(next);updateIntegration(latest||await api.integrationStatus());}catch(error){toggle.checked=!next;notify(messageFor(error));toggle.disabled=false;}};
  box.append(row);
  const check=node('button','重新检查状态','quiet-button');check.dataset.permissionFocus='check';check.onclick=async()=>{check.disabled=true;try{updateIntegration(await api.integrationStatus());}catch(error){notify(messageFor(error));check.disabled=false;}};box.append(check);
  if(mac){
    const heading=node('h3','macOS 隐私权限');box.append(heading,node('p','仅在使用对应功能时需要授权。授权由系统设置完成；返回应用后会自动复检。'));
    for(const [kind,title,detail] of [['inputMonitoring','输入监控','用于识别双击复制，不读取普通按键内容。'],['screen','屏幕录制','用于框选截图 OCR；本地识别，不上传截图。']]){
      const entry=permissions[kind]||{};const card=node('div',undefined,'setting-row permission-setting');
      card.append(node('strong',title),node('span',permissionLabel(entry.state)+(entry.message?' · '+entry.message:'')),node('p',detail));
      if(entry.state==='denied'||entry.state==='not-determined'){
        const action=node('button','打开'+title+'设置','permission-button');action.dataset.permissionFocus=kind;
        action.onclick=async()=>{action.disabled=true;try{await api.openPermissions(kind);updateIntegration(await api.integrationStatus());}catch(error){notify(messageFor(error));action.disabled=false;}};
        card.append(action);
      }
      box.append(card);
    }
    if((input.state==='restart-required'||screen.state==='restart-required')&&api.restartForPermissions){const restart=node('button','重新启动应用以应用权限','quiet-button');restart.onclick=async()=>{if(activeId){notify('请先完成或停止当前翻译，再重新启动以应用权限。');return;}restart.disabled=true;try{await api.restartForPermissions(permissionDraft());}catch(error){notify(messageFor(error));restart.disabled=false;}};box.append(restart);}
  }else{
    box.append(node('p',dc.ready?'双击复制已就绪。':'Windows 上无需打开 macOS 隐私权限；如功能未就绪，请重新检查状态。'));
  }
  if(focusKey){const next=[...box.querySelectorAll('[data-permission-focus]')].find(el=>el.dataset.permissionFocus===focusKey);next?.focus();}
  $('drawer').scrollTop=scroll;
}
function newerFeatureVersion(candidate,current){
  if(!/^\d+\.\d+\.\d+$/.test(candidate||'')||!/^\d+\.\d+\.\d+$/.test(current||''))return false;
  const a=candidate.split('.').map(Number),b=current.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
async function renderUpdateSettings(box){
  const section=node('section',undefined,'update-settings');box.append(section);section.append(node('h3','应用更新'));
  try{
    const status=await api.updateStatus();if(drawerKind!=='settings')return;
    section.append(node('p',`当前功能版本 ${status.version} · 基础 App ${status.baseVersion}`),node('p','导入已签名的更新包，空闲时直接生效。原文、译文与队列保留；模型和隐私权限保持原样。原生组件更新仍使用完整 App。'));
    const onlineAvailable=status.online?.status==='available'&&newerFeatureVersion(status.online.version,status.version);
    const onlineInfo=node('p',onlineAvailable?`发现功能更新 ${status.online.version}`:['available','up-to-date'].includes(status.online?.status)?'已是当前最新功能版本。':'更新检查只访问 GitHub 发布目录，不发送翻译正文。');section.append(onlineInfo);
    const check=node('button','检查更新','quiet-button');check.id='checkUpdatesButton';check.onclick=async()=>{check.disabled=true;onlineInfo.textContent='正在检查 GitHub 更新…';try{await api.checkUpdates();await openDrawer('settings');}catch(error){onlineInfo.textContent='更新检查未完成，离线翻译照常可用。'+messageFor(error);check.disabled=false;}};section.append(check);
    if(onlineAvailable&&!status.staged){const download=node('button',`下载更新 ${status.online.version}`,'quiet-button');download.id='downloadUpdateButton';download.onclick=async()=>{download.disabled=true;onlineInfo.textContent='正在下载并校验签名…';try{await api.downloadUpdate();await openDrawer('settings');}catch(error){onlineInfo.textContent=messageFor(error);download.disabled=false;}};section.append(download);}
    const auto=node('label',undefined,'update-auto');const toggle=node('input');toggle.type='checkbox';toggle.checked=status.autoCheck;toggle.onchange=async()=>{try{await api.setAutoUpdateCheck(toggle.checked);}catch(error){notify(messageFor(error));}};auto.append(toggle,node('span','启动后自动检查更新（仅版本信息）'));section.append(auto);
    if(status.error)section.append(node('p','上次更新校验未通过，已使用基础版本。'));
    const pick=node('button','导入更新包','quiet-button');pick.id='importUpdateButton';pick.onclick=async()=>{clearTimeout(debounce);if(activeId){notify('请先完成或停止当前翻译，再导入更新。');return;}try{const value=await api.importUpdate();if(value)await openDrawer('settings');}catch(error){notify(messageFor(error));}};section.append(pick);
    if(status.staged){const apply=node('button',`应用更新 ${status.staged}`,'quiet-button');apply.id='applyUpdateButton';apply.onclick=async()=>{clearTimeout(debounce);if(activeId){notify('请先完成或停止当前翻译，再应用更新。');return;}apply.disabled=true;try{await api.applyUpdate(runtimeDraft());}catch(error){apply.disabled=false;notify(messageFor(error));}};section.append(apply);}
    if(status.source==='update'){const undo=node('button','回到上一版本','quiet-button');undo.id='rollbackUpdateButton';undo.onclick=async()=>{clearTimeout(debounce);if(activeId)return notify('请先完成或停止当前翻译，再回退。');undo.disabled=true;try{await api.rollbackUpdate(runtimeDraft());}catch(error){undo.disabled=false;notify(messageFor(error));}};section.append(undo);}
  }catch(error){section.append(node('p',messageFor(error)));}
}
function closeDrawer(){if($('drawer').hidden)return;$('drawer').hidden=true;drawerKind=null;drawerOpener?.focus();}
async function openDrawer(kind){if($('drawer').hidden)drawerOpener=document.activeElement;drawerKind=kind;$('drawer').hidden=false;$('drawerTitle').textContent={settings:'设置',history:'翻译历史',glossary:'术语表'}[kind];const box=$('drawerContent');box.replaceChildren();$('closeDrawer').focus();if(kind==='settings'){
const mac=document.body.dataset.platform==='darwin';
if(api.updateStatus)await renderUpdateSettings(box);
const shortcutTitle=node('h3','双击复制翻译');box.append(shortcutTitle,node('p',mac?'选中文字，按住 ⌘，在 0.6 秒内按两次 C。':'选中文字，按住 Ctrl，在 0.6 秒内按两次 C。'),node('p','普通复制保持原样。只有识别到双击复制后才读取文字；不保存按键记录，不自动写回剪贴板。'));
const integrationBox=node('div');integrationBox.id='integrationSettings';box.append(integrationBox);
if(integrationSnapshot)renderIntegrationSettings(integrationSnapshot);else integrationBox.append(node('p','正在检查功能与权限状态…'));
const requestVersion=integrationVersion;
try{const latest=await api.integrationStatus();if(drawerKind===kind&&requestVersion===integrationVersion)updateIntegration(latest);}catch(error){if(drawerKind===kind)integrationBox.replaceChildren(node('p',messageFor(error)));}
box.append(node('h3','备用入口'),node('p',mac?'选中文字后右键 → 服务 → 用 OpenDeepL 翻译；或复制文字后右键点击菜单栏 OpenDeepL 图标 → 翻译剪贴板文字。':'复制文字后，右键点击任务栏通知区域的 OpenDeepL 图标 → 翻译剪贴板文字。其他软件的文字右键菜单由各软件管理。'),node('p',mac?'剪贴板翻译：⌘⌥T · 框选截图：⌘⌥S':'剪贴板翻译：Ctrl+Alt+T · 框选截图：Ctrl+Alt+S'));
const clip=node('button','翻译剪贴板文字','quiet-button');clip.onclick=()=>api.translateClipboard().catch(e=>notify(messageFor(e)));box.append(clip);
for(const [title,detail] of [['完全本地翻译','翻译正文仅发往本机 127.0.0.1:18082；OCR、历史与文档处理均在本机。'],['按需模型','默认 7B；快速模式使用 1.8B。文档固定使用 7B。只在翻译时加载，切换时先释放前一个模型，空闲 60 秒卸载。'],['模型文件','Mac 复用现有 LocalTranslation 模型。Windows 使用 OpenDeepL 的本地运行目录。'],['数据存储','历史与术语保存在本机应用数据目录，没有账号或同步。']]){const row=node('div',undefined,'setting-row');row.append(node('strong',title),node('span',detail));box.append(row);}const heading=node('h3','当前功能范围');box.append(heading,node('p','文本、语言切换、语气、历史、术语和文本文件导入/导出。OCR 在本机离线运行。双击复制和框选截图可使用上述方式触发；托盘右键提供剪贴板翻译备用入口。文档工作区支持 DOCX/PPTX/PDF 另存翻译；译文长度会影响排版，请核对输出。关闭窗口后保留托盘入口，退出请用托盘菜单或系统退出命令。'));const button=node('button','刷新引擎状态','quiet-button');button.onclick=refreshStatus;box.append(button);}
if(kind==='history'){const items=await api.history();if(drawerKind!==kind)return;if(!items.length)box.append(node('p','翻译完成后，历史会保存在这里。','empty-note'));for(const item of items){const button=node('button',undefined,'history-entry');button.append(node('time',new Date(item.date).toLocaleString()),node('strong',item.source),node('p',item.translation));button.onclick=()=>{cancel();$('sourceText').value=item.source;$('resultText').textContent=item.translation;$('sourceLanguage').value=item.sourceLanguage;$('targetLanguage').value=item.targetLanguage;lastSource=item.source;resultComplete=true;lastResultModel=item.modelMode||'quality';lastCompletedRequest={text:item.source,sourceLanguage:item.sourceLanguage,targetLanguage:item.targetLanguage,tone:'default',glossary,modelMode:lastResultModel};closeDrawer();update();};box.append(button);}if(items.length){const clear=node('button','清空历史','quiet-button danger');clear.onclick=async()=>{if(!window.confirm('清空本机保存的全部翻译历史？'))return;await api.clearHistory();openDrawer('history');};box.append(clear);}}
if(kind==='glossary'){box.append(node('p','添加优先使用的译法。术语作为模型提示，使用前请核对实际译文。'));for(const term of glossary){const row=node('div',undefined,'glossary-row');row.append(node('span',term.source),node('span','→'),node('span',term.target));const remove=node('button','移除');remove.onclick=async()=>{try{const next=glossary.filter(x=>x.id!==term.id);await api.saveGlossary(next);glossary=next;optionsChanged();openDrawer('glossary');}catch(error){notify(messageFor(error));}};row.append(remove);box.append(row);}const form=node('form',undefined,'glossary-form');const source=document.createElement('input');source.placeholder='原文术语';source.setAttribute('aria-label','原文术语');source.maxLength=200;source.required=true;const target=document.createElement('input');target.placeholder='优先译法';target.setAttribute('aria-label','优先译法');target.maxLength=200;target.required=true;const submit=node('button','添加术语','primary');submit.type='submit';form.append(source,target,submit);form.onsubmit=async event=>{event.preventDefault();const from=source.value.trim(),to=target.value.trim();if(!from||!to)return;submit.disabled=true;try{const next=[...glossary,{id:crypto.randomUUID(),source:from,target:to}];await api.saveGlossary(next);glossary=next;optionsChanged();openDrawer('glossary');}catch(error){notify(messageFor(error));}finally{submit.disabled=false;}};box.append(form);}}
async function importFile(){try{const file=await api.importText();if(!file)return;await cancel();$('sourceText').value=file.text;$('fileName').textContent=file.name;lastSource='';edited();$('sourceText').focus();}catch(error){notify(messageFor(error));}}
async function ocrFile(){try{setState('正在本机识别图片',true);const result=await api.ocrFile();if(result){$('sourceText').value=result.text;$('fileName').textContent='图片 OCR';edited();}await refreshStatus();}catch(error){setState('OCR 未完成',false,true);notify(messageFor(error));}}
function optionsChanged(){
  cancel(); resultComplete=false; lastSource=''; $('resultText').textContent=''; $('translationMeta').textContent='';
  hideNotice(); update();
  if(workspaceMode==='text'&&$('autoTranslate').checked&&$('sourceText').value.trim())debounce=setTimeout(translate,250);
}
function setView(mode,deferUpdate=false){clearTimeout(debounce);$('modelMode').value=mode==='document'?'quality':textModelMode;$('modelMode').disabled=mode==='document'||!!activeId;workspaceMode=mode;document.body.dataset.workspace=mode;$('textWorkspace').hidden=mode!=='text';$('documentWorkspace').hidden=mode!=='document';$('textTab').classList.toggle('active',mode==='text');$('docTab').classList.toggle('active',mode==='document');$('translateButton').textContent=mode==='document'?'翻译文档':'翻译';if(!deferUpdate)update();}
function requestOptions(){return {modelMode:workspaceMode==='document'?'quality':textModelMode,sourceLanguage:$('sourceLanguage').value,targetLanguage:$('targetLanguage').value,tone:$('tone').value,glossary};}
async function chooseDocument(){try{
  const files=api.chooseDocuments?await api.chooseDocuments():await api.chooseDocument();if(!files)return;
  await cancel();setDocumentSelection(Array.isArray(files)?files:[files]);hideNotice();setView('document');
}catch(error){notify(messageFor(error));}}
async function translateDocument(indices){
  if(!documentFile)return;
  const selected=Array.isArray(indices)?indices:documentItems.map((item,index)=>item.status==='completed'?-1:index).filter(index=>index>=0);
  if(api.translateDocuments&&selected.length===0)return;
  if(activeId)await cancel();const ticket=++generation;activeId='pending';jobKind='document';pendingEvents=[];documentRunIndices=selected;
  selected.forEach(index=>{documentItems[index].status='queued';documentItems[index].message='';});renderDocumentItems();
  hideNotice();setBusy(true);setState('准备本机文档翻译',true);$('documentProgress').textContent='请选择译文的保存文件夹。';$('documentCurrentProgress').textContent='';$('documentCurrentProgressBar').hidden=true;
  if(!api.translateDocuments)$('revealDocument').disabled=true;
  try{
    const id=api.translateDocuments?await api.translateDocuments(selected.map(index=>documentFiles[index].token),requestOptions()):await api.translateDocument(documentFile.token,requestOptions());
    if(ticket!==generation){if(id)await api.cancel(id);return;}
    if(!id){activeId=null;setBusy(false);selected.forEach(index=>{if(documentItems[index].status==='queued')documentItems[index].status='cancelled';});renderDocumentItems();$('documentProgress').textContent='已取消保存，原文档保持不变；已完成译文仍可显示。';return;}
    activeId=id;const queued=pendingEvents;pendingEvents=[];for(const event of queued)applyEvent(event);
  }catch(error){if(ticket!==generation)return;activeId=null;setBusy(false);selected.forEach(index=>{if(documentItems[index].status==='queued')documentItems[index].status='failed';});renderDocumentItems();$('documentProgress').textContent='文档翻译未完成。';setState('文档翻译未完成',false,true);notify(messageFor(error));}
}

async function acceptExternal(value){if(value.error){notify(messageFor(value.error));return;}if(!value.text)return;await cancel();if(!$('drawer').hidden)closeDrawer();setView('text');$('sourceText').value=value.text;$('fileName').textContent=({'screenshot':'框选截图 OCR','double-copy':'双击复制','context-menu':'右键翻译','clipboard':'剪贴板文字'})[value.source]||'外部文字';lastSource='';update();await translate();}
async function captureScreen(){try{const value=await api.captureScreen();if(value)await acceptExternal(value);}catch(error){notify(messageFor(error));setState('截图未完成',false,true);}}
$('sourceText').addEventListener('input',edited);
$('translateButton').onclick=()=>translate();
$('retranslateButton').onclick=()=>translate('quality',true);
$('modelMode').value='quality';
$('modelMode').onchange=()=>{if(activeId||workspaceMode==='document')return;clearTimeout(debounce);textModelMode=$('modelMode').value==='fast'?'fast':'quality';if(textModelMode==='fast')notify('快速模式适合日常阅读；金额、单位及重要内容建议用 7B 核对。');else hideNotice();refreshStatus();update();};
$('cancelButton').onclick=cancel;
$('clearButton').onclick=()=>{cancel();$('sourceText').value='';$('resultText').textContent='';$('fileName').textContent='';lastSource='';update();$('sourceText').focus();};
$('sourceLanguage').onchange=optionsChanged;
$('targetLanguage').onchange=optionsChanged;
$('tone').onchange=optionsChanged;
$('autoTranslate').onchange=()=>{clearTimeout(debounce);if(workspaceMode==='text'&&$('autoTranslate').checked)edited();};
$('swapButton').onclick=()=>{
  if(activeId){notify('请先完成或停止当前翻译，再交换语言。');return;}
  if($('sourceLanguage').value==='auto'){notify('请先选择原文语言，再交换语言方向。');return;}
  clearTimeout(debounce);
  const target=$('targetLanguage').value;
  $('targetLanguage').value=$('sourceLanguage').value;$('sourceLanguage').value=target;
  if($('resultText').textContent){const old=$('sourceText').value;$('sourceText').value=$('resultText').textContent;$('resultText').textContent=old;lastSource=$('sourceText').value;}
  resultComplete=false;$('translationMeta').textContent='已交换 · 请重新翻译';update();
};
$('copyButton').onclick=async()=>{if(!resultComplete)return;try{await api.copy($('resultText').textContent);$('translationMeta').textContent='译文已复制';}catch(error){notify(messageFor(error));}};
$('exportButton').onclick=async()=>{if(!resultComplete)return;try{await api.exportText($('resultText').textContent);}catch(error){notify(messageFor(error));}};
$('importButton').onclick=importFile;$('docTab').onclick=()=>setView('document');
$('chooseDocument').onclick=chooseDocument;$('retryDocuments').onclick=()=>translateDocument(documentItems.map((item,index)=>['failed','cancelled'].includes(item.status)?index:-1).filter(index=>index>=0));$('revealDocument').onclick=()=>api.revealDocument(lastDocumentId).catch(e=>notify(messageFor(e)));$('screenshotButton').onclick=captureScreen;
$('textTab').onclick=()=>{setView('text');$('sourceText').focus();};$('ocrButton').onclick=ocrFile;
$('settingsButton').onclick=()=>openDrawer('settings').catch(e=>notify(messageFor(e)));
$('historyButton').onclick=()=>openDrawer('history').catch(e=>notify(messageFor(e)));
$('glossaryButton').onclick=()=>openDrawer('glossary').catch(e=>notify(messageFor(e)));
$('closeDrawer').onclick=closeDrawer;
$('permissionNoticeSettings').onclick=()=>openDrawer('settings').catch(e=>notify(messageFor(e)));
$('permissionNoticeDismiss').onclick=()=>{permissionNoticeDismissed=true;$('permissionNotice').hidden=true;};
if(api.onIntegrationStatus)api.onIntegrationStatus(updateIntegration);
if(api.onUpdateAvailable)api.onUpdateAvailable(value=>{notify('发现 OpenDeepL '+value.version+' 更新，可在设置中下载并应用。');});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();translate();}if(event.key==='Escape'){if(!$('drawer').hidden)closeDrawer();else if(activeId)cancel();}});
if(api.onExternalText)api.onExternalText(value=>acceptExternal(value).catch(e=>notify(messageFor(e))));
api.onEvent(event=>{if(activeId==='pending')pendingEvents.push(event);else applyEvent(event);});
startupReady=(async()=>{try{
  const [info,terms,draft]=await Promise.all([api.appInfo(),api.glossary(),api.restorePermissionDraft?api.restorePermissionDraft():Promise.resolve(null)]);
  document.body.dataset.platform=info.platform;if(info.platform!=='darwin')$('shortcut').textContent='Ctrl ↵';
  glossary=terms;setView('text',true);restorePermissionDraft(draft);update();
  if(api.runtimeReady)await api.runtimeReady(info.runtimeGeneration);
  // Status is a read-only background probe, not a prerequisite for typing.
  refreshStatus();
}catch(error){notify(messageFor(error));setState('本地运行环境待配置',false,true);}})();
setInterval(refreshStatus,30000);
