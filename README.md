# Football Analysis Annotator

A stills-first web application for football match analysis. Built with **Next.js 14 (App Router)**, **React 18**, **TypeScript**, and **Konva** for canvas-based annotation.

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
- Active work is currently centered on **video loading and presentation playback media**: original-video serving, exact-motion transition clips, and the supporting derived-media plumbing around presentation playback.
- **Clip authoring and CV-on-clips features are currently on hold.** The code and routes remain in the repo, but tracking, segmentation, homography, occlusion, and clip-export workflows should be treated as paused workstreams until revisited.

## Key features
- **Project folders** on disk (`.matchproj` convention) with a `project.json` manifest and automatic integrity repair
- **Video import** and playback with frame-level stepping and an **editor-style zoomable timeline** (timecode ruler, mark pips, playhead, 1×–100× zoom)
- **Match metadata** — teams, teamsheets (CSV/TSV/paste import), period boundaries, football-data.org API import
- **Marks** at timestamps with a hierarchical **tagging system** (primary path + facet traits, driven by per-project `tagging-schema.yaml`)
- **Tag folder tree** — collapsible tree view grouping marks by schema, with drag-and-drop re-tagging and period-aware timestamps
- **Still capture** from video frames with automatic thumbnails
- **Annotation editor** (Konva canvas) — boxes, circles, arrows, text, polygons, highlights, perspective-aware placement; supports multiple annotation documents per still
- **Clip editor** — video sub-clips with keyframe-animated annotations, interpolation engine (linear + Catmull-Rom), and timeline strip; currently on hold as an active workstream
- **Presentations** — deck-like slide sequences built from stills, clips, and title cards; tag-tree-driven asset browser; match-video transitions; annotation set timing; exact-motion transition playback
- **ML sidecar** (Python) — exact-motion encoding is part of the current video-loading / derived-media work; clip-CV features such as tracking, homography, segmentation, occlusion, and clip export are currently on hold
- **Foreground occlusion** — people rendered above annotations via sidecar segmentation masks
- **Video export** — frontend-driven frame rendering + sidecar ffmpeg encoding to MP4; currently on hold with the broader clip/CV toolchain
- **Derived media** — exact-motion video segments for presentation transitions; this is the current active area of work
- **Export** annotated PNGs and CSV/JSON reports
- **Dark monochrome UI** — Tailwind CSS v4, square design language, space-filling controls

## Sidecar (ML service)

The Python sidecar provides local video-processing endpoints. Current work is focused on presentation video loading / exact-motion derived media; clip-oriented CV endpoints remain in the repo but are presently on hold. See [`sidecar/README.md`](sidecar/README.md) for setup and API documentation.

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
