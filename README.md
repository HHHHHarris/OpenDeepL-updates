# OpenDeepL updates

Public distribution channel for signed OpenDeepL runtime updates. This repository is not a dump of the development workspace.

## Privacy

- Translation, OCR, documents, glossary and history are processed locally.
- The optional updater requests release metadata and packages from GitHub. Translation text and document contents are never included in update requests.
- No user documents, logs, screenshots, credentials, private signing keys, model weights or third-party reverse-engineering materials are published here.
- Only explicitly reviewed release files are uploaded. Local paths and test evidence remain private.

## Update scope

Runtime `.odup` packages update the interface and Python translation logic of a compatible, already-installed OpenDeepL App. They are not standalone installers and do not install models or Python dependencies.

The App validates a pinned Ed25519 signature, file SHA-256 digests and base-version/platform compatibility. Applying an update waits for an idle App, preserves the current translation workspace, and supports rollback. Native helpers and Electron require a separately built App update; runtime updates do not replace those components or reset macOS permissions.

The default translation model is Hy-MT2-7B; the optional fast text mode uses Hy-MT2-1.8B. Only one model is loaded by OpenDeepL at a time, with weight unloading after 60 seconds idle. Document translation uses 7B. Model output still requires review for important uses.

See [Releases](https://github.com/HHHHHarris/OpenDeepL-updates/releases) for compatible versions and checksums. Automatic update checks can be disabled in App settings; offline translation remains available.

OpenDeepL is an independent application, not affiliated with DeepL SE. Model weights and third-party components retain their respective licenses.
