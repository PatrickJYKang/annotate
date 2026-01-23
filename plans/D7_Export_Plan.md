# D7 – Export (Annotated PNGs + Reports) Implementation Plan

Date: 2025-12-23
Status: Planned
Target: Chromium desktop only

## Goals
- Export **annotated PNGs** for stills at **full source resolution**.
- Export **reports** (CSV + JSON) summarizing marks, stills, and annotation counts.
- Write all export artifacts into the project folder under `reports/`, using the File System Access API.
- Exports are **outputs only**. The editor must never treat export PNGs as inputs or source-of-truth.

## Output Locations & Naming
- Annotated stills: `reports/annotated/<stillFileBase>.png`
- Reports:
  - `reports/marks.csv`
  - `reports/marks.json`
  - `reports/annotations.json` (optional: per-still detail)

## Acceptance Criteria
- A user can trigger export from the UI (button/menu):
  - Export **all stills** in the project (MVP).
- For each still with annotations:
  - An annotated PNG is written at **exact still pixel dimensions**.
  - Visual output matches the editor rendering for:
    - Box, Circle, Arrow, Polyline, Highlight, Text
    - Colors, stroke width, fill opacity
    - Highlight occlusion of arrow/poly strokes
    - Arrow/poly snapping endpoints (using resolved anchored refs)
- Reports are written and include:
  - Video name/id
  - Mark timestamp (ms and formatted)
  - Tags
  - Still filename/path
  - Annotation counts (total + per type)
- Export is resilient:
  - Errors show a non-blocking message and do not corrupt the project.
  - Partial exports are allowed (failed stills are reported).

## Tasks
- [x] Implement an **annotation renderer** that can draw a still + shapes to a canvas at full resolution.
- [x] Implement export pipeline:
  - [x] Load still image as `ImageBitmap` (or `HTMLImageElement`) from project folder.
  - [x] Render annotated canvas.
  - [x] Encode PNG blob and write to destination file.
- [x] Implement reports:
  - [x] Build rows from manifest: videos, marks, stills, annotations index.
  - [x] Read per-still annotation sidecars and compute counts.
  - [x] Write CSV + JSON to `reports/`.
- [x] Add UI:
  - [x] Add "Export…" action (project toolbar or stills page).
  - [x] Show progress (simple: current/total + last file written).
  - [ ] Allow cancel (optional MVP).
- [ ] QA:
  - [ ] Verify output matches editor for representative scenes.
  - [ ] Verify works on 4K stills and 100+ stills without tab crashes.

## Technical Notes
- Rendering should be **resolution-correct**:
  - Canvas size must match the still image `width`/`height`.
  - Render with `stageScale = 1` and no pan/zoom.
- Suggested implementation paths:
  - **A) Canvas2D renderer (recommended)**: draw primitives directly to `CanvasRenderingContext2D`.
    - Pros: no Konva DOM dependency; easier to run in OffscreenCanvas.
    - Cons: must carefully match Konva styles (line caps/joins, text metrics).
  - **B) Konva export stage**: create a hidden `Konva.Stage` at full resolution and call `stage.toCanvas()` / `toDataURL()`.
    - Pros: reuses existing Konva shape config.
    - Cons: depends on DOM and Konva internals; might be slower for bulk export.
- Highlight occlusion should match editor:
  - If using Canvas2D, implement mask behavior for highlight shapes affecting arrow/poly strokes.
- File I/O:
  - Use existing project folder handle helpers.
  - Ensure destination directories exist: `reports/`, `reports/annotated/`.

## Out of Scope (D7)
- Video burn-in exports.
- ZIP packaging / `.annotzip` bundles.
- Cloud sharing.
- Full templated report generator UI.

## Rollback Plan
- Export is additive (writes to `reports/`); rollback is deleting generated outputs.
