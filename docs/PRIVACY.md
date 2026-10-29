# Privacy and local data

OpenDeepL is designed for local processing **after setup**. The app-owned inference service listens on `127.0.0.1:18082`; translation text and document contents are sent to that local service, not to a hosted translation API. Screenshot OCR and document processing run locally. No translation API key is needed.

## What leaves the device?

| Action | Network behavior |
| --- | --- |
| Translate text, captured text, or a document | No cloud translation request. |
| Prepare the app or obtain model weights | 0.7 bundles its Python, PDF, OCR and inference dependencies. Clicking model download sends ordinary HTTPS file requests to Hugging Face and its official CDN hosts; no translation content is included. Developer builds also download dependencies during packaging. |
| Check for updates | Optional request to the configured GitHub Releases feed for metadata and, when an update is selected, its package. A startup check is scheduled after about 30 seconds. Disable automatic checks in Settings to avoid the startup request; a manual check still uses the network. |

The updater does not include translation text, screenshots, or document contents in its requests. We do not claim that third-party download services are anonymous. A fork or self-built copy should review `electron/update-config.json` and the pinned update key before enabling a feed; the inherited maintainer feed is not a general update service for forks.

## What stays on the device?

- Translation history (`history.json`) holds up to 200 items **in plaintext**, including source and result text. You can clear it in the app. Avoid translating secrets if local storage of those strings is inappropriate.
- Glossary, settings, update preference, model checksum receipts, and working files live in application-owned local storage. App data defaults to `~/Library/Application Support/OpenDeepL` on macOS or `%LOCALAPPDATA%\OpenDeepL` on Windows. Electron may keep additional user-data files in its platform user-data directory.
- Document output is saved where you choose. Temporary processing files should be treated as potentially sensitive; operating-system backups and sync tools may copy any local files you place in synchronized locations.
- Full 0.7 installers contain the local Python environment and inference/OCR tools, not the multi-gigabyte translation weights. Model references record only the local paths you chose; selecting an existing model verifies it without copying or uploading it. Model weights are not included in this source repository or `.odup` update assets.

This is a local-processing design statement, not a claim of zero network activity or end-to-end encryption of local files. Local users, backups, malware, and OS services with access to your profile can read plaintext history. See [SECURITY.md](../SECURITY.md) for private vulnerability reporting.
