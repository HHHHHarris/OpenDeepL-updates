# Install OpenDeepL

## Release status

**0.7.1 is published.** Download the full package for Apple Silicon macOS or Windows x64 from the [release page](https://github.com/HHHHHarris/OpenDeepL-updates/releases/tag/v0.7.1). Both were built and exercised on actual machines. The Mac build has a fixed local signature, **not** Apple Developer ID signing or notarization; Windows is unsigned. See [0.7.1 release notes](RELEASE-0.7.1.md). `.odup` assets are compatible-app runtime updates, not standalone installers.

| Platform / verification | Download |
| --- | --- |
| Apple Silicon Mac DMG | [OpenDeepL-0.7.1-macos-arm64.dmg](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/OpenDeepL-0.7.1-macos-arm64.dmg) |
| Windows x64 installer | [OpenDeepL-0.7.1-windows-x64-setup.exe](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/OpenDeepL-0.7.1-windows-x64-setup.exe) |
| SHA-256 checksums | [SHA256SUMS-0.7.1.txt](https://github.com/HHHHHarris/OpenDeepL-updates/releases/download/v0.7.1/SHA256SUMS-0.7.1.txt) |

**Install:** download the full package and verify its published SHA-256; copy the Mac app from the DMG or run the Windows installer; then download or verify/import the default 7B model. The optional 1.8B model enables fast mode. The runtime is bundled but model weights are not. The 0.7.1 app lets you choose English or Simplified Chinese in Settings, and saves the preference. App-owned native menus and dialogs follow this choice; OS-provided buttons may use the OS language. Intel Mac, Windows ARM and Linux are not advertised as accepted package targets.

### First-open notices

Because these packages lack public publisher signing/notarization, macOS Gatekeeper or Windows Defender SmartScreen may display a first-open warning. Verify that the download came from the linked Releases page and matches its published SHA-256 digest before making your own decision about opening it. [Apple's guidance](https://support.apple.com/102445) explains the Mac alerts; [Microsoft's guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) explains SmartScreen reputation for unsigned downloads. Managed-device policy may prevent opening the app, and Windows Smart App Control may block unsigned executables. The installer cannot promise to work under those policies. Do not turn off device protections or remove download quarantine as an installation step.

If you have a 0.6.x native installation, install the **full 0.7.1 package** rather than applying a runtime update to the old base. An existing 0.7.0 app can receive compatible web-UI language changes through a runtime update, but English in app-owned native menus and dialogs requires the full 0.7.1 package. Version-specific 0.7 feeds and legacy 0.6 feeds remain separate and available. Keep your model files and local data. Re-check feature-specific OS permissions after replacement if prompted.

## First-run flow for the 0.7.1 application

1. Install the complete application, then open **OpenDeepL** directly.
2. The built-in setup screen checks its bundled Python, PDF and inference components. No system Python, Homebrew, pip or API key is required.
3. Download the recommended **7B standard model** (about 8 GB). Add **1.8B fast mode** (about 1.9 GB) if wanted. Downloads use Tencent's official Hugging Face repositories, can resume, and must pass SHA-256 verification.
4. Already have the exact Q8 files? Choose **Choose existing model / 选择已有模型**. OpenDeepL verifies and references the existing file without making another multi-gigabyte copy. Keep that file at its original location.
5. Return to translation. The default remains 7B. Fast results offer **Retranslate with 7B / 用 7B 重译**. One model is loaded at a time; weights unload after 60 seconds idle.

Model download requires internet access; importing an already verified model does not. Text, screenshots, documents and inference are processed locally; model and application downloads do not upload translation content. Optional system integrations request only their relevant OS permissions when enabled. A build signature does not grant those permissions on the user's behalf.

### Models

| Mode | Exact file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Standard, default | `HY-MT2-7B-Q8_0.gguf` | 7,981,928,896 | `58b3ad55dd6f6fa08c695cddc34fb5f8f708a844f78ae10508071914b0ed67c0` |
| Fast | `Hy-MT2-1.8B-Q8_0.gguf` | 1,908,528,192 | `5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4` |

The exact [7B](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) and [1.8B](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) repositories publish their weights under Apache-2.0, separately from OpenDeepL's original MIT code. Read the model cards and licenses. Available memory and speed vary by hardware; disk estimates exclude working space and the application runtime.

Downloaded weights, model references and translation history live in `~/Library/Application Support/OpenDeepL` on macOS or `%LOCALAPPDATA%\OpenDeepL` on Windows. Imported models stay at their original path; moving or deleting one requires selecting it again. Source documents are not overwritten. Uninstalling the Windows app leaves local models and user data intact.

## Build from source

Developer prerequisites: Node.js 22.12+, Python 3.12+, npm and a supported native build host. macOS also needs Xcode Command Line Tools and `rcodesign` for local build signing. The source checkout omits the runtime binaries and weights; `prepare_runtime.py` downloads and audits pinned build inputs. No public signing certificate is needed for this release workflow.

```sh
npm ci
node node_modules/electron/install.js
# On an Apple Silicon Mac:
python3 scripts/prepare_runtime.py --target macos-arm64
./scripts/setup_local_signing.sh
./scripts/build_desktop.sh --output /absolute/staging/OpenDeepL.app
```

The local Mac signature supports bundle integrity and identity continuity; it is not Developer ID signing or Apple notarization.

Windows PowerShell:

```powershell
npm ci
node node_modules/electron/install.js
py -3 scripts/prepare_runtime.py --target windows-x64
.\scripts\build_desktop.ps1
# Optional installer compilation, using Inno Setup from its official source:
.\scripts\build_installer.ps1 -Iscc 'C:\path\to\ISCC.exe'
```

Runtime inputs and digests are recorded in `scripts/runtime-sources.json`; Python dependency versions are in `scripts/runtime-requirements.txt`. Runtime preparation occurs on the build machine, not on a consumer's first launch. The runtime audit removes build-path-bearing wrappers and bytecode, checks for the build user's home path, and generates a file inventory. Review [third-party notices](../THIRD_PARTY_NOTICES.md) before distributing binaries.

## Documents and troubleshooting

DOCX and PPTX preserve package parts outside the translated XML text. PDF translation is a conservative, best-effort subset: it supports tested horizontal text with valid Unicode mappings, including embedded CJK fonts; scans, rotated text, forms, signatures and ambiguous layouts are rejected before output. Overflow is reported rather than silently clipped. Keep originals and review the translation.

- **Download interrupted:** click download again to resume; do not rename the partial file.
- **Checksum mismatch:** the invalid download is discarded. Re-download the exact Q8 file.
- **Existing model moved:** reopen the model panel and choose its new location.
- **Missing application components:** reinstall the full package, not an `.odup` file.
- **System permission prompt:** use the app's feature-specific guide. An OS security block is distinct from a feature permission; review the first-open notes above.
- **Signed-runtime update:** 0.7.1 uses a version-specific update feed. The existing 0.6 update feed remains separate.
