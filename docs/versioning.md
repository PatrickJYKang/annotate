# Versioning and release identity

Annotate uses one product version for the browser source, desktop app and sidecar. The root `package.json` is the source of truth. The webapp package and both npm lockfiles must match it; a native contract test enforces that. Desktop packaging and source archives read the root version rather than maintaining a separate desktop preview version. The native host supplies this version to the sidecar; source-run Python reads the root package.

## Version numbers

- `0.2.3-rc.1`, `0.2.3-rc.2`: test candidates for the same release. Increment the candidate number whenever a shared build changes, including packaging-only or signing changes.
- `0.2.3`: an example final version after its candidate passes release gates; it has not been published. Current development is proceeding to 0.2.4 instead.
- `0.2.4`: the agreed next release, including recording takes, match-data lookup and tracking improvements. This is a release target, not the current package version.
- `0.3.0`: a substantial feature release or intentionally incompatible change during the 0.x series. Document migration requirements explicitly.

Project schema versions such as `project.v2` are independent contracts, not app version numbers. A patch or release-candidate bump does not justify rewriting project data. Platform and architecture belong in artifact filenames, not separate product version sequences.

## Immutable published builds

A tag is `v` followed by the complete product version. Once a tag or artifact is shared publicly, do not move or replace it. Publish a new candidate or patch instead. The historical `v0.2.2-desktop.2` replacements predate this policy; leave that tag alone now.

Each package contains `build-info.json` with product version, source commit, dirty-tree flag, build time and target. Help > Copy diagnostic information exposes the safe build identity. Filenames include version/platform/architecture; source archives and SHA-256 checksums use the same version. Build from a clean committed tree. Do not describe a dirty build as a release candidate suitable for distribution.

As of 2026-11-24, manifests still identify `0.2.3-rc.1`, but `main` has continued beyond that candidate toward [0.2.4](../desktop/releases/0.2.4.md). Do not identify a current-source build solely by that unchanged version string; inspect its source commit. Public downloads remain `0.2.2-desktop.2`. Set a new candidate version, such as `0.2.4-rc.1`, before sharing the next build. The PnLCalib permission and Microsoft runtime confirmation are resolved; exact source packaging, Windows validation, signing/notarization and clean-machine testing remain publication gates. Automatic updates are not implemented; Help > Downloads and updates opens the release page.

## Release sequence

1. Set the root and webapp versions, refresh their lockfiles, and write the candidate's release notes.
2. Run unit, sidecar, native, browser, type and lint checks. Build the renderer and test real native workflows and recovery.
3. Commit and push. Stage and package both targets from that commit. Generate source and checksums; confirm embedded build identity is clean and correct.
4. Test the actual mounted DMG and Windows installer, including upgrade, relaunch, cancellation and a representative user workflow. Record the host and limitations of each result; packaging checks are not Windows runtime checks.
5. After approval and licence/signing gates, create an immutable tag and publish matching artifacts. Release candidates retain GitHub's prerelease designation; use README links rather than mislabelling stability for homepage visibility.
