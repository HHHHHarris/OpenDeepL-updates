'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const VALID=new Set(['en','zh-CN']);
const messages={
  runtimeSetup:['Complete the local runtime setup from Model in the top bar.','请点击顶栏「模型」完成本地运行环境配置。'],
  modelSetup:['Download or import the {mode} model from Model in the top bar.','请点击顶栏「模型」下载或导入 {mode} 模型。'],
  temporaryCleanup:['Document temporary file cleanup did not finish.','文档临时文件清理未完成。'],
  updateIdle:['Finish or stop translation and screen capture before applying the update.','请先完成或停止翻译和截图，再应用更新。'],
  updateDraftLimit:['Update draft exceeds the local limit.','更新草稿超出限制。'],
  importSignedUpdate:['Import a signed update package first.','请先导入签名更新包。'],
  updateHealth:['Updated core health check failed.','更新核心健康检查未通过。'],
  selectModel:['Choose a downloaded model','选择已下载的模型'],
  ggufModel:['GGUF model','GGUF 模型'],
  textFilter:['Text files','文本文件'],
  imagesFilter:['Images','图像'],
  documentsFilter:['Documents','文档'],
  currentTranslation:['Finish or stop the current translation first.','请先完成或停止当前翻译。'],
  restartTranslation:['Finish or stop the current translation before restarting.','请先完成或停止当前翻译，再重新启动。'],
  noRestart:['Current permission state does not require a restart.','当前权限状态无需重新启动。'],
  selectDocument:['Choose a DOCX, PPTX, or PDF file.','请选择 DOCX、PPTX 或 PDF 文件。'],
  documentTooLarge:['Document exceeds 100 MB. Split it before processing.','文档超过100MB，请拆分后处理。'],
  chooseDocumentsIdle:['Finish or stop the current translation before selecting documents.','请先完成或停止当前翻译，再选择文档。'],
  documentCount:['Select 1 to 20 documents per batch.','每批请选择1至20份文档。'],
  documentUnderLimit:['Choose a document under 100 MB.','请选择100MB以内的文档。'],
  documentExpired:['Document selection expired. Choose the document again.','文档选择已失效，请重新选择。'],
  selectOutputFolder:['Choose a folder for translated documents','选择译文保存文件夹'],
  reselectDocument:['Choose the document again.','请重新选择文档。'],
  translatedDocument:['Translated document','翻译后的文档'],
  differentOutput:['Use a different filename and retain the original extension.','请使用不同文件名，并保留原扩展名。'],
  updateBusy:['An update request is in progress. Please wait.','更新请求正在进行，请稍候。'],
  checkUpdateFirst:['Check for a new version first.','请先检查新版本。'],
  importUpdate:['Import OpenDeepL signed update package','导入 OpenDeepL 签名更新包'],
  updatePackage:['OpenDeepL Update','OpenDeepL 更新包'],
  contextSelection:['Translate selection with OpenDeepL','用 OpenDeepL 翻译选中文字'],
  clipboard:['Translate clipboard text','翻译剪贴板文字'],
  contextReceive:['Context service failed. Select the text and try again.\n','右键服务接收失败，请重新选择文字后重试。\n'],
  trayTooltip:['OpenDeepL · Local translation','OpenDeepL · 本地翻译'],
  openApp:['Open OpenDeepL','打开 OpenDeepL'],
  screenshot:['Translate screen selection','框选截图翻译'],
  quit:['Quit','退出'],
  captureUnavailable:['No screen image is available. Check Screen Recording permission.','没有可用的屏幕图像。请核对屏幕录制权限。'],
  captureEmpty:['Screen image is empty. Check Screen Recording permission.','截图为空。请核对屏幕录制权限。'],
  captureNoText:['No text recognized in the selected region. Select it again.','框选区域未识别到文字，请重新框选。'],
  selectionTimeout:['Reading selected text timed out. Try again.','读取选词超时，请重试。'],
  selectionLimit:['Selected text exceeds the local limit.','选中文字超过本地限制。'],
  selectionUnavailable:['Text-selection component is not ready.','选词组件尚未就绪。'],
  selectionRetry:['Select text in another app and try again.','请在其他应用选中文字后重试。'],
  selectionEmpty:['Select text in another app first.','请先在其他应用选中文字。'],
  unsupportedText:['Unsupported text format.','不支持的文本格式。'],
  textLimit:['Text file exceeds the local limit.','文本文件超过本地限制。'],
  unsupportedImage:['Unsupported image format.','不支持的图像格式。'],
  imageLimit:['Image file exceeds the local limit.','图像文件超过本地限制。']
};
function systemLocale(value){return /^zh(?:-|$)/i.test(value||'')?'zh-CN':'en';}
function createInterfaceLocale({directory,system='en',onChange=()=>{}}){
  const file=path.join(directory,'interface-locale.json');let current=systemLocale(system),queue=Promise.resolve();
  function get(){return current;}
  function t(key,values={}){const pair=messages[key];if(!pair)throw new Error('Unknown locale key.');return pair[current==='en'?0:1].replace(/\{(\w+)\}/g,(_all,name)=>String(values[name]??''));}
  async function load(){try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(VALID.has(value?.locale))current=value.locale;}catch(error){if(error?.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}return current;}
  function set(locale){if(!VALID.has(locale))return Promise.reject(new Error('Invalid interface locale.'));
    const write=async()=>{await fs.mkdir(directory,{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify({locale})+'\n',{mode:0o600});await fs.rename(temp,file);}catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}current=locale;onChange(locale);return locale;};
    const result=queue.then(write);queue=result.catch(()=>{});return result;
  }
  return {get,t,load,set,file};
}
module.exports={createInterfaceLocale,systemLocale};
