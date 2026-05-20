# annotate

We have released [**our first stable pre-release**](https://github.com/PatrickJYKang/annotate/releases/tag/v0.1.0-pre.1) 🎉 Massively grateful to everyone who has supported this project to get it to this stage.

A web application for football match analysis across marks, stills, clips, and presentations. Built with **Next.js 14 (App Router)**, **React 18**, **TypeScript**, and **Konva** for canvas-based annotation.

Requires a **Chromium-based browser** (Chrome, Edge, Arc, etc.) for the File System Access API.

## Quick start

For a non-technical local install on macOS, download the Annotate 0.1 pre-release bundle and double-click `Install Annotate.command`.

From a terminal, you can also run:

```bash
bash install.sh
```

The installer bootstraps missing prerequisites where it can, clones Annotate, installs dependencies, and creates Desktop launchers. On a clean macOS machine it can install Homebrew, Git, Node.js, Python, and ffmpeg; if macOS asks for Command Line Tools, complete the system prompt and return to the installer. On macOS, double-click `Annotate.command` on your Desktop to run the app; from a terminal, run `app.sh`.

Requires a Chromium-based browser. If Chrome, Edge, Brave, Arc, or Chromium is missing, the installer stops and asks you to install Chrome from <https://www.google.com/chrome/>. The launcher also refuses to fall back silently to a non-Chromium browser.

The installer defaults to the pinned Git release ref `v0.1.0-pre.1`. It only installs missing system packages, skips Homebrew updates unless `ANNOTATE_BREW_UPDATE=1` is set, skips install-time tests unless `ANNOTATE_RUN_TESTS=1` is set, and skips repeat dependency installs when lockfiles have not changed. Terminal output is compact by default; set `ANNOTATE_VERBOSE_INSTALL=1` to stream full dependency logs while testing. Node dependencies install from `package-lock.json` via `npm ci`; sidecar dependencies install from `sidecar/requirements.lock.txt`.

If the installer fails after cloning the repo, you can run the app manually from the install folder:

```bash
cd ~/Documents/annotate
cd webapp && npm ci && cd ..
python3.12 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.lock.txt
npm run dev
```

If the installer fails before cloning, install Git, Node.js 18.17+, Python 3.10+ or 3.12, ffmpeg, and a Chromium-based browser first, then clone the release tag and run the same commands:

```bash
git clone --branch v0.1.0-pre.1 --single-branch https://github.com/PatrickJYKang/annotate.git ~/Documents/annotate
```

For development from an existing checkout:

```bash
npm run dev
```

If this is your first run, install the webapp dependencies first:

```bash
cd webapp
npm ci
```

## Workspace run command
From the repo root, `npm run dev` now launches both the Next.js webapp and the Python sidecar together. If the sidecar virtualenv exists at `sidecar/.venv`, that interpreter is used automatically; otherwise it falls back to `python3`.

## Current development focus
- Active work is currently centered on **clip analysis and presentation authoring/playback**: clip keyframing, highlight tracking, pitch homography, annotation import from stills, and presentation playback media.
- The sidecar-backed CV paths are live local workflows: `/track`, `/homography`, `/segment`, `/export`, and `/derived-media/exact-motion` all remain optional but supported when the sidecar is running with the relevant dependencies.

## Key features
- **Project folders** on disk with a `project.json` manifest and automatic integrity repair
- **Video import** and playback with frame-level stepping and an **editor-style zoomable timeline** (timecode ruler, mark pips, playhead, 1×–100× zoom)
- **Match metadata** — teams, teamsheets (CSV/TSV/paste import), football-data.org API import
- **Marks** at timestamps with a hierarchical **tagging system** (primary path + facet traits, driven by per-project `tagging-schema.yaml`)
- **Tag folder tree** — collapsible tree view grouping marks by schema, with drag-and-drop re-tagging
- **Still capture** from video frames with automatic thumbnails
- **Annotation editor** (Konva canvas) — boxes, circles, highlights, shadows, arrows, lobs, polygons, and text; linked stroke/fill defaults; PnLCalib or manual homography; multiple annotation documents per still
- **Clip editor** — video sub-clips with keyframe-animated annotations, interpolation engine (linear + Catmull-Rom), timeline strip, show/hide keyframes, pitch/image drawing modes, still-annotation import, and batch tracking
- **Presentations** — deck-like slide sequences built from stills, clips, and title cards; tag/time/clip asset browsing; drag-to-deck authoring; match-video transitions; annotation set timing; exact-motion transition and clip playback
- **ML sidecar** (Python) — highlight tracking via YOLO + vendored trackers OC-SORT, pitch homography via vendored trackers PnLCalib, segmentation/occlusion, clip export, and exact-motion derived media
- **Foreground occlusion** — people rendered above annotations via sidecar segmentation masks
- **Video export** — frontend-driven frame rendering + sidecar ffmpeg encoding to MP4
- **Derived media** — exact-motion video segments for presentation transitions and clip-slide playback preparation
- **Export** annotated PNGs and CSV/JSON reports
- **Dark monochrome UI** — Tailwind CSS v4, square design language, space-filling controls

## Sidecar (ML service)

The Python sidecar provides local video-processing endpoints for clip analysis and presentation playback media. See [`sidecar/README.md`](sidecar/README.md) for setup and API documentation.

```bash
cd sidecar
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.lock.txt
python -m annotate_sidecar   # http://127.0.0.1:8321
```

## Documentation
- [As-built technical specification](technical_document.md) – Current codebase and runtime behavior
- [Historical MVP plan](MVP_Implementation_Plan.md) – Original MVP planning document
- [Plans directory](plans/) – Historical per-deliverable implementation plans and post-MVP design docs

## Testing
```bash
npm run test          # Vitest unit/component-level tests
npm run test:e2e      # Playwright browser flows
```

Vitest excludes `webapp/e2e/**`; browser coverage lives under Playwright.
