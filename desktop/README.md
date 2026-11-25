# Desktop Preview

The Electron host runs the shared Annotate UI against native project files. Development targets **0.2.4**, although package manifests still use **0.2.3-rc.1** for both hosts. Public downloads remain `0.2.2-desktop.2` and do not include the later source changes. The root `package.json` supplies the desktop version through `desktop/preview-version.mjs`, and matching lockfiles/webapp versions are tested. Both hosts share project.v2 schemas, drawing code, frame contracts and repository rules, including the new optional recording fields. See [current source status](releases/0.2.4.md), [versioning](../docs/versioning.md), [earlier candidate notes](releases/0.2.3-rc.1.md) and [licence review](../docs/licence-review.md).

## Install Preview

Download the Apple Silicon DMG or Windows x64 installer from the [0.2.2 Desktop Preview 2 release](https://github.com/PatrickJYKang/annotate/releases/tag/v0.2.2-desktop.2). GitHub marks this as a normal, Latest release so it appears on the repository homepage; the builds remain unsigned evaluation previews. The release also includes installation notes, a source archive and SHA-256 checksums. The earlier desktop.1 DMG is superseded and is not uploaded.

On macOS, open the DMG and drag Annotate to Applications. On Windows, run the EXE installer and select an installation directory; the installer creates a desktop shortcut and can launch the application after installation. No separate Python, Node, Homebrew, ffmpeg or browser installation is required. The runtime and both CV models are bundled, so the first launch does not download models. Local build artifacts are in `desktop/artifacts/installers/`.

These packages have no verified publisher signature. The macOS app has an ad-hoc signature required for Apple Silicon, not Developer ID signing or notarization; Gatekeeper may require explicit approval. Windows can show an unknown-publisher/SmartScreen warning. Do not disable operating-system security protections globally. These are evaluation builds, not a signed stable desktop release. Windows packaging does not establish that the app runs correctly on Windows; native Windows testing is still required.

Initial targets are Apple Silicon with macOS 14 or newer and Windows 10/11 x64. Intel Mac and native Windows ARM packages are not included. macOS 14 is the compilation target, not a tested OS matrix. Allow several gigabytes for the installed app and additional space for project media and exports. Test with copies of existing projects; browser and desktop must not edit the same project simultaneously.

## Package

The desktop app icon uses the existing lowercase `a` from `brand/wordmark/a-icon.svg`, scaled down by about 10% within the same square canvas for extra padding. The source artwork, web favicons and in-app branding are unchanged. Committed PNG, ICNS and ICO assets live in `desktop/icons/` and are used for application windows and both platform packages. To regenerate them, run `npm run build:desktop-icons` on a Mac with ImageMagick and the system `iconutil`; normal packaging uses the committed icons and does not require ImageMagick.

Build prerequisites on the packaging Mac are Node/npm, uv, Git, curl, Xcode command-line tools, CMake, make and pkg-config, plus the locked PnLCalib checkout/weights and YOLO weight used by the development setup. None of these build tools are needed by recipients. Set `ANNOTATE_PNLCALIB_ROOT` if the checkout is outside `sidecar/third_party/pnlcalib`. PnLCalib now pins licence-clarification commit `42088864170f75ea02e76d20e9a9a1db59edb3e3`; provision the default checkout with `scripts/setup-pnlcalib.sh` or ensure the override checkout contains that revision before staging. Existing external development checkouts are not modified automatically by staging.

```bash
npm ci
npm --prefix webapp ci
npm run build:desktop-host
npm run build:desktop-renderer
npm run stage:desktop -- darwin-arm64
npm run package:desktop -- darwin-arm64
npm run stage:desktop -- win32-x64
npm run package:desktop -- win32-x64
```

Staging downloads checksum-verified Python 3.12.14 standalone builds, installs the existing sidecar lock for the target platform, and bundles pinned models/source. macOS ffmpeg 8.1.1 and x264 are compiled with four jobs against macOS 14 without Homebrew dylib dependencies. Their source archives, license texts and build recipe are included. Windows uses platform-specific Python wheels and app-local Microsoft runtime DLLs, so no system-wide runtime install is performed. Packaging verifies all 13 Microsoft DLLs, including Shapely's copy, and presents the original runtime terms explicitly scoped to those components. The unused renderer image optimizer is omitted on both targets. Electron-builder 26.15.3 produces a DMG and NSIS installer without publishing them. The original Windows media tools remain Gyan 8.1.1 until the isolated source-built replacement passes native Windows validation.

Runtime resources live under `Contents/Resources/runtime` on macOS and `resources/runtime` on Windows. Settings, caches, temporary files and service logs go under Electron's user-data directory outside the installation. Startup checks required resources and their checksums, displays service progress and launches the workspace. Signing changes executable hashes, so the Mac packager refreshes the manifest after nested signing and reseals the outer bundle.

Current staging collects client-bundled and nested third-party notices, restores exact-version Next notices and retains source inputs appropriate to each actual native package. `npm run prepare:compliance -- <target>` audits an existing runtime into a separate directory/archive without changing it. It includes committed application source, a tracked working-tree patch, a dirty-tree flag, an untracked-file list and before/after binary fingerprints; dirty evidence is not a publishable source companion. PnLCalib's code/weight permission questions and the Microsoft runtime review are resolved. New renderers omit sharp/libvips and use the Annotate-owned client-only marker; controlled Mac OpenCV replaces the old Homebrew-library chain. GEOS source and Shapely wheel recipes are retained. The Windows source-built media candidate is separate from the working app pending Windows validation. See [distribution compliance](../docs/distribution-compliance.md) for exact status; original staging and public installers are unchanged.

For the isolated Windows media candidate, run `node desktop/scripts/controlled-windows-ffmpeg.mjs /absolute/new-media-directory`, then `node desktop/scripts/windows-media-evidence.mjs /absolute/new-media-directory`. The first command refuses to overwrite a populated output, limits compilation to four jobs and pins the sources/toolchain; the second verifies and completes its runtime notices/source record. `desktop/scripts/check-windows-media.py` is the native Windows comparison check and saves its diagnostics. These commands do not publish or silently promote the candidate. The Windows source gap is closed only for a build whose executable and source checks actually pass, not for the older Gyan binary.

The 2026-11-01 candidate compiled and passed its source/executable/import checks; 86 desktop tests pass. `package-windows-media-check.mjs <media-directory> <new-output-directory>` makes a diagnostic ZIP with a double-click Windows launcher, persistent logs and the media sources/notices. It does not alter the installed app. After native Windows tests pass, opt in during staging with `node desktop/scripts/stage-runtime.mjs win32-x64 --windows-media=/absolute/verified-media-directory`. Legacy staging remains available for comparison, not as a cleared public-release path.

```bash
node desktop/scripts/check-runtime.mjs desktop/build/darwin-arm64/runtime
ANNOTATE_TEST_PACKAGED_EXECUTABLE="/path/to/Annotate.app/Contents/MacOS/Annotate" npm run test:electron
```

The runtime check removes development search paths and executes actual detection, calibration and H.264 export on a fixture. It verifies model execution, not real-match tracking or homography quality. The Electron smoke accepts either the development executable or a packaged executable. Automated native-chooser fixtures are still used; these tests do not replace a clean-machine installation test.

New Mac staging also runs `controlled-opencv.mjs`: OpenCV 4.11.0, FFmpeg 7.1 and x264 are compiled from pinned source with four build jobs. Only Apple system dylibs are linked, avoiding the old wheel's Homebrew dependency chain. This is packaging-time work, not first-launch compilation. Real-match comparison passed six exact decoded frames, identical detections and fifty identical tracking frames; three homographies agreed within 0.00002 pixels. The 2026-10-29 checks include 77 desktop, 468 web unit, 104 sidecar and 26 production-renderer browser tests. See [controlled build and source reproduction](../docs/distribution-compliance.md#controlled-mac-opencv).

For isolated packaging verification, `package-desktop.mjs` accepts `--runtime=/absolute/candidate/runtime` and `--output=/absolute/test-output` alongside `--dir --allow-dirty`. These override only the input runtime and output destination; dirty builds remain marked and publication remains disabled. `prepare-compliance.mjs <target> /absolute/candidate/runtime` can inspect the same candidate without replacing the original staging directory.

The isolated 2026-10-29 Mac `.app` passed deep/strict ad-hoc signature verification, its bundled runtime smoke and the full Electron workflow smoke, including real detection, native import, persistence, pin windows, report export and presentation playback. This does not claim Developer ID signing, notarization or a native Windows test. The installed app and published installers were not replaced.

The published 2026-10-12 desktop.2 rebuild no longer bundles the user guide: the header's **User guide** button opens the [online user guide](https://patrickjykang.github.io/annotate-docs/) in the current UI language (English, French, Spanish or Simplified Chinese) in the system browser, with its complete-workflow and twelve tutorial videos. That historical package allowed only the guide as an external link; current source also supports explicit source, support and release links through the host's allowlist. The rebuild kept the macOS background-service Dock fix, the smaller icon letter and localized built-in tagging boards. The rebuilt Mac app passed the Electron smoke directly from its read-only mounted DMG with `PATH=/usr/bin:/bin`, plus deep/strict ad-hoc signature and disk-image integrity checks; its bundled runtime check executed YOLO detection, PnLCalib inference and H.264 encoding, and the guide button pointed to the website in each language. The standalone renderer smoke passed. The Windows installer passed archive and runtime-manifest checks. This is historical package evidence, not a current-source rebuild, fresh Windows execution or clean-machine result, and does not address installer size or cold-start performance.

Between the 2026-10-07 and 2026-10-12 public rebuilds, only the user guide and desktop handling of its link changed. The guide-link and dashboard browser tests, webapp unit tests, 27 native-host tests, lint and TypeScript passed; the full sidecar and browser suites were not rerun. Staging used the then-locked PnLCalib checkout via `ANNOTATE_PNLCALIB_ROOT` (the default `sidecar/third_party/pnlcalib` was absent).

The refreshed downloads are 976,333,370 bytes (Mac DMG) and 930,816,967 bytes (Windows EXE). The user explicitly requested moving `v0.2.2-desktop.2` to the matching rebuild/documentation commit, as with the earlier refreshes. The version and canonical filenames remain the same, so the release checksum file identifies this refresh. Browser release tags are unchanged. Prior installers are retained locally; replacements are uploaded under temporary names and checked before switching canonical release assets. `node desktop/scripts/archive-source.mjs [git-ref]` archives committed source and Markdown documentation, including historical plans linked from the index, from the supplied ref (default `HEAD`). It excludes working-tree edits and untracked files; generate release source from the tagged commit.

## Run

Use the existing webapp dependencies, Python environment, ffmpeg and models from the browser setup, then:

```bash
npm ci
npm run build:desktop-renderer
npm run desktop:dev
```

The desktop command rebuilds the trusted domain-service bundle and launches Electron 44.9.3. It uses a production renderer, not hot reload: rebuild the desktop renderer and restart after UI changes. Startup selects private loopback ports, starts the sidecar and standalone Next server, waits for readiness, then opens the workspace. It does not reuse or stop the browser preview. Electron supplies the web server's Node runtime; on macOS, the server runs through the background Helper executable rather than the foreground app executable so it does not create a second Dock icon. No separate Chrome is required. The development command uses developer-provided Python, ffmpeg and models; installed packages use their bundled runtime exclusively.

ANNOTATE_SIDECAR_PYTHON selects an absolute interpreter path; ANNOTATE_PNLCALIB_ROOT selects the verified model installation; ANNOTATE_DESKTOP_USER_DATA overrides development settings. The integration test's chooser-path and hidden-window overrides are main-process environment settings, never renderer permissions.

## Architecture

| Module | Responsibility |
| --- | --- |
| main.mjs | Native dialogs, window/project grants, domain dispatch, edit baselines, clip/pin window deduplication, recent project, services and close/quit orchestration. |
| preload.cjs | Context-isolated serializable request/reply bridge, notifications, progress and close guards. No Node APIs or raw IPC are exposed. |
| core/domain-service.ts | Named project/metadata/clip/pin/annotation/presentation/trash commands using the existing shared repositories. |
| core/repository-directory.mjs | Trusted filesystem adapter and serialization for those repositories. |
| core/project-store.mjs | Opaque capabilities, portable paths, queues, bounded reads, staged writes, revisions, streams and revocation. |
| core/media-server.mjs | Loopback capability URLs with Range, HEAD and exact Origin checks. |
| core/sidecar-proxy.mjs | Per-window CV proxy limited to health, owned-reference detection/tracking/homography and reference cleanup. |
| core/recording-export.mjs | Window/project-owned recording sessions, private sidecar encoding calls, confined MP4 writes and session cleanup. |
| core/service-supervisor.mjs | Explicit executable startup without a shell, readiness deadlines, cancellation, rollback and owned-process shutdown. |
| core/user-state.mjs | Atomic native preferences and canonical-project-scoped pin annotation recovery copies; pending-write drain. |
| core/service-parent.cjs | Private lifetime-pipe handling for the renderer service after main-process death. The sidecar has an equivalent Python watcher. |
| core/node-service-executable.mjs | Selects the background Electron Helper for macOS Node-mode services; other platforms keep the main executable. |
| core/resource-layout.mjs | Packaged architecture/resource/checksum validation and writable directories outside the bundle. |
| scripts/stage-runtime.mjs | Target-specific Python, dependencies, model/source, renderer and media-tool assembly. |
| scripts/package-desktop.mjs | Electron packaging, unsigned installers and final Mac runtime checksum sealing. |
| scripts/opencv-macos-evidence.mjs | Read-only wheel fingerprint checks, original Homebrew bottle verification and recipe provenance staging; not a runtime startup restriction. |
| scripts/prepare-license-sources.mjs | Checksum-pinned source/notices collection, with a checksum-checked curl fallback for upstream HTTP-client rejections. |
| scripts/cargo-source-inputs.mjs | Expands explicitly pinned Cargo locks into checksum-verified crate sources/notices without dependency resolution or executing build scripts. |
| scripts/check-lgpl-replacement.mjs | Isolated Mac libsoxr replacement, real-video decode parity and audio resampling check; never modifies the original runtime. |
| core/project-connection.mjs | Independently tested lower-level transport contract. The final preload uses domain commands, not its generic document writer. |

The isolated preload selects the native adapter in webapp/lib/host/desktop; ordinary browsers retain their browser adapter. Plain error replies are reconstructed as DOM errors in the renderer so shared missing-file handling works. Methods, mutator callbacks and native directory handles never cross IPC.

The 2026-10-26 native compliance pass adds original Homebrew build evidence for 62 of 65 Mac OpenCV dylibs, 47 archived recipes/base sources, identified patches, GLib's exact GVDB subproject, JPEG XL's sjpeg resource and all 227 rav1e locked registry crate archives. Separate source evidence contains 316 Mac / 46 Windows inputs. An isolated modified libsoxr replacement passed ten upstream tests, real-video decode parity and audio resampling; all 70 desktop tests pass. For those historical wheel-based binaries, the three unmatched libraries and remaining transitive source/relinking issues remain listed in [distribution compliance](../docs/distribution-compliance.md); this is not release clearance. Existing runtime binaries and installers are unchanged.

## Persistence And Media

Authoritative writes run through named main-process commands and the shared schema validators, clip locks, pin-anchor checks, tombstones and trash operations. Generic renderer writes are limited to auxiliary export/cache directories. Clip and manifest edits merge permitted changed fields and check original window baselines for stale same-field edits. Pin documents and presentations use whole-document revision conflicts. Reopening a clip or pin focuses its existing project-owned window. Opening another project cannot redirect that editor.

Media files are renderer metadata capabilities, not whole-video Blobs. Playback, pin rasterization, thumbnails and report exports use range-backed URLs; accidental whole-file Blob reads fail explicitly. The trusted host registers authorized paths with the managed sidecar. Unregistering a native reference never deletes the source. Import uses the existing preserve/remux/transcode decision, reports preparation and copy progress, supports cancellation, stages the copy and commits the manifest or rolls back. It avoids the browser upload/download round trip.

The sidecar's private bearer token stays in the host. Renderers receive separate proxy tokens scoped to their window's video references. Private /native/register and /native/import routes are unavailable in ordinary browser mode and cannot be reached through the proxy. Existing broad path-based sidecar endpoints remain available to the browser/developer workflow but are not forwarded to native pages.

Recording export does not expand that proxy. `recording.start/frame/finish/cleanup` commands own encoder sessions per window and project, validate dimensions/FPS, frame indices, JPEG payloads and output filenames, call the existing sidecar export API with the private host credentials, then copy the result into `exports/recordings/` through the native store. Neither arbitrary input paths nor the sidecar output path crosses renderer IPC. Closing the owning window discards its encoder sessions. Saved timing takes use normal clip/presentation repository writes; unfinished passes remain in renderer memory rather than the pin-recovery store.

The current source disables Ultralytics usage analytics and unused HUB integration before loading prediction callbacks. The packaged environment explicitly identifies its existing app-private settings directory, and the sidecar updates only `sync` and `hub`, including for older profiles. It does not change unrelated Ultralytics settings or disable model downloads. The runtime verification script uses the same initialization path. This fix is not yet included in the published desktop.2 installers; see [sidecar privacy settings](../sidecar/README.md#yolo-privacy-settings).

Closing an editor runs save guards before destroying the window. Pin autosave and pending clip/presentation writes are flushed. Unfinished trim/retrack/tracking sessions or save errors keep the window open unless the user explicitly discards. Quit waits for window closure and owned-service shutdown. Crashed/unresponsive editors and closes stalled for 15 seconds now offer explicit wait/reload/close choices. Lifetime pipes stop services after abrupt main-process death, and a single-instance lock avoids duplicate service sets for the same profile.

Locale and panel layouts persist atomically in native user data independently of renderer origins. Pin annotation recovery copies use canonical project/document paths and are written before authoritative saves. A newer differing copy prompts for restore or keeping the saved version; autosave cannot replace it until the decision. This is not every-keystroke or multi-file crash recovery, and does not migrate ambiguous older preview/browser backups. See [support and recovery](../docs/support.md) for the limitations and Help-menu diagnostics.

## Checks

The pre-commit checks for `ed70920` on 2026-11-24 passed 87 native contract tests, 481 web unit tests, TypeScript and zero-warning lint. Six targeted Chromium presentation/recording tests also passed during implementation. No installer was rebuilt for that commit. Dated package/runtime checks above apply to their stated builds; the current recording exporter still needs packaged and native Windows workflow validation before release.

```bash
npm run test:desktop
npm run test:electron
npm run test:electron-recovery
npm test
npm run test:e2e
```

Build the desktop renderer first. Native tests use real temporary directories and child processes. Electron tests use the production UI, native filesystem adapter and managed Python service; only OS chooser selection uses a fixture-path seam. Coverage includes project opening/import, separate clip/pin windows, video seeking, language changes without resetting the loaded video or rewriting clip data, drawing, disk persistence/reload, close-time autosave, annotated PNG reports, presentation save/playback, window deduplication and rejected IPC operations. The language regression checks decoded video pixels and media state, not the operating system's compositor; native-surface faults still require native screenshots or recordings. Model transport checks are not tracking-accuracy or homography-quality benchmarks.

The original standalone checks remain available:

```bash
npm run test:desktop-renderer
npm run test:desktop-services
```

They copy the renderer and optionally sidecar source outside the checkout, then exercise them in Chromium. They still use installed Python/dependencies/models. The macOS 14/Windows 2022 native-contract CI matrix passed with Node 22/24 on `09d51833` ([2026-09-22 run](https://github.com/PatrickJYKang/annotate/actions/runs/35775405345)). It does not certify Windows Electron, installer behavior, or CV compatibility.

## Browser Sessions

Browser sessions preserve annotate-db version 1, the handles store and raw project bookmark. Additional project-session:<id> handles identify folders through isSameEntry under a Web Lock. URLs/session storage bind each editor to its original project; a missing explicit session refuses fallback. Old registry entries are not pruned yet. Unscoped legacy annotation backups remain untouched but cannot safely be assigned to a project automatically.

Manifest/clip/document locks, change channels and backup keys include project scope. Reload old editors before using this build. Browser and desktop writers are not mutually locked across hosts: do not edit the same project in both simultaneously.

## Remaining Release Gates

- Verify the assembled Python/native libraries, ffmpeg/ffprobe and models on clean Apple Silicon macOS and Windows x64 machines. The manifest requires renderer, python, sidecar, ffmpeg, ffprobe, yolo, pnlcalib, keypoints and lines; file resources carry SHA-256 checksums. Finish distribution/license review before public release.
- Verify representative tracking, homography, long-video import/playback and cancellation through the native host, including Windows. The fixture smoke is not a clean-machine or CV-quality test.
- Verify clip/deck recording save, replay, silent MP4 output, mixed-video scaling and failure/close cleanup in the actual packaged native host. Browser recording coverage does not establish native Windows encoding or filesystem behavior.
- Multi-file crash recovery and uncommitted provisional tracking recovery remain incomplete. Native pin copies, crashed/hung-renderer handling and private-pipe cleanup cover specific failures, not every crash boundary.
- Native Quick Annotate scratch storage is not implemented; canonical project annotation is supported. Older ambiguous origin-local preferences/backups are not automatically migrated.
- Complete all-resource cross-window synchronization, capability release on navigation/project switching and project/session eviction. Native committed change notifications and editor deduplication are not a collaborative editing system.
- Complete publisher signing/notarization and clean-machine installer testing before claiming stable desktop support. Updates are manual through Help > Downloads and updates. Startup progress, resource checks and unsigned evaluation downloads exist; GitHub's Latest label does not close these gates. [Guide recordings](../docs/demo-recording-checklist.md) document their own completed and pending coverage.

The store rejects traversal, links, Windows drive/UNC/device/ADS names and case/Unicode collisions. It is not a race-proof sandbox against hostile local path replacement. Queues/revisions protect cooperating callers, not arbitrary external applications; other filesystems' replacement behavior needs separate validation. See [the implementation checklist](../plans/pre-electron-implementation-checklist.md).
