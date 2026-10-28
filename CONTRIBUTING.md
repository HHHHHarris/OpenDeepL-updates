# Contributing

Thanks for helping improve OpenDeepL. Start with [INSTALL.md](docs/INSTALL.md) and [DEVELOPMENT.md](docs/DEVELOPMENT.md), then choose a focused issue or propose one.

## Before a pull request

1. Keep changes small and explain the user-visible behavior, affected platform, and limitations.
2. Add or update tests for behavior changes. Run the relevant Python and Node suites; report exact commands/results, and clearly identify anything not run.
3. Verify both platform paths when touching shared logic. For UI changes, include your own screenshots with synthetic content only.
4. Do not commit model weights, user files, logs, secrets, signing identities, private test evidence, third-party proprietary assets, or generated build artifacts.
5. Review licensing of every new dependency or borrowed asset. MIT applies to original project code, not automatically to dependencies or contributions copied from elsewhere. PDF support has separate PyMuPDF terms.

Please use the PR template. A passing unit suite is distinct from a clean-device install or a platform acceptance test; describe each honestly. For vulnerabilities, use the private route in [SECURITY.md](SECURITY.md) rather than a public issue.

By submitting a contribution, you affirm you have the rights to provide it under the project's MIT license (or explicitly identify a separate compatible license for an asset).
