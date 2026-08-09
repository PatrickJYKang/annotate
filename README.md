# Annotate

Annotate is a self-hosted football video analysis application for capturing
passages of play, drawing frame-accurate tactical analysis, tracking players,
and assembling presentations.

The released stable pre-release is
[Annotate 0.1](https://github.com/PatrickJYKang/annotate/releases/tag/v0.1.0-pre.3).
This checkout contains the in-development **0.2 implementation**, which uses a
new frame-native project format and is not data-compatible with 0.1 projects.

Annotate requires a **Chromium-based browser** such as Chrome, Edge, Brave,
Arc, or Chromium because project folders use the File System Access API.

## Released install (0.1)

For a non-technical local install on macOS, download the 0.1 release bundle and
double-click `Install Annotate.command`. From a terminal, run:

```bash
bash install.sh
```

The installer is pinned to `v0.1.0-pre.3`, bootstraps missing prerequisites
where possible, installs locked dependencies, and creates a Desktop launcher.
It stops with a link to Chrome if no supported browser is installed.

If the installer fails after cloning the repository, run the dependency and
startup commands directly from the installation folder:

```bash
cd ~/Documents/annotate
cd webapp && npm ci && cd ..
python3.12 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.lock.txt
npm run dev
```

If cloning itself failed, first install Git, Node.js 18.17 or newer, Python
3.10-3.12, ffmpeg, and a Chromium browser, then clone the release:

```bash
git clone --branch v0.1.0-pre.3 --single-branch \
  https://github.com/PatrickJYKang/annotate.git ~/Documents/annotate
```

## Development setup (0.2)

Install the webapp and sidecar dependencies from the checked-in lockfiles:

```bash
cd webapp
npm ci
cd ../sidecar
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock.txt
cd ..
```

Run both services from the repository root:

```bash
npm run dev
```

The Next.js app starts at `http://localhost:3000`; the Python sidecar starts at
`http://127.0.0.1:8321`. Video import in 0.2 uses the sidecar to obtain an
authoritative frame count and choose the least destructive browser-compatible
path: preserve compatible CFR H.264 MP4, remux compatible streams, or transcode
only incompatible/variable-frame-rate media.

## Project compatibility

Annotate 0.2 creates only `project.v2` folders. It deliberately refuses
`project.v1` folders and does not migrate them. Keep using the pinned 0.1
release for existing 0.1 work.

Every stored media position in 0.2 is an absolute, zero-based video frame.
Clip ranges are half-open (`[startFrame, endFrame)`). FPS, frame count, width,
and height belong to each video rather than the project, so mixed-FPS and
mixed-resolution clips can be used in one presentation.

## Current features

- **Local project folders** with a `project.json` manifest, project-handle
  restoration, open-time integrity reporting, and recoverable trash operations.
- **Observable, per-video import** that preserves compatible CFR H.264 MP4s,
  remuxes compatible streams without re-encoding video, and transcodes only as
  a fallback, with byte/media-time progress, Apple VideoToolbox acceleration,
  and a bounded four-thread software fallback.
- **Frame-native clip capture** from a configurable button board, including
  exact-frame start/stop range toggles, overlapping captures, live pending
  ranges, facets, hotkeys, untagged capture, paused re-tagging, and
  drag-and-drop re-tagging in the clip tree. The multi-lane tagging timeline
  opens at a one-minute view and supports horizontal zoom and scrolling.
- **Clip editor** with absolute-frame transport, keyframed tactical shapes,
  position and show/hide keyframes, manual keyframe retiming, horizontal timeline
  zoom, image/pitch coordinate modes, undo/redo, and persisted resizable panels.
- **Player tracking** for highlight objects through YOLO and vendored OC-SORT,
  with linked image-space tactical shapes following their highlight anchor.
- **Pitch homography** through vendored PnLCalib, interpolation and sanity
  filtering, video-namespaced project caching, and pitch-space box/circle
  authoring.
- **Clip-local pins** for important frames, with multiple annotation documents,
  the shared tactical annotation editor, five-second context preview, automatic
  or manual calibration, and explicit pin-document import into the animated clip
  layer.
- **Presentations** built from clips, pins, and distinct title-card templates,
  with source preview, a thumbnail storyboard, frame-native authoring transport,
  pin pauses, annotation cues, match-video transitions, direct source-video
  playback, scrubber-free full-screen playback, and graceful handling of
  missing references. Referenced clips can be opened in the clip editor in a
  new tab; saved changes refresh in presentation authoring.
- **Exports** written to `exports/report/`: clip JSON and CSV reports plus one
  native-resolution annotated PNG per pin annotation document. Individual render
  failures are reported without discarding successful outputs.
- **English, French, Spanish, and Simplified Chinese UI** with a persisted
  global locale. All four catalogs are structurally aligned; non-English copy
  still awaits native-speaker editorial review.
- **Standalone quick annotate route** at `/quick-annotate` for a single image.
  It is retained as a best-effort compatibility utility and is not part of the
  canonical `project.v2` workflow.

The Python sidecar owns smart media preparation, authoritative probing, tracking,
homography, optional foreground segmentation, and export encoding APIs. Its
exact-motion segment endpoint remains available as an export-oriented building
block but is not used by presentation playback. See the
[sidecar documentation](sidecar/README.md) for its endpoints and model
requirements.

## Technology

- Next.js 14 App Router, React 18, and TypeScript
- Konva and React-Konva for tactical annotation
- Tailwind CSS 4 and `react-resizable-panels`
- File System Access API, IndexedDB, and OPFS
- FastAPI, OpenCV, ffmpeg, Ultralytics YOLO, vendored OC-SORT, and PnLCalib
- Vitest, Playwright, and pytest

## Documentation

- [As-built technical reference](technical_document.md)
- [Annotate 0.2 scope](plans/v0.2/v0.2-scope.md)
- [Annotate 0.2 implementation ledger](plans/v0.2/implementation-plan.md)
- [Project v2 schema and migration decisions](plans/v0.2/project-v2-schema-and-migration.md)
- [Python sidecar setup and API](sidecar/README.md)
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
