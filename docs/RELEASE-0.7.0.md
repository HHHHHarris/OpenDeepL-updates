# OpenDeepL 0.7.0 — self-contained community release

**Status:** Acceptance completed on physical existing machines with isolated app data and bundled runtimes. Download from the [v0.7.0 release](https://github.com/HHHHHarris/OpenDeepL-updates/releases/tag/v0.7.0) and verify against the hashes below. Supported package targets are **Apple Silicon macOS** and **Windows x64**; the interface is primarily Chinese.

[**Mac DMG**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.0/OpenDeepL-0.7.0-macos-arm64.dmg) · [**Windows installer**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.0/OpenDeepL-0.7.0-windows-x64-setup.exe) · [**SHA256SUMS-0.7.0.txt**](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.0/SHA256SUMS-0.7.0.txt)

**Three steps:** 1. Download the package for your platform and verify its SHA-256. 2. Copy the Mac App from the DMG or run the Windows installer, then open OpenDeepL. 3. Download or verify/import the default 7B model; optionally add 1.8B fast mode. Read the [first-open guidance](INSTALL.md#first-open-notices), especially on managed devices.

## What's new

- Full native packages include local Python, llama.cpp, PDF and OCR components. No system Python, Homebrew, pip, or translation API key is needed on a consumer machine. Model weights are **not** included.
- The first-run setup guides a SHA-256-checked download of Hy-MT2-7B Q8 (default, about 8 GB) and optional Hy-MT2-1.8B Q8 (fast, about 1.9 GB). It can verify an existing exact model file and reference it in place; keep imported files at their original paths.
- One model is loaded at a time; idle weights unload after 60 seconds. Fast results offer 7B retranslation.
- DOCX, PPTX, and a conservative subset of text-based PDFs can be translated locally. PDF support targets common horizontal text with valid Unicode mappings. Scans, complex layouts, rotated text, forms and signatures are rejected rather than promised as faithful conversions. Review all output.

## Installation and compatibility

The Mac package uses a fixed **local** build signature, not Apple Developer ID signing or notarization. The Windows package is **unsigned**. macOS Gatekeeper and Windows SmartScreen may warn on first open; managed-device policy or Windows Smart App Control may block execution. Verify the release source and digest, and follow [installation guidance](INSTALL.md). Do not disable device protections or strip quarantine as a setup step. See [Apple](https://support.apple.com/102445) and [Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) for platform behavior.

Users of a 0.6.x native app must install the full 0.7 package once. The older `.odup` files are signed runtime updates for compatible 0.6 installations, not full installers and not a way to cross native versions. The 0.7 update feeds use separate filenames; legacy feeds remain available.

## Verification boundary

As of 2026-10-29, a Mac DMG was verified, copied to an isolated install path, and passed strict code-signature verification plus App UI/bridge smoke (0.36 s load, 0.47 s ready). A Windows Inno installer installed to a fresh isolated directory and its App passed UI/bridge smoke (1.01 s load, 1.15 s ready). Real 7B and 1.8B UI translation and 7B retranslation passed on both platforms. In one synthetic example, Mac r2 timings were 39.9 s / 2.1 s / 8.8 s and Windows r3 timings 37.3 s / 12.4 s / 45.9 s respectively; these are **not cross-hardware benchmarks**. Both packaged runtimes completed real-7B DOCX/PPTX/PDF backend cases and the packaged OCR sample; Windows PDF Unicode extraction reproduced the expected Chinese. Both were observed with at most one loaded model, and Windows passed a 60-second idle-unload check. The source JS suite recorded 117 tests (116 pass, one skip); the final Python test-environment rerun recorded 88 tests (84 pass, four skip). These are physical-machine tests with isolated data, **not** a clean-VM no-dependency installation; document cases exercised the packaged backend, not GUI file pickers. Full 0.7 native-hotkey and drag-OCR reruns, broad layouts/languages, and managed-device policies are outside this acceptance claim.

## Installer SHA-256

| File | SHA-256 |
| --- | --- |
| `OpenDeepL-0.7.0-macos-arm64.dmg` | `151b259ed83eb8482d20cb852e045cd2596fe8d767fbe3d3eb7994e4e2905aa4` |
| `OpenDeepL-0.7.0-windows-x64-setup.exe` | `67eed465c774615b981b453617a3a1c9c63c44f99003aa4b6eb67e59b32efd0e` |

The separate `SHA256SUMS-0.7.0.txt` also covers new runtime packages and feeds. The original `SHA256SUMS.txt` is retained unchanged for the legacy 0.6.2 update assets.
