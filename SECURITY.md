# Security policy

## Report privately

Please do not publish an exploit, private data, signing material, or a sensitive reproducer in a public issue. Use GitHub's **Report a vulnerability** / private advisory feature for this repository when available. If the button is absent, open an issue asking for a private reporting channel without including vulnerability details or sensitive data. Include the affected base-app and runtime versions, operating system, impact, and minimal reproduction steps. Remove real document content and credentials from logs and attachments.

No response-time or fix-time SLA is promised for this developer preview. We will assess a report and coordinate disclosure before public detail where practical.

## Boundaries to know

- Translation history is plaintext local data; see [privacy details](docs/PRIVACY.md).
- This source repository does not distribute models, signing keys, or standalone installers. Verify separately obtained components and their licenses.
- Runtime updates are intended for a compatible installed app and are validated with a pinned signature, file hashes, platform, and base-version checks. Forks must make their own feed/key decisions rather than treating the maintainer feed as a trusted channel for their builds.
- A locally self-signed macOS build is not Apple-notarized. Preserve the local signing identity outside the checkout for subsequent builds; a new identity can require permission reauthorization.
