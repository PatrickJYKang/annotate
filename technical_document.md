# Football Analysis Annotator – Technical Specification (As-Built)

## Overview
This repository contains a working **Next.js (React 18 + TypeScript)** web application under `webapp/` for stills-first football match analysis.

The as-built workflow is:

1. Create/open a project folder on disk (Chromium File System Access API).
2. Import videos into the project.
3. Tag moments ("marks") while watching video.
4. Generate still PNGs + thumbnails.
5. Annotate stills with a Konva-based editor.
6. Export annotated PNGs and reports into the project folder.

This document describes the **current implementation** (routes, on-disk formats, runtime behavior). If something here disagrees with the code, the code is authoritative.

---

## Table of contents
1. Application architecture
2. Routes and user-facing pages
3. On-disk project format
4. `project.json` manifest (`project.v1`)
5. Annotation format (`annotations.v1`)
6. Core workflows (import, marks, still capture, annotate, export)
7. Persistence and synchronization
8. Concurrency / locking
9. Browser requirements and limitations
10. Segmentation test page (experimental)

---

## 1) Application architecture

### Runtime model
- The application is a Next.js App Router app.
- All core pages are client components (`"use client"`).
- Projects are stored in a user-selected **directory on the local filesystem** via the File System Access API (Chromium-only).
- The in-memory session state lives in a React context (`ProjectProvider`), which stores:
  - the open project directory handle
  - the loaded manifest (`project.json`)
  - the currently selected video ID

### Key implementation files
- App shell: `webapp/app/layout.tsx`
- Project context: `webapp/lib/state/ProjectContext.tsx`
- Project folder utilities: `webapp/lib/fs/projectFolder.ts`
- Manifest schema: `webapp/lib/types/project.ts`
- Video player: `webapp/components/player/VideoPlayerUnit.tsx`
- Stills export: `webapp/lib/export/d7Export.ts`, `webapp/lib/export/d7Render.ts`
- Annotation editor: `webapp/components/annotate/Editor.tsx`

---

## 2) Routes and user-facing pages

### `/` – Project + import
- File: `webapp/app/page.tsx`
- Responsibilities:
  - Create a new project folder (creates required subdirectories + `project.json`).
  - Open an existing project folder (validates structure + loads `project.json`).
  - Import video files into `media/` (streaming copy).
  - Choose a video to work on (sets `selectedVideoId` then routes to `/player`).

### `/player` – Playback + marks
- File: `webapp/app/player/page.tsx`
- Responsibilities:
  - Load video bytes from the project folder and play them via `<video>`.
  - Create marks at timestamps (`t_ms`) and toggle numeric tags (`1`–`9`).
  - Persist mark edits by rewriting `project.json`.

### `/stills` – Still capture + thumbnail grid + export
- File: `webapp/app/stills/page.tsx`
- Responsibilities:
  - Generate a still at the current playhead time.
  - Write still PNG to `stills/` and thumbnail PNG to `thumbnails/`.
  - Display a grid of thumbnails for the selected video.
  - Open the annotation editor in a new tab (`/annotate/[stillId]`).
  - Export annotated PNGs and reports into `reports/`.

### `/annotate/[stillId]` – Annotation editor
- File: `webapp/app/annotate/[stillId]/page.tsx`
- Responsibilities:
  - Connect to the project directory handle (via `postMessage` from `/stills` or restore from IndexedDB).
  - Load the still image from `stills/...`.
  - Provide editing tools and autosave to `annotations/<stillId>.json`.

### `/segmentation-test` – Experimental segmentation sandbox
- File: `webapp/app/segmentation-test/page.tsx`
- Responsibilities:
  - Local image input + foreground cutout demos.
  - Not integrated into the annotation pipeline.

---

## 3) On-disk project format

A project is a user-selected directory containing `project.json` plus a fixed set of subdirectories.

The `.matchproj` suffix is currently a naming convention used by the UI (not a filesystem requirement).

### Required structure
Created/validated by `webapp/lib/fs/projectFolder.ts`.

```text
MyMatch.matchproj/
  project.json
  media/
  stills/
  thumbnails/
  annotations/
  reports/
    annotated/
  clips/
```

Notes:
- `reports/annotated/` is created during export.
- `clips/` exists but is not used by the current app.

---

## 4) `project.json` manifest (`project.v1`)

### Location and lifecycle
- Location: `project.json` in the project root.
- The manifest is the primary index for all project assets.
- The app rewrites the entire file on updates (JSON, pretty-printed).

### Schema
Defined in `webapp/lib/types/project.ts`.

```ts
export interface ProjectManifestV1 {
  schema: 'project.v1';
  name: string;
  created: string;
  videos: { id: string; label: string; file: string; durationMs?: number; width?: number; height?: number; fps?: number }[];
  marks: { id: string; videoId: string; t_ms: number; tags: string[] }[];
  stills: { id: string; videoId: string; t_ms: number; file: string; width?: number; height?: number }[];
  annotations: { stillId: string; file: string; lastModified?: string }[];
  reports: string[];
  thumbnails: string[];
}
```

Key invariants:
- `schema` must equal `"project.v1"`.
- `videos[].file`, `stills[].file`, and the strings in `thumbnails[]` / `reports[]` are **relative paths** within the project directory.
- A still is linked to marks by **time tolerance**, not by mark ID. Export uses a ±2 frame tolerance based on FPS.

---

## 5) Annotation format (`annotations.v1`)

### Location
- Main save location: `annotations/<stillId>.json`.
- If write permission is not available, the editor also writes a backup record to IndexedDB (see Persistence).

### Schema
Export expects this schema (`webapp/lib/export/d7Export.ts`), and the editor writes it (`webapp/components/annotate/Editor.tsx`).

```json
{
  "schema": "annotations.v1",
  "stillId": "<stillId>",
  "image": { "file": "stills/000001.png", "width": 1920, "height": 1080 },
  "shapes": [
    {
      "id": "<shapeId>",
      "type": "arrow",
      "x": 0,
      "y": 0,
      "points": [100, 200, 400, 220],
      "style": { "stroke": "#ef4444", "strokeWidth": 6, "strokePattern": "solid" }
    }
  ],
  "perspective": {
    "quad": [
      { "x": 100, "y": 100 },
      { "x": 1800, "y": 120 },
      { "x": 1750, "y": 980 },
      { "x": 120, "y": 960 }
    ]
  }
}
```

Shape model (high-level):
- Supported types: `box`, `circle`, `arrow`, `text`, `poly`, `highlight`.
- Shapes support a `style` object with stroke/fill/strokeWidth/strokePattern/font.
- Some tools can use perspective-aware placement via a calibrated quad:
  - `perspective.quad` defines a homography from a unit square plane to image space.
  - Shapes may include a `plane` property storing plane-space geometry.

---

## 6) Core workflows

### 6.1 Create/open project
- Create:
  - UI prompts for a folder name (adds `.matchproj` suffix if missing).
  - Writes required subdirectories and `project.json`.
- Open:
  - Validates that required subdirectories exist and `project.json` parses as `project.v1`.

Files:
- UI: `webapp/app/page.tsx`
- Implementation: `webapp/lib/fs/projectFolder.ts`

### 6.2 Import video
- Video import copies selected files into `media/`.
- Name collisions are avoided by generating a unique filename (`file (2).mp4`, etc.).
- Basic metadata is extracted client-side via `<video>`:
  - duration
  - width/height
  - optional FPS estimate via `requestVideoFrameCallback`

Files:
- `webapp/app/page.tsx`
- `webapp/lib/fs/utils.ts`
- `webapp/lib/media/metadata.ts`

### 6.3 Marks (timestamps + tags)
- Marks are stored in `project.json` as `{ id, videoId, t_ms, tags[] }`.
- The player supports keyboard shortcuts globally on the page:
  - `M` add mark
  - `1`–`9` toggle tags for selected (or most recent) mark
  - `J/K/L`, `,/.`, `←/→` for stepping and nudging

Files:
- Page logic: `webapp/app/player/page.tsx`
- Player component: `webapp/components/player/VideoPlayerUnit.tsx`

### 6.4 Still capture + thumbnails
- Stills are created by drawing the current `<video>` frame to a canvas and encoding PNG.
- Stills are named sequentially using a 6-digit filename convention (`000001.png`).
- Duplicate capture is avoided within ±2 frames (based on FPS).
- Thumbnail PNGs are generated from the still PNG and written to `thumbnails/`.

Files:
- `webapp/app/stills/page.tsx`

### 6.5 Annotate
- The still editor opens in a new tab.
- The `/stills` page attempts to pass the live directory handle via `postMessage`.
- The annotation page can also restore the last project directory handle from IndexedDB.
- The editor supports autosave with debouncing and flush-on-hide behavior.

Files:
- Host page: `webapp/app/annotate/[stillId]/page.tsx`
- Editor: `webapp/components/annotate/Editor.tsx`

### 6.6 Export
Export is initiated from `/stills`.

Output files:
- Annotated PNG per still: `reports/annotated/<stillBaseName>.png`
- `reports/marks.json`
- `reports/marks.csv`
- `reports/annotations.json`

Notes:
- Export reads `annotations/<stillId>.json` if present; otherwise it uses an empty shape list.
- Export counts annotations by type (excluding temporary shapes).
- Export also updates `manifest.reports` and rewrites `project.json`.

Files:
- `webapp/lib/export/d7Export.ts`
- `webapp/lib/export/d7Render.ts`

---

## 7) Persistence and synchronization

### Source of truth
- The project directory on disk is the canonical source.
- The manifest file (`project.json`) is the index.

### IndexedDB usage
This app uses IndexedDB directly (no wrapper library) for two purposes:

1. Project directory handle persistence (annotation page)
  - DB: `annotate-db`
  - Object store: `handles`
  - Key: `project`
  - Behavior: the annotation page can auto-restore the last project folder handle if permission is still granted.

2. Annotation backup records (editor)
  - DB: `annotate-backup-db`
  - Object store: `ann-backup` (keyPath `stillId`)
  - Behavior:
    - On save, the editor writes a backup record.
    - If write permission is missing, the backup is used as a fallback so work is not lost.
    - On load, the editor can detect a newer backup than the on-disk JSON and offer recovery.

### Cross-tab update signal
- The editor emits `BroadcastChannel('annotate-events')` messages on save (`type: 'annotation-saved'`).
- The `/stills` page listens and reindexes `manifest.annotations` by scanning `annotations/`.

Files:
- Listener: `webapp/app/stills/page.tsx`
- Emitter + backup logic: `webapp/components/annotate/Editor.tsx`
- Reindex: `webapp/lib/fs/projectFolder.ts` (`reindexAnnotations`)

---

## 8) Concurrency / locking

The app uses the Web Locks API (when available) to reduce races during concurrent writes:

- Manifest writes in `/player`:
  - Uses `navigator.locks.request('project-manifest', { mode: 'exclusive' }, ...)`.

- Annotation writes:
  - Uses `navigator.locks.request('save-<stillId>', { mode: 'exclusive' }, ...)`.

If locks are not available, the code falls back to direct writes.

---

## 9) Browser requirements and limitations

- **Chromium requirement**: creating/opening/writing project folders requires the File System Access API.
- **Permissions**:
  - Access to the directory can be revoked; the annotation page includes explicit "Enable autosave" flow.
- **No PWA/SW behavior is assumed by this spec**:
  - There is no documented service-worker registration in the current code paths scanned.
- **No ZIP export**:
  - Export currently writes to `reports/` inside the project folder. A `.annotzip` bundle is not produced by the current implementation.
- **Media accuracy**:
  - Still capture uses canvas `drawImage(video, ...)` and does not provide ffmpeg-level PTS accuracy.
- **Performance**:
  - Very large stills increase memory usage (canvas + ImageBitmap during export).

---

## 10) Segmentation test page (experimental)

The `segmentation-test` route is a sandbox for foreground extraction from a still image.

### Purpose
- Provide a quick way to validate segmentation approaches and tune parameters.
- Not currently used in the annotation editor or export pipeline.

### Implemented methods
1. **Edge-based segmentation**
  - File: `webapp/lib/segmentation/edgeSegmentation.ts`
  - Approach:
    - downscale to `maxDim`
    - grayscale + blur
    - Sobel magnitude thresholding by percentile
    - morphological dilation/closing
    - optional hole filling
    - connected-component filtering

2. **ML-based person segmentation (BodyPix via TFJS)**
  - File: `webapp/lib/segmentation/personSegmentation.ts`
  - Uses dynamic imports of:
    - `@tensorflow/tfjs-core`
    - `@tensorflow/tfjs-converter`
    - `@tensorflow/tfjs-backend-webgl`
    - `@tensorflow-models/body-segmentation`

### Output contract
Both methods return (or `null` on failure):
- `cutout`: a canvas containing the input masked by alpha
- `mask`: an `ImageData` alpha mask
- `ratio`: foreground pixel ratio
- `w`, `h`: internal resolution after downscale
