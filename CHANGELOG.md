# Changelog

Notable public-source changes are recorded here. Publication status is stated per entry; candidate verification does not imply GitHub assets are already uploaded.

## 0.7.1 — 2026-10-30 · release candidate, not published

- Added English and Simplified Chinese interface selection with a persisted preference; the full package also localizes app-owned native menus, dialogs and screenshot overlay text. OS-supplied controls may still follow the OS language.
- Prepared a new, entirely fictional observatory and technical-instruction walkthrough with direct app captures. These are one-run demonstrations, not benchmarks or guarantees of translation accuracy.
- Existing 0.7.0 installations can receive compatible web-UI language changes via runtime update; native menu/dialog language needs a full 0.7.1 package. 0.6.x users need a full-package migration. Older feeds remain available.
- Local candidate validation: 132 Node tests (131 pass, one skip); full Mac and Windows packages built; real English-interface translation, language persistence, 7B/1.8B model cycle and idle state observed on both platforms. The 12 release assets and new checksum file are staged locally. This round did not re-accept all OCR, document or native-menu paths. GitHub upload and hosted-asset verification remain open; see [candidate notes](docs/RELEASE-0.7.1.md).

## 0.7.0 — 2026-10-29 · self-contained community release

- Added Apple Silicon Mac and Windows x64 native packages with bundled Python, llama.cpp, PDF and OCR components. Model weights remain a separate verified download or in-place import.
- Added first-run setup, default Hy-MT2-7B Q8, optional 1.8B fast mode, 7B retranslation, and single-model lifecycle with idle unload.
- Added a conservative text-PDF backend alongside DOCX/PPTX. Scanned and complex-layout PDFs are outside the supported subset.
- Kept 0.7 runtime-update feed filenames separate from legacy 0.6 feeds. Existing 0.6.x native installations require one full 0.7 installation.
- Mac packages use a fixed local signature without Apple Developer ID/notarization; Windows installer is unsigned. See [release notes](docs/RELEASE-0.7.0.md) for validation scope and first-open limitations.

## 0.6.3-source.1 — 2026-10-29 · public-source prerelease

- Published the original OpenDeepL desktop source and developer documentation under MIT.
- Documented separate licenses and provisioning for model weights and optional Python backends.
- Retained the historical GitHub release-feed URL for compatibility with existing installed clients.
- Clarified that current `.odup` assets update compatible apps and are not installers.

## Version context

The previously published source preview identifies as **0.6.3**. Existing native **0.6.0** apps may run **0.6.2** runtime content from the legacy update channel. Those `.odup` assets require base 0.6.0 and are incompatible with the 0.7 native base. Runtime updates do not replace native helpers, Electron, model weights, or Python dependencies. The `v0.6.3-source.1` tag remains a prerelease, not a generic installer release.
