'use strict';
// Share the actual setup-control decisions with regression tests.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.openDeepLSetupPolicy=factory();})(globalThis,()=>{const t=value=>globalThis.openDeepLI18n?.t(value)||value;return ({
  modelControls(mode,model,ready,busy){
    const sizeMatches=!!model?.present&&model.bytes===model.requiredBytes;
    const verified=sizeMatches&&!!model.verified;
    return {
      sizeMatches,
      downloadDisabled:busy||!ready||verified,
      importDisabled:busy||!ready,
      downloadLabel:verified?t('已校验'):sizeMatches?t('校验 / 重新下载'):mode==='fast'?t('下载 1.8B 模型'):t('下载 7B 模型'),
      stateText:verified?(model.referenced?t('已校验 · 使用原文件，请保持文件位置不变'):t('已校验 · 可离线使用')):sizeMatches?t('模型已存在 · 使用前自动校验'):model?.present?t('文件大小不符 · 请重新下载或选择文件'):t('尚未下载')
    };
  }
});});
