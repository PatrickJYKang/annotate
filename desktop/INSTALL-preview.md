# Annotate Desktop Preview

Version: 0.2.2-desktop.2. These are unsigned evaluation builds, not a new stable release. This refresh includes the media-import, tracking-preview, homography, video-deletion and editor-session fixes from main as of 2026-09-16. It is not an installer-size or cold-start optimization release.

The Mac DMG, matching application source, installation notes and SHA-256 checksums are available on the [desktop prerelease page](https://github.com/PatrickJYKang/annotate/releases/tag/v0.2.2-desktop.2). This release does not include the superseded desktop.1 DMG or the locally built Windows installer.

## macOS

Apple Silicon (M1 or later), targeting macOS 14 or newer. Open the DMG and drag Annotate to Applications, then open Annotate from Applications. This is not an Intel Mac build.

The application has an ad-hoc signature, not an Apple-verified Developer ID signature or notarization. macOS may ask you to approve it under System Settings > Privacy & Security. Do not turn off Gatekeeper globally. If macOS refuses to offer an approval option, retain the exact warning for diagnosis rather than disabling security checks.

This build passed automated editing, saving, media import, detection, export and presentation checks directly from its read-only DMG on the build Mac. Clean-machine installation and older supported macOS versions still need testing. First launch can take longer while bundled libraries load and caches initialize; the startup window reports progress.

## Windows

Windows 10/11 x64. Run the EXE installer, choose the installation folder and finish installation. A desktop shortcut is created. The installer is per-user and does not require a system-wide Python or Node installation.

There is no verified Windows publisher signature. SmartScreen or organizational security policies may warn or block installation. Only approve a file obtained from the project maintainer; do not disable Defender or bypass your organization's policies.

The earlier desktop.1 preview was tried on Windows; this refreshed build still needs Windows runtime testing. Archive, platform-binary and checksum checks on the build Mac do not replace that test. Report startup failures with the exact error and service log. Installation and the first launch can be slow while Windows scans bundled files and libraries initialize; do not disable Defender to speed this up.

## Runtime And Projects

Both packages include Electron, Python, video tools, tracking and homography models. No Homebrew, Python, Node, separate Chrome installation or first-launch model download is required. Allow approximately 2.5 GB for the installed application, additional temporary space during installation and separate space for project videos/exports.

Use a copy of a project when testing. Project schemas are unchanged, but desktop recovery and cross-window behavior are still under development. Do not edit the same project simultaneously in the browser and desktop app or in separate application instances.

Service logs are stored in `~/Library/Application Support/Annotate/logs/services.log` on macOS and `%APPDATA%\Annotate\logs\services.log` on Windows. Project media remains in the project folder. Quit Annotate normally before replacing the application. The Windows uninstaller keeps application settings and does not delete project folders.

The accompanying source archive contains the application source used for this preview, including the desktop.2 packaging changes on top of main commit `140ec2c4` and the updated release documentation. Dependency locks, bundled third-party license material and native-tool build recipes are included in the source/runtime. The new `v0.2.2-desktop.2` tag records the packaging and documentation changes; existing browser release tags have not moved.
