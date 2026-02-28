# Football Analysis Annotator – Technical Specification (As-Built)

## Overview
This repository contains a working **Next.js (React 18 + TypeScript)** web application under `webapp/` for stills-first football match analysis.

This repository is licensed under the **Apache-2.0** license.

The as-built workflow is:

1. Create/open a project folder on disk (Chromium File System Access API).
2. Import videos into the project.
3. Enter match metadata (teams, teamsheets, period boundaries).
4. Tag moments ("marks") while watching video.
5. Generate still PNGs + thumbnails.
6. Annotate stills with a Konva-based editor.
7. Export annotated PNGs and reports into the project folder.

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
13. Testing
14. Segmentation test page (experimental)

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
- Tagging schema & helpers: `webapp/lib/tagging/schema.ts`
- Tagging UI — menu: `webapp/components/tagging/TaggingMenu.tsx`
- Tagging UI — folder tree: `webapp/components/tagging/TagFolderTree.tsx`
- Tagging schema default template: `webapp/public/tagging/schema.yaml`
- Video player: `webapp/components/player/VideoPlayerUnit.tsx`
- Stills export: `webapp/lib/export/d7Export.ts`, `webapp/lib/export/d7Render.ts`
- Annotation editor: `webapp/components/annotate/Editor.tsx`
- Metadata page: `webapp/app/metadata/page.tsx`
- Metadata components: `webapp/components/metadata/` (MatchDetailsForm, TeamPanel, TeamsheetImporter, PeriodEditor, FootballDataImporter)
- Metadata utilities: `webapp/lib/metadata/` (teamsheetParser, timeDisplay, footballDataApi)
- API proxy: `webapp/app/api/football-data/route.ts`
- Styling: `webapp/app/globals.css` (Tailwind v4 `@theme` + component classes), `webapp/tailwind.config.ts`, `webapp/postcss.config.mjs`

---

## 2) Routes and user-facing pages

### `/` – Project + import
- File: `webapp/app/page.tsx`
- Layout: full-bleed, two-state design.
  - **Empty state** (no project open): viewport-centered card with title, two large CTA buttons ("Create New Project", "Open Existing Project"), and a Chromium-required warning if the File System Access API is unavailable.
  - **Dashboard** (project open): two-column layout.
    - **Left sidebar** (320px fixed): project name, created date, stat counts (videos / marks / stills), action buttons (Match Info, Import Video, Save Now), and a "Close Project" button separated by a divider at the bottom.
    - **Right area** (flex-grow): video list heading with count, selectable video rows (label, duration, resolution; selected row highlighted with `bg-selected` and left accent border; clicking navigates to `/player`), and a dashed-border drop zone for drag-and-drop video import.
- Responsibilities:
  - Create a new project folder (creates required subdirectories + `project.json` + `tagging-schema.yaml`).
  - Open an existing project folder (validates structure + loads `project.json` + reads `tagging-schema.yaml`; if missing, prompts to add the default schema).
  - Import video files into `media/` (streaming copy via file picker or drag-and-drop onto the drop zone).
  - Choose a video to work on (sets `selectedVideoId` then routes to `/player`).
  - "Set up match info →" / "Edit match info" button in the sidebar links to `/metadata`.

### `/metadata` – Match metadata
- File: `webapp/app/metadata/page.tsx`
- Layout: full-bleed with a navbar replacing the old toolbar. Navbar buttons use the space-filling pattern (`self-stretch`, square, border separators). Left group: "← Back to project", "Import match metadata". Right group: "Save now", "Player →".
- Responsibilities:
  - Edit match details (date, kickoff, competition, season, round, venue, referee, score).
  - Edit home/away team panels (name, coach, formation, inline editable player table).
  - Import teamsheets from CSV/TSV/TXT files or pasted text.
  - Import match metadata from football-data.org API (search → preview → selective import).
  - Edit period boundaries (1st Half, 2nd Half, etc.) with a mini video scrubber and "Set" buttons.
  - Free-form notes field.
  - Debounced auto-save of `matchInfo` to `project.json` (800ms).

### `/player` – Playback + tagging
- File: `webapp/app/player/page.tsx`
- Layout: full-bleed, navbar + two-pane content. Navbar uses the space-filling button pattern: left group ("← Back", "Match info"), right group ("Delete", "Stills →"). Below the navbar: video player with editor-style timeline (left, flex-grow) + tag folder tree (right, 300px fixed, `border-l`).
- Responsibilities:
  - Load video bytes from the project folder and play them via `<video>`.
  - Create marks at timestamps (`t_ms`); adding a mark auto-opens the `TaggingMenu`.
  - Display marks organised into collapsible folders mirroring the `primary_tree` schema, via the `TagFolderTree` component.
  - Display period-aware timestamps (e.g. "1H 34:12") when period boundaries are set; falls back to raw video time otherwise.
  - Tag marks via a hierarchical tagging menu (right-click a mark to open `TaggingMenu`); schema is passed as a prop from `ProjectContext`.
  - Re-tag marks by dragging them onto a folder in the tree (sets `primary` to the target node ID, clears facets).
  - Undo/redo for mark and tag edits (⌘Z / ⌘⇧Z), with a 50-entry stack.
  - Persist mark edits by rewriting `project.json`.

### `/player-legacy` – Legacy playback + marks (preserved)
- File: `webapp/app/player-legacy/page.tsx`
- The original `/player` page, preserved as-is for reference/fallback. Not reachable from normal navigation.

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

The `.matchproj` suffix is currently a naming convention used by the UI (not a filesystem requirement).

### Required structure
Created/validated by `webapp/lib/fs/projectFolder.ts`.

```text
MyMatch.matchproj/
  project.json
  tagging-schema.yaml
  media/
  stills/
  thumbnails/
  annotations/
  reports/
    annotated/
  clips/
```

Notes:
- `tagging-schema.yaml` is written from the default template on project creation. For existing projects opened without one, the user is prompted to add it.
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
import type { TaggingSelection } from "../tagging/schema";

export interface ProjectManifestV1 {
  schema: 'project.v1';
  name: string;
  created: string;
  videos: { id: string; label: string; file: string; durationMs?: number; width?: number; height?: number; fps?: number }[];
  marks: { id: string; videoId: string; t_ms: number; tags?: TaggingSelection | string[] }[];
  stills: { id: string; videoId: string; t_ms: number; file: string; width?: number; height?: number }[];
  annotations: { stillId: string; file: string; lastModified?: string }[];
  reports: string[];
  thumbnails: string[];
  matchInfo?: MatchInfo;
}
```

### Match metadata types
Also defined in `webapp/lib/types/project.ts`:

- **`MatchInfo`** — top-level match metadata: `homeTeam`, `awayTeam` (both `TeamInfo`), `date`, `kickoffTime`, `competition`, `season`, `round`, `venue`, `referee`, `score`, `substitutions` (`Substitution[]`), `periods` (`MatchPeriod[]`), `notes`.
- **`TeamInfo`** — `name`, `coach`, `formation`, `players` (`PlayerEntry[]`).
- **`PlayerEntry`** — `id` (UUID), `number`, `name`, `position`, optional `isCaptain`, `isSubstitute`.
- **`Substitution`** — `id`, `team` (`"home" | "away"`), `minute`, `playerOut` (PlayerEntry ID), `playerIn` (PlayerEntry ID).
- **`MatchPeriod`** — `id`, `label` (e.g. "1st Half"), `videoId`, `startMs`, `endMs`.
- **`defaultMatchInfo()`** — returns a blank `MatchInfo` with empty arrays and null fields.
- **`defaultProjectManifest(name)`** — returns a blank `ProjectManifestV1`.

Existing projects without `matchInfo` are handled gracefully — the field is simply absent until the user fills it in.

Key invariants:
- `schema` must equal `"project.v1"`.
- `videos[].file`, `stills[].file`, and the strings in `thumbnails[]` / `reports[]` are **relative paths** within the project directory.
- `marks[].tags` may be a `TaggingSelection` object (`{ primary, facets }`) or a legacy `string[]`. Readers must handle both via `ensureTaggingSelection()` from `webapp/lib/tagging/schema.ts`.
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
- **Horizontal scroll**: mouse wheel on the timeline scrolls horizontally (vertical delta mapped to horizontal). Ctrl+wheel zooms instead. During playback, auto-scrolls to keep the playhead visible (~33% from left edge). When paused, free scroll; selecting an off-screen mark auto-scrolls to it.
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
- The optional `formatTimestamp` prop overrides the default raw-time formatter (used by the player page to inject period-aware timestamps via `formatMatchTimestamp`).
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
- When period boundaries are set in `matchInfo.periods`, the player passes a `formatTimestamp` callback (using `formatMatchTimestamp`) to `TagFolderTree` so mark times display as e.g. "1H 34:12".
- When no schema is loaded, the right pane shows a placeholder message.

---

## 11) Match metadata system

Design doc: `plans/post-mvp/metadata/match-metadata-screen.md`.

### Metadata page (`/metadata`)
- File: `webapp/app/metadata/page.tsx`
- Full-bleed layout with a navbar (space-filling buttons, border separators). Left: "← Back to project", "Import match metadata". Right: "Save now", "Player →".
- Reads `matchInfo` from `ProjectContext.manifest`; initialises with `defaultMatchInfo()` if absent.
- Uses debounced auto-save (800ms) via `writeManifest`. Flushes on unmount and before navigation.
- Sections: Match details form, Home/Away team panels (side-by-side responsive grid), Period editor, Notes textarea.
- "Import match metadata" navbar button opens `FootballDataImporter` modal.

### Components
- **`MatchDetailsForm`** (`webapp/components/metadata/MatchDetailsForm.tsx`) — 3×3 grid of controlled inputs for date, kickoff, competition, season, round, venue, referee, score (H – A).
- **`TeamPanel`** (`webapp/components/metadata/TeamPanel.tsx`) — team name, coach, formation fields + inline editable player table (number, name, position, captain checkbox, substitute checkbox, remove button). Validates duplicate shirt numbers (red highlight). "Import teamsheet" button opens `TeamsheetImporter` modal. "+ Add player" appends a blank row.
- **`TeamsheetImporter`** (`webapp/components/metadata/TeamsheetImporter.tsx`) — modal with file picker (`.csv`, `.tsv`, `.txt`) and paste textarea. Parses input, shows editable preview table, confirm to replace team’s player array.
- **`FootballDataImporter`** (`webapp/components/metadata/FootballDataImporter.tsx`) — modal for importing from football-data.org API v4. Three search modes: by competition + season + matchday, by stage (cups), or by direct match ID. API key input persisted to `localStorage` (key: `football_data_api_key`). Flow: search → results table → detail preview with section toggles (match details, home team, away team, substitutions) → selective confirm. Handles rate-limiting (429), lineups-not-yet-available warning for scheduled matches.
- **`PeriodEditor`** (`webapp/components/metadata/PeriodEditor.tsx`) — mini video scrubber (`<video controls>`) + period table with editable label, start/end timestamps, "Set" buttons that capture current video time. Auto-creates default "1st Half" / "2nd Half" periods on mount if none exist. Add/remove period rows.

### Utilities
- **`teamsheetParser.ts`** (`webapp/lib/metadata/teamsheetParser.ts`)
  - `parseTeamsheetCSV(text)` — auto-detects delimiter (comma, tab, semicolon), flexible header alias matching (number/name/position/captain/substitute), falls back to first-two-columns heuristic if no headers match.
  - `parseTeamsheetPlainText(text)` — parses `<number> <name>` / `<number>. <name>` / `#<number> <name>` formats. Strips trailing `(C)` captain marker and `(GK)` / `[CB]` position hints.
- **`timeDisplay.ts`** (`webapp/lib/metadata/timeDisplay.ts`)
  - `formatRawTime(ms)` — raw video time as `mm:ss.mmm` or `h:mm:ss.mmm`.
  - `formatMatchTimestamp(videoTimeMs, videoId, periods)` — returns `{ display, periodAware }`. Matches timestamp to a period with complete boundaries and formats as `"1H 34:12"`, `"2H 07:40"`, `"ET1 05:00"`, etc. Falls back to raw time when no matching period is found. Short label mapping: "1st Half" → "1H", "2nd Half" → "2H", "Extra Time 1" → "ET1", "Extra Time 2" → "ET2"; unknown labels used as-is.
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
- **Fonts**: `--font-sans` (Helvetica Neue, Helvetica, Arial, sans-serif), `--font-mono` (SF Mono, Cascadia Code, Fira Code, Menlo, monospace).
- **Text sizes**: `xs` (11px), `sm` (13px), `base` (15px), `lg` (18px), `xl` (22px).
- **Border radius**: all radius tokens (`--radius` through `--radius-3xl`) set to `0px` — everything is square. `--radius-full` remains `9999px` for pills/badges.

### Design principles
1. **Square and blocked-out** — zero border-radius everywhere.
2. **Space-filling** — buttons stretch to fill their container height (`self-stretch`); inputs fill available width.
3. **Dark + monochrome** — colour reserved only for semantic meaning (danger, success, warning).
4. **Helvetica** font family everywhere; monospace only for timestamps and code.
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

## 13) Testing

The project uses **Vitest** for unit tests (`vitest: ^4.0.18` dev dependency). Scripts:
- `npm run test` — single run.
- `npm run test:watch` — watch mode.

Existing test files:
- `webapp/lib/metadata/teamsheetParser.test.ts` — 26 tests covering CSV (standard headers, aliases, TSV, semicolons, fallback, empty, unicode, Windows line endings) and plain-text (number formats, no-number, captain marker, position hints, blank lines, whitespace, unique IDs).
- `webapp/lib/metadata/timeDisplay.test.ts` — 16 tests covering `formatRawTime` (zero, sub-minute, minutes, hours, negative clamp) and `formatMatchTimestamp` (complete boundaries, missing boundaries, between/before/after periods, different videoId, custom labels like "Extra Time 1" and unknown labels).

---

## 14) Segmentation test page (experimental)

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
