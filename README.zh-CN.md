<p align="center"><img src="assets/AppIcon.svg" width="96" alt="OpenDeepL 图标"></p>
<h1 align="center">OpenDeepL</h1>
<p align="center"><strong>复制两次，本地翻译。让你的文字留在自己的设备上。</strong></p>
<p align="center"><a href="README.md">English</a> · <a href="docs/INSTALL.md">构建与配置</a> · <a href="https://github.com/HHHHHarris/OpenDeepL-updates/releases">Releases</a> · <a href="docs/ROADMAP.md">路线图</a></p>

OpenDeepL 是适用于 macOS 与 Windows 的独立开源桌面翻译应用。配置好模型和本地运行环境后，文本、截图和受支持文档都在本机处理，无需翻译 API Key。**本项目与 DeepL SE 没有关联。**

> **开发者预览版（源码版本 0.6.3）：**此仓库提供源码与构建脚本，不是开箱即用的安装包。现有 Release 中的 `.odup` 文件是供兼容的已安装 App 使用的签名**运行时更新包**，不是独立安装包。请先阅读[构建与配置指南](docs/INSTALL.md)。目前尚未完成两平台全新设备端到端安装验收。

## 为什么选择 OpenDeepL？

- **少打断工作：** Mac 按 `⌘C+C`、Windows 按 `Ctrl+C+C`，翻译选中的文字。
- **速度与质量自己选：** 1.8B 快速阅读，再按需用 7B 重译。
- **内容留在本机：** 翻译、OCR、文档处理都在本地，无需翻译 API 密钥或订阅。

## 功能概览

| 场景 | 当前行为 |
| --- | --- |
| 文本 | 默认 Hy-MT2-7B Q8；可选 Hy-MT2-1.8B Q8 快速模式，再用 7B 重新翻译。术语表作为提示，不保证强制命中。 |
| 截图 | 框选屏幕区域，使用本地 OCR 识别并翻译。 |
| 文档 | DOCX、PPTX 和文字型 PDF，单文件或每批 1–20 份；文档使用 7B。PDF 为尽力保留效果；文档翻译不支持扫描版 PDF。 |
| 桌面入口 | 托盘、剪贴板翻译、双击复制捕获，以及系统允许范围内的右键菜单/选词回退。普通复制不受抑制；不同系统的集成和权限行为存在差异。 |
| 本地工作区 | 查看翻译历史及术语表。历史最多 200 条，以明文保存在本机。 |
| 模型运行 | 同时只加载一个模型，空闲 60 秒后卸载权重。 |
| 更新 | 兼容的已安装 App 可检查维护者签名的运行时更新；启动约 30 秒后检查，可在设置中关闭。 |

译文、OCR、字体和文档排版效果会随内容变化。重要用途应人工核对；文档排版不保证像素级一致。

## 从源码开始

1. 阅读 [INSTALL.md](docs/INSTALL.md)，了解前置环境、模型校验和平台构建。
2. 使用 Node.js 22.12+，克隆仓库后执行 `npm ci`。
3. 按指南配置指定模型、匹配的 llama.cpp 和独立 Python 环境。
4. 用 `npm start` 运行开发界面，或构建平台产物。源码构建不附带模型权重或 Python 依赖。

## 隐私与许可

完成配置后，推理、OCR、文档、术语表与历史均在本机处理。应用不会将原文或文件发送给云翻译 API。**初始化下载**（依赖、模型）及**可选的 GitHub 更新检查**需要网络；更新请求不包含文档内容。详见 [PRIVACY.md](docs/PRIVACY.md)。

本项目的原创代码采用 [MIT 许可](LICENSE)。模型权重、llama.cpp、Electron、Python 包等各有独立许可；特别是可选 PDF 后端 PyMuPDF 采用 **AGPLv3 或商业许可**，并非 MIT。分发前请查看 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各上游条款。

## 参与项目

[开发指南](docs/DEVELOPMENT.md) · [路线图](docs/ROADMAP.md) · [更新记录](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md)

继续保留 `HHHHHarris/OpenDeepL-updates` 仓库地址，是为了兼容现有客户端的更新源；旧名称不代表本次公开源码的范围。请勿在 Issue 或 PR 中上传用户内容、模型权重、签名密钥或私人开发记录。
