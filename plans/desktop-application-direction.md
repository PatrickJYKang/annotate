# Desktop Application Direction

Date: 2026-08-10
Status: Adopted product and architecture direction; the Annotate 0.2.2 and user-guide prerequisites are complete, but desktop implementation has not started
Scope: Direction record, not an implementation checklist and not a definition of the remaining browser-release features or fixes

## Decision summary

Annotate will remain a stable and fully usable self-hosted browser application. A macOS desktop application will be added after the 0.2.2 feature release and its user-guide pass because a conventional app is easier for non-technical users to install, launch, update, and understand.

The browser application and desktop application are two hosts for one product, not separate product forks. They share the project format, domain model, editing behavior, renderers, sidecar contracts, and most of the React interface. Host behavior may differ when the operating environment offers a better convention: browser tabs can become native windows, selected panels can support Pop Out and Dock in the app, and browser file pickers can become native dialogs.

The first desktop distribution will be a directly distributed, signed, and notarized macOS application delivered as a DMG. Mac App Store distribution is explicitly deferred and is not a requirement for the desktop architecture.

## Release sequencing

Annotate 0.2.1 delivers inward clip trimming and post-track tail repair. Annotate 0.2.2 adds pin-annotation animations. Both continue to ship through the current browser-based installation path.

The user guide now covers the completed 0.2.2 browser product. Desktop implementation remains a separate next-stage decision rather than being mixed into the browser release; its useful starting point is this known-good, documented browser build with passing production tests.

The browser remains supported after the desktop application ships. It is not a temporary compatibility fallback, and desktop work must not quietly degrade its workflows or test coverage.

## Product model

The desktop application should feel like a native host for Annotate rather than a browser window with the address bar removed. This does not require rewriting the analysis product in native UI technology. Electron provides the application shell, Chromium renderer, process lifecycle, native windows, menus, dialogs, and distribution; the existing Next/React application remains the primary interface implementation.

The two hosts should follow these rules:

- Shared product behavior remains shared code.
- Platform-specific behavior is explicit and lives behind a small host boundary.
- The on-disk project format is identical in browser and desktop modes.
- A project created or edited by either host opens in the other without conversion.
- Host-specific features must degrade clearly when they do not exist in the browser; they must not create browser-incompatible project data.
- Public features should normally use the same product version across both hosts, with packaging build metadata used when a desktop-only revision must be distinguished.

## Desktop window model

The initial desktop window model should be deliberate rather than making every panel detachable.

- Opening a project creates one primary project workspace window.
- Opening a clip editor creates or focuses a dedicated clip window.
- Opening a pin annotation editor creates or focuses a dedicated annotation window.
- Opening the same clip or pin twice focuses its existing window instead of creating competing editors.
- Presentation playback can use a separate clean output window, including full-screen output on another display, while authoring or presentation controls remain elsewhere.
- Closing a project closes or detaches all windows owned by that project in a predictable order.
- Closing the last window follows normal macOS behavior: the application may remain running until the user quits it.

Selected panels may gain a Pop Out and Dock action. The first candidates are the tagging board, object inspector, and presentation controls because they can benefit from a second display or more working space. Pop-out behavior should render the same panel component in a dedicated window and synchronize its state through the project session; it should not attempt to move a live DOM node between windows.

Browser mode keeps its tab-based behavior. A shared host action such as `openClipEditor` can use `window.open` in the browser and an Electron window in the app. The visible editor and saved result remain the same.

## Native application behavior

The desktop host should add the operating-system behavior users reasonably expect from an application:

- A compact opening screen for recent projects, Create project, and Open project.
- Native project-folder, import, export, and Save As dialogs.
- File, Edit, View, Window, and Help menus with standard macOS shortcuts.
- Reveal in Finder for projects, media, exports, logs, and diagnostics.
- Dragging a project folder or supported video onto the application.
- Restoration of window positions, sizes, panel layouts, and the last project where safe.
- Project-aware background tracking, homography, and export jobs with progress, cancellation, completion notification, and failure details.
- Graceful startup and shutdown of all bundled services.
- An integrated route to the user guide and a simple Copy diagnostics or Open logs action.
- Update checks and signed application updates once the distribution pipeline is stable.

The app should remain fully local and usable offline after installation. Users should not need Node.js, Python, Homebrew, ffmpeg, a terminal, or a separately installed Chromium browser.

## Shared and platform-specific architecture

The following remain shared:

- Project schema and validation.
- Video, clip, pin, annotation, tagging-board, presentation, and export domain models.
- Frame mathematics and media timebase rules.
- Annotation and animated-clip renderers.
- Editor state transitions, history behavior, tracking application logic, and integrity checks.
- React components for tagging, clip editing, pin annotation, presentations, metadata, and project navigation.
- Sidecar request and response contracts.

The host boundary should cover only capabilities that genuinely differ:

- Project and file access.
- Opening, focusing, and closing resources or panel windows.
- Native dialogs, menus, notifications, and Finder integration.
- Application preferences and recent-project state.
- Sidecar and web-runtime lifecycle.
- Background-job reporting.
- Logs, caches, bundled resource locations, and updates.

Browser mode continues to use the File System Access API, persisted `FileSystemDirectoryHandle` values, browser locks, object URLs, and temporary sidecar video registrations where required by browser security boundaries.

Desktop mode should use a path-backed project filesystem adapter exposed through a narrow preload/IPC interface. Renderers should remain context-isolated with Node integration disabled. The main process, rather than individual windows, should own the project path, coordinate access, and serialize writes that could otherwise race across windows.

## Project coordination and multi-window safety

Multi-window editing is the most important behavioral difference and the largest correctness risk. Simply replacing `window.open` with `BrowserWindow` would allow multiple renderer processes to read stale documents and overwrite each other.

The desktop project session should therefore provide:

- One authoritative project identity and filesystem root.
- One writer or equivalent exclusive mutation path per mutable resource.
- Cross-window change notifications after successful persistence.
- Tombstone and trash awareness so a stale editor cannot recreate a deleted resource.
- Existing-window lookup by project and resource id.
- Project-close coordination and background-job ownership.
- Clear recovery when a renderer or helper process exits unexpectedly.

These guarantees should preserve the current browser repository semantics rather than introduce a second set of mutation rules.

## Media and sidecar integration

Electron should supervise the production web runtime and Python sidecar as application-owned child processes. Startup should expose meaningful progress, wait for health checks before opening the workspace, report actionable failures, and terminate helpers cleanly when the application quits.

Desktop mode can pass absolute project media paths to the local sidecar instead of uploading browser `File` objects into temporary registrations. The renderer should receive video through a controlled local protocol or equivalent range-capable media path so long match videos seek without being copied into memory or duplicated on disk.

Bundled resources such as ffmpeg, ffprobe, the Python runtime, YOLO, PnLCalib code, and model weights are read-only application resources. Mutable state belongs in conventional locations:

- Preferences and persistent application state under `~/Library/Application Support/Annotate`.
- Rebuildable data under `~/Library/Caches/Annotate`.
- Diagnostic output under `~/Library/Logs/Annotate`.
- Temporary registrations and working files under the operating-system temporary directory.
- User projects and exports in locations explicitly selected by the user.

The packaged ffmpeg build must be self-contained rather than copied from a Homebrew installation with unresolved Homebrew library paths.

## Development workflow

Development continues against the shared Next/React renderer and Python sidecar. Once desktop work starts, a desktop development command should launch the Next development server, sidecar, and Electron window together so ordinary development exercises the actual application host. The current browser development command remains available for fast renderer work and browser-specific verification.

Changes should not require duplicate implementations or duplicate full test suites. Tests are divided by responsibility:

- Vitest covers shared domain, rendering, repository, and component logic.
- Pytest covers sidecar services and CV boundaries.
- Playwright Chromium remains the broad end-to-end product suite and protects the supported browser version.
- A focused Electron integration suite covers application startup, native dialogs through test seams, project persistence, window creation and focusing, cross-window synchronization, helper lifecycle, and graceful shutdown.
- Release candidates receive a packaged `.app` smoke test rather than being validated only through a development Electron process.
- Clean-machine testing verifies that the application launches and performs representative tracking and homography without external runtimes or package managers.

Browser and desktop release gates should share fixtures where possible. Host-specific assertions should be layered around the same workflow rather than copying every browser scenario into a second suite.

## Distribution

The initial desktop release target is macOS. The preferred artifact is a signed and notarized DMG containing `Annotate.app`; a PKG is unnecessary unless installation later requires privileged or shared-system changes.

Apple Silicon and Intel builds should be distributed separately at first. A universal application would duplicate much of Electron, Python, PyTorch, OpenCV, and other architecture-specific native code while providing little benefit over two clearly labeled downloads.

The existing browser installer remains available for the supported self-hosted version and for platforms without a native Annotate build. Desktop downloads should become the recommended path for ordinary macOS users once they are stable.

Mac App Store distribution is deferred. It would require a separate Electron MAS build, App Sandbox entitlements, sandbox-compatible helper processes and project-folder access, App Review compliance, and legal review of distribution under the current GPL-3.0-only license. The desktop architecture should not be distorted around these constraints unless App Store demand later justifies a dedicated target.

## Current size and effort expectations

Local measurements after the dependency trim provide a more useful estimate than a generic Electron comparison:

- Clean Python/CV runtime: approximately 1.0 GB.
- PnLCalib runtime code and required weights: approximately 510 MB when development-only checkout material is omitted.
- Next production runtime: approximately 250-320 MB before final standalone tracing and pruning.
- Electron/Chromium: approximately 250-300 MB installed for one architecture.
- ffmpeg and ffprobe: approximately 52 MB for the current Homebrew distribution, with the final standalone build still to be selected.
- Current YOLO model: approximately 6 MB.

The initial expectation is approximately 2.0-2.4 GB installed for one architecture and approximately 1.2-1.6 GB as a compressed DMG. The repository's older 2.4 GB development virtual environment is not a shipping baseline because it still contains removed packages; the clean runtime is approximately 1.0 GB.

A basic development `.app` that starts the existing services is expected to require several focused days. A reliable self-contained Apple Silicon distribution with packaged CV dependencies, correct resource paths, lifecycle handling, and clean-machine verification is more reasonably a one-to-two-week packaging effort. These are directional engineering estimates, not release commitments.

## Principal risks

- Multi-window stale writes unless project persistence is centralized before windows proliferate.
- Python, PyTorch, OpenCV, Ultralytics, and PnLCalib freezing or signing failures caused by dynamic imports, bundled data, and native libraries.
- ffmpeg binaries that accidentally retain package-manager-specific dynamic library paths.
- Browser regressions caused by desktop assumptions leaking into shared components.
- Divergent behavior if host adapters implement different mutation or frame rules.
- Large downloads and updates caused primarily by CV runtimes and model weights rather than Electron itself.
- Renderer security regressions if broad filesystem or process access is exposed instead of a narrow preload API.
- Release failures that appear only in the packaged application rather than development mode.

## Open decisions for the desktop implementation phase

These decisions are intentionally left until desktop work begins:

- Whether PnLCalib weights ship inside every DMG or are checksum-verified during a first-run setup flow.
- Whether the production Next application runs as a bundled loopback server or behind a controlled application protocol.
- Which panels beyond the initial candidates provide enough value to justify Pop Out and Dock behavior.
- Whether Intel support launches with the first desktop alpha or follows the Apple Silicon build.
- The exact updater and GitHub Release publication flow.
- Whether a lightweight project bookmark or launcher file is worthwhile while the project itself remains an ordinary folder.

## Non-goals

- Rewriting Annotate in Swift, AppKit, or another native UI framework.
- Forking browser and desktop project formats or editor implementations.
- Removing or intentionally degrading the browser distribution.
- Defining the remaining browser-release feature and fix list.
- Targeting the Mac App Store in the initial desktop phase.
- Building mobile or touch-first applications.
- Making every existing panel detachable before concrete workflows demonstrate value.
