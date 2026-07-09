# Football Analysis Annotator – Technical Specification (As-Built)

## Overview
This repository contains a working **Next.js (React 18 + TypeScript)** web application under `webapp/` and a **Python sidecar service** under `sidecar/` for football match analysis.

This repository is licensed under the **GPL-3.0-only** license.

The as-built workflow is:

1. Create/open a project folder on disk (Chromium File System Access API).
2. Import videos into the project.
3. Enter match metadata (teams and teamsheets).
4. Tag moments ("marks") while watching video.
5. Generate still PNGs + thumbnails.
6. Annotate stills with a Konva-based editor (supports multiple annotation documents per still).
7. Create clips (time-range segments with keyframed, trackable annotations).
8. Build presentations (deck-like sequences of analysis slides from stills and clips).
9. Export annotated PNGs, reports, and clip MP4s into the project folder.

The optional Python sidecar provides ML-powered features: object tracking (YOLO + vendored trackers OC-SORT), person segmentation (YOLO + MobileSAM), pitch homography estimation (vendored trackers PnLCalib provider), and video encoding (ffmpeg). The webapp gracefully degrades when the sidecar is unavailable.

### Current scope note
- The repository contains an active **clip system** with keyframed annotations, highlight tracking, pitch homography, still-annotation import, occlusion, and clip export.
- Presentations are also active: the editor builds decks from stills, clips, and title cards, and present mode uses exact-motion media for match-video transitions and clip playback.
- The Python sidecar is optional but live for local CV/media workflows. When unavailable, manual still/clip/presentation authoring remains usable and sidecar-backed controls are hidden or disabled.

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
10. Tagging schema system
11. Match metadata system
12. Styling system (Tailwind CSS v4)
13. Clips system
14. Presentations system
15. Python sidecar service
16. Project integrity
17. Derived media
18. Testing
19. Segmentation test page (experimental)

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
  - the loaded tagging schema (`TaggingSchema | null`)

### Key implementation files
- App shell: `webapp/app/layout.tsx`
- Global header: `webapp/components/HeaderControls.tsx`
- Project context: `webapp/lib/state/ProjectContext.tsx`
- Project folder utilities: `webapp/lib/fs/projectFolder.ts`
- Manifest schema: `webapp/lib/types/project.ts`
- Project integrity: `webapp/lib/utils/projectIntegrity.ts`
- Tagging schema & helpers: `webapp/lib/tagging/schema.ts`
- Tagging UI — menu: `webapp/components/tagging/TaggingMenu.tsx`
- Tagging UI — folder tree: `webapp/components/tagging/TagFolderTree.tsx`
- Tagging schema default template: `webapp/public/tagging/schema.yaml`
- Video player: `webapp/components/player/VideoPlayerUnit.tsx`
- Stills export: `webapp/lib/export/d7Export.ts`, `webapp/lib/export/d7Render.ts`
- Annotation editor: `webapp/components/annotate/Editor.tsx`
- Annotation storage: `webapp/lib/fs/annotationStorage.ts`
- Quick-annotate session helpers: `webapp/lib/annotate/quickSession.ts`
- Metadata page: `webapp/app/metadata/page.tsx`
- Metadata components: `webapp/components/metadata/` (MatchDetailsForm, TeamPanel, TeamsheetImporter, FootballDataImporter)
- Metadata utilities: `webapp/lib/metadata/` (teamsheetParser, timeDisplay, footballDataApi)
- API proxy: `webapp/app/api/football-data/route.ts`
- Clip types: `webapp/lib/types/clip.ts`
- Clip storage: `webapp/lib/fs/clipStorage.ts`
- Clip interpolation: `webapp/lib/clip/interpolation.ts`
- Clip bbox conversion: `webapp/lib/clip/bboxConvert.ts`
- Clip editor: `webapp/components/clip/ClipEditor.tsx`
- Sidecar client: `webapp/lib/clip/sidecarClient.ts`
- Sidecar context: `webapp/lib/state/SidecarContext.tsx`
- Presentation types: `webapp/lib/types/presentation.ts`
- Presentation storage: `webapp/lib/fs/presentationStorage.ts`
- Presentation authoring: `webapp/lib/presentation/authoring.ts`
- Presentation editor: `webapp/components/presentation/PresentationAuthoringEditor.tsx`
- Presentation canvas: `webapp/components/presentation/PresentationCanvas.tsx`
- Derived media storage: `webapp/lib/fs/derivedMediaStorage.ts`
- Derived media types: `webapp/lib/presentation/derivedMediaTypes.ts`
- Styling: `webapp/app/globals.css` (Tailwind v4 `@theme` + component classes), `webapp/tailwind.config.ts`, `webapp/postcss.config.mjs`
- Python sidecar: `sidecar/annotate_sidecar/` (FastAPI server, ML routes, services)

---

## 2) Routes and user-facing pages

### `/` – Project + import
- File: `webapp/app/page.tsx`
- Layout: full-bleed, two-state design.
  - **Empty state** (no project open): viewport-centered card with title, two large CTA buttons ("Create New Project", "Open Existing Project"), a divider with a "Quick Annotate a Still…" option (image file picker that stashes the file and routes to `/quick-annotate`), and a Chromium-required warning if the File System Access API is unavailable.
  - **Dashboard** (project open): two-column layout.
    - **Left sidebar** (320px fixed): project name, created date, stat counts (videos / marks / stills), action buttons (Match Info, Import Video, Save Now), and a "Close Project" button separated by a divider at the bottom.
    - **Right area** (flex-grow): video list heading with count, selectable video rows (label, duration, resolution; selected row highlighted with `bg-selected` and left accent border; clicking navigates to `/player`), and a dashed-border drop zone for drag-and-drop video import.
- Responsibilities:
  - Create a new project folder (creates required subdirectories + `project.json` + `tagging-schema.yaml`).
  - Open an existing project folder (validates structure + loads `project.json` + reads `tagging-schema.yaml`; if missing, prompts to add the default schema).
  - Import video files into `media/` (streaming copy via file picker or drag-and-drop onto the drop zone).
  - Choose a video to work on (sets `selectedVideoId` then routes to `/player`).
  - "Set up match info →" / "Edit match info" button in the sidebar links to `/metadata`.

### `/quick-annotate` – Standalone still annotation
- File: `webapp/app/quick-annotate/page.tsx`
- Session helpers: `webapp/lib/annotate/quickSession.ts`
- Annotate a single uploaded image with the full annotation editor and export the annotated PNG — no project required.
- Two-state design:
  - **Picker state** (no image chosen): centered card with a "Choose Image…" button (plain `<input type="file">`) and drag-and-drop support.
  - **Editor state**: navbar (Back, New Image…, filename, save status, Export PNG) + the same tool/style toolbar as `/annotate/[stillId]` (minus occlusion and annotation sets) + Fit / 100% / wheel-zoom / middle-click pan.
- Implementation:
  - The page wraps its subtree in a **nested `ProjectProvider`** and connects an **origin-private file system (OPFS)** directory (`quick-annotate/` via `navigator.storage.getDirectory()`) as the editor's project directory. The unmodified `Editor` component loads/saves annotation documents against it; app-wide project state is untouched.
  - The still ID is a deterministic hash of the image file's name, size, and mtime (`quick_<hash>`), so re-opening the same image restores its annotations from OPFS.
  - The splash screen hands the chosen file to the page via an in-memory module stash (`stashQuickAnnotateFile` / `takeQuickAnnotateFile`); on a direct visit or reload the page offers its own picker.
  - **Export PNG** bumps the editor's manual save tick, waits for the save to settle, reads the saved `annotations.v1` document from OPFS, renders it onto the native-resolution image with `renderAnnotatedPng` (the same renderer as project exports), and downloads `<name>-annotated.png`.
  - **Calibrate** (PnLCalib auto-calibration) works on the lone image: the page registers the image file via `/video/register` and calls `/homography` over `[0ms, 100ms]` — `cv2.VideoCapture` opens a registered still as a single-frame source — then projects pitch bounds to a perspective quad and applies it through the editor's `autoPerspectiveQuad` props. Requires the sidecar with PnLCalib assets; failures surface as a toast. "Manual H" remains available without the sidecar.
  - Image dimensions are decoded with `createImageBitmap(file)` rather than an `<img src=objectURL>` probe (a Strict Mode revoke race in the probe approach produced spurious decode errors).

### `/metadata` – Match metadata
- File: `webapp/app/metadata/page.tsx`
- Layout: full-bleed with a navbar replacing the old toolbar. Navbar buttons use the space-filling pattern (`self-stretch`, square, border separators). Left group: "← Back to project", "Import match metadata". Right group: "Save now", "Player →".
- Responsibilities:
  - Edit match details (date, kickoff, competition, season, round, venue, referee, score).
  - Edit home/away team panels (name, coach, formation, inline editable player table).
  - Import teamsheets from CSV/TSV/TXT files or pasted text.
  - Import match metadata from football-data.org API (search → preview → selective import).
  - Free-form notes field.
  - Debounced auto-save of `matchInfo` to `project.json` (800ms).

### `/player` – Playback + tagging
- File: `webapp/app/player/page.tsx`
- Layout: full-bleed, navbar + two-pane content. Navbar uses the space-filling button pattern: left group ("← Back", "Match info"), right group ("Delete", "Stills →"). Below the navbar: video player with editor-style timeline (left, flex-grow) + tag folder tree (right, 300px fixed, `border-l`).
- Responsibilities:
  - Load video bytes from the project folder and play them via `<video>`.
  - Create marks at timestamps (`t_ms`); adding a mark auto-opens the `TaggingMenu`.
  - Display marks organised into collapsible folders mirroring the `primary_tree` schema, via the `TagFolderTree` component.
  - Tag marks via a hierarchical tagging menu (right-click a mark to open `TaggingMenu`); schema is passed as a prop from `ProjectContext`.
  - Re-tag marks by dragging them onto a folder in the tree (sets `primary` to the target node ID, clears facets).
  - Undo/redo for mark and tag edits (⌘Z / ⌘⇧Z), with a 50-entry stack.
  - Persist mark edits by rewriting `project.json`.

### `/player-legacy` – Legacy playback + marks (preserved)
- File: `webapp/app/player-legacy/page.tsx`
- The original `/player` page, preserved as-is for reference/fallback. Not reachable from normal navigation.

### `/stills` – Still capture + thumbnail grid + clips + export
- File: `webapp/app/stills/page.tsx`
- Responsibilities:
  - Generate a still at the current playhead time (writes `sourceMarkId` linking the still to its source mark).
  - Write still PNG to `stills/` and thumbnail PNG to `thumbnails/`.
  - Display a grid of thumbnails for the selected video.
  - Open the annotation editor in a new tab (`/annotate/[stillId]`).
  - **Clip management**: list clips for the selected video, create new clips (via a modal specifying start/end marks or timestamps), delete clips, open clips in a new tab (`/clip/[clipId]`). Clip thumbnails are generated from the video at the clip's start time.
  - Export annotated PNGs and reports into `reports/`.
  - Navigate to presentations (`/presentations`).

### `/annotate/[stillId]` – Annotation editor
- File: `webapp/app/annotate/[stillId]/page.tsx`
- Responsibilities:
  - Connect to the project directory handle (via `postMessage` from `/stills` or restore from IndexedDB).
  - Load the still image from `stills/...`.
  - Supports **multiple annotation documents** per still. The URL query parameter selects which annotation document to edit (defaults to `annotations/<stillId>.json`). New annotation sets can be created inline, and the editor remounts per selected document.
  - Provide editing tools (select, box, circle, highlight, shadow, arrow, lob, poly, text) and autosave to the selected annotation document path.
  - Use the sidecar-backed **Calibrate** action to apply a PnLCalib homography for the still when the source video is available; **Manual H** remains the manual quad fallback.
  - Support a keyboard-only video preview around the still: hold `ArrowLeft` / `ArrowRight` to play backward/forward up to five seconds from the annotation timestamp, and press `Space` to return to the annotation frame.
  - Hide annotations and lock editing while the preview is away from the annotation frame; zoom/pan remain available.
  - Supports renaming and deleting non-default annotation sets.

### `/clip/[clipId]` – Clip editor
- File: `webapp/app/clip/[clipId]/page.tsx`
- Layout: full-bleed, navbar + toolbar + ClipEditor. Navbar shows "Close" button, clip time range, annotation count, sidecar video error (if any), and FPS. Toolbar provides annotation tools (select, box, circle, shadow, arrow, lob, poly, text, highlight) and stroke settings (color picker, width selector).
- Responsibilities:
  - Auto-restore project handle from IndexedDB or receive via `postMessage`.
  - Load clip JSON from `clips/clip-<clipId>.json`, resolve mark pinning against current marks.
  - Resolve the video file URL from the manifest using the clip's `videoId`.
  - Register the video file with the sidecar (`POST /video/register`) to obtain a `videoRef` for ML operations. Unregister on unmount.
  - Wrap the editor in `SidecarProvider` so ML features (Track, Homography, Occlusion, Export) are conditionally available.
  - Render the `ClipEditor` component with playback, keyframe interpolation, annotation rendering, and editing.

### `/presentations` – Presentation list
- File: `webapp/app/presentations/page.tsx`
- Layout: full-bleed with navbar ("← Stills", "Presentations" heading, "Refresh"). Summary cards (presentation count, slide count, project name). Create form. Scrollable list of presentations with rename, duplicate, delete, and "Open" actions.
- Responsibilities:
  - List all presentations from `presentations/*.json` (sorted by most recently updated).
  - Create new presentations (writes a default presentation JSON).
  - Rename, duplicate, and delete presentations.
  - Navigate to the presentation editor (`/presentation/[presentationId]`).

### `/presentation/[presentationId]` – Presentation editor
- File: `webapp/app/presentation/[presentationId]/page.tsx`
- Responsibilities:
  - Auto-restore project handle from IndexedDB or receive via `postMessage`.
  - Load presentation JSON from `presentations/presentation-<presentationId>.json`.
  - Load tagging schema for the asset browser tree.
  - Render `PresentationAuthoringEditor` — a full-screen editor with asset browser, canvas, inspector, and deck strip.

### `/api/football-data` – API proxy (server-side)
- File: `webapp/app/api/football-data/route.ts`
- A Next.js API route that proxies requests to `https://api.football-data.org/v4`.
- Forwards the `X-Auth-Token` header and the `path` query parameter.
- Returns the upstream response body and status. Handles 429 rate-limit and connection errors.

### `/dropdown-test` – Tagging dropdown sandbox
- File: `webapp/app/dropdown-test/page.tsx`
- Responsibilities:
  - Standalone test page for the hierarchical tagging dropdown.
  - Loads `schema.yaml` from `public/tagging/` and renders the primary tree + facet pickers.
  - Displays current selection as JSON.
  - Not integrated into the main workflow; exists for development/testing.

### `/segmentation-test` – Experimental segmentation sandbox
- File: `webapp/app/segmentation-test/page.tsx`
- Responsibilities:
  - Local image input + foreground cutout demos.
  - Uses the same segmentation helpers as the editor's optional foreground occlusion feature.

---

## 3) On-disk project format

A project is a user-selected directory containing `project.json` plus a fixed set of subdirectories.

### Required structure
Created/validated by `webapp/lib/fs/projectFolder.ts`.

```text
MyMatch/
  project.json
  tagging-schema.yaml
  media/
  stills/
  thumbnails/
  annotations/
    <stillId>.json                      # default annotation document
    <stillId>/                          # per-still subdirectory for alternate sets
      <annotationId>.json
  reports/
    annotated/
  clips/
    clip-<clipId>.json
  presentations/
    presentation-<presentationId>.json
  homography-cache/
    range-<startMs>-<endMs>.json
  derived-media/
    presentations/
      <presentationId>/
        index.json
        jobs.json
        preparation.json
        motion-assets/
          motion-<generationKey>.mp4
```

Notes:
- `tagging-schema.yaml` is written from the default template on project creation. For existing projects opened without one, the user is prompted to add it.
- `reports/annotated/` is created during export.
- `clips/` stores clip JSON files; clips are discovered by directory listing (no manifest entry).
- `presentations/` stores presentation JSON files; discovered by directory listing.
- `homography-cache/` stores per-range homography matrices computed by the sidecar.
- `derived-media/` stores sidecar-encoded exact-motion assets for presentations.

---

## 4) `project.json` manifest (`project.v1`)

### Location and lifecycle
- Location: `project.json` in the project root.
- The manifest is the primary index for all project assets.
- The app rewrites the entire file on updates (JSON, pretty-printed).

### Schema
Defined in `webapp/lib/types/project.ts`.

```ts
import type { TaggingSelection } from "../tagging/schema";

export interface ProjectAnnotationIndexEntry {
  stillId: string;
  file: string;
  id?: string;           // annotation document ID (derived from path if absent)
  label?: string;        // human-readable label
  role?: 'default' | 'alternate';
  lastModified?: string;
}

export interface ProjectManifestV1 {
  schema: 'project.v1';
  name: string;
  created: string;
  videos: { id: string; label: string; file: string; durationMs?: number; width?: number; height?: number; fps?: number }[];
  marks: { id: string; videoId: string; t_ms: number; tags?: TaggingSelection | string[] }[];
  stills: { id: string; videoId: string; t_ms: number; file: string; width?: number; height?: number; sourceMarkId?: string | null }[];
  annotations: ProjectAnnotationIndexEntry[];
  reports: string[];
  thumbnails: string[];
  matchInfo?: MatchInfo;
}
```

### Match metadata types
Also defined in `webapp/lib/types/project.ts`:

- **`MatchInfo`** — top-level match metadata: `homeTeam`, `awayTeam` (both `TeamInfo`), `date`, `kickoffTime`, `competition`, `season`, `round`, `venue`, `referee`, `score`, `substitutions` (`Substitution[]`), `notes`.
- **`TeamInfo`** — `name`, `coach`, `formation`, `players` (`PlayerEntry[]`).
- **`PlayerEntry`** — `id` (UUID), `number`, `name`, `position`, optional `isCaptain`, `isSubstitute`.
- **`Substitution`** — `id`, `team` (`"home" | "away"`), `minute`, `playerOut` (PlayerEntry ID), `playerIn` (PlayerEntry ID).
- **`defaultMatchInfo()`** — returns a blank `MatchInfo` with empty arrays and null fields.
- **`defaultProjectManifest(name)`** — returns a blank `ProjectManifestV1`.

Existing projects without `matchInfo` are handled gracefully — the field is simply absent until the user fills it in.

Key invariants:
- `schema` must equal `"project.v1"`.
- `videos[].file`, `stills[].file`, and the strings in `thumbnails[]` / `reports[]` are **relative paths** within the project directory.
- `marks[].tags` may be a `TaggingSelection` object (`{ primary, facets }`) or a legacy `string[]`. Readers must handle both via `ensureTaggingSelection()` from `webapp/lib/tagging/schema.ts`.
- `stills[].sourceMarkId` links each still to a specific mark by ID. This is required for the presentations asset browser. On project open, `projectIntegrity.ts` repairs missing `sourceMarkId` fields by matching `(videoId, t_ms)` to existing marks or creating backfilled marks. See §16 (Project integrity).
- `annotations[]` entries are document-aware: each entry has a `file` path, a derived or explicit `id`, optional `label`, and `role` (`'default'` or `'alternate'`). The annotation index is rebuilt by scanning the `annotations/` directory recursively on project open. See §5 for the multi-document annotation model.
- Export still uses ±2 frame tolerance for legacy linking but prefers `sourceMarkId` when available.

---

## 5) Annotation format (`annotations.v1`)

### Location and multi-document model
- **Default document**: `annotations/<stillId>.json` — backward-compatible path, always editable by the annotation editor.
- **Alternate documents**: `annotations/<stillId>/<annotationId>.json` — additional named annotation sets per still (e.g. different analysis perspectives).
- If write permission is not available, the editor also writes a backup record to IndexedDB (see Persistence).

The annotation storage layer (`webapp/lib/fs/annotationStorage.ts`) owns all annotation I/O:
- `buildDefaultAnnotationPath(stillId)` / `buildAnnotationPath(stillId, annotationId)` — path resolution.
- `listAnnotationEntriesForStillWithDefault(manifest, stillId)` — returns resolved entries for a still, always including the default document even if not indexed.
- `readAnnotationDocument(projectDir, filePath)` / `writeAnnotationDocument(...)` / `deleteAnnotationDocument(...)` — CRUD for individual documents.
- `readAnnotationDocumentsForStill(projectDir, manifest, still)` — loads all annotation documents for a still.
- `mergeAnnotationDocuments(documents)` — merges shapes from multiple documents into a single `AnnotationsV1` (deduplicates by shape ID, takes the first perspective quad found). Used by export and presentation rendering.
- `scanAnnotationEntries(projectDir, manifest)` — recursively walks `annotations/` and rebuilds the manifest index.

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
- Supported types: `box`, `circle`, `shadow`, `arrow`, `lob`, `text`, `poly`, `highlight`.
- Shapes support a `style` object with stroke/fill/fillOpacity/strokeWidth/strokePattern/font/textHighlight. The editor UI keeps stroke and fill colours linked by default for fill-capable shapes, with an explicit unlink toggle.
- Some tools can use perspective-aware placement via a calibrated quad:
  - `perspective.quad` defines a homography from a unit square plane to image space.
  - Shapes may include a `plane` property storing plane-space geometry.

---

## 6) Core workflows

### 6.1 Create/open project
- Create:
  - UI prompts for a project name, then creates a matching project folder.
  - Writes required subdirectories, `project.json`, and `tagging-schema.yaml` (default template).
  - Reads the schema back and stores it in `ProjectContext.taggingSchema`.
- Open:
  - Validates that required subdirectories exist and `project.json` parses as `project.v1`.
  - Reads `tagging-schema.yaml` from the project directory.
  - If the schema file is missing, shows a `confirm()` prompt: "This project does not have a tagging schema. Add the default schema?". On accept, writes the default template; on cancel, tagging features remain disabled (`taggingSchema = null`).

Files:
- UI: `webapp/app/page.tsx`
- Implementation: `webapp/lib/fs/projectFolder.ts`
- Schema I/O: `webapp/lib/tagging/schema.ts`

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
- Marks are stored in `project.json` as `{ id, videoId, t_ms, tags }` where `tags` is a `TaggingSelection` object (or legacy `string[]`).
- The right pane of the player page shows a **tag folder tree** (`TagFolderTree`) that groups marks into collapsible folders matching the `primary_tree` from the schema:
  - Marks are placed by matching `mark.tags.primary` to a node ID.
  - An **"Untagged"** bucket collects marks with `primary = null`.
  - An **"Unknown tag"** bucket collects marks whose `primary` does not match any schema node (displays the raw ID).
  - Parent folders show recursive mark counts as badges.
  - Folders with marks are auto-expanded on first load; empty folders are dimmed.
  - Clicking a mark timestamp selects it and seeks the video.
  - The selected mark is automatically scrolled into view.
- Tags are assigned via a hierarchical tagging menu (`TaggingMenu` component):
  - Right-click a mark in the tree → opens menu at cursor.
  - Adding a mark (`M`) auto-opens the menu (centered on viewport).
  - Drag-and-drop a mark onto a folder to set its `primary` tag (clears facets).
- The player supports keyboard shortcuts globally on the page:
  - `M` add mark (+ auto-open tagging menu)
  - `Backspace/Delete` delete selected mark
  - `C` clear tags on selected mark
  - `⌘Z` undo, `⌘⇧Z` redo (50-entry stack)
  - `⌘←/⌘→` jump to prev/next mark
  - `J/K/L`, `,/.`, `←/→` for stepping and nudging
  - `Space` play/pause

#### VideoPlayerUnit (editor-style timeline)
The `VideoPlayerUnit` component (`webapp/components/player/VideoPlayerUnit.tsx`) has been redesigned from a YouTube-style seek bar overlay to an editor-style timeline panel below the video. Key elements:
- **Layout**: video element fills available space (`flex-1 min-h-0`); timeline panel is a `shrink-0` region below with `bg-surface border-t border-border`.
- **Timecode ruler**: horizontal ruler with major/minor tick marks and time labels. Ticks adapt to zoom level (>30 min visible → 5 min/1 min; 5–30 min → 1 min/15 s; 1–5 min → 15 s/5 s; 15 s–1 min → 5 s/1 s; <15 s → 1 s/0.25 s).
- **Track lane**: `h-8 bg-raised` strip showing mark pips (3px wide, full lane height; yellow `#fbbf24` = default, orange `#f97316` = selected) and a 2px red playhead line. Clicking the lane seeks; clicking a pip selects the mark and seeks to it. Tooltips on hover show timestamp and label.
- **Zoom**: internal state (1× to 100×). Controls: range slider in the transport bar + Ctrl/⌘+Scroll on the timeline area. Zoom anchors on the mouse cursor position. `pps = (containerWidth / duration) * zoom`; total timeline width scales accordingly with `overflow-x: auto`.
- **Horizontal scroll**: mouse wheel on the timeline scrolls horizontally (vertical delta mapped to horizontal). Ctrl+wheel zooms instead. During playback, auto-scrolls to keep the playhead visible (~33% from left edge). When paused, free scroll; selecting an off-screen mark auto-scrolls to it, and the zoom slider anchors around the selected mark or current playhead.
- **Transport bar**: square, space-filling buttons matching the navbar pattern (skip back, step back, play/pause, step forward, skip forward, add mark, fullscreen). Monospace timecode readout (`HH:MM:SS.mmm`). Zoom slider at right end.
- **Imperative API** (`VideoPlayerHandle`): `playPause`, `stepFrame`, `nudgeSmall`, `nudgeLarge`, `seekMs`, `getCurrentTimeMs`, `addMark`, `getVideoElement`. Used by the parent page for keyboard shortcuts.

Files:
- Page logic: `webapp/app/player/page.tsx`
- Player component: `webapp/components/player/VideoPlayerUnit.tsx`
- Tagging folder tree: `webapp/components/tagging/TagFolderTree.tsx`
- Tagging menu: `webapp/components/tagging/TaggingMenu.tsx`
- Tagging schema helpers: `webapp/lib/tagging/schema.ts`
- Time display: `webapp/lib/metadata/timeDisplay.ts`

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
- The editor includes optional foreground occlusion (edge-based or ML person segmentation) to render annotations under the detected foreground.
- Text supports an optional highlight style for readability and is rendered above the occlusion layer.

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

## 10) Tagging schema system

### Schema source
- **Per-project**: each project carries its own schema at `<project>/tagging-schema.yaml`. This is the runtime source.
- **Default template**: `webapp/public/tagging/schema.yaml` (bundled static asset). Written into new projects automatically and offered to existing projects missing a schema.
- **Design docs**: `plans/post-mvp/tagging/schema.md`, `plans/post-mvp/tagging/schema.yaml`, and `plans/post-mvp/tagging/tagging-page-redesign.md`.

### Schema structure (`TaggingSchema`)
Defined in `webapp/lib/tagging/schema.ts`, parsed from YAML at runtime using the `yaml` npm package.

```ts
type TaggingSchema = {
  version: number;
  facet_groups: TaggingFacetGroup[];
  primary_tree: TaggingNode[];
};
```

- **`primary_tree`**: hierarchical tree of event categories (e.g., Offensive > Open play > Cross). Each node has `id`, `label`, optional `children`, and optional `facet_group_ids`.
- **`facet_groups`**: flat list of optional trait pickers. Each group has `id`, `label`, `mode` (`single` | `multi`), `options`, and optional `requires_any` (conditional visibility).

### Selection model (`TaggingSelection`)
```ts
type TaggingSelection = {
  primary: string | null;
  facets: Record<string, string | string[]>;
};
```

- `primary`: the selected node ID from the primary tree (can stop at any depth).
- `facets`: keyed by facet group ID, value is a single option ID (for `single` mode) or an array of option IDs (for `multi` mode).

Helper functions:
- `createEmptyTaggingSelection()` — returns `{ primary: null, facets: {} }`.
- `ensureTaggingSelection(input)` — normalizes legacy `string[]` or `null` to `TaggingSelection`.
- `selectionToTagList(input)` — flattens a selection into a string array for display (primary ID + `groupId=optionId` entries).
- `readTaggingSchema(dir)` — reads and parses `tagging-schema.yaml` from a project directory; returns `null` if not found.
- `writeDefaultTaggingSchema(dir)` — fetches the default template from `public/tagging/schema.yaml` and writes it into the project directory; returns the parsed schema.
- `fetchDefaultTaggingSchema()` — fetches the raw YAML text of the default template.
- `fetchTaggingSchema()` — **deprecated**; legacy wrapper that fetches the default template and parses it. Kept for reference / `dropdown-test` page.

### TaggingMenu component
- File: `webapp/components/tagging/TaggingMenu.tsx`
- A fixed-position popup menu rendered when `open` is true.
- Accepts an optional `schema: TaggingSchema` prop. When provided, the schema is used directly. When omitted, falls back to fetching the default template via `fetchTaggingSchema()` (legacy behavior for `dropdown-test`).
- Renders the primary tree as horizontally scrolling columns (multi-level cascade).
- Shows applicable facet groups below the primary selector, with conditional facets gated by `requires_any`.
- Closing behavior:
  - `Enter` → confirm selection.
  - `Escape` or click-outside → dismiss.
  - Double-click an option → confirm immediately.
- Props accept a `selection` that can be `TaggingSelection | string[] | null` for backward compatibility.
- Includes an optional "Clear tags" action.

### TagFolderTree component
- File: `webapp/components/tagging/TagFolderTree.tsx`
- A scrollable collapsible tree view that mirrors the schema's `primary_tree`.
- Props: `schema`, `marks`, `selectedMarkId`, `onSelectMark`, `onContextMenu`, optional `onDropMarkOnNode`, optional `formatTimestamp`.
- The optional `formatTimestamp` prop overrides the default raw-time formatter for custom mark labels.
- Pure presentation + interaction; no data fetching or schema loading.
- Builds a mark index by matching each mark's `tags.primary` to schema node IDs.
- Special buckets: **Untagged** (`primary = null`) and **Unknown tag** (primary not in schema, displayed with raw ID in amber).
- Recursive mark counts on parent folders via badge.
- Folder collapse/expand with CSS `grid-template-rows` animation (200ms ease).
- Auto-expands non-empty folders on initial render; subsequent mark changes expand newly non-empty folders without collapsing user-opened ones.
- Selected mark is scrolled into view via `scrollIntoView({ block: "nearest", behavior: "smooth" })`.
- Mark items are draggable (`draggable`, MIME type `application/x-mark-id`); folder headers accept drops when `onDropMarkOnNode` is provided (visual drag-over feedback).

### Integration in `/player`
- The player page reads `taggingSchema` from `ProjectContext` and passes it as a prop to both `TagFolderTree` and `TaggingMenu`.
- Layout: video player (left, flex-grow) + tag folder tree (right, fixed 300px).
- Right-clicking a mark in the tree opens `TaggingMenu` anchored at the click position.
- Adding a mark via `M` auto-opens `TaggingMenu` (centered on viewport) after the mark is created.
- Drag-and-drop a mark onto a folder header sets `mark.tags = { primary: nodeId, facets: {} }` (undo-aware).
- On confirm, the selection is saved to `mark.tags` as a `TaggingSelection` object.
- When no schema is loaded, the right pane shows a placeholder message.

---

## 11) Match metadata system

Design doc: `plans/post-mvp/metadata/match-metadata-screen.md`.

### Metadata page (`/metadata`)
- File: `webapp/app/metadata/page.tsx`
- Full-bleed layout with a navbar (space-filling buttons, border separators). Left: "← Back to project", "Import match metadata". Right: "Save now", "Player →".
- Reads `matchInfo` from `ProjectContext.manifest`; initialises with `defaultMatchInfo()` if absent.
- Uses debounced auto-save (800ms) via `writeManifest`. Flushes on unmount and before navigation.
- Sections: Match details form, Home/Away team panels (side-by-side responsive grid), Notes textarea.
- "Import match metadata" navbar button opens `FootballDataImporter` modal.

### Components
- **`MatchDetailsForm`** (`webapp/components/metadata/MatchDetailsForm.tsx`) — 3×3 grid of controlled inputs for date, kickoff, competition, season, round, venue, referee, score (H – A).
- **`TeamPanel`** (`webapp/components/metadata/TeamPanel.tsx`) — team name, coach, formation fields + inline editable player table (number, name, position, captain checkbox, substitute checkbox, remove button). Validates duplicate shirt numbers (red highlight). "Import teamsheet" button opens `TeamsheetImporter` modal. "+ Add player" appends a blank row.
- **`TeamsheetImporter`** (`webapp/components/metadata/TeamsheetImporter.tsx`) — modal with file picker (`.csv`, `.tsv`, `.txt`) and paste textarea. Parses input, shows editable preview table, confirm to replace team’s player array.
- **`FootballDataImporter`** (`webapp/components/metadata/FootballDataImporter.tsx`) — modal for importing from football-data.org API v4. Three search modes: by competition + season + matchday, by stage (cups), or by direct match ID. API key input persisted to `localStorage` (key: `football_data_api_key`). Flow: search → results table → detail preview with section toggles (match details, home team, away team, substitutions) → selective confirm. Handles rate-limiting (429), lineups-not-yet-available warning for scheduled matches.
### Utilities
- **`teamsheetParser.ts`** (`webapp/lib/metadata/teamsheetParser.ts`)
  - `parseTeamsheetCSV(text)` — auto-detects delimiter (comma, tab, semicolon), flexible header alias matching (number/name/position/captain/substitute), falls back to first-two-columns heuristic if no headers match.
  - `parseTeamsheetPlainText(text)` — parses `<number> <name>` / `<number>. <name>` / `#<number> <name>` formats. Strips trailing `(C)` captain marker and `(GK)` / `[CB]` position hints.
- **`timeDisplay.ts`** (`webapp/lib/metadata/timeDisplay.ts`)
  - `formatRawTime(ms)` — raw video time as `mm:ss.mmm` or `h:mm:ss.mmm`.
- **`footballDataApi.ts`** (`webapp/lib/metadata/footballDataApi.ts`)
  - API client for football-data.org v4 (via the `/api/football-data` proxy route).
  - Search: `searchMatchesByCompetition`, `searchMatchesByStage`, `fetchMatch`.
  - Mapper: `mapMatchToMatchInfo` converts API response → `MatchInfo`, including position normalisation (e.g. "Centre-Back" → "CB"), lineup/bench player mapping, substitution mapping.
  - API key helpers: `getApiKey()` / `setApiKey()` / `clearApiKey()` (localStorage).
  - `COMPETITIONS` — well-known free-tier competition codes (PL, BL1, SA, PD, FL1, ELC, DED, PPL, CL, EC, WC).

### Navigation integration
- Home page (`/`): "Set up match info →" / "Edit match info" in the left sidebar.
- Metadata page navbar: "← Back to project" (left), "Player →" (right).
- Player page navbar: "← Back" and "Match info" (left), "Delete" and "Stills →" (right).

### Not yet implemented
- Substitution recording on the tagging page (hotkey + picker UI).
- Image OCR for printed teamsheets.
- Dynamic facet population from teamsheet players.

---

## 12) Styling system (Tailwind CSS v4)

Design doc: `plans/post-mvp/ui-refresh/ui-refresh.md` (audit, design principles, implementation checklist).

### Overview
The app uses **Tailwind CSS v4** (build-time only, via `@tailwindcss/postcss`). All design tokens are defined in `webapp/app/globals.css` using the `@theme` directive — `tailwind.config.ts` only specifies content paths.

### Dependencies
- `tailwindcss: ^4.2.1`, `@tailwindcss/postcss: ^4.2.1`, `postcss: ^8.5.6`, `autoprefixer: ^10.4.24` (all dev dependencies).
- PostCSS config: `webapp/postcss.config.mjs` (plugin: `@tailwindcss/postcss`).

### Design tokens (`@theme` in `globals.css`)
- **Colours**: `canvas` (#0f172a), `surface` (#0b1220), `raised` (#1f2937), `hover` (#111827), `selected` (#334155), `accent` (#e5e7eb), `accent-hover` (#cbd5e1), `on-accent` (#0f172a), `subtle` (#1e293b), `border` (#334155), `focus` (#e5e7eb), `muted` (#64748b), `secondary` (#9ca3af), `danger` (#ef4444), `success` (#34d399), `warning` (#fbbf24), `info` (#93c5fd).
- **UI fonts**: `--font-sans` (Helvetica Neue, Helvetica, Arial, sans-serif), `--font-mono` (SF Mono, Cascadia Code, Fira Code, Menlo, monospace). Annotation text shapes store their own `fontFamily` and are rendered from shape style.
- **Text sizes**: `xs` (11px), `sm` (13px), `base` (15px), `lg` (18px), `xl` (22px).
- **Border radius**: all radius tokens (`--radius` through `--radius-3xl`) set to `0px` — everything is square. `--radius-full` remains `9999px` for pills/badges.

### Design principles
1. **Square and blocked-out** — zero border-radius everywhere.
2. **Space-filling** — buttons stretch to fill their container height (`self-stretch`); inputs fill available width.
3. **Dark + monochrome** — colour reserved only for semantic meaning (danger, success, warning).
4. **Helvetica** for app UI; monospace only for timestamps and code. Canvas annotation text uses the per-shape `fontFamily`.
5. **Keyboard-friendly** — visible square focus rings (1px solid, monochrome).

### Base layer (`@layer base`)
- `html, body`: full-height, `overflow-x: hidden`, `bg-canvas`, `text-accent`, `font-sans`.
- `button`: default styling with `bg-raised`, `border border-border`, `rounded-none`, `text-sm`, hover/disabled/focus-visible states.
- `input/select/textarea`: `focus-visible` outline (1px solid focus colour).
- `::selection`: accent background, on-accent text.
- Webkit scrollbar styling (6px, dark track, slate thumb).

### Component layer (`@layer components`)
Key composite classes defined via `@apply`-equivalent CSS:
- `.container` — `max-width: 920px; margin: 0 auto` (used by layout wrapper; homepage opts out via `.fullbleed`).
- `.header` — flex, `items-stretch`, `border-b border-border`, `bg-surface`. Contains `<h1>` (text-lg bold) and `HeaderControls` (Fullscreen button, space-filling via `self-stretch border-0 border-l border-solid border-border`).
- `.toolbar` — flex wrap, `items-stretch`, `gap-0`, `mb-12px`.
- `.panel` — `bg-surface`, `border border-subtle`, `p-12px`.
- `.fullbleed` — breaks out of `.container` to full viewport width.
- `.modal-overlay` — fixed full-viewport backdrop (`bg-base/60`, z-50).
- `.modal-card` — `bg-surface`, `border border-border`, `p-16px`, `max-w-36rem`.
- `.team-grid` — 2-column responsive grid for team panels; collapses to 1 column below 700px.
- `.toast`, `.overlay`, `.loader`, `.spinner`, `.progress`, `.status` — utility classes for feedback UI.

### Navbar pattern
A consistent navigation bar used on `/metadata` and `/player` pages (replacing the old `.toolbar`):
- Container: `flex items-stretch bg-surface border-b border-border`.
- Buttons: `self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base` (left-side buttons) or `border-l` (right-side buttons).
- Spacer: `<span className="flex-1" />` between left and right groups.

### Inline style migration
Previously, components used duplicated inline style constant objects (`INPUT_STYLE`, `LABEL_STYLE`, `CELL_INPUT`). These have been replaced with Tailwind utility classes across all pages:
- `/` (homepage): fully restructured with Tailwind classes.
- `/player`: navbar + content area use Tailwind; no inline styles except `height: calc(100vh - var(--player-headroom))`.
- `/metadata`: navbar uses Tailwind; content area partially migrated.
- `/stills`: inline styles largely replaced with Tailwind utilities (`flex`, `gap`, grid template, status colours).
- `/annotate/[stillId]`: tool buttons extracted to a `toolBtnCls` helper returning Tailwind classes; save status uses semantic colour classes; inspector grid, error panel, and calibration panel use Tailwind.
- `Editor.tsx`: host div, error/calibration/inspector panels, selection rectangle migrated from inline styles to Tailwind.
- `TagFolderTree.tsx`: inline style constant objects (`BADGE_STYLE`, `CHEVRON_STYLE`, `COLLAPSIBLE_STYLE_*`) replaced with Tailwind class strings.
- `TaggingMenu.tsx`: inline style constant objects (`optionButtonBase`, `optionButtonSelected`, `optionButtonLabel`) replaced with Tailwind class strings (`optBtnCls`, `optBtnSelectedCls`, `optBtnLabelCls`).

### Planning docs (UI refresh)
- `plans/post-mvp/ui-refresh/ui-refresh.md` — master plan: audit, design principles, Tailwind config, component classes, 9-section implementation checklist.
- `plans/post-mvp/ui-refresh/stage2-homepage-layout.md` — homepage redesign: empty state + dashboard layout (untracked).
- `plans/post-mvp/ui-refresh/stage2-metadata-layout.md` — metadata layout redesign; marked **DEPRECATED** — only the navbar rework was applied (untracked).
- `plans/post-mvp/ui-refresh/stage2-player-layout.md` — player page: toolbar→navbar, remove `.panel` wrapper, remove status bar (untracked).
- `plans/post-mvp/ui-refresh/stage2-videoplayer-timeline.md` — VideoPlayerUnit redesign: editor-style timeline with ruler, track lane, zoom, transport bar (untracked).

---

## 13) Clips system

Design docs: `plans/post-mvp/clips/clips-feature.md`, `plans/post-mvp/clips/clips-roadmap.md`, and `plans/post-mvp/clips/tracking-correction-architecture.md`.

### Core concept
A **clip** is a reference to a time range within a project video (not a copy of the video data). Clips carry their own keyframed, trackable annotations that animate over the clip's duration. Stills remain independent saved assets, but their relationship to clips is derived from video/time bounds: stills inside a clip range are treated as clip-related media and can be imported onto the corresponding clip frame.

### Data model
Defined in `webapp/lib/types/clip.ts`. Schema version: `CLIP_SCHEMA_VERSION = 1`.

```ts
interface Clip {
  schema: number;
  id: ClipId;             // UUID string
  videoId: string;        // which project video this clip references
  startMs: number;        // absolute video time
  endMs: number;
  startMarkId?: string | null;  // optional mark pinning
  endMarkId?: string | null;
  annotations: ClipAnnotation[];
}
```

**Annotations** (`ClipAnnotation`):
- `id`, `type` (`'box' | 'circle' | 'shadow' | 'arrow' | 'lob' | 'text' | 'poly' | 'highlight'`), `keyframes` (sorted by `tMs`), optional `visibilityKeyframes`, `style` (`ClipAnnotationStyle`), `source` (`'manual' | 'auto' | 'corrected'`), `coordMode` (`'image' | 'pitch'`), optional `text`, optional `trackingAnchorId`, optional `vertexRefs`, and optional `closed` for polygons.

**Keyframes** — per-type interfaces (`BoxKeyframe`, `BoxQuadKeyframe`, `CircleKeyframe`, `ShadowKeyframe`, `ArrowKeyframe`, `LobKeyframe`, `TextKeyframe`, `PolyKeyframe`, `HighlightKeyframe`), all sharing a base `{ tMs: number; visible?: boolean; provenance?: 'manual' | 'tracked' | 'lost' | 'correction' }`. Keyframe timestamps are **clip-relative** (0 = clip start). Visibility keyframes are separate manual show/hide events (`{ tMs, action: 'show' | 'hide' }`) and cannot overlap position keyframes.

**Style** (`ClipAnnotationStyle`): `stroke`, `fill`, `fillOpacity`, `strokeWidth`, `strokePattern` (`'solid' | 'dashed' | 'dotted' | 'dashdot'`), `fontSize`, `fontFamily`, `textHighlight`.

### Mark pinning
Clips can optionally pin their start/end to marks via `startMarkId`/`endMarkId`. On load, `resolveMarkPinning(clip, marks)` updates `startMs`/`endMs` from the current mark positions (lazy resolution — stale ms values cached on disk).

### Interpolation engine
File: `webapp/lib/clip/interpolation.ts`.

`interpolateKeyframes(keyframes, tMs, type, fps)` returns the interpolated geometry at a given clip-relative time:
- **Single keyframe**: clamp (return static properties).
- **Before first / after last**: clamp to boundary keyframe.
- **Between two keyframes**: compute `t ∈ [0,1]` within the bracket.
  - **Linear** (`lerp`): used when bracket gap ≤ 2 frames, and always for poly/point-array types.
  - **Cubic** (Catmull-Rom spline): used for simple numeric properties when bracket gap > 2 frames and adjacent control points exist.
- If either bracket keyframe has `visible: false` → returns `null` (hidden).
- Binary search (`findBracketIndex`) for efficient lookup in sorted keyframes.

### Bbox conversion
File: `webapp/lib/clip/bboxConvert.ts`.

Converts sidecar tracking bboxes `{ x, y, w, h }` to typed `ClipKeyframe[]`:
- `bboxToBox`, `bboxToCircle`, `bboxToHighlight`, `bboxToArrow` — per-type geometry converters. In current UI flows, tracking is highlight-driven and highlight geometry is foot-anchored.
- `convertTrackingKeyframes(rawKeyframes, annotationType, clipStartMs)` — batch converts sidecar results (absolute ms) to clip-relative keyframes.

### Storage
File: `webapp/lib/fs/clipStorage.ts`.

- Clips stored as `clips/clip-<clipId>.json`. Discovered via directory listing (no manifest entry).
- `migrateClipSchema(raw)` — validates and migrates clip JSON (currently v1 only).
- CRUD: `readClip`, `writeClip`, `deleteClip`, `listClips` (sorted by `startMs`).

### Clip editor
- Route: `/clip/[clipId]` → `ClipEditor` component (dynamically imported, SSR disabled).
- Wrapped in `SidecarProvider` for ML feature discovery.
- Video file registered with sidecar via `POST /video/register` for tracking/segmentation/homography.
- Features: video playback synced to clip range, annotation rendering via Konva, keyframe editing, draggable/zoomable timeline strip, show/hide keyframes, still-annotation import, batch tracking, and auto-save.
- ML features (conditional on sidecar): Track / Batch Track / Re-track (YOLO + vendored trackers OC-SORT), Compute Homography (vendored trackers PnLCalib provider), Occlusion toggle, Export to MP4.

### Coordinate modes
- `image`: pixel coordinates relative to the video frame.
- `pitch`: coordinates on a normalized pitch plane, projected to image space via homography. Requires a computed homography matrix for the clip's time range.
- The clip editor defaults to **Draw: Pitch** when homography is loaded/generated, but only pitch-grounded tools (`box`, `circle`) create pitch-space annotations; tactical tools and tracking anchors stay image-space and can follow highlight anchors through `trackingAnchorId` / `vertexRefs`.

### Export
Frontend-driven pipeline:
1. `POST /export/start` → session ID.
2. For each frame: seek video → capture canvas → render annotations via Konva → optionally composite occlusion mask → encode as JPEG → `POST /export/frame`.
3. `POST /export/encode` → ffmpeg encodes to MP4 (libx264, CRF 18, faststart).
4. `DELETE /export/{sessionId}` → cleanup.

Files:
- Types & storage: `webapp/lib/types/clip.ts`, `webapp/lib/fs/clipStorage.ts`
- Interpolation: `webapp/lib/clip/interpolation.ts`
- Bbox conversion: `webapp/lib/clip/bboxConvert.ts`
- Sidecar client: `webapp/lib/clip/sidecarClient.ts`
- Clip page: `webapp/app/clip/[clipId]/page.tsx`
- Clip editor component: `webapp/components/clip/ClipEditor.tsx`

---

## 14) Presentations system

Design doc: `plans/post-mvp/presentations/presentations-feature.md`.

### Core concept
A **presentation** is a deck-like sequence of analysis slides assembled from existing project assets (stills, clips, title cards). Presentations are a narrative composition tool — separate from asset creation. The asset browser is **mark-first**: tag view groups marks by schema, time view groups marks chronologically by video, and clip view groups clips with their in-range stills. Marks without stills remain visible and can be dragged to the deck, materializing a still when needed.

### Data model
Defined in `webapp/lib/types/presentation.ts`. Schema version: `PRESENTATION_SCHEMA_VERSION = 1`.

```ts
interface Presentation {
  schema: number;
  id: string;
  name: string;
  createdAt: string;   // ISO date
  updatedAt: string;
  slides: PresentationSlide[];
  transitions: PresentationTransition[];
  theme?: PresentationTheme;
}
```

**Slide types** (`PresentationSlide` = `StillSlide | ClipSlide | TitleSlide`):
- **`StillSlide`**: `{ kind: 'still', id, stillId, showAnnotations, notes?, holdMs?, annotationSetIds?, annotationSetCues?, annotationCues? }`. Supports set-based annotation selection with per-set enter/exit timing cues.
- **`ClipSlide`**: `{ kind: 'clip', id, clipId, notes?, holdMs? }`.
- **`TitleSlide`**: `{ kind: 'title', id, template ('title' | 'section' | 'divider'), title, body?, notes?, holdMs? }`.

**Transitions** (`PresentationTransition`):
- `{ mode: 'cut' }` — instant switch.
- `{ mode: 'match_video', hideAnnotationsDuringPlayback, playbackRate?, startOffsetMs?, endOffsetMs? }` — plays the source video between two consecutive still slides that share the same `videoId` and have chronologically ordered timestamps. Migration defaults `hideAnnotationsDuringPlayback` to `true` when old files omit it.

### Storage
File: `webapp/lib/fs/presentationStorage.ts`.

- Presentations stored as `presentations/presentation-<presentationId>.json`. Discovered via directory listing.
- `migratePresentationSchema(raw)` — validates and migrates (currently v1). Normalizes transition array length to `slides.length - 1`.
- CRUD: `readPresentation`, `writePresentation`, `deletePresentation`, `listPresentations` (sorted by most recently updated), `renamePresentation`, `duplicatePresentation`.

### Authoring
File: `webapp/lib/presentation/authoring.ts`.

- **Asset index** (`buildPresentationAssetIndex`): builds a tag-tree-driven index of marks with their linked stills. Groups marks by `tags.primary` into schema tree nodes; untagged and unknown-tag marks collected separately. Also identifies stills with missing `sourceMarkId`.
- **Chronological browsing** (`buildChronologicalMarkGroups`): groups marks by source video and sorts them by timestamp, including marks that do not yet have stills.
- **Clip-centered browsing** (`buildClipCenteredStillGroups`): groups in-bounds stills under clips using the derived still/clip time relationship.
- **Slide creation**: `createStillSlide(stillId)`, `createClipSlide(clipId)`, `createTitleSlide(template)`.
- **Transition sync** (`synchronizeTransitions`): when slides are reordered/inserted/removed, preserves existing transitions by edge identity (`fromSlide.id::toSlide.id`); fills gaps with auto-detected defaults (cut, or match_video if same video within 5s).
- **Deck operations**: `insertSlideAtIndex`, `insertSlideAfterSelection`, `removeSlideAtIndex`, `moveSlide`.

### Presentation editor
- Route: `/presentation/[presentationId]` → `PresentationAuthoringEditor` component.
- Layout: asset browser (tag/time/clip source browser), canvas (still/video preview with annotation overlay), inspector (slide properties, annotation set selection, transition settings), deck strip (sortable slide thumbnails and drag-to-insert drop targets).
- **Edit mode**: author slides, adjust transitions, configure annotation visibility and timing.
- **Present mode**: full-screen sequential playback. `match_video` transitions play pre-cut exact-motion clips and then advance directly to the next slide.
- **Annotation rendering**: reuses the still annotation rendering path. Still slides render merged annotations from selected annotation sets, with optional per-set enter/exit timing.
- **Derived media**: presentation playback now uses structured playback assets for original source video plus exact-motion transition and clip-slide media. See §17 (Derived media).
- Auto-save on slide/transition changes.

### Annotation set support on still slides
Still slides can specify which annotation documents to render via `annotationSetIds` and per-set timing via `annotationSetCues` (each with `annotationSetId`, `enterAtMs`, `exitAtMs`). The inspector exposes controls for set selection and timing. `PresentationCanvas` honors these cues during playback, showing/hiding annotation sets at the specified times within the slide's hold duration.

Files:
- Types: `webapp/lib/types/presentation.ts`
- Storage: `webapp/lib/fs/presentationStorage.ts`
- Authoring logic: `webapp/lib/presentation/authoring.ts`
- Presentation list page: `webapp/app/presentations/page.tsx`
- Presentation editor page: `webapp/app/presentation/[presentationId]/page.tsx`
- Authoring editor: `webapp/components/presentation/PresentationAuthoringEditor.tsx`
- Canvas: `webapp/components/presentation/PresentationCanvas.tsx`

---

## 15) Python sidecar service

### Overview
The sidecar (`sidecar/annotate_sidecar/`) is a local **FastAPI** HTTP server that provides ML-powered features. It runs alongside the Next.js frontend on `http://127.0.0.1:8321` (configurable via `--port`). The webapp discovers sidecar capabilities at runtime and adjusts the UI accordingly — all sidecar features are optional.

Current scope note:
- Sidecar-backed **clip/CV workflows** (`/track`, `/segment`, `/homography`, occlusion, clip export) are live optional local workflows.
- The sidecar also backs the **video-loading / derived-media path** for presentations, specifically exact-motion transition and clip media.

### Requirements
- Python 3.10–3.12 (TensorFlow does not support 3.13+).
- ffmpeg (for export encoding).
- Dependencies installed via `sidecar/requirements.txt`.
- MobileSAM installed separately (`pip install git+https://github.com/ChaoningZhang/MobileSAM.git`).
- Tracking uses vendored trackers OC-SORT primitives under `annotate_sidecar/vendor/trackers/`.
- Homography uses the vendored trackers `PnLCalibProvider`, with an accessible upstream PnLCalib checkout + weights via `sidecar/third_party/pnlcalib`, `../trackers/third_party/pnlcalib`, or `ANNOTATE_PNLCALIB_ROOT`.

### Architecture
```text
annotate_sidecar/
  __main__.py              # CLI entry point (uvicorn)
  server.py                # FastAPI app, CORS, lifespan
  video_registry.py        # videoRef → temp-file registry
  routes/
    health.py              # GET /health
    track.py               # POST /track
    segment.py             # POST /segment
    homography.py          # POST /homography
    export.py              # Export endpoints
    video.py               # Video register/unregister
    derived_media.py       # POST /derived-media/exact-motion
  services/
    frame_extractor.py     # cv2.VideoCapture → frames
    tracker.py             # YOLO + vendored trackers OC-SORT adapter
    segmenter.py           # YOLO + MobileSAM
    calibration/           # PnLCalib-backed homography provider adapter
    encoder.py             # ffmpeg MP4 encoding
  vendor/trackers/         # Vendored trackers primitives (OC-SORT + PnLCalib)
  models/                  # Optional local model cache (gitignored)
```

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Status + model availability + capabilities list |
| `POST` | `/video/register` | Upload video file → `videoRef` (temp registry) |
| `POST` | `/video/normalize` | Transcode upload to project FPS/resolution → MP4 blob |
| `DELETE` | `/video/{videoRef}` | Unregister temp video |
| `POST` | `/track` | Object tracking (YOLO + vendored trackers OC-SORT): `videoRef`, time range, seed bbox → keyframes |
| `GET` | `/track/debug/{artifact}` | Download a saved tracking debug MP4 artifact |
| `POST` | `/segment` | Person segmentation (YOLO + MobileSAM): `videoRef`, frame ms → base64 PNG alpha mask |
| `POST` | `/homography` | Pitch homography (vendored trackers PnLCalib provider): `videoRef`, time range → per-frame 3×3 matrices |
| `POST` | `/export/start` | Begin export session → `sessionId` |
| `POST` | `/export/frame` | Submit rendered frame (base64 JPEG) |
| `POST` | `/export/encode` | Encode frames → MP4 (ffmpeg, libx264, CRF 18) |
| `GET` | `/export/{sessionId}/file` | Download encoded export MP4 before cleanup |
| `DELETE` | `/export/{sessionId}` | Clean up export session |
| `POST` | `/derived-media/exact-motion` | Encode exact video segment → MP4 blob |

### Video registration
Routes that require video access (`/track`, `/segment`, `/homography`) accept either:
- `videoRef` from `POST /video/register` (recommended — webapp uploads the file from the File System Access API).
- Absolute `videoPath` (legacy). Relative paths are rejected.

### Frontend integration
- **Sidecar client** (`webapp/lib/clip/sidecarClient.ts`): typed API functions for all endpoints (`checkHealth`, `registerVideoFile`, `requestTracking`, `requestSegmentation`, `requestHomography`, `startExport`, `sendExportFrame`, `encodeExport`, `cleanupExport`, `requestExactMotionEncode`, etc.).
- **SidecarContext** (`webapp/lib/state/SidecarContext.tsx`): React context providing `{ connected, capabilities, models, baseUrl, retry }`. Polls `/health` on mount, every 30s, and on tab focus (`visibilitychange`). Components use `useSidecar()` to conditionally show/hide ML features.

### Graceful degradation
When the sidecar is unavailable:
- Track, Re-track, Compute Homography, Occlusion, and Export buttons are hidden via capability flags (`canTrack`, `canComputeHomography`, `canSegment`, `canExport`).
- Manual-only clip editing remains fully functional.

### Hardware support
- **CPU-only**: all features work (slower tracking/segmentation).
- **CUDA GPU**: accelerates YOLO, MobileSAM, and PnLCalib.
- **Apple Silicon**: supported via MPS (Metal Performance Shaders) for PyTorch.

### Homography cache
File: `webapp/lib/fs/homographyCache.ts`.

Computed homography matrices are cached on disk at `homography-cache/range-<startMs>-<endMs>.json`:
- `writeHomographyCache(projectDir, startMs, endMs, frames)`.
- `readHomographyCache(projectDir, startMs, endMs)` — exact range match.
- `findOverlappingCache(projectDir, startMs, endMs)` — finds any cached range that fully contains the requested range.

Files:
- Sidecar: `sidecar/annotate_sidecar/` (all routes and services)
- Sidecar README: `sidecar/README.md`
- Client: `webapp/lib/clip/sidecarClient.ts`
- Context: `webapp/lib/state/SidecarContext.tsx`
- Homography cache: `webapp/lib/fs/homographyCache.ts`

---

## 16) Project integrity

File: `webapp/lib/utils/projectIntegrity.ts`.

### Purpose
Ensures referential integrity between marks, stills, and annotations on project open. Runs automatically during `validateProjectFolderStructure()`.

### Repairs performed
1. **Duplicate mark timestamps**: detects multiple marks at the same `(videoId, t_ms)`. Reports as `duplicate_mark_timestamp` issues but does not auto-merge (user intervention required).
2. **Still–mark linking** (`sourceMarkId`):
   - For each still, validates that `sourceMarkId` points to an existing mark with the same `videoId`.
   - If missing or broken: attempts to find a unique mark at the exact `(videoId, t_ms)`.
   - If no mark exists at that timestamp: creates a **backfilled mark** (`mark_backfill_<stillId>`) and sets `sourceMarkId`.
   - Reports unresolvable cases as `unresolved_still_source_mark` issues.
3. **Annotation reindexing**: `scanAnnotationEntries` recursively walks `annotations/` and rebuilds `manifest.annotations` with document-aware entries.

### Key functions
- `repairManifestIntegrity(manifest)` → `{ manifest, changed, issues }`.
- `findMarkAtTimestamp(marks, videoId, t_ms)` — exact lookup.
- `hasDuplicateMarkTimestamp(marks, videoId, t_ms)` — duplicate check.
- `findLinkedStillsForMark(stills, markId)` — reverse lookup.
- `findCanonicalStillForMark(manifest, markId)` — selects the best still for a mark (exact timestamp match preferred, then closest, then alphabetical).
- `summarizeManifestRepairIssues(issues)` — human-readable issue summary.

### Integration
- `validateProjectFolderStructure()` in `projectFolder.ts` runs `reindexAnnotations` + `repairManifestIntegrity` on every project open.
- If repairs are needed, the updated manifest is persisted automatically.
- If unresolvable issues remain (e.g. duplicate mark timestamps), the project is reported as invalid with a descriptive reason.
- Player page prevents creating duplicate marks at the same `(videoId, t_ms)`.
- Stills page always writes `sourceMarkId` when capturing, reusing the selected/exact mark or creating a new one.

---

## 17) Derived media

Design doc: `plans/post-mvp/presentation-derived-media/derived-media-serving.md`.

### Overview
Derived media are sidecar-encoded video assets used by presentations for smooth playback. The active implementation is now intentionally narrow:
- **Exact-motion assets**: precise transition clips and clip-slide playback clips generated for preview/present workflows, stored per presentation.

Current implementation note:
- Transition preview, present playback, and clip slides wait for exact-motion assets and then play those generated clips directly.
- Retrieval stays on direct original-video loading and does not route through a proxy layer.

### Storage layout
Under `derived-media/` in the project directory:
- `presentations/<presentationId>/index.json` — `ExactMotionAssetIndexFile` tracking motion assets.
- `presentations/<presentationId>/jobs.json` — `DerivedMediaJobQueueFile` tracking generation jobs.
- `presentations/<presentationId>/preparation.json` — `PresentationPreparationStatusFile`.
- `presentations/<presentationId>/motion-assets/*.mp4` — encoded motion asset files.

### Asset lifecycle
1. **Queueing**: transition preview, present playback, and clip slides queue missing/stale exact-motion assets for playable `match_video` edges and clip-slide requirements.
2. **Execution**: exact-motion jobs register the source video, request `POST /derived-media/exact-motion`, write the result as a `.pending` file, verify currentness, then promote via `promoteExactMotionJobIfCurrent()`.
3. **Index management**: asset indices track status (`ready`, `stale`, `missing`, `failed`, `queued`, `running`). Reconciliation runs on load to sync index with on-disk files and job queue state.
4. **Startup cleanup**: `cleanupPendingExactMotionFilesForActiveJobs()` removes interrupted `.pending` files on presentation load.

### Playback asset resolver
File: `webapp/lib/presentation/playbackAssetResolver.ts`.

The resolver layer maps video IDs and motion requirements to structured `PlaybackAsset` objects with workflow metadata (original or exact motion). Transition and clip-slide workflows resolve exact-motion assets; retrieval resolves original video.

### Preparation status
File: `webapp/lib/presentation/presentPreparation.ts`.

Evaluates presentation closure requirements for exact-motion assets. In the current code this helper still uses internal `ready`, `degraded`, and `failed` status values while tracking transition and clip-slide exact-motion requirements, even though the presentation UI has been simplified around direct preview / present flows.

Files:
- Types: `webapp/lib/presentation/derivedMediaTypes.ts`
- Storage: `webapp/lib/fs/derivedMediaStorage.ts`
- Jobs: `webapp/lib/presentation/derivedMediaJobs.ts`
- Keys: `webapp/lib/presentation/derivedMediaKeys.ts`
- Resolver: `webapp/lib/presentation/playbackAssetResolver.ts`
- Preparation: `webapp/lib/presentation/presentPreparation.ts`

---

## 18) Testing

The project uses **Vitest** for unit/component-level tests (`vitest: ^4.0.18`) and **Playwright** for browser flows. Root scripts delegate into `webapp/`:
- `npm run test` — Vitest single run. `webapp/vitest.config.ts` excludes `e2e/**`.
- `npm run test:e2e` — Playwright browser flows under `webapp/e2e`.
- `npm run test:e2e:headed` — headed Playwright run.
- `npm run playwright:install` — install the Chromium browser used by Playwright.

Existing test files:
- `webapp/components/annotate/saveTick.test.ts` — manual-save tick consumption.
- `webapp/components/annotate/tacticalGeometry.test.ts` — lob and shadow tactical geometry helpers.
- `webapp/lib/annotate/pitchCalibration.test.ts` — pitch calibration projection helpers.
- `webapp/lib/annotate/quickSession.test.ts` — quick-annotate session helpers (file stash handoff, deterministic still IDs, export naming).
- `webapp/lib/fs/annotationStorage.test.ts` — annotation document storage and indexing.
- `webapp/lib/metadata/teamsheetParser.test.ts` — CSV and plain-text teamsheet parsing (headers, aliases, delimiters, captain markers, position hints, fallback).
- `webapp/lib/metadata/timeDisplay.test.ts` — raw timestamp formatting.
- `webapp/lib/fs/clipStorage.test.ts` — clip schema migration, mark pinning resolution, CRUD operations.
- `webapp/lib/clip/interpolation.test.ts` — linear/cubic interpolation, clamping, visibility, bracket search, per-type interpolators.
- `webapp/lib/clip/bboxConvert.test.ts` — bbox-to-geometry conversion and batch tracking keyframe conversion.
- `webapp/lib/clip/editorState.test.ts` — tracked keyframe merging and correction-state helpers.
- `webapp/lib/clip/frameMath.test.ts` — frame snapping/stepping helpers.
- `webapp/lib/clip/homographyInterpolation.test.ts` — homography lookup/interpolation.
- `webapp/lib/clip/pitchProjection.test.ts` — image/pitch projection helpers.
- `webapp/lib/clip/sidecarClient.test.ts` — sidecar API client tests.
- `webapp/lib/clip/stillImport.test.ts` — still annotation import into clip keyframes.
- `webapp/lib/clip/stillRelationship.test.ts` — derived still/clip time-bound relationships.
- `webapp/lib/clip/trackingState.test.ts` — tracking provenance, gaps, and visibility state.
- `webapp/lib/clip/videoLocator.test.ts` — video locator utility tests.
- `webapp/lib/fs/presentationStorage.test.ts` — presentation schema migration, CRUD, transition normalization, rename, duplicate.
- `webapp/lib/fs/derivedMediaStorage.test.ts` — derived media queue reads vs startup cleanup behavior for pending files.
- `webapp/lib/presentation/authoring.test.ts` — presentation asset grouping and deck authoring helpers.
- `webapp/lib/presentation/derivedMediaServing.test.ts` — derived media serving/resolver tests.
- `webapp/lib/utils/projectIntegrity.test.ts` — manifest repair, duplicate mark detection, sourceMarkId backfill, canonical still selection.

Existing Playwright specs:
- `webapp/e2e/home.spec.ts` — app bootstrap/homepage smoke flow.
- `webapp/e2e/clip-editor.spec.ts`, `clip-homography.spec.ts`, `clip-occlusion.spec.ts`, `clip-save-reload.spec.ts` — clip editor browser coverage.
- `webapp/e2e/presentation-*.spec.ts` — presentation authoring, retrieval, transitions, clip slides, present mode, and domain flows.

---

## 19) Segmentation test page (experimental)

The `segmentation-test` route is a sandbox for foreground extraction from a still image.

### Purpose
- Provide a quick way to validate segmentation approaches and tune parameters.
- The same underlying segmentation helpers are used by the annotation editor for optional foreground occlusion.

### Implemented methods
1. **Edge-based segmentation**
  - File: `webapp/lib/segmentation/edgeSegmentation.ts`
  - Approach:
    - compute mask at `maskMaxDim` (or `maxDim`)
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
- `w`, `h`: cutout canvas dimensions
- `maskW`, `maskH`: mask dimensions
