# Third-party components and model licenses

OpenDeepL's original application source, tests, documentation, and artwork are
licensed under the [MIT License](LICENSE). **This is not a claim that every
runtime dependency, model, or assembled application bundle is MIT-licensed.**
Third-party components retain their own licenses and attribution requirements.
No model weights, third-party runtimes, or proprietary DeepL files are vendored
in this source release. Lockfiles and provisioning scripts identify dependencies
fetched separately by developers.

## Important: the PDF backend

The optional PDF workflow imports **PyMuPDF (1.28.2)**, which uses MuPDF.
Upstream offers **GNU AGPLv3 or a commercial license**, not MIT.
The document dependency installers currently install this backend alongside lxml.
DOCX/PPTX translation does not depend on PyMuPDF; use lxml alone if you only need
Office documents. PDF processing reports a missing-backend error without it.

If you distribute or provide an application that incorporates PyMuPDF, review
and satisfy the applicable AGPL obligations, including the required source and
notices, or obtain the appropriate commercial license from Artifex. Installing
it separately does not, by itself, waive those obligations. The project's MIT
license does not grant a commercial PyMuPDF license or replace its license.
This source release does not include a combined PyMuPDF application binary.
See [upstream licensing](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright)
and [Artifex licensing](https://artifex.com/licensing/).

## Main components

| Component | Role | Upstream license / notices |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) 44.9.3 | Desktop shell | [MIT](https://github.com/electron/electron/blob/main/LICENSE); Chromium and other bundled components have additional notices. Preserve the distribution's `LICENSE` and `LICENSES.chromium.html`. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | Local inference runtime, separately installed | [MIT](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE); preserve notices for the chosen binary and its GPU backends. |
| [Hy-MT2-7B-GGUF](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) | Default Q8 translation model | [Apache-2.0 license in this exact repository](https://huggingface.co/tencent/Hy-MT2-7B-GGUF/blob/main/LICENSE.txt). |
| [Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) | Fast Q8 translation model | [Apache-2.0 license in this exact repository](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/blob/main/LICENSE.txt). |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) / rapidocr-onnxruntime | Local OCR | [Apache-2.0](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE); retain code/model notices from the exact distribution. |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | OCR inference | [MIT and third-party notices](https://github.com/microsoft/onnxruntime/blob/main/LICENSE). |
| [lxml](https://lxml.de/) | Office XML processing | [BSD and underlying libxml2/libxslt notices](https://lxml.de/FAQ.html#what-license-is-lxml-released-under). |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) | Optional PDF processing | **AGPLv3 or commercial**, as explained above. |
| [apple-codesign / rcodesign](https://github.com/indygreg/apple-platform-rs) | macOS build-time signing tool | [MPL-2.0](https://github.com/indygreg/apple-platform-rs/blob/main/LICENSE); installed separately. |
| Apple AppKit, Vision, ApplicationServices | macOS system integration | Platform SDK/runtime terms; not redistributed by this repository. |

The GGUF license links above apply to the **exact GGUF repositories used here**;
do not assume other Tencent models, quantizations, or future versions have the
same terms. When redistributing weights, preserve their license, attribution,
applicable NOTICE files, and modification notices. Model licenses do not confer
rights to third-party brands.

## Transitive dependencies and release checklist

Python installers also pin NumPy, OpenCV, pyclipper, Shapely, PyYAML, Pillow,
six, tqdm, flatbuffers, packaging, and protobuf. Their licenses and bundled
native-library notices remain applicable. `package-lock.json` identifies the
npm dependency tree. This document is an index, not a substitute for all notices
in downloaded distributions or a complete binary SBOM.

Before publishing a binary:

1. Inventory the exact runtime, Python wheels, OCR assets, and models included.
2. Collect their license/NOTICE files and produce a versioned dependency inventory.
3. Resolve the PDF backend's AGPL/commercial obligations for that distribution.
4. Preserve Electron/Chromium and GPU-runtime notices in the assembled package.
5. Exclude keys, translation history, private documents, machine paths, and logs.
6. Verify the packaged application on each advertised OS and architecture.

DeepL is a third-party product and trademark. OpenDeepL is an independent project;
this repository contains no DeepL client binaries, extracted assets, or service
credentials and makes no affiliation or quality-equivalence claim.
