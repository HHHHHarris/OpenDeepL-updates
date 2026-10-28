# Build and setup from source

**Status: developer preview (source version 0.6.3).** These steps assemble a local development installation; they have **not** been accepted as a clean-device, end-to-end installer on both platforms. The existing [Release assets](https://github.com/HHHHHarris/OpenDeepL-updates/releases) are `.odup` runtime updates for compatible installed apps, **not** standalone installers. No model weights, llama.cpp executable, Python environment, or macOS signing key is bundled with this repository.

The interface is currently primarily Chinese. macOS and Windows integrations have different system permissions and behavior.

## Prerequisites

- macOS or Windows, Node.js **22.12+**, `npm`, and Python **3.12** (tested baseline; use a suitable local Python rather than changing your system Python).
- Enough disk space for model files: the required 7B Q8 file is **7,981,928,896 bytes**; optional fast 1.8B Q8 is **1,908,528,192 bytes**, plus runtime and working space. Actual memory needs depend on the machine and workload.
- A compatible **llama.cpp `llama-server`** binary. Build **10450** is the tested reference; use a build supporting `--models-preset`, `--models-max`, `--sleep-idle-seconds`, and offline flags. The service is app-owned and bound to **127.0.0.1:18082**. No external API key is used. Obtain/build the executable under its own upstream license; it is not part of this checkout.
- On macOS, Xcode Command Line Tools for the Swift native helpers. The macOS bundle builder also needs **rcodesign 0.29.0**, obtained from the upstream project and made executable via `OPENDEEPL_RCODESIGN` or `PATH`; the binary is not bundled.
- On Windows, PowerShell and Python launcher `py` (or set `OPENDEEPL_BOOTSTRAP_PYTHON`). The Windows build is a portable ZIP, not an installer.

Clone the repository, then run in its root:

```sh
git clone https://github.com/HHHHHarris/OpenDeepL-updates.git OpenDeepL
cd OpenDeepL
npm ci
```

`npm ci` installs the locked Electron **44.9.3** development dependency. It does not set up inference or download weights.

## Model files and chat template

Get the exact GGUF files from the upstream [Hy-MT2-7B-GGUF](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) and, for fast mode, [Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) repositories. Read each upstream `LICENSE.txt` and model card. Their weights are separate Apache-2.0-licensed artifacts, **not** covered by this repository's MIT license. The app checks size and SHA-256 before loading.

| Mode | Default destination under app data `models/` | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Quality, required | `HY-MT2-7B-Q8_0.gguf` | 7,981,928,896 | `58b3ad55dd6f6fa08c695cddc34fb5f8f708a844f78ae10508071914b0ed67c0` |
| Fast, optional | `Hy-MT2-1.8B-Q8_0.gguf` | 1,908,528,192 | `5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4` |

Default app data is `~/Library/Application Support/OpenDeepL` on macOS and `%LOCALAPPDATA%\OpenDeepL` on Windows. Place the files at those exact names or set `OPENDEEPL_QUALITY_MODEL` and `OPENDEEPL_FAST_MODEL` to absolute file paths. Never substitute a similarly named quantization without also changing and reviewing the pinned checks in source.

The formatting-only chat template is tracked at `platform/templates/hunyuan-translation.jinja`. Copy it into the app-data runtime directory as `hunyuan-translation.jinja`, or set `OPENDEEPL_CHAT_TEMPLATE` to its absolute path. Do not put weights or a private configuration in the repository.

**macOS example** (from the repository root, after placing the weights):

```sh
APP="$HOME/Library/Application Support/OpenDeepL"
mkdir -p "$APP/models" "$APP/runtime"
cp platform/templates/hunyuan-translation.jinja "$APP/runtime/hunyuan-translation.jinja"
shasum -a 256 "$APP/models/HY-MT2-7B-Q8_0.gguf"
# Optional: shasum -a 256 "$APP/models/Hy-MT2-1.8B-Q8_0.gguf"
```

**Windows PowerShell example:**

```powershell
$AppData = Join-Path $env:LOCALAPPDATA 'OpenDeepL'
New-Item -ItemType Directory -Force (Join-Path $AppData 'models'), (Join-Path $AppData 'runtime') | Out-Null
Copy-Item 'platform\templates\hunyuan-translation.jinja' (Join-Path $AppData 'runtime\hunyuan-translation.jinja')
Get-FileHash (Join-Path $AppData 'models\HY-MT2-7B-Q8_0.gguf') -Algorithm SHA256
# Optional: Get-FileHash (Join-Path $AppData 'models\Hy-MT2-1.8B-Q8_0.gguf') -Algorithm SHA256
```

Compare the printed digest and file size with the table before launching. The app verifies them again.

## Local Python dependencies

Use the repository scripts to create an app-private Python environment. These scripts download packages from PyPI during setup, but inference and OCR do not depend on a hosted API at runtime.

**macOS:**

```sh
./scripts/install_document_dependencies.sh
./scripts/install_ocr_dependencies.sh
```

**Windows PowerShell:**

```powershell
.\scripts\install_document_dependencies.ps1
.\scripts\install_ocr_dependencies.ps1
```

The OCR setup verifies against the public synthetic fixture `Tests/fixtures/ocr-sample.png`. PDF document support uses **PyMuPDF**, whose AGPLv3/commercial terms are distinct from MIT; review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before redistributing a build. DOCX/PPTX and text PDF translation are best-effort; scanned PDFs are outside the document path.

## Run or build

For the default lookup, install `llama-server` on macOS's launch-time `PATH`
(or `/opt/homebrew/bin/llama-server`). On Windows, place the executable **and its
matching runtime DLLs** under `%LOCALAPPDATA%\OpenDeepL\runtime\llama\`.
Alternatively, set `OPENDEEPL_LLAMA_SERVER` to its absolute path. Shell environment
variables only reach processes launched from that shell; they are not persisted
by building the app and might not reach a Finder/Explorer launch. Use the default
locations for direct launching, or launch from your configured shell.

After configuring the runtime, run `npm start` from the repository root. This starts the **developer shell**; it is not a packaging step.

**macOS build:** provision rcodesign, then create a stable, local-only signing identity and build to a fresh absolute path:

```sh
export OPENDEEPL_LLAMA_SERVER=/absolute/path/to/llama-server
export OPENDEEPL_RCODESIGN=/absolute/path/to/rcodesign
./scripts/setup_local_signing.sh
./scripts/build_desktop.sh --output "$PWD/dist/OpenDeepL.app"
```

The self-signed identity is stored outside the checkout under `~/Library/Application Support/OpenDeepL/build-signing`. Preserve it for subsequent builds: replacing a signing identity can require macOS privacy permission reauthorization. This is **not Apple notarization**. An existing app with a different signing class may also require one permission reauthorization. The explicit `--output` path stages a bundle; the no-argument script targets `~/Applications/OpenDeepL.app` and may replace an existing own installation with rollback handling, so use the staging path first.

**Windows PowerShell build:**

```powershell
$env:OPENDEEPL_LLAMA_SERVER = 'C:\absolute\path\to\llama-server.exe'
.\scripts\build_desktop.ps1
```

The script writes `dist\OpenDeepL-win-portable.zip`. It does not bundle Python, model files, or llama.cpp and does not create an installer or auto-start entry. Set up those dependencies on the machine where you run it.

## First-run checks and limitations

1. Confirm the configured model file matches the exact byte size and SHA-256 above. First verification of a large file may take time.
2. Translate a short, non-sensitive text sample. If using fast mode, verify the optional 1.8B file too. Only one model is loaded at a time; weights unload after 60 seconds idle.
3. Test screenshot OCR and desktop integrations separately, granting OS permissions only where needed. Double-copy is intended to preserve normal copy behavior. Platform context-menu behavior is not identical.
4. Test documents with disposable samples. A text-based PDF is supported on a best-effort basis; scanned PDF pages, complex layout, fonts, and exact pagination are not guaranteed.
5. Use Settings to disable automatic update checks if you want no startup GitHub request. A manual update check still contacts the feed.

The repository's `electron/update-config.json` retains the maintainer's historical feed URL for installed-client compatibility. A self-built `0.6.3` source app is a different base from an installed `0.6.0` app running `0.6.2` runtime content. The older `.odup` packages require the **0.6.0 base** and should be rejected by a `0.6.3` source build. Forks should disable automatic checks or configure their own feed and signing key before distributing builds.
