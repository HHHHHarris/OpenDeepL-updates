# Roadmap

This is a direction list, not a release promise. The repository is currently a **developer preview**.

## Next acceptance gates

- Reproduce a clean-device, source-to-running-app setup on macOS and Windows, including pinned models, Python/OCR dependencies, and local inference.
- Publish reproducible build instructions and downloadable artifacts only after fresh-machine verification. Existing `.odup` assets remain runtime updates, not installers.
- Validate privacy and signing/update-feed behavior for self-built and forked distributions.
- Expand representative document and OCR regression fixtures, including cancellation, retry, failed files in a batch, and output inspection.

## Areas to improve

- More resilient setup diagnostics and a clearer first-run status view.
- Better layout preservation in complex DOCX/PPTX/text PDFs; scanned-PDF handling is separate work.
- Accessibility, keyboard navigation, localization, and platform-specific integration parity.
- More transparent performance and quality measurements with publishable, reproducible fixtures.

A feature is marked shipped only after its relevant code, tests, and platform behavior have been verified. Suggestions are welcome in a [feature request](../.github/ISSUE_TEMPLATE/feature_request.yml).
