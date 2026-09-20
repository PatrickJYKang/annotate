# Desktop Preview

The Electron host runs the shared Annotate UI against native project files. Self-contained unsigned preview packages are built as `0.2.2-desktop.2` for Apple Silicon macOS and Windows x64. The package version is defined in `desktop/preview-version.mjs` and shared by packaging, notices and source archives. This is not a new stable release; the browser version and `v0.2.2` tag remain unchanged. Both hosts use the same project.v2 schemas, drawing code, frame contracts and repository rules.

## Install Preview

Download the Apple Silicon DMG from the [0.2.2 Desktop Preview 2 prerelease](https://github.com/PatrickJYKang/annotate/releases/tag/v0.2.2-desktop.2). Open the DMG and drag Annotate to Applications. The release also includes installation notes, a source archive and SHA-256 checksums. The earlier desktop.1 DMG is superseded and is not uploaded.

Local build artifacts are in `desktop/artifacts/installers/`, including the Windows x64 EXE, which is not attached to this Mac prerelease. On Windows, run the EXE installer and select an installation directory; the installer creates a desktop shortcut and can launch the application after installation. No separate Python, Node, Homebrew, ffmpeg or browser installation is required. The runtime and both CV models are bundled, so the first launch does not download models.

These packages have no verified publisher signature. The macOS app has an ad-hoc signature required for Apple Silicon, not Developer ID signing or notarization; Gatekeeper may require explicit approval. Windows can show an unknown-publisher/SmartScreen warning. Do not disable operating-system security protections globally. These are evaluation builds, not a signed stable desktop release. Windows packaging does not establish that the app runs correctly on Windows; native Windows testing is still required.

Initial targets are Apple Silicon with macOS 14 or newer and Windows 10/11 x64. Intel Mac and native Windows ARM packages are not included. macOS 14 is the compilation target, not a tested OS matrix. Allow several gigabytes for the installed app and additional space for project media and exports. Test with copies of existing projects; browser and desktop must not edit the same project simultaneously.

## Package

Build prerequisites on the packaging Mac are Node/npm, uv, Git, curl, Xcode command-line tools, make and pkg-config, plus the locked PnLCalib checkout/weights and YOLO weight used by the development setup. None of these build tools are needed by recipients. Set `ANNOTATE_PNLCALIB_ROOT` if the checkout is outside `sidecar/third_party/pnlcalib`.

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

Staging downloads checksum-verified Python 3.12.14 standalone builds, installs the existing sidecar lock for the target platform, and bundles pinned models/source. macOS ffmpeg 8.1.1 and x264 are compiled with four jobs against macOS 14 without Homebrew dylib dependencies. Their source archives, license texts and build recipe are included. Windows uses a checksum-verified ffmpeg 8.1.1 distribution and Windows-specific Python wheels. App-local Microsoft Visual C++ 14.44.35211.0 runtime DLLs, including MSVCP140 required by PyTorch, are extracted from Microsoft's checksum-pinned redistributable; no system-wide prerequisite install is performed. The traced renderer's optional image binaries are replaced with Windows versions for that target. Electron-builder 26.15.3 produces a DMG and NSIS installer without publishing them.

Runtime resources live under `Contents/Resources/runtime` on macOS and `resources/runtime` on Windows. Settings, caches, temporary files and service logs go under Electron's user-data directory outside the installation. Startup checks required resources and their checksums, displays service progress and launches the workspace. Signing changes executable hashes, so the Mac packager refreshes the manifest after nested signing and reseals the outer bundle.

```bash
node desktop/scripts/check-runtime.mjs desktop/build/darwin-arm64/runtime
ANNOTATE_TEST_PACKAGED_EXECUTABLE="/path/to/Annotate.app/Contents/MacOS/Annotate" npm run test:electron
```

The runtime check removes development search paths and executes actual detection, calibration and H.264 export on a fixture. It verifies model execution, not real-match tracking or homography quality. The Electron smoke accepts either the development executable or a packaged executable. Automated native-chooser fixtures are still used; these tests do not replace a clean-machine installation test.

The 2026-09-16 desktop.2 preview passed the Electron smoke directly from its read-only mounted Mac DMG with `PATH=/usr/bin:/bin`, as well as deep/strict ad-hoc signature and disk-image integrity checks. The Windows installer and its inner 25,328-file payload passed archive tests; recursive runtime checks verified 289 Mac and 251 Windows native binaries, resource hashes and internal-only symlinks. All 23 native-host contract tests and the standalone renderer build passed. Bundled Mac Python executed actual YOLO detection, PnLCalib inference and H.264 export. No Windows execution or clean-machine result is claimed. This is a refresh of the latest app code, not an installer-size or cold-start optimization release.

## Run

Use the existing webapp dependencies, Python environment, ffmpeg and models from the browser setup, then:

```bash
npm ci
npm run build:desktop-renderer
npm run desktop:dev
```

The desktop command rebuilds the trusted domain-service bundle and launches Electron 44.2.0. It uses a production renderer, not hot reload: rebuild the desktop renderer and restart after UI changes. Startup selects private loopback ports, starts the sidecar and standalone Next server, waits for readiness, then opens the workspace. It does not reuse or stop the browser preview. Electron's executable supplies the web server's Node runtime; no separate Chrome is required. The development command uses developer-provided Python, ffmpeg and models; installed packages use their bundled runtime exclusively.

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
| core/service-supervisor.mjs | Explicit executable startup without a shell, readiness deadlines, cancellation, rollback and owned-process shutdown. |
| core/resource-layout.mjs | Packaged architecture/resource/checksum validation and writable directories outside the bundle. |
| scripts/stage-runtime.mjs | Target-specific Python, dependencies, model/source, renderer and media-tool assembly. |
| scripts/package-desktop.mjs | Electron packaging, unsigned installers and final Mac runtime checksum sealing. |
| core/project-connection.mjs | Independently tested lower-level transport contract. The final preload uses domain commands, not its generic document writer. |

The isolated preload selects the native adapter in webapp/lib/host/desktop; ordinary browsers retain their browser adapter. Plain error replies are reconstructed as DOM errors in the renderer so shared missing-file handling works. Methods, mutator callbacks and native directory handles never cross IPC.

## Persistence And Media

Authoritative writes run through named main-process commands and the shared schema validators, clip locks, pin-anchor checks, tombstones and trash operations. Generic renderer writes are limited to auxiliary export/cache directories. Clip and manifest edits merge permitted changed fields and check original window baselines for stale same-field edits. Pin documents and presentations use whole-document revision conflicts. Reopening a clip or pin focuses its existing project-owned window. Opening another project cannot redirect that editor.

Media files are renderer metadata capabilities, not whole-video Blobs. Playback, pin rasterization, thumbnails and report exports use range-backed URLs; accidental whole-file Blob reads fail explicitly. The trusted host registers authorized paths with the managed sidecar. Unregistering a native reference never deletes the source. Import uses the existing preserve/remux/transcode decision, reports preparation and copy progress, supports cancellation, stages the copy and commits the manifest or rolls back. It avoids the browser upload/download round trip.

The sidecar's private bearer token stays in the host. Renderers receive separate proxy tokens scoped to their window's video references. Private /native/register and /native/import routes are unavailable in ordinary browser mode and cannot be reached through the proxy. Existing broad path-based sidecar endpoints remain available to the browser/developer workflow but are not forwarded to native pages.

Closing an editor runs save guards before destroying the window. Pin autosave and pending clip/presentation writes are flushed. Unfinished trim/retrack/tracking sessions or save errors keep the window open unless the user explicitly discards. Quit waits for window closure and owned-service shutdown. This is graceful-close protection, not crash recovery.

## Checks

```bash
npm run test:desktop
npm run test:electron
npm test
npm run test:e2e
```

Build the desktop renderer first. Native tests use real temporary directories and child processes. Electron tests use the production UI, native filesystem adapter and managed Python service; only OS chooser selection uses a fixture-path seam. Coverage includes project opening/import, separate clip/pin windows, video seeking, drawing, disk persistence/reload, close-time autosave, annotated PNG reports, presentation save/playback, window deduplication and rejected IPC operations. Model transport checks are not tracking-accuracy or homography-quality benchmarks.

The original standalone checks remain available:

```bash
npm run test:desktop-renderer
npm run test:desktop-services
```

They copy the renderer and optionally sidecar source outside the checkout, then exercise them in Chromium. They still use installed Python/dependencies/models. Native-contract CI is configured for macOS/Windows with Node 22/24 but has not yet run. It does not certify Windows Electron or CV compatibility.

## Browser Sessions

Browser sessions preserve annotate-db version 1, the handles store and raw project bookmark. Additional project-session:<id> handles identify folders through isSameEntry under a Web Lock. URLs/session storage bind each editor to its original project; a missing explicit session refuses fallback. Old registry entries are not pruned yet. Unscoped legacy annotation backups remain untouched but cannot safely be assigned to a project automatically.

Manifest/clip/document locks, change channels and backup keys include project scope. Reload old editors before using this build. Browser and desktop writers are not mutually locked across hosts: do not edit the same project in both simultaneously.

## Remaining Release Gates

- Verify the assembled Python/native libraries, ffmpeg/ffprobe and models on clean Apple Silicon macOS and Windows x64 machines. The manifest requires renderer, python, sidecar, ffmpeg, ffprobe, yolo, pnlcalib, keypoints and lines; file resources carry SHA-256 checksums. Finish distribution/license review before public release.
- Verify representative tracking, homography, long-video import/playback and cancellation through the native host, including Windows. The fixture smoke is not a clean-machine or CV-quality test.
- Add durable native recovery records, multi-file crash recovery, crashed/hung-renderer handling and abrupt main-process crash cleanup. Graceful quit and tombstones do not cover every crash boundary.
- Persist preferences independently of the renderer's dynamically assigned origin. Locale, panel layouts and recovery records remain origin-local. Native Quick Annotate scratch storage is not implemented; canonical project annotation is supported.
- Complete all-resource cross-window synchronization, capability release on navigation/project switching and project/session eviction. Native committed change notifications and editor deduplication are not a collaborative editing system.
- Complete updater behavior, publisher signing/notarization and clean-machine installer testing before a stable desktop release. Startup progress, resource checks and unsigned prerelease distribution exist. Guide videos remain deferred until desktop UI behavior settles.

The store rejects traversal, links, Windows drive/UNC/device/ADS names and case/Unicode collisions. It is not a race-proof sandbox against hostile local path replacement. Queues/revisions protect cooperating callers, not arbitrary external applications; other filesystems' replacement behavior needs separate validation. See [the implementation checklist](../plans/pre-electron-implementation-checklist.md).
