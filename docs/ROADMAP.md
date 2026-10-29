# Roadmap

This is a direction list, not a release promise. The **0.7.0 self-contained community release** has completed bounded candidate checks on existing physical machines with isolated data, see [release notes](RELEASE-0.7.0.md).

## Next release and acceptance gates

- Publish the v0.7.0 Mac DMG, Windows installer, and versioned SHA-256 checksum file after final artifact audit; preserve the legacy 0.6 update assets and feed bytes.
- Run clean-VM installation checks on both platforms without preinstalled development dependencies, plus native-hotkey and drag-OCR end-to-end reruns.
- Validate 0.7 update-feed behavior separately from the legacy 0.6 feed and document first-open outcomes under different device policies.
- Expand representative document and OCR regression fixtures, including GUI file-picker paths, cancellation, retry, failed files in a batch, and output inspection.

## Areas to improve

- More resilient setup diagnostics and a clearer first-run status view.
- Better layout preservation in complex DOCX/PPTX/text PDFs; scanned-PDF handling is separate work.
- Accessibility, keyboard navigation, localization, and platform-specific integration parity.
- More transparent performance and quality measurements with publishable, reproducible fixtures.

A feature is marked shipped only after its relevant code, tests, and platform behavior have been verified. Suggestions are welcome in a [feature request](../.github/ISSUE_TEMPLATE/feature_request.yml).
