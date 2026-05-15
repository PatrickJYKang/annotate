# Football Analysis Annotator

A web application for football match analysis across marks, stills, clips, and presentations. Built with **Next.js 14 (App Router)**, **React 18**, **TypeScript**, and **Konva** for canvas-based annotation.

Requires a **Chromium-based browser** (Chrome, Edge, Arc, etc.) for the File System Access API.

## Quick start
```bash
npm run dev
```

If this is your first run, install the webapp dependencies first:

```bash
cd webapp
npm install
```

## Workspace run command
From the repo root, `npm run dev` now launches both the Next.js webapp and the Python sidecar together. If the sidecar virtualenv exists at `sidecar/.venv`, that interpreter is used automatically; otherwise it falls back to `python3`.

## Current development focus
- Active work is currently centered on **clip analysis and presentation authoring/playback**: clip keyframing, highlight tracking, pitch homography, annotation import from stills, and presentation playback media.
- The sidecar-backed CV paths are live local workflows: `/track`, `/homography`, `/segment`, `/export`, and `/derived-media/exact-motion` all remain optional but supported when the sidecar is running with the relevant dependencies.

## Key features
- **Project folders** on disk (`.matchproj` convention) with a `project.json` manifest and automatic integrity repair
- **Video import** and playback with frame-level stepping and an **editor-style zoomable timeline** (timecode ruler, mark pips, playhead, 1×–100× zoom)
- **Match metadata** — teams, teamsheets (CSV/TSV/paste import), period boundaries, football-data.org API import
- **Marks** at timestamps with a hierarchical **tagging system** (primary path + facet traits, driven by per-project `tagging-schema.yaml`)
- **Tag folder tree** — collapsible tree view grouping marks by schema, with drag-and-drop re-tagging and period-aware timestamps
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
pip install -r requirements.txt
python -m annotate_sidecar   # http://127.0.0.1:8321
```

## Documentation
- `technical_document.md` – As-built technical specification for the current codebase and runtime behavior
- `MVP_Implementation_Plan.md` – Historical MVP planning document
- `plans/` – Historical per-deliverable implementation plans and post-MVP design docs

## Testing
```bash
npm run test          # Vitest unit/component-level tests
npm run test:e2e      # Playwright browser flows
```

Vitest excludes `webapp/e2e/**`; browser coverage lives under Playwright.
