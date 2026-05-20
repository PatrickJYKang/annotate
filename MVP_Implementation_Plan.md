# Football Analysis Annotator – MVP Implementation Plan (Web PWA)

Date: 2025-10-08

Historical note:
- This file is an original planning document, not the source of truth for the current implementation.
- For current runtime behavior, use `README.md`, `technical_document.md`, and `sidecar/README.md`.
- The body below intentionally preserves the original MVP assumptions, including items that are now superseded by clips, presentations, sidecar CV, and the current test setup.

## 0) Targets and Browser Support

- **Platforms**: Chromium-based desktop browsers (Chrome, Edge, Opera).
- **Baseline**: Chromium 110+.
- **Offline**: PWA installable; app shell works offline after first load.
- **Media**: Use `<video>` + Canvas; ffmpeg.wasm Worker for VFR/unsupported codecs.

## 0a) Phase Gate (Pre-Implementation)

- This plan is documentation-only until stakeholder sign-off.
- No source code, packages, or runtime scaffolding will be created before approval.
- After sign-off, we start at M0 with bootstrap tasks.

## 1) MVP Scope and Non‑Goals

- **In Scope**
  - **Project folder container** with `project.json`, `media/`, `stills/`, `annotations/`, `thumbnails/`, `reports/`.
  - **Video import** via File Picker and Drag & Drop; open/save directly to the chosen project folder.
  - **Playback + marking** with hotkeys (J/K/L, `M` to mark; 1–9 quick tags).
  - **Frame extraction** to PNG via Canvas from `<video>`; **ffmpeg.wasm** fallback for VFR/unsupported codecs.
  - **Annotation editor** using React-Konva (Canvas2D) with Arrow, Box, Circle, Polyline, Text.
  - **Selection, transform handles, z‑order, undo/redo** via Zustand command stack.
  - **Annotation persistence** to per-still JSON sidecars; project index in `project.json` within the folder.
  - **Export** clean and annotated PNGs; CSV/JSON reports written into the project folder (ZIP optional post‑MVP).
  - **Thumbnail grid** via virtualized list; cached thumbs in `thumbnails/`.

- **Out of Scope (Post‑MVP)**
  - Video overlays/burn-ins for clips (use ffmpeg.wasm/serverless later).
  - AI-assisted tagging, motion arrows/keyframing.
  - Cloud sync and external suite export formats beyond CSV/JSON.

## 2) Deliverables and Acceptance Criteria

- **D1: Project container (folder)**
  - Create/Open/Save a project folder. Auto-save writes directly into this folder.
  - `project.json` contains project metadata and schema version.

- **D2: Import + metadata**
  - Import MP4/MOV/WebM. Extract duration/fps via `<video>`; ffmpeg.wasm fallback when required.
  - Handle duplicate import by content hash.

- **D3: Playback + marks**
  - Play/pause, seek, shuttle (J/K/L). Add mark at current time with `M`. Assign numeric tags 1–9.
  - Sidebar list of marks with time, tags, and navigation.

- **D4: Stills + thumbnails**
  - Generate PNG still per selected mark using Canvas. Files named `000001.png`, etc., under `stills/`.
  - Generate cached thumbnails (≈400px width) under `thumbnails/` at still creation time.
  - Accurate frame capture (tolerance ≤ half frame duration). Use `requestVideoFrameCallback` where available; otherwise seek+draw.

- **D5: Annotation editor + persistence (combined)** [DONE]
  - Konva stage with pan/zoom. Create/edit Arrow, Box, Circle, Polyline, Text.
  - Selection, drag, resize, rotate; inspector for color/width/font size.
  - Undo/redo works for object create/delete/move/transform/style edits.
  - Auto-save annotations in `annotations/<still_id>.json` (schema v1) and update `project.json` index.
  - Re-opening the project rehydrates and renders identically from the project folder.

- **D7: Export**
  - Write clean PNGs and annotated PNGs into `stills/` matching source dimensions and sRGB profile.
  - Write CSV + JSON reports into `reports/` summarizing marks and annotations.
  - (Post‑MVP) Optional backup ZIP for sharing.

- **D8: Thumbnails grid**
  - Virtualized grid of stills reading cached thumbnails under `thumbnails/`. Scrolling stays smooth at 500+ items.

- **D9: Quality**
  - Unit tests for models; snapshot tests for annotation rendering; perf check on 4K stills.

- **D10: FFmpeg fallback**
  - ffmpeg.wasm integrated in a Web Worker; fallback used when native path cannot meet accuracy tolerance or codec unsupported.
  - Validated on VFR sample and at least one non-H.264 asset.

## 3) Milestones and Timeline (sequential, short iterations)

- **M0 – Bootstrap (0.5–1 day)**
  - Initialize Next.js 14 (TypeScript) with ESLint/Prettier, Tailwind or MUI, basic routing.
  - Set up PWA manifest + service worker scaffold.

- **M1 – Data model + storage (1–2 days)**
  - Define TypeScript types for Project, Video, Mark, Still, AnnotationRef.
  - Folder IO helpers for project folders (open/create/save) and minimal local index.

- **M2 – Import + metadata (1–2 days)**
  - File Picker + drag-drop. Copy/refer videos under `media/` within the project folder.
  - Extract duration/fps; update `project.json` index.

- **M3 – Playback + marking (2–3 days)**
  - `<video>` playback view, transport controls, keyboard shortcuts.
  - Mark list UI; add/remove, tagging 1–9; navigate to mark.

- **M4 – Stills extraction (1–2 days)**
  - Canvas capture at `t_ms`; write PNG blob; generate thumbnail.
  - Handle precision tolerances; retry with ffmpeg.wasm when needed.

- **M5 – Annotation editor + persistence (5–7 days)**
  - React-Konva stage; pan/zoom, hit-testing.
  - Shapes: Arrow, Box, Circle, Polyline, Text.
  - Selection, transform handles, z-order; undo manager in Zustand.
  - Sidecar v1 read/write; bind to canvas; change tracking + autosave.

- **M6 – Export (1–2 days)**
  - Annotated PNG render pipeline; CSV/JSON reports; write outputs to project folder.
  - (Optional, post‑MVP) backup ZIP creation.

- **M7 – Thumbnails grid (1 day)**
  - Virtualized grid with cached thumbnails; prefetching; selection UX.

- **M8 – Tests + perf (1–2 days)**
  - Unit + snapshot tests; quick perf benchmarks on 4K stills.

- **M9 – PWA + offline (0.5–1 day)**
  - Manifest, service worker caching strategy for app shell and assets.

- **M10 – Polish + QA (1–2 days)**
  - Keyboard shortcuts discoverability; inspector ergonomics; bug fixes.

## 4) Project Structure

Repository modules:
```
app/                    # Next.js app router pages
components/             # UI components (player, canvas, grids, inspector)
lib/                    # media utils, export, zip, schema helpers
store/                  # Zustand stores + undo layer
workers/                # ffmpeg.wasm worker, thumbnail worker
types/                  # TypeScript types for data model
public/                 # static assets, icons, manifest
schemas/                # JSON schemas
samples/                # sample export bundles
```

App modules:
- `AppShell` Next.js layout, toolbars, shortcuts.
- `Data` IndexedDB repositories, hashing, project index.
- `Media` `<video>` playback, canvas extraction + ffmpeg.wasm fallback.
- `Annotator` React-Konva canvas, tools, hit-testing, undo.
- `Export` Canvas burn-in, CSV/JSON, ZIP (JSZip).
- `Thumbs` Thumbnail generation (OffscreenCanvas), virtualized grid.
- `Tests` Unit, snapshot, e2e (Playwright).

Note: Modules are planned only. They will be scaffolded after sign-off (start of M0).

## 5) Data Model Details (TypeScript)

- **Project**: `id`, `name`, `created`, `settingsJSON`, `schemaVersion`.
- **Video**: `id`, `projectId`, `handleId | blobRef`, `durationMs`, `fps`, `hash`.
- **Mark**: `id`, `videoId`, `tMs`, `tags: string[]`.
- **Still**: `id`, `markId`, `fileName`, `width`, `height`.
- **AnnotationRef**: `id`, `stillId`, `zOrderTop`, `lastModified`.

Notes:
 - `project.json` is the project index. Annotation sidecars are the source of truth for annotation content.
 - Reconcile index and files on open/save within the project folder.

## 6) Annotation JSON v1 (Sidecar) – Canonical Schema

```json
{
  "schema": "annot.v1",
  "image": "stills/000123.png",
  "canvas": { "width": 1920, "height": 1080, "scale": 1.0, "origin": "top-left", "units": "px" },
  "t_ms": 45730,
  "objects": [
    {
      "id": "uuid",
      "type": "arrow",
      "z": 10,
      "style": { "stroke": "#ff0000ff", "width": 4, "opacity": 1.0, "dash": [] },
      "data": { "from": [210,380], "to": [340,290], "head": { "length": 14, "angle": 28 } }
    },
    {
      "id": "uuid",
      "type": "circle",
      "z": 12,
      "style": { "stroke": "#00ff00ff", "width": 3, "opacity": 1.0, "dash": [] },
      "data": { "center": [190,400], "r": 20 }
    },
    {
      "id": "uuid",
      "type": "text",
      "z": 20,
      "style": { "color": "#ffffffff", "size": 16, "font": "SF Pro Text", "align": "left" },
      "data": { "pos": [360,280], "text": "Weak side", "wrap": { "width": 240 } }
    }
  ]
}
```

- Coordinates: pixel space in source image dimensions; origin top-left.
- Colors: `#RRGGBBAA` hex; stroke widths and font sizes in pixels.
- Store `canvas.width/height` to allow scaling on reopen if needed; render engine maps to device scale.
- Include `schema` string for future migrations.

## 7) Media Import and Metadata

- Use File Picker and drag-drop to add videos.
- Copy imported videos into the project folder under `media/` (default behavior for MVP).
- Extract `duration` and (when available) `fps` via `<video>` metadata; probe via ffmpeg.wasm when necessary.
- Update `project.json` media index.

## 8) Playback and Marking
- HTML `<video>` with custom controls; `requestVideoFrameCallback` when available.
- Hotkeys: `J` = step back, `K` = pause/play, `L` = step forward; `←/→` short seeks; `,`/`.` frame nudges.
- `M` adds a mark; 1–9 toggles tag membership for the selected mark.
- Sidebar list shows marks with hh:mm:ss.mmm and tags; clicking navigates player to mark time.

 ## 9) Stills Extraction
 
 - Use Canvas with `drawImage(video, ...)` and `canvas.toBlob('image/png')`.
 - Prefer `requestVideoFrameCallback` for precise capture; otherwise seek and wait for `seeked` before drawing.
 - Fallback: ffmpeg.wasm extraction with PTS-accurate seeking when browser path is insufficient.
 - Naming: sequential `000001.png` by mark order; maintain mapping in IndexedDB.

## 10) Annotation Editor

- Canvas: React-Konva stage.
- Rendering: Konva shapes; text via canvas text APIs.
- Interactions:
  - Tool mode selection (arrow/box/circle/polyline/text/select).
  - Pan (space-drag), zoom (trackpad pinch/⌘+/-), snap-to-pixel at high zoom.
  - Selection marquee; per-shape bounding box with resize and rotate handles.
  - Hit-testing via path containment and stroke proximity.
- Undo/redo via Zustand command stack:
  - Operations: create, delete, property edits, transform, z-order changes, text edits.
  - Drag/transform gesture batching to a single undo step per gesture.
- Inspector (React): color picker, stroke width, font family/size, z-order controls (Send Back/Front).

## 11) Persistence and Autosave

- Autosave annotation JSON on:
  - Blur/leave canvas, switching stills, or N seconds idle after changes (e.g., 1–2s debounce).
- Merge strategy: sidecar is source of truth for annotation content; `project.json` stores minimal index metadata.
- Include `lastModified` timestamps in sidecars for conflict checks; for MVP, last-writer-wins.

## 12) Thumbnails and Grid

- Generate thumbnails on still creation; store under `thumbnails/` at ~400px width.
- Virtualized grid with prefetch and memory cache. Lazy loading on scroll.

## 13) Export Pipelines

- Clean PNG: canvas capture of raw frame with sRGB profile and DPI metadata (72 dpi default where applicable) written into `stills/`.
- Annotated PNG: render offscreen canvas at full image size, composite shapes/text using same style logic as editor, written into `stills/`.
- Reports:
  - CSV: columns for video, t_ms, tags, still filename, annotation counts, written into `reports/`.
  - JSON: structured export of marks plus embedded annotation sidecars, written into `reports/`.
- Optional (post‑MVP): Create a backup ZIP for sharing.

## 14) Keyboard Shortcuts (Commands)

- File: New, Open, Save.
- View: Zoom In (⌘+), Zoom Out (⌘-), Actual Size (⌘0).
- Playback: J (step back), K (pause/play), L (step forward), ←/→ (short seeks), ,/. (frame nudges), M (Add Mark), Delete/Backspace (Delete selected mark).
- Tools: 1 Arrow, 2 Box, 3 Circle, 4 Polyline, 5 Text; Shift modifies or cycles.

## 15) Testing and Performance

- Unit tests (Jest): data models (Mark/Still), JSON encode/decode, file path resolution.
- Snapshot tests: render shapes onto known 800×600 and compare to golden images (lock font + color profile).
 - Performance: 4K still extraction p50 < 200 ms on modern desktop; annotated render p50 < 16 ms for 20 shapes.
 - FFmpeg.wasm fallback tests: verify fallback triggers on VFR/non-native codecs and yields accurate frames within tolerance.
 - E2E (Playwright): import → mark → still → annotate → export → re-import; verify outputs and fidelity.

## 16) Error Handling and UX Safeguards

 - Graceful errors for unsupported codecs; automatic ffmpeg.wasm fallback when needed; suggest re-encode as an alternative.
 - Detect missing file handles on re-open; prompt to relink or mark as offline.
 - Recover autosave drafts if crash detected; store in IndexedDB with versioning.

## 17) Dependencies and Packaging

- npm (Node 20+): `next`, `react`, `react-dom`, `zustand`, `immer`, `react-konva`, `konva`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `zod` (optional), `playwright`.
- Optional (post‑MVP): `jszip` for backup ZIP creation.
- PWA: manifest.json + service worker; host on Vercel/Netlify/Cloudflare Pages.
## 18) Risks and Mitigations

- VFR accuracy: start with browser seeks + `requestVideoFrameCallback`; ffmpeg.wasm fallback when needed.
- 4K memory/perf: edit at downscaled preview; use OffscreenCanvas and Workers for heavy ops; export at full res.
- Undo complexity: centralize mutating actions through a command layer to ensure undo consistency.
- Browser scope: Chromium-only; clearly message requirement on landing and docs.

## 19) Open Questions (to refine during build)

- Do we normalize coordinates to image pixels only, or support percentage-based coordinates for future rescaling?
 - Minimum browser support baseline: Chromium 110+ (decided).
- Preferred default fonts and style presets for team workflows.

## 20) Definition of Done (MVP)

 - A user can create/open a project folder, import a video, add marks, generate stills, annotate them, and produce clean/annotated PNGs plus CSV/JSON reports inside the folder; closing and reopening the project folder restores state—without errors—and performance remains smooth on a 10-minute 1080p clip with 100+ marks/stills on a modern desktop browser.
