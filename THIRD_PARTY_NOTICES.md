# Third-party components and model licenses

OpenDeepL's original application source, tests, documentation, and artwork are
licensed under the [MIT License](LICENSE). **This is not a claim that every
runtime dependency, model, or assembled application bundle is MIT-licensed.**
Third-party components retain their own licenses and attribution requirements.
No model weights, third-party runtimes, or proprietary DeepL files are vendored
in this source release. Lockfiles and provisioning scripts identify dependencies
fetched separately by developers.

## PDF processing in 0.7

The application runtime uses **pypdf (BSD-3-Clause)**, **ReportLab (BSD)** and
**pypdfium2 / PDFium (Apache-2.0 or BSD-3-Clause, with PDFium's bundled notices)**.
The CJK font is Noto Sans SC under **SIL OFL 1.1**, instantiated at weight 400
from the pinned upstream variable font. The PDF runtime does not import PyMuPDF.

PyMuPDF remains an optional **test-only** inspector for older geometry regression
fixtures. It is AGPLv3/commercial and is excluded from runtime requirements and
application bundles. Do not add it to a distributed runtime without separately
resolving its licensing obligations. Complex, rotated, scanned, signed and form
PDFs are not claimed to have unrestricted layout-preserving support.

## Main components

| Component | Role | Upstream license / notices |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) 44.9.3 | Desktop shell | [MIT](https://github.com/electron/electron/blob/main/LICENSE); Chromium and other bundled components have additional notices. Preserve the distribution's `LICENSE` and `LICENSES.chromium.html`. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | Bundled local inference runtime (b11978) | [MIT](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE); preserve notices for the chosen binary and its GPU backends. |
| [Hy-MT2-7B-GGUF](https://huggingface.co/tencent/Hy-MT2-7B-GGUF) | Default Q8 translation model | [Apache-2.0 license in this exact repository](https://huggingface.co/tencent/Hy-MT2-7B-GGUF/blob/main/LICENSE.txt). |
| [Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF) | Fast Q8 translation model | [Apache-2.0 license in this exact repository](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/blob/main/LICENSE.txt). |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) / rapidocr-onnxruntime | Local OCR | [Apache-2.0](https://github.com/RapidAI/RapidOCR/blob/main/LICENSE); retain code/model notices from the exact distribution. |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | OCR inference | [MIT and third-party notices](https://github.com/microsoft/onnxruntime/blob/main/LICENSE). |
| [lxml](https://lxml.de/) | Office XML processing | [BSD and underlying libxml2/libxslt notices](https://lxml.de/FAQ.html#what-license-is-lxml-released-under). |
| [pypdf](https://github.com/py-pdf/pypdf) 6.21.0 | PDF content streams | BSD-3-Clause; bundled wheel license. |
| [ReportLab](https://www.reportlab.com/) 4.4.5 | PDF replacement text | BSD; bundled wheel license. |
| [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) 5.3.0 | PDF glyph geometry | Apache-2.0 / BSD-3-Clause; retain the complete PDFium third-party notice directory. |
| [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc) | CJK PDF text | SIL OFL 1.1; `runtime/notices/NotoSansSC-OFL.txt`. |
| [CPython / python-build-standalone](https://github.com/astral-sh/python-build-standalone) | Bundled interpreter | Python-2.0 and upstream dependency licenses; complete upstream notice set is pinned in `scripts/runtime-sources.json`. |
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
npm dependency tree. The Windows image-only OCR runtime omits OpenCV's optional FFmpeg video plugin; the omitted file and original digest are recorded in `runtime/notices/omitted-components.json`. The full OpenCV wheel notices are still preserved. The NumPy OpenBLAS binary includes GCC runtime code covered by GPL-3.0 with the GCC Runtime Library Exception; its complete notices are retained in the NumPy distribution. RapidOCR and PaddleOCR Apache-2.0 license texts are pinned and added under `runtime/notices`. This document is an index, not a substitute for all notices
in downloaded distributions or a complete binary SBOM.

Before publishing a binary:

1. Inventory the exact runtime, Python wheels, OCR assets, and models included.
2. Collect their license/NOTICE files and produce a versioned dependency inventory.
3. Confirm PyMuPDF is absent from the runtime and preserve all PDFium/font notices.
4. Preserve Electron/Chromium and GPU-runtime notices in the assembled package.
5. Exclude keys, translation history, private documents, machine paths, and logs.
6. Verify the packaged application on each advertised OS and architecture.

DeepL is a third-party product and trademark. OpenDeepL is an independent project;
this repository contains no DeepL client binaries, extracted assets, or service
credentials and makes no affiliation or quality-equivalence claim.
