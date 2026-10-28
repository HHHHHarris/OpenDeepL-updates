# Development guide

OpenDeepL combines an Electron UI (`electron/`, `ui/`), a Python translation/document core (`core/`), and platform integrations (`platform/`). `scripts/` contains tests, provisioning, build, and update tooling. The interface is currently primarily Chinese; localization is a welcome contribution.

## Versions and delivery layers

- `package.json` identifies the **public source/native base as 0.6.3**. This source preview is released as `v0.6.3-source.1` as a GitHub prerelease, not as `latest` and not as a generic installer release.
- Existing installed native **0.6.0** apps can have signed **0.6.2 runtime** content applied. Those `.odup` packages alter compatible UI/Python runtime files; they do not ship a replacement Electron binary, native helpers, models, or Python packages.
- A `0.6.3` source build is not the same base as a `0.6.0` installed app. Existing `0.6.2` runtime packages require base `0.6.0` and should not apply to it. Keep version compatibility explicit when changing the updater.
- The repository URL retains its older `OpenDeepL-updates` slug because compatible clients already refer to that feed. Keep forks' feed and key configuration separate.

## Reproducible local loop

Prerequisites and model setup are in [INSTALL.md](INSTALL.md). Use Node.js 22.12+ and Python 3.12; install the lockfile exactly:

```sh
npm ci
npm start
```

The app's inference adapter expects a compatible llama.cpp `llama-server` (build 10450 is the tested reference) and the exact model weights/checksums documented in INSTALL. `OPENDEEPL_LLAMA_SERVER`, `OPENDEEPL_QUALITY_MODEL`, `OPENDEEPL_FAST_MODEL`, and `OPENDEEPL_CHAT_TEMPLATE` override local paths. Default data paths are outside the checkout. The app-owned server binds `127.0.0.1:18082`; do not make it a public network listener.

## Tests

Run focused tests after changes. From the repository root:

```sh
./scripts/test_core.sh
node --test Tests/*.cjs
PYTHONPATH=. python3 -m unittest discover -s Tests -p 'test_*.py' -v
```

On Windows, use the equivalent `py -3.12 -m unittest ...` and PowerShell command syntax. Some integration tests or fixtures may require the platform, installed dependencies, or a local model; identify skipped/blocked tests separately from passing tests. When changing a shared path, report both unit results and any actual macOS/Windows manual acceptance. A test pass does not establish a clean-device installer.

## Build and update discipline

The macOS builder creates native helpers and a self-signed bundle; its identity is intentionally stored outside the repository. The Windows builder produces a portable ZIP. Neither script installs model weights or the private Python environment. Review the output before sharing; never commit a signing key, model file, user content, or generated bundle.

Update packaging uses pinned Ed25519 signatures, SHA-256 file checks, and base/platform compatibility. Treat a new update signing key or feed as a separate trust migration. Do not use the maintainer's feed as a distribution channel for a fork. `docs/PRIVACY.md` describes network and local storage boundaries.

## Review checklist

- Behavior, user-visible limitations, and platform differences are documented.
- Tests cover success, failure, and cancellation/retry where relevant.
- Synthetic fixtures only; no real translated documents, screenshots, absolute personal paths, private logs, or proprietary assets enter the repository.
- Third-party dependencies and assets are attributed under their own licenses, especially optional PyMuPDF PDF support.
- Claims distinguish source availability, successful build, installed runtime, and verified end-to-end use.

### Automated source checks

GitHub Actions runs the Node and Python suites on macOS and Windows without
model downloads. CI tests protocol and file-processing behavior; it does not
prove desktop permission grants, GPU inference, or a clean-device installation.
Actions are pinned to commit SHAs, use read-only repository permissions, and do
not receive release keys. `python scripts/check_public_source.py` checks tracked
publication boundaries, common credential patterns, and local Markdown links;
manual review is still required.

The signing/rollback integration test is opt-in: set
`OPENDEEPL_SIGNING_TESTS=1` only on a prepared Mac with Electron, Swift and your
own local signing identity. Default unit runs skip it. Jinja2 3.1.6 enables the
formatting-template tests; document tests need the lxml/PyMuPDF versions recorded
in the provisioning scripts.
