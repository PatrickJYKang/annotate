# Annotate

A self-hosted football video analysis application for capturing passages of play, drawing frame-accurate tactical analysis, tracking players, and assembling presentations.

Download [Annotate 0.2.2 Desktop Preview 2 for macOS or Windows](https://github.com/PatrickJYKang/annotate/releases/latest). These are unsigned evaluation builds. Annotate 0.1 projects are not supported.

## Install

### macOS

Download [Annotate 0.2.2 Desktop Preview 2](https://github.com/PatrickJYKang/annotate/releases/download/v0.2.2-desktop.2/Annotate-0.2.2-desktop.2-mac-arm64.dmg) (976 MB). Requires an Apple Silicon Mac (M1 or later) running macOS 14 or newer. Open the DMG, drag Annotate to Applications, then launch it from Applications. Python, video tools, models and the browser engine are bundled; no terminal setup or separate browser is needed. Allow at least 3 GB for the application and additional space for the download, project videos and exports.

The app is ad-hoc signed, not Developer ID signed or notarized. macOS may require approval under System Settings > Privacy & Security; do not disable Gatekeeper globally. Automated packaged-app checks passed on the build Mac, but clean-machine and older-macOS coverage remain incomplete.

### Windows

Download the [Windows x64 installer](https://github.com/PatrickJYKang/annotate/releases/download/v0.2.2-desktop.2/Annotate-0.2.2-desktop.2-win-x64.exe) (930 MB). Requires Windows 10 or 11, x64. Run the installer, choose an installation folder, then open Annotate using its desktop shortcut. Python, video tools and models are bundled; no separate development tools or browser are required.

The installer has no verified publisher signature, so SmartScreen or organizational security policies may warn or block it. Do not disable Defender. Installation and the first launch can be slow. The previous preview was tried on Windows; this refreshed build passed packaging checks but still needs Windows runtime testing.

### Requirements and limitations

- 8 GB RAM is the practical minimum; 16 GB or more is recommended for tracking and homography. A discrete GPU is not required.
- Allow at least 3 GB for the installed app, additional temporary space for installation, and separate space for project videos and exports.
- Intel Mac, native Windows ARM and Linux desktop packages are not provided.
- These remain evaluation builds despite GitHub's Latest label. Use project copies for testing and do not edit one project in browser and desktop simultaneously. First launch can take longer while bundled libraries initialize.

See [installation notes and log locations](desktop/INSTALL-preview.md). Command-line browser installation is archived under [legacy/browser-install](legacy/browser-install/README.md).

## Development

The browser and desktop app share the UI and project format. See [development setup](docs/development.md) for the browser preview and tests, and [desktop development and packaging](desktop/README.md) for Electron. Browser development remains supported; only the old end-user installation path is archived.

## Features

- **Local project folders** with a `project.json` manifest, project-handle restoration, open-time integrity reporting, and recoverable trash operations.
- **Observable, per-video import** that preserves compatible CFR H.264 MP4s, remuxes compatible streams without re-encoding video, and transcodes only as a fallback, with byte/media-time progress, Apple VideoToolbox acceleration, and a bounded four-thread software fallback.
- **Frame-native clip capture** from a configurable button board, including exact-frame start/stop range toggles, overlapping captures, live pending ranges, facets, hotkeys, untagged capture, paused re-tagging, and drag-and-drop re-tagging in the clip tree. The multi-lane tagging timeline opens at a one-minute view and supports horizontal zoom and scrolling.
- **Clip editor** with absolute-frame transport, inward-only clip trimming with immediate undo, keyframed tactical shapes, position keyframes and tracker-managed visibility, manual keyframe retiming, horizontal timeline zoom, image/pitch coordinate modes, undo/redo, and persisted resizable panels.
- **Player tracking** for highlight objects through YOLO and vendored OC-SORT, with linked image-space tactical shapes following their highlight anchor and provisional re-tracking from any retained frame.
- **Pitch homography** through vendored PnLCalib, interpolation and sanity filtering, video-namespaced project caching, and pitch-space box/circle authoring.
- **Clip-local pins** for important frames, with multiple annotation documents, the shared tactical annotation editor, ordered per-shape entrance animations, five-second context preview, automatic or manual calibration, and explicit pin-document import into the animated clip layer.
- **Presentations** built from clips, pins, and distinct title-card templates, with source preview, a thumbnail storyboard, frame-native authoring transport, animated pin pauses, document cues, match-video transitions, direct source-video playback, scrubber-free full-screen playback, and graceful handling of missing references. Referenced clips can be opened in the clip editor in a new tab; saved changes refresh in presentation authoring.
- **Exports** written to `exports/report/`: clip JSON and CSV reports plus one native-resolution annotated PNG per pin annotation document. Individual render failures are reported without discarding successful outputs.
- **English, French, Spanish, and Simplified Chinese UI** with a persisted global locale. All four catalogs are structurally aligned; non-English copy still awaits native-speaker editorial review.
- **Standalone quick annotate route** at `/quick-annotate` for a single image. It is retained as a best-effort compatibility utility and is not part of the canonical `project.v2` workflow.

The Python sidecar owns smart media preparation, authoritative probing, tracking, homography, and export encoding APIs. Its exact-motion segment endpoint remains available as an export-oriented building block but is not used by presentation playback. See the [sidecar documentation](sidecar/README.md) for its endpoints and model requirements.

## Tech Stack

- Next.js 15 App Router, React 19, and TypeScript
- Konva and React-Konva for tactical annotation
- Tailwind CSS 4 and `react-resizable-panels`
- File System Access API, IndexedDB, and OPFS
- FastAPI, OpenCV, ffmpeg, Ultralytics YOLO, vendored OC-SORT, and PnLCalib
- Vitest, Playwright, and pytest

## Documentation

- **In-app user guide:** choose **User guide** in the app header. In a default browser development session it is also available at [`http://localhost:3000/userguide`](http://localhost:3000/userguide).
- [Offline user guide](USER_GUIDE.md)
- [Desktop preview installation](desktop/INSTALL-preview.md)
- [Desktop build and architecture](desktop/README.md)
- **[As-built technical reference](technical_document.md)**
- [Annotate 0.2 scope](plans/v0.2/v0.2-scope.md)
- [Annotate 0.2 implementation ledger](plans/v0.2/implementation-plan.md)
- [Project v2 schema and migration decisions](plans/v0.2/project-v2-schema-and-migration.md)
- [Python sidecar setup and API](sidecar/README.md)
- [Third-party software notices](THIRD_PARTY_NOTICES.md)
- [Documentation and historical-plan index](plans/README.md)
- [Historical MVP plan](MVP_Implementation_Plan.md)

## Verification

```bash
npm test                         # Vitest
npm run test:e2e                # Playwright (Chromium)
npm run build                   # production Next.js build
npm --prefix webapp run lint    # ESLint
(cd sidecar && .venv/bin/python -m pytest tests)
```

Vitest excludes `webapp/e2e/**`; browser coverage is owned by Playwright.
