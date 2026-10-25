# Security reports

Please do not put credentials, private footage, project files or an exploitable security issue in a public bug report. Use [GitHub's private vulnerability reporting](https://github.com/PatrickJYKang/annotate/security/advisories/new) if available. If it is unavailable, open an issue requesting a private contact channel without publishing exploit details.

The desktop host accepts only authorized project operations from its isolated renderer and runs its services on private loopback ports. Browser development servers are intended for local use, not public hosting. Do not expose their ports to the internet.

Release candidates are evaluation builds. Signing and notarization establish publisher identity; they are not a guarantee that software has no vulnerabilities. Dependency audits, host boundary tests and clean-machine tests are separate checks.
