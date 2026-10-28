# Changelog

Notable public-source changes are recorded here. This file describes the repository state, not an independently verified installer release.

## 0.6.3-source.1 — 2026-10-29 · public-source prerelease

- Published the original OpenDeepL desktop source and developer documentation under MIT.
- Documented separate licenses and provisioning for model weights and optional Python backends.
- Retained the historical GitHub release-feed URL for compatibility with existing installed clients.
- Clarified that current `.odup` assets update compatible apps and are not installers.

## Version context

The published source/native base identifies as **0.6.3**. Existing installed native **0.6.0** apps may run **0.6.2** runtime content from the update channel. Those `.odup` assets require base 0.6.0 and should be rejected by a 0.6.3 source build. Runtime updates do not replace native helpers, Electron, model weights, or Python dependencies. The `v0.6.3-source.1` tag is a prerelease, not the `latest` update feed or a generic installer release.
