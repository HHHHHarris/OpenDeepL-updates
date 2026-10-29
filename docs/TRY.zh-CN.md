# 约五分钟试用 OpenDeepL

这是**动手清单**，不是速度或翻译质量基准。首次模型下载、SHA-256 校验与首次加载另计。**0.7.1 尚处发布候选阶段**；完整包及校验文件出现之前，以[最新已发布版本](https://github.com/HHHHHarris/OpenDeepL-updates/releases/latest)为准。已构建的安装包面向 Apple Silicon Mac 和 Windows x64。

1. **安装并选择界面语言。** 核对已公布安装包的摘要，打开完整 App，在设置中选择 **English** 或**简体中文**，重启后检查偏好是否保留。App 自有原生菜单与对话框的语言需要完整 0.7.1 包；系统提供的按钮可能仍跟随系统语言。安装包自带运行环境，默认 **7B Q8** 模型需另备（约 8 GB），可选快速 **1.8B Q8** 约 1.9 GB；可下载或校验导入完全相同的文件。Mac 未使用 Developer ID 签名/公证，Windows 未签名；首次打开可能出现提示或被设备策略阻止。详见[安装指南](INSTALL.md)。
2. **翻译虚构导览。** 在 App 中选择**英语 → 法语**、7B，粘贴：`At the observatory's open evening, visitors can borrow a sky map. The telescope is on the roof, but the exhibition is on the ground floor. If clouds cover the sky, the talk will continue indoors. This is an invented visitor guide.` 检查屋顶与底层是否区分、阴天讲座是否仍在室内。记录实际结果，包括错误；措辞无需和某份参考译文完全一致。
3. **再试技术说明。** 选择**中文 → 英语**，粘贴：`这是一段虚构的接口说明。缓存未命中时，不应阻塞主线程。最多重试三次，间隔依次为200毫秒、400毫秒和800毫秒。每次重试必须沿用同一个请求ID。如果用户取消操作，应丢弃尚未完成的响应并释放缓冲区。` 检查“不阻塞”、三次、200/400/800 毫秒、同一请求 ID、取消后的处理。若已安装 1.8B，可比较快速模式与**用 7B 重译**。以往合成测试发现 1.8B 曾漏否定；7B 也不能保证无误。
4. **检查桌面入口和空闲状态。** 在其他 App 选中虚构导览，单次复制再粘贴，确认仍是普通复制。若要试双复制，仅授予功能实际请求的系统权限，再按 `⌘C+C` / `Ctrl+C+C`。入口及权限行为因平台而异。翻译后闲置至少 **60 秒**；只有状态指示明确显示时才记录模型卸载已观察到。再次翻译，检查能否重新加载。

可选：用虚构文字制作临时 DOCX/PPTX 或简单文字型 PDF。文档始终使用 **7B**。PDF 支持范围保守，扫描件或复杂版式可能被拒绝。保留原件并核对另存结果。

[提交首次试用反馈](https://github.com/HHHHHarris/OpenDeepL-updates/issues/new?template=first-run-feedback.yml)：每项标记成功／未测试／有问题。首次打开受阻也是有价值的结果。公开 Issue 只放合成文本和经过脱敏的观察，不上传私人文档、个人截图、密钥或原始日志。安全问题见 [SECURITY.md](../SECURITY.md)。
