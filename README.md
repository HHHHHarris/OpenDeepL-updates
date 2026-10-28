<p align="center">
  <img src="assets/AppIcon.svg" width="96" alt="OpenDeepL icon">
</p>
<h1 align="center">OpenDeepL</h1>
<p align="center"><strong>Copy twice. Translate locally. Keep your words on your device.</strong></p>
<p align="center">
  <a href="LICENSE"><code>MIT code</code></a>
  <code>macOS + Windows</code>
  <code>Local inference</code>
</p>
<p align="center"><a href="README.zh-CN.md">简体中文</a> · <a href="docs/INSTALL.md">Build & setup</a> · <a href="https://github.com/HHHHHarris/OpenDeepL-updates/releases">Releases</a> · <a href="docs/ROADMAP.md">Roadmap</a></p>

OpenDeepL is an independent, open-source desktop translator for macOS and Windows. Text, screenshots, and supported documents are translated on your computer after you set up the model and local runtime. No translation API key is required. It is **not affiliated with DeepL SE**.

> **Developer preview (source version 0.6.3):** This repository contains source and build scripts, not a one-click installer. The existing Release assets are signed `.odup` **runtime updates for compatible installed apps**, not standalone installers. Start with the [build and setup guide](docs/INSTALL.md). The published source has not yet been accepted as a clean-device, end-to-end install on both platforms.

## Why OpenDeepL?

- **Stay in your workflow:** double-copy selected text with `⌘C+C` on Mac or `Ctrl+C+C` on Windows.
- **Choose speed or depth:** a small 1.8B model for quick reading, with a 7B retranslate button when you want another pass.
- **Keep control of your data:** local inference, local OCR, and local document processing—no translation subscription or cloud API key.

## What you can do

| Workspace | Current behavior |
| --- | --- |
| Text | Translate with Hy-MT2-7B Q8 by default; choose the optional Hy-MT2-1.8B Q8 fast mode, then retranslate with 7B. A glossary guides output but is not a guaranteed term lock. |
| Capture | Select a screen region, run local OCR, and translate detected text. |
| Documents | Translate DOCX, PPTX, and text-based PDFs, one file or a batch of 1–20. The document path uses 7B. PDFs are best-effort; scanned PDFs are not supported by document translation. |
| Desktop access | Tray actions, clipboard translation, double-copy capture, and context-menu/selection fallbacks where the operating system permits. Ordinary copy behavior remains available. Integration behavior and permissions differ by platform. |
| Local workspace | Review translation history and glossary entries stored on the device. History keeps up to 200 entries in local plaintext. |
| Runtime | One model is loaded at a time. Model weights unload after 60 seconds of idle time. |
| Updates | A compatible installed app can check a pinned maintainer feed for signed runtime updates. The startup check occurs after about 30 seconds and is optional in Settings. |

Translation quality, OCR accuracy, fonts, and document layout vary. Review important output; document layout is not pixel-perfect. See [limitations and setup](docs/INSTALL.md).

## Quick start from source

1. Read [INSTALL.md](docs/INSTALL.md) for prerequisites, model checksums, local Python dependencies, signing, and platform-specific builds.
2. Clone this repository and run `npm ci` with Node.js 22.12+.
3. Set up the exact model files, the matching llama.cpp runtime, and the private Python environment described in the guide.
4. Run `npm start` for the developer shell or build a platform artifact. A source build does not include model weights or the Python dependencies.

## Privacy at a glance

Inference, OCR, document processing, glossary, and history are local after setup. The app does not send translation text or files to a cloud translation API. **Setup downloads** (dependencies/models) and the **optional GitHub update check** do use network access; the update request is for release metadata/packages, not document contents. See [PRIVACY.md](docs/PRIVACY.md) for storage and threat-model details.

## Open source, with distinct licenses

The original OpenDeepL code is MIT-licensed; see [LICENSE](LICENSE). Model weights, llama.cpp, Electron, Python packages, and other third-party components are governed by their own terms. In particular, optional PyMuPDF PDF support uses **AGPLv3 or a commercial license**, not MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and review the upstream licenses for anything you distribute.

## Project

- [Build and setup](docs/INSTALL.md) · [Development](docs/DEVELOPMENT.md) · [Privacy](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md)
- [Contribute](CONTRIBUTING.md) · [Report a vulnerability](SECURITY.md)

The `HHHHHarris/OpenDeepL-updates` URL is retained because existing installed clients use it as their update feed. Its historical slug does not describe the scope of this newly published source repository. No user content, model weights, signing keys, or private development evidence belongs in issues or pull requests.
