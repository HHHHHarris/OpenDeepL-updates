<p align="center"><img src="assets/AppIcon.svg" width="96" alt="OpenDeepL icon"></p>
<h1 align="center">OpenDeepL</h1>
<p align="center"><strong>Translate on your computer, without sending your words to a translation cloud.</strong></p>
<p align="center"><a href="README.zh-CN.md">简体中文</a> · <a href="docs/DEMO.md">Real-app walkthrough</a> · <a href="docs/TRY.md">Try it</a> · <a href="docs/INSTALL.md">Install & build</a></p>

OpenDeepL is an independent, open-source desktop translator for **Apple Silicon macOS and Windows x64**. Translate text, selected screen regions, and supported documents with local models. No translation API key is needed. OpenDeepL is **not affiliated with DeepL SE**.

> **0.7.1 is available.** English and Simplified Chinese UI, with self-contained packages for Mac and Windows. [Release notes](docs/RELEASE-0.7.1.md) document the real-machine checks and limits.

### Download

[**Download for Mac**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/OpenDeepL-0.7.1-macos-arm64.dmg) · [**Download for Windows**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/OpenDeepL-0.7.1-windows-x64-setup.exe) · [SHA-256 checksums](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/SHA256SUMS-0.7.1.txt)

## A real app, a fictional guide

![OpenDeepL macOS app with an English interface translating an invented observatory guide into French](assets/demo/translation-macos.png)

*Direct capture from the final 0.7.1 Mac package, not a mockup. The invented guide is one observed local-model run, not a quality or speed benchmark. [See the technical sample, fast mode, Windows app and idle state](docs/DEMO.md).*

## What it does

- **Text at your desk:** translate in the app, or select text elsewhere and double-copy with `⌘C+C` on Mac / `Ctrl+C+C` on Windows where the OS integration is available. One ordinary copy stays an ordinary copy.
- **Screen and files:** capture a region for local OCR and translation; translate DOCX, PPTX, and a conservative subset of text PDFs. Document output is saved separately; check layout and meaning.
- **Two local model choices:** Hy-MT2-7B Q8 is the default. Optional Hy-MT2-1.8B Q8 fast mode offers a 7B retranslation button. Documents always use 7B. One model is loaded at a time; weights unload after 60 seconds idle.
- **An interface you can choose:** English and Simplified Chinese app UI, with a persisted preference. This includes app-owned native menus and dialogs in the full 0.7.1 package; buttons supplied by the operating system may follow its language.
- **Your workspace stays local:** glossary and up to 200 history entries are stored on the device in plaintext. There is no account or sync.

**Translation quality varies.** Earlier synthetic testing caught a missed negation in 1.8B; 7B also offers no correctness guarantee. Check negation, identifiers, units, and critical instructions. Glossary terms guide rather than lock output. OCR and document layout also need review.

## Get started

1. Download the full package from the [latest release](https://github.com/HHHHHarris/OpenDeepL-updates/releases/latest) for your platform and verify its published SHA-256. The runtime is bundled; model weights are not. A first-time 7B download is about **8 GB**; optional 1.8B is about **1.9 GB**. You may instead verify/import the exact existing Q8 file.
2. Open the app and complete model setup. Mac uses a fixed **local** signature, not Apple Developer ID signing or notarization; Windows is unsigned. First-open warnings or device-policy blocks are possible. [Read first-open guidance](docs/INSTALL.md#first-open-notices).
3. Try the [short synthetic-text checklist](docs/TRY.md) and share [first-run feedback](https://github.com/HHHHHarris/OpenDeepL-updates/issues/new?template=first-run-feedback.yml). The checklist takes about five minutes **after** model setup; downloads and initial loading take extra time. Public issues should contain only invented examples, not private documents or raw logs.

An existing **0.7.0** app can receive compatible web-UI language changes through a runtime update, but English in app-owned native menus and dialogs requires the **full 0.7.1 package**. Users of a **0.6.x** native app also need a full-package upgrade. Older update feeds remain available; `.odup` files are not standalone installers.

## Privacy, licensing and scope

Inference, OCR and document processing happen locally after setup; translation text and files are not sent to a translation API. Model download and the optional GitHub update check use the network. See [privacy details](docs/PRIVACY.md).

Original OpenDeepL code is [MIT-licensed](LICENSE). Model weights, llama.cpp, Electron, Python components and fonts have separate third-party terms; see [notices](THIRD_PARTY_NOTICES.md). The source checkout excludes runtime binaries and weights. Build details and supported-platform limits are in [INSTALL.md](docs/INSTALL.md).

[Changelog](CHANGELOG.md) · [Development](docs/DEVELOPMENT.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

The `HHHHHarris/OpenDeepL-updates` URL remains the existing-client update-feed address; its historical name does not indicate affiliation with DeepL.
