# Pre-Electron Implementation Checklist

Date: 2026-09-04

Status: Development returned to `main` on 2026-09-16; `codex/pre-electron` is no longer the working branch. This work started from `v0.2.2` (`b14783b1`). Browser host/session isolation, a native Electron host and self-contained unsigned preview packaging are implemented. Initial targets remain Apple Silicon macOS and Windows x64. User installation trials have taken place on Mac and Windows, but installation/startup performance, broader platform verification and the unchecked release gates below remain open; moving branches does not mark them complete.

This checklist implements the direction in [Desktop Application Direction](desktop-application-direction.md). Completed steps must preserve project compatibility and browser workflows. There is no project-schema migration, UI redesign, browser version bump or movement of existing tags. The refreshed desktop packages use the separate preview version `0.2.2-desktop.2`; its Mac DMG is distributed under the new `v0.2.2-desktop.2` prerelease tag. Windows desktop.2 and superseded desktop.1 artifacts remain available locally. Electron 44.2.0, esbuild 0.28.2 and electron-builder 26.15.3 are pinned root development dependencies. The sidecar dependency lock is unchanged; packages bundle Python 3.12.14.

Markers: `[x]` implemented and locally verified; `[-]` partly implemented or awaiting platform/integration verification; `[ ]` not done. [Desktop Foundations](../desktop/README.md) records the module contracts, mutable-resource inventory, commands, and limitations.

## 1. Browser host and storage boundary

- [x] Introduce renderer-facing `AppHost`, `ProjectDirectory`, `ProjectFile`, `ProjectWritable`, and editor-window contracts without Electron or native filesystem types.
- [x] Wrap browser directory/file handles rather than passing them through React and repository interfaces. Preserve native errors, permission checks, file/blob reads, write-close behavior, and recursive removal semantics.
- [x] Route project folder pickers, video selection, quick-annotate scratch storage, and editor-tab opening/closing through the browser host.
- [x] Preserve synchronous blank-tab reservation before asynchronous pin creation and navigation; preserve blocked-popup handling and closing on failure.
- [x] Move browser bookmarks into the host implementation. Keep IndexedDB database `annotate-db`, version 1, store `handles`, key `project`, and the raw native-handle value format unchanged.
- [x] Keep manifest/clip validation, Web Locks, tombstones, trash operations, and project-open integrity checks in their existing shared repositories.
- [x] Exercise the filesystem adapter in existing repository tests and add focused capability, permission, error, binary-write, path, and window tests.
- [x] Add a boundary regression test that rejects direct native handles, pickers, and editor-window calls in product code outside the host implementation.
- [x] Verify the full browser suite, production build, lint, and typecheck before completing this stage.

`webapp/lib/host/index.ts` selects the native adapter only when the isolated preload exists; normal browsers retain their adapter. Tokens and serializable commands cross IPC, not native handles or mutator callbacks. Native media uses range-backed URLs rather than whole-video IPC payloads.

## 2. Project sessions and write ownership

- [x] Introduce explicit browser project-session identity independent of the globally remembered project. Editor URLs and tab storage retain the originating project through route changes and refresh; missing explicit sessions refuse fallback.
- [x] Serialize session registration using native `isSameEntry` comparisons and a registry Web Lock. Preserve raw legacy bookmarks and prevent stale asynchronous open/restore/close results from repopulating context.
- [x] Inventory mutable resources beyond clip documents: manifest, board, presentations, annotation backups, homography cache, application preferences, media, exports, trash, and scratch data.
- [x] Scope manifest/clip/pin-document Web Locks and clip/annotation change channels and backup keys to the project. Preserve repository tombstones and late-save refusal.
- [x] Test same resource ids in separate projects, independent locks/notifications, project switching, editor refresh, and missing-session behavior. Keep existing browser repository deletion/late-save and cross-tab tests passing.
- [x] Define and integrate serializable domain mutation commands. Shared repositories execute in the host; clip/manifest fields check window baselines, pin/presentation saves check document revisions, and raw authoritative writes are denied. Stale cross-window writes are exercised through actual Electron IPC.
- [-] Provide committed change notifications for all resources. Clip and pin-save notifications are scoped; manifest, presentation, board, and native revision event protocols still need implementation.
- [-] Test project-close ordering. Native window ownership, save guards, pin autosave flush and owned-service shutdown are integrated and tested. Crashed/hung-renderer recovery and abrupt main-process termination remain release gates.

The browser no longer uses one global project identity for editors. Closing one tab does not revoke sibling sessions. Native clip/pin windows deduplicate by project/resource. Session pruning and durable native recovery remain open; old unscoped backups cannot safely be assigned to projects. Reload old editors before using the new lock namespace. Browser and desktop writers must not simultaneously edit the same folder: their locks are not cross-host.

## 3. Native filesystem boundary

- [x] Implement trusted-process filesystem primitives and a serializable, per-window/per-project connection using opaque project/file capabilities. Reject unknown operations, extra fields, project substitution, and foreign file tokens.
- [x] Validate portable paths and reject project-contained symlinks, Windows drive/UNC paths, alternate data streams, traversal, reserved device names, and case/Unicode collisions. Test actual filesystem behavior on the local Mac.
- [x] Add bounded document/binary reads, streamed media, create-only or revision-checked JSON replacement, temporary-file cleanup, capability revocation, and structured filesystem error codes.
- [-] Run filesystem contracts against real directories on macOS and Windows. Local Mac primitives, shared repository tests and Electron persistence flows pass; the configured macOS/Windows Node 22/24 CI matrix has not run.
- [x] Connect the native AppHost/repository adapter using named domain commands, narrow auxiliary-file writes and reconstructed DOM errors. No arbitrary native callback or path-based host operation is exposed.
- [ ] Verify that a native-written project opens and edits in the browser and vice versa, without schema conversion.

The native store serializes cooperating calls and detects stale document revisions. It is not an OS-wide lock, multi-file recovery journal, or race-proof sandbox against a hostile local process swapping path ancestors. These distinctions must remain explicit when wiring the eventual preload and domain service.

## 4. Media and service lifecycle

- [x] Separate runtime connection configuration from build-time `NEXT_PUBLIC_SIDECAR_URL`; support validated launch-time endpoints and session headers while preserving browser defaults and existing overrides.
- [x] Introduce a service supervisor with readiness deadlines, progress/log/failure events, cancellation, startup rollback, and shutdown. It launches explicit executables without Bash or npm; packaged builds resolve bundled executables instead of developer paths.
- [x] Exercise actual child-service startup/failure/cleanup and the production renderer plus real authenticated sidecar on macOS. The app's clip editor successfully polls health, registers video, and loads the video using launch-time configuration.
- [x] Connect native project playback, pin rasterization, thumbnails and report exports to range-capable media URLs. Browser object URLs/uploads remain unchanged; native source reads avoid whole-video buffering.
- [-] Pass authorized paths privately to the sidecar. Real preserve import, frame metadata, seeking, YOLO detection, PNG export and initial import cancellation pass through Electron. Full tracking/homography quality, remux/transcode cancellation and long-video native parity remain to verify.
- [x] Protect native services with a trusted per-window proxy and private upstream token. Only owned-reference health/detection/tracking/homography/cleanup routes are forwarded; path APIs and private native routes are denied. Tests cover auth, origin, ownership and streaming.
- [ ] Test Windows child/grandchild cleanup and real CV/export jobs, including application crash recovery and quit behavior.

## 5. Packaged resource preparation

- [x] Inventory the resource categories and existing locked inputs in `desktop/README.md`; explicitly separate renderer assets, Python/native dependencies, model source/weights, media binaries, and license/notice material.
- [x] Add opt-in Next standalone output, asset copying, and real Chromium smoke checks of the copied production renderer outside the checkout.
- [x] Add staged-resource manifest validation for platform/architecture, relative paths, file checksums, model-path consistency, and writable locations outside the bundle. Tests cover aliases, wrong architecture, and tampered weights without writing inside resources.
- [x] Relocate writable caches/logs/temp/settings and remove source-directory assumptions. The complete Mac app passes its Electron smoke from a read-only DMG with a temporary user-data directory and restricted executable search path. Windows runtime verification remains a separate gate.
- [x] Prove self-contained launch outside the checkout on the local Mac. The read-only DMG uses bundled Electron/Python/dependencies/models and compiled media tools, with no Homebrew dylib dependencies. This is not a clean-machine or Windows result.
- [-] Assemble relocatable Python, native libraries, ffmpeg/ffprobe, model files, checksums, and notices per target architecture. Apple Silicon and Windows x64 staging and unsigned packaging exist. Windows runtime and final distribution-license verification remain outstanding.
- [ ] Test representative CV and export jobs on Windows before advertising compatibility. Existing macOS tests are not evidence of Windows native-library compatibility.

## 6. Electron shell and distribution gates

- [x] Add a runnable Electron development shell with sandboxed/context-isolated windows, narrow preload and no renderer Node integration. Production renderer and Python services are managed on private dynamic ports.
- [-] Implement project-owned clip/pin windows, focus-existing, native dialogs, menus and graceful close/quit. Local Mac flows pass; OS dialog interaction, failure/discard UX and Windows behavior require manual/platform testing.
- [-] Add real Electron startup/window/persistence/media/import/export/presentation/security/shutdown tests while retaining browser coverage. Abrupt process crashes and recovery are not yet covered.
- [-] Build and test self-contained macOS and Windows artifacts on clean machines without Node, Python, Homebrew, ffmpeg, or a separate Chrome installation. DMG/NSIS generation and restricted-search-path Mac checks exist; this is not yet a clean-machine or Windows test result.
- [x] Display startup progress while checking resources and starting packaged services.
- [ ] Add signing/notarization and platform installer/update handling before a stable desktop release. Unsigned prereleases remain evaluation builds. App Store distribution remains out of scope.

## 7. User guide

- [ ] Update written host-specific instructions as native window/file behavior lands.
- [ ] Record and insert guide videos after the desktop UI is settled. Keep the current video placeholders until then.

## Verification log

2026-09-19, desktop prerelease publication: prepared the existing, checksum-verified desktop.2 Mac DMG for the separate `v0.2.2-desktop.2` GitHub prerelease. The release commit records packaging/version changes and updates the README, offline guide, technical reference and desktop installation documentation. Its source archive includes the offline guide and third-party notices. The release attaches the latest Mac DMG, installation notes, matching application source and release-specific checksums; superseded desktop.1 and the Windows installer are not attached. Publication does not claim new runtime testing, signing, Windows certification or a startup-performance fix. Existing stable releases and tags remain unchanged.

2026-09-16, desktop.2 packaging refresh: generated new Apple Silicon DMG and Windows x64 NSIS installers from main `140ec2c4` plus the packaging/version changes, retaining the desktop.1 installers. The preview version is centralized in `desktop/preview-version.mjs`; staging replaces the sidecar source tree so deleted modules cannot survive a refresh. The standalone production renderer build and all 23 native-host contract tests pass. The actual Mac package passes deep/strict ad-hoc signature verification, DMG integrity verification and the full Electron smoke from its read-only mounted DMG with `PATH=/usr/bin:/bin`; the temporary test project and services are cleaned up afterward. Separate bundled-runtime checks execute YOLO detection, PnLCalib inference and H.264 export. Native verification checks 289 Mac and 251 Windows binaries; the Windows NSIS container and its inner 25,328-file payload pass archive tests. The Windows package's embedded app version is verified as `0.2.2-desktop.2`. Installation notes, source archive and SHA-256 checksums accompany the files. This does not certify Windows execution or clean-machine installation, and does not reduce the large runtime footprint or resolve the earlier Windows cold-start delay. No release is published, tag moved or installed app replaced.

2026-09-16, return to main: 356 Vitest tests, 92 sidecar tests, 23 native-host contract tests and all 46 Chromium browser tests passed locally. Strict ESLint, TypeScript, the production web build and diff checks passed. Browser coverage includes automatic project-handle sharing between editor tabs, revoked-permission recovery without reselecting a folder, per-project isolation, import progress/cancellation, tracking preview and timeline selection. The pre-push pass updated the old permission-clearing assertion and made undo/presentation persistence assertions await completed writes. This is source verification, not a new signed desktop release or a fresh packaged-app/Windows certification. Generated installers, recordings and local diagnostic output are excluded from Git. The browser preview remains on port 3100 with sidecar port 8321; existing release tags remain unchanged.

2026-09-04, desktop packaging pass: generated `0.2.2-desktop.1` Apple Silicon DMG and Windows x64 NSIS installer. The Mac app passes deep/strict ad-hoc signature verification, DMG integrity verification and the full Electron smoke launched from the read-only mounted DMG with `PATH=/usr/bin:/bin`. The smoke waits for the presentation video to finish loading before testing Play. Separate restricted-environment runtime checks execute YOLO detection, PnLCalib inference and H.264 export with bundled Python 3.12.14. Recursive checks inspect 289 Mac and 251 Windows native binaries, resource hashes and symlinks; the Windows NSIS container and inner 25,326-file payload pass archive tests. App-local Microsoft C++ DLLs are bundled. This does not certify Windows execution, macOS 14 compatibility, clean-machine installation or real-match CV quality. Both packages are unsigned private previews; publisher signing, notarization and platform testing remain open. Source archives and installation notes accompany the files; no release is published or tag moved.

2026-09-04, native integration pass: 305 Vitest tests across 52 files, 49 Python tests, 22 native contract tests and all 38 browser Playwright flows pass locally. Strict lint, TypeScript, browser production and standalone production builds pass. The actual Electron smoke passes project import/cancellation, native editor/pin windows, video seeking and drawing, disk persistence/reload, pin autosave on close, real YOLO detection request, report PNG export, presentation save/playback, window deduplication, stale-write conflicts, IPC denial checks and owned-service shutdown. Test videos are fixtures and OS chooser selections use main-process test seams; no CV quality benchmark, clean-machine app or Windows result is claimed. Electron startup evaluation, serialized error types, close-before-autosave and reentrant quit races found by this run are fixed. The version/tag remain unchanged and work is uncommitted.

2026-09-04, extended preparation pass: 302 Vitest tests across 51 files, 46 sidecar tests, 18 native-foundation tests, and all 38 Playwright Chromium flows passed on the local Apple Silicon Mac. Strict ESLint, TypeScript, normal production build, and standalone production build passed. The standalone renderer smoke and extended authenticated-sidecar check passed in real Chromium outside the source checkout. Native tests use actual temporary files and child processes, including revocation of queued file reads; the browser's project-switch test uses actual OPFS and IndexedDB handles. Windows CI is configured but not yet executed. Version and tag remain `0.2.2` / `v0.2.2`.

The extended browser suite used ports 3200/8521; the refreshed user preview uses 3100/8321 because port 3000 belongs to another project. Service smoke tests allocate loopback ports and clean up their temporary source copies, fixture data, and owned processes. No unrelated project/server or branding work is modified.

2026-09-04, initial host-boundary pass: 297 Vitest tests across 49 files, 42 sidecar tests, and all 37 Playwright Chromium flows passed. TypeScript, strict ESLint, the production build, and `git diff --check` passed. Browser flows include restoring native IndexedDB handles, denied/stale permissions, creating projects without overwriting existing data, import, clip/pin tabs, drawing, tracking workflow, animation playback, presentation playback, exports, and user-guide navigation.

Playwright used ports 3100/8421 to avoid another project's running server on port 3000. The browser suite uses its existing fixture videos and sidecar mocks where configured; it is not a new CV accuracy benchmark. No Electron, Windows runtime, native-package, or clean-machine result is claimed by this pass. No dependencies, release version, or `v0.2.2` tag were changed.

Production-preview startup exposed an existing local resource-path dependency: this checkout has no `sidecar/third_party/pnlcalib`, and development discovers the sibling `trackers/third_party/pnlcalib` copy. The release startup check requires its expected directory or an explicit `ANNOTATE_PNLCALIB_ROOT`. The existing sibling copy passed the locked source-revision and both weight-checksum checks; the preview uses that supported override without downloading or modifying models. Stage 5 must remove this source-checkout dependency for packaged applications.
