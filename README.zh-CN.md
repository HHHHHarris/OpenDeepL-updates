<p align="center"><img src="assets/AppIcon.svg" width="96" alt="OpenDeepL 图标"></p>
<h1 align="center">OpenDeepL</h1>
<p align="center"><strong>在自己的电脑上翻译，不把文字交给云端翻译服务。</strong></p>
<p align="center"><a href="README.md">English</a> · <a href="docs/DEMO.md">真实 App 演示</a> · <a href="docs/TRY.zh-CN.md">试用清单</a> · <a href="docs/INSTALL.md">安装与构建</a></p>

OpenDeepL 是面向 **Apple Silicon Mac 和 Windows x64** 的独立开源桌面翻译应用。文本、框选截图和受支持文档使用本地模型处理，无需翻译 API Key。**本项目与 DeepL SE 无关联。**

> **0.7.1 已发布。** 支持英文／简体中文界面，提供 Mac 与 Windows 完整安装包。[版本说明](docs/RELEASE-0.7.1.md)列出真机验证范围和限制。

### 下载

[**下载 Mac 版**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/OpenDeepL-0.7.1-macos-arm64.dmg) · [**下载 Windows 版**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/OpenDeepL-0.7.1-windows-x64-setup.exe) · [SHA-256 校验](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/SHA256SUMS-0.7.1.txt)

## 真实 App，虚构导览

![OpenDeepL Mac App 的英文界面将虚构天文台导览翻译成法语](assets/demo/translation-macos.png)

*最终 0.7.1 Mac 包直接截图，并非设计图。虚构导览是一次真实本地模型输出，不代表质量或速度基准。[查看技术说明、快速模式、Windows App 与空闲状态](docs/DEMO.md)。*

## 能做什么

- **随手译文：** 在 App 内翻译；在系统集成可用时，也可从其他应用选中文字，用 Mac `⌘C+C` / Windows `Ctrl+C+C` 双复制翻译。单次复制保持普通复制行为。
- **截图与文件：** 框选区域后在本地 OCR 并翻译；支持 DOCX、PPTX 和保守范围内的文字型 PDF。译文另存，重要用途需核对含义和排版。
- **两种本地模型：** 默认 Hy-MT2-7B Q8；可选 Hy-MT2-1.8B Q8 快速模式，并可用 7B 重译。文档始终使用 7B。一次只加载一个模型，空闲 60 秒卸载权重。
- **自主选择界面语言：** 英语和简体中文，偏好会保存。完整 0.7.1 包覆盖 App 自己的原生菜单与对话框；操作系统提供的按钮可能仍使用系统语言。
- **本地工作区：** 术语表和最多 200 条历史记录以明文保存在设备上，不设账号或同步。

**译文质量随内容而变。** 以往合成测试发现 1.8B 曾漏掉否定含义；7B 也不能保证正确。请核对否定、标识符、单位与关键指令。术语表只提供提示，不强制锁定；OCR 和文档版式也需复核。

## 开始使用

1. 从[最新发布页](https://github.com/HHHHHarris/OpenDeepL-updates/releases/latest)下载完整安装包并核对公开的 SHA-256。运行环境随包提供；模型权重不包含在内。默认 7B 首次下载约 **8 GB**，可选 1.8B 约 **1.9 GB**；也可校验导入完全相同的已有 Q8 文件。
2. 打开 App 完成模型准备。Mac 是固定**本地**签名，不是 Apple Developer ID 签名或公证；Windows 未签名。首次打开可能有系统提示或受到设备策略阻止。详见[安装说明](docs/INSTALL.md#first-open-notices)。
3. 用[简短合成文本清单](docs/TRY.zh-CN.md)试用，并[提交首次反馈](https://github.com/HHHHHarris/OpenDeepL-updates/issues/new?template=first-run-feedback.yml)。约五分钟指**模型准备之后**的操作时间；下载和首次加载另计。公开 Issue 请只用虚构示例，不贴私人文档或原始日志。

已有 **0.7.0** App 可通过兼容运行时更新获得网页界面的语言功能，但 App 原生菜单和对话框的英文需要安装**完整 0.7.1 包**。**0.6.x** 原生版用户也需要完整包迁移。旧更新源保留；`.odup` 不是独立安装程序。

## 隐私、许可与范围

配置完成后，推理、OCR、文档处理均在本机完成；译文和文件不会发送到云翻译 API。模型下载及可选 GitHub 更新检查仍会联网。详见[隐私说明](docs/PRIVACY.md)。

原创代码采用 [MIT 许可](LICENSE)。模型权重、llama.cpp、Electron、Python 组件和字体各有第三方条款，详见[许可清单](THIRD_PARTY_NOTICES.md)。源码仓库不包含运行环境二进制文件和模型权重；平台范围及构建方法见[安装指南](docs/INSTALL.md)。

[更新记录](CHANGELOG.md) · [开发指南](docs/DEVELOPMENT.md) · [路线图](docs/ROADMAP.md) · [贡献](CONTRIBUTING.md) · [安全报告](SECURITY.md)

保留 `HHHHHarris/OpenDeepL-updates` 地址是为了兼容已安装客户端的更新源；历史名称不表示与 DeepL 有关联。
