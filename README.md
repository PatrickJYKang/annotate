# Football Analysis Annotator

A stills-first web application for football match analysis. Built with **Next.js 14 (App Router)**, **React 18**, **TypeScript**, and **Konva** for canvas-based annotation.

Requires a **Chromium-based browser** (Chrome, Edge, Arc, etc.) for the File System Access API.

## Quick start
```bash
cd webapp
npm install
npm run dev
```

## Key features
- **Project folders** on disk (`.matchproj` convention) with a `project.json` manifest
- **Video import** and playback with frame-level stepping and an **editor-style zoomable timeline** (timecode ruler, mark pips, playhead, 1×–100× zoom)
- **Match metadata** — teams, teamsheets (CSV/TSV/paste import), period boundaries, football-data.org API import
- **Marks** at timestamps with a hierarchical **tagging system** (primary path + facet traits, driven by per-project `tagging-schema.yaml`)
- **Tag folder tree** — collapsible tree view grouping marks by schema, with drag-and-drop re-tagging and period-aware timestamps
- **Still capture** from video frames with automatic thumbnails
- **Annotation editor** (Konva canvas) — boxes, circles, arrows, text, polygons, highlights, perspective-aware placement
- **Clip editor** — video sub-clips with keyframe-animated annotations, interpolation engine, and timeline strip
- **ML sidecar** (Python) — YOLO+ByteTrack object tracking, Narya pitch homography, YOLO+MobileSAM person segmentation, ffmpeg video export
- **Foreground occlusion** — people rendered above annotations via sidecar segmentation masks
- **Video export** — frontend-driven frame rendering + sidecar ffmpeg encoding to MP4
- **Export** annotated PNGs and CSV/JSON reports
- **Dark monochrome UI** — Tailwind CSS v4, square design language, space-filling controls

## Sidecar (ML service)

The Python sidecar provides ML features (tracking, segmentation, homography, export). See [`sidecar/README.md`](sidecar/README.md) for setup and API documentation.

```bash
cd sidecar
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m annotate_sidecar   # http://127.0.0.1:8321
```

## Documentation
- `technical_document.md` – As-built technical specification (routes, schemas, workflows, persistence, styling)
- `MVP_Implementation_Plan.md` – Original MVP plan and milestones
- `plans/` – Per-deliverable implementation plans and post-MVP design docs (tagging schema, metadata screen, UI refresh, clips feature)
