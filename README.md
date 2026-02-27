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
- **Video import** and playback with frame-level stepping
- **Match metadata** — teams, teamsheets (CSV/TSV/paste import), period boundaries, football-data.org API import
- **Marks** at timestamps with a hierarchical **tagging system** (primary path + facet traits, driven by per-project `tagging-schema.yaml`)
- **Tag folder tree** — collapsible tree view grouping marks by schema, with drag-and-drop re-tagging and period-aware timestamps
- **Still capture** from video frames with automatic thumbnails
- **Annotation editor** (Konva canvas) — boxes, circles, arrows, text, polygons, highlights, perspective-aware placement
- **Export** annotated PNGs and CSV/JSON reports

## Documentation
- `technical_document.md` – As-built technical specification (routes, schemas, workflows, persistence)
- `MVP_Implementation_Plan.md` – Original MVP plan and milestones
- `plans/` – Per-deliverable implementation plans and post-MVP design docs (tagging schema, metadata screen, etc.)
