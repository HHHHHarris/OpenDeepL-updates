'use strict';
// First-run configuration is explicit about downloads; model execution stays separate.
(()=>{
  const api=window.openDeepL;
  if(!api?.setupStatus)return;
  const button=document.getElementById('setupButton');
  const workspace=document.querySelector('main');
  const panel=document.createElement('section');panel.id='setupPanel';panel.className='setup-panel';panel.hidden=true;
  panel.setAttribute('aria-labelledby','setupTitle');
  panel.innerHTML=`<div class="setup-heading"><div><h1 id="setupTitle" tabindex="-1">开始本地翻译</h1><p>运行环境随应用提供。准备好模型后，翻译内容始终留在这台电脑上。</p></div><button id="setupClose" class="quiet-button">返回翻译</button></div>
  <div class="setup-runtime"><div><strong>本地运行环境</strong><p id="setupRuntime" role="status">正在检查随应用提供的组件…</p></div><button id="setupRetry" class="quiet-button">重新检查</button></div>
  <div class="setup-models">
    <section class="setup-model"><div><h2>7B 标准模式 <span>默认 · 文档翻译</span></h2><p>Hy-MT2-7B Q8 · 约 8 GB 下载空间</p><p id="setupQualityState" class="setup-model-state">等待检查</p></div><div class="setup-model-actions"><button id="setupQualityDownload" class="primary">下载 7B 模型</button><button id="setupQualityImport" class="quiet-button">选择已有模型</button><button id="setupQualityLicense" class="setup-license">模型许可 ↗</button></div></section>
    <section class="setup-model"><div><h2>1.8B 快速模式 <span>可选 · 日常阅读</span></h2><p>Hy-MT2-1.8B Q8 · 约 1.9 GB 下载空间</p><p id="setupFastState" class="setup-model-state">等待检查</p></div><div class="setup-model-actions"><button id="setupFastDownload" class="quiet-button">下载 1.8B 模型</button><button id="setupFastImport" class="quiet-button">选择已有模型</button><button id="setupFastLicense" class="setup-license">模型许可 ↗</button></div></section>
  </div>
  <div id="setupTransfer" class="setup-transfer" hidden><div><strong id="setupTransferTitle">正在下载模型</strong><button id="setupCancel" class="quiet-button">暂停下载</button></div><progress id="setupProgress" max="100" value="0" aria-label="模型下载进度"></progress><p id="setupTransferDetail" role="status"></p></div>
  <p id="setupError" class="setup-error" role="alert" hidden></p>
  <div class="setup-note"><p>模型从腾讯的 Hugging Face 仓库下载，支持暂停后续传，并在使用前校验 SHA-256。下载过程只请求模型文件，不上传你的文字、截图或文档。</p><p>首次请先准备默认 7B 模型；1.8B 为可选快速模式，译文可用 7B 重译。同一时间只加载一个模型，空闲 60 秒卸载。无需登录或填写 API 密钥。</p></div>`;
  workspace.before(panel);
  const el=id=>document.getElementById(id);
  let snapshot=null,busy=false,runtimeReady=false;
  function open(){panel.hidden=false;workspace.hidden=true;button.setAttribute('aria-expanded','true');el('setupTitle').focus();}
  function close(){panel.hidden=true;workspace.hidden=false;button.setAttribute('aria-expanded','false');button.focus();}
  function errorMessage(error){const code=String(error?.message||error);const known={CANCELLED:'操作已暂停。下载文件会保留，可继续下载；所选原文件保持不变。',INSUFFICIENT_DISK:'磁盘剩余空间不足，请释放空间后继续。',HASH_MISMATCH:'文件校验未通过，请重新下载指定的 Q8 模型；所选原文件保持不变。',SIZE_MISMATCH:'文件大小不匹配，请选择指定的 Q8 模型，或重新下载。',RUNTIME_MISSING:'应用组件缺失，请重新安装完整安装包。',RUNTIME_INVALID:'运行环境检查未通过，请重新安装适合此系统的完整安装包。',NETWORK_TIMEOUT:'下载连接超时，点击下载继续。',TRANSFER_BUSY:'已有模型正在准备，请等待完成或暂停。',INVALID_SOURCE:'请选择指定的 GGUF 模型文件。',UNTRUSTED_URL:'下载仓库返回了新的地址，请更新应用，或选择已下载的模型文件。'};return Object.entries(known).find(([k])=>code.includes(k))?.[1]||'准备未完成，请检查网络和磁盘空间后重试。';}
  function showError(error){el('setupError').textContent=errorMessage(error);el('setupError').hidden=false;}
  function render(){
    for(const [mode,label] of [['quality','Quality'],['fast','Fast']]){
      const controls=window.openDeepLSetupPolicy.modelControls(mode,snapshot?.models?.[mode],runtimeReady,busy);
      el('setup'+label+'State').textContent=controls.stateText;
      el('setup'+label+'Download').disabled=controls.downloadDisabled;
      el('setup'+label+'Download').textContent=controls.downloadLabel;
      el('setup'+label+'Import').disabled=controls.importDisabled;
    }
    button.textContent=busy?'模型准备中':'模型';
  }
  async function refresh(){snapshot=await api.setupStatus();render();return snapshot;}
  async function initialize(){
    runtimeReady=false;el('setupRetry').disabled=true;el('setupRuntime').textContent='正在配置本地运行环境…';
    try{snapshot=await api.setupInitialize();runtimeReady=true;el('setupRuntime').textContent='已就绪 · 不需要手动安装 Python 或推理工具';el('setupError').hidden=true;}
    catch(e){showError(e);el('setupRuntime').textContent='组件检查未通过';}
    finally{el('setupRetry').disabled=false;render();}
  }
  async function transfer(mode,importing){
    if(busy)return;busy=true;el('setupCancel').textContent=importing?'停止校验':'暂停下载';el('setupCancel').disabled=false;el('setupError').hidden=true;render();
    el('setupTransfer').hidden=false;el('setupTransfer').scrollIntoView({block:'nearest'});el('setupTransferTitle').textContent=importing?'正在导入并校验模型':'正在连接模型仓库';el('setupProgress').removeAttribute('value');el('setupTransferDetail').textContent=importing?'直接使用原文件，不复制、不上传；请保持原文件的位置不变。':'首次下载可能需要较长时间。';
    try{const result=await (importing?api.setupImport(mode):api.setupDownload(mode));if(result)el('setupTransferDetail').textContent=mode==='fast'&&!snapshot?.models?.quality?.present?'1.8B 已校验。首次使用请继续准备默认 7B 模型。':'模型校验通过。返回翻译即可开始。';else el('setupTransfer').hidden=true;}
    catch(e){showError(e);}
    finally{busy=false;el('setupCancel').disabled=true;await refresh();}
  }
  button.onclick=async()=>{open();await refresh();};el('setupClose').onclick=close;el('setupRetry').onclick=initialize;
  el('setupCancel').onclick=()=>api.setupCancel();
  for(const [mode,label] of [['quality','Quality'],['fast','Fast']]){el('setup'+label+'Download').onclick=()=>transfer(mode,false);el('setup'+label+'Import').onclick=()=>transfer(mode,true);el('setup'+label+'License').onclick=()=>api.modelLicense(mode);}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)close();});
  api.onSetupProgress(progress=>{
    if(!progress.mode)return;
    el('setupTransfer').hidden=false;
    const name=progress.mode==='fast'?'1.8B':'7B';
    el('setupTransferTitle').textContent=progress.phase==='verifying'?'正在校验 '+name+' 模型':progress.phase==='ready'?name+' 模型已就绪':'正在下载 '+name+' 模型';
    if(progress.phase==='verifying'){el('setupProgress').removeAttribute('value');el('setupCancel').textContent='停止校验';}else el('setupProgress').value=progress.percent||0;
    if(progress.phase==='downloading')el('setupTransferDetail').textContent=((progress.bytes||0)/1e9).toFixed(2)+' / '+((progress.total||0)/1e9).toFixed(2)+' GB · '+progress.percent+'%';
    else if(progress.phase==='verifying')el('setupTransferDetail').textContent='核对完整文件 SHA-256；此步骤不会加载模型。';
  });
  window.openDeepLSetup={open,refresh};
  (async()=>{try{const state=await refresh();if(!window.openDeepLSetupPolicy.modelControls('quality',state.models.quality,true,false).sizeMatches||!state.runtime.python||!state.runtime.template)open();await initialize();}catch(e){open();showError(e);}})();
})();
