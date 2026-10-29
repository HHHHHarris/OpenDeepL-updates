# OpenDeepL 0.7.1 — release candidate

**Status (2026-10-30): locally accepted candidate; not yet a published GitHub release.** Twelve assets, including `SHA256SUMS-0.7.1.txt`, are staged locally. Use the [latest published release](https://github.com/HHHHHarris/OpenDeepL-updates/releases/latest) until the 0.7.1 assets are uploaded and independently verified on GitHub. The published [v0.7.0 release](RELEASE-0.7.0.md) retains its separate historical acceptance record.

## What's new

- Choose **English** or **简体中文** for the app interface; the preference persists. The full 0.7.1 package extends language selection to app-owned native menus, dialogs and screenshot overlay text. OS-owned controls may use the system language.
- New direct-app demonstration uses invented observatory and technical-instruction text, not personal content. Mac and Windows screenshots show actual English-interface output, not a speed/quality benchmark. The Mac technical screenshot came from an earlier genuine 0.7.1 candidate; Mac observatory/fast-mode and Windows captures came from final packages.
- The 7B Q8 model remains the default; optional 1.8B Q8 offers fast mode and a 7B retranslation. A prior synthetic fast-mode test missed a negation; neither model guarantees correctness. Review critical output.

## Installation and compatibility

Built and locally tested packages: **Apple Silicon Mac DMG** and **Windows x64 installer**, with a separate SHA-256 file. The runtime is bundled; model weights are a separate verified download or exact-file import (about **8 GB** for 7B, **1.9 GB** for 1.8B). The Mac build has a fixed local signature but no Apple Developer ID/notarization; Windows is unsigned. First-open warnings and managed-device blocks are possible; see [INSTALL.md](INSTALL.md).

A compatible runtime update can bring web-UI language changes to an existing 0.7.0 app, but native menus and dialogs need the **full 0.7.1 package**. A 0.6.x native installation also needs a full-package migration. Older update feeds remain available; `.odup` is not an installer.

The staged release directory contains **12 assets**: two full installers, two new 0.7.1 runtime `.odup` files, two versioned `update-*-0.7.json` feeds, the two retained 0.6.2 runtime files, the two legacy `update-*.json` feeds, the new `SHA256SUMS-0.7.1.txt`, and the retained legacy `SHA256SUMS.txt`. The new checksum file lists the six new installer/runtime/feed assets; the legacy checksum file remains separate.

| Full package | Local SHA-256; verify again after GitHub upload |
| --- | --- |
| `OpenDeepL-0.7.1-macos-arm64.dmg` | `6b37e7d03450c46f2dd22906f90b195c50d28a227c24d2d3f0d2b44f28d1e7b3` |
| `OpenDeepL-0.7.1-windows-x64-setup.exe` | `5bf0569e34b72bd0eb63766b2f24c5599e19615ae53f24283778ec681065b51b` |

## Local acceptance and remaining publication check

- Final Node tests: **132 total, 131 pass, one skip, zero failures**.
- Final Mac DMG and Windows installer were built. One real Mac package UI/bridge smoke run completed on one machine. Its roughly 0.49-second observed time is not a launch-speed promise.
- On Mac, the final App translated the invented observatory guide English → French with 7B and 1.8B; the 7B result kept roof, ground floor and indoors distinct. A genuine earlier 0.7.1 candidate translated the technical note Chinese → English with 7B, preserving negation, three retries, 200/400/800 ms, request ID and cancellation. English → Chinese → English UI switching preserved source, result and numeric completion time without extra history records. The final 7B retranslation was observed at 10.8 s. After 60 seconds idle, local API state showed 7B sleeping and 1.8B unloaded. All these times are single-run observations on one machine, not a performance promise.
- The final Windows installer was independently installed and exercised in a real GUI: English selection persisted across restart, and a real 7B Chinese → English technical translation preserved the key instructions. A later 7B run in the same final package produced the public [Windows capture](../assets/demo/translation-windows.png) with **50.9 s** shown; the first acceptance run took **112.7 s**. Fast 1.8B and 7B retranslation were also observed at **12.5 s** and **39.3 s**. English → Chinese → English switching preserved text, target and numeric completion time with no new history entry. After 68 seconds idle, the UI showed model unloaded; local API showed 7B sleeping and 1.8B unloaded. These are individual Windows observations, not cross-hardware benchmarks.
- All published-demo PNGs are direct app-content captures using synthetic text and were visually checked for private content and OS-controlled prompts. This round re-accepted interface language, text translation and the model cycle; it did **not** rerun every OCR, document, hotkey, native-menu or OS-policy path. The staged 12 assets and checksum file still require GitHub upload and hosted-byte/hash verification.

The demonstration contains only synthetic text. Text, OCR and supported document processing are local after setup; model downloads and optional GitHub update checks use the network. Original code is MIT-licensed; models and bundled components retain their own terms. OpenDeepL is independent of DeepL SE.
