# Annotate 0.2 As-Built Technical Reference

Date: 2026-07-11

Status: current implementation on the Annotate 0.2 development branch. The
code is authoritative if this document drifts.

## 1. Product model

Annotate is a browser-based, self-hosted football analysis application. The
canonical workflow is:

1. Create a local project and enter its match metadata.
2. Import video. The sidecar preserves its own FPS/resolution where possible.
3. Watch the video and press tagging-board buttons to capture clips.
4. Open a clip to animate tactical shapes and mark important frames with pins.
5. Annotate a pin's exact video frame with one or more drawing documents.
6. Build a presentation from clips, pins, and title cards.
7. Export clip reports and annotated pin images into the project folder.

The three main analysis concepts are deliberately distinct:

- A **clip** is a half-open passage of play in one video and owns animated
  tactical annotations.
- A **pin** is one important absolute frame inside a clip.
- A **pin annotation document** is a frozen-frame drawing attached to a pin.

Pins are clip-local. Two overlapping clips may each have a pin at the same
video frame because the clips are independent analyses.

## 2. Compatibility boundary

Annotate 0.2 reads and writes only `project.v2`. It explicitly refuses
`project.v1` and has no data migrator. Existing 0.1 projects must remain on the
pinned `v0.1.0-pre.3` application.

The exception is the standalone `/quick-annotate` utility. It retains its
independent `annotations.v1` OPFS session format and does not participate in a
project.

## 3. Runtime architecture

### Web application

- Next.js 14.2.5 App Router
- React 18.2 and TypeScript
- Konva / React-Konva for drawing
- Tailwind CSS 4 for styling
- `react-resizable-panels` for persisted editor layouts
- File System Access API for project files
- IndexedDB for the restorable project directory handle
- OPFS for standalone quick-annotate sessions

Primary code areas:

```text
webapp/app/                 App Router pages
webapp/components/          route-level and shared UI
webapp/lib/types/           runtime domain contracts
webapp/lib/fs/              File System Access persistence
webapp/lib/clip/            frame math, interpolation, tracking adapters
webapp/lib/presentation/    authoring and playback logic
webapp/lib/tagging/         board parsing and capture engine
webapp/lib/i18n/            locale provider and catalogs
```

`webapp/app/layout.tsx` installs one `LocaleProvider` and one
`ProjectProvider`. The project provider exposes the validated manifest, board,
selected video, directory handle, and integrity report. It never publishes
partially validated project state.

### Python sidecar

The local FastAPI service runs on `http://127.0.0.1:8321` by default. It owns:

- smart video preparation and authoritative frame probing;
- YOLO detection plus vendored OC-SORT tracking;
- vendored PnLCalib homography estimation;
- optional person segmentation;
- ffmpeg export-session encoding APIs; and
- exact-motion segment generation for presentations.

`npm run dev` starts the webapp and sidecar together. The client base URL can
be changed with `NEXT_PUBLIC_SIDECAR_URL`. See `sidecar/README.md` for the full
HTTP contract and model requirements.

## 4. Frame contract

Every authored media position is an absolute, zero-based source-video frame.
The domain does not store clip-relative frame numbers or media timestamps.

- A displayable position has branded type `VideoFrame`.
- An exclusive end has branded type `FrameBoundary`.
- Clip ranges are `[startFrame, endFrame)`.
- The last displayable clip frame is `endFrame - 1`.
- `endFrame` may equal the video's `frameCount`.
- Presentation cue durations remain wall-clock milliseconds because they are
  not media positions.

`webapp/lib/clip/frameMath.ts` is the only conversion boundary. Seeking writes
`frame / fps`. Presented-frame identity prefers
`requestVideoFrameCallback().mediaTime` and floors with an epsilon; it clamps to
`[0, frameCount - 1]`.

The sidecar API remains timestamp-based. Requests convert frames to
milliseconds at `sidecarClient.ts`. Its frame sampler includes `endMs`, so a
domain range sends `frameToMs(endFrame - 1)`, not the exclusive boundary.
One-frame clips are valid data, but tracking and homography range actions need
at least two frames because the current sidecar requires `endMs > startMs`.

## 5. Project folder

A project is a normal user-selected directory:

```text
MyMatch/
  project.json
  tagging-board.json
  media/
  analysis/
    clips/
      <clipId>/
        clip.json
        annotations/
          <annotationId>.json
  presentations/
    <presentationId>.json
  homography-cache/
  derived-media/
    presentations/
      <presentationId>/
        assets-v2.json
        motion-v2/
  exports/
    report/
      clips.json
      clips.csv
      annotated/
  cache/
  .trash/
    clips/
    pins/
    annotations/
    tombstones/
```

`project.json` is the creation commit marker. Project creation refuses a
non-empty destination, creates the directory structure and default board, then
writes the manifest last. A partial tree without a valid manifest is not an
openable project.

Clips and presentations are discovered by directory scan rather than indexed
in `project.json`. Homography and exact-motion files are regenerable caches.
`exports/` contains rendered outputs, never copied source video.

## 6. Persisted schemas

### `project.json`

The canonical TypeScript contract is `webapp/lib/types/project.ts`:

```ts
interface ProjectManifest {
  schema: 'project.v2';
  name: string;
  created: string;
  videos: VideoEntry[];
  matchInfo?: MatchInfo;
}

interface VideoEntry {
  id: string;
  label: string;
  file: string;                  // confined to media/
  fps: number;                   // authoritative for this video
  frameCount: FrameBoundary;
  frameCountSource: 'normalize' | 'probe';
  width: number;                 // authoritative source/output dimensions
  height: number;
}
```

Manifest parsing is strict. Video IDs must be unique, paths must stay in
`media/`, and each video's FPS, dimensions, and authoritative frame count must
be positive. Early development `project.v2` manifests with top-level `fps` and
`resolution` still open; those obsolete fields are ignored and omitted on the
next manifest write.

### `tagging-board.json`

The required `tagging-board.v1` file contains:

- project-wide default lead/lag seconds and capture mode;
- flat visual groups of primary-tag buttons;
- optional per-button hotkeys and capture overrides;
- per-button applicable facet-group IDs; and
- single- or multi-select facet groups with optional `requiresAny` rules.

The parser rejects duplicate or unresolved IDs, invalid defaults, dependency
cycles, and malformed requirements. Conflicting hotkeys disable every binding
in that collision rather than selecting one implicitly. If a valid v2 project
is missing its board, open installs the default board from
`webapp/public/tagging/board.json`.

Older v2 board files using `leadFrames`/`lagFrames` are read as 30 FPS reference
durations and converted in memory to seconds. Capture converts those durations
to frames using the selected video's FPS.

Board labels are project-authored data. They are intentionally displayed as
stored and are not translated by the application locale.

### `clip.json`

The canonical contract is `webapp/lib/types/clip.ts`:

```ts
interface Clip {
  schema: 'clip.v2';
  id: string;
  videoId: string;
  startFrame: VideoFrame;
  endFrame: FrameBoundary;
  label?: string;
  tags: { primary: string | null; facets: Record<string, string | string[]> };
  pins: ClipPin[];
  annotations: ClipAnnotation[];
}
```

Clip validation enforces:

- folder ID equals document ID;
- a non-empty half-open frame range;
- unique pin IDs and at most one pin per frame;
- pins sorted and confined to the clip;
- annotation IDs unique across the entire clip;
- pin document paths exactly `annotations/<annotationId>.json`;
- at most one default document per pin;
- keyframes sorted, unique, and in range; and
- geometry and visibility keyframes do not share a frame.

Animated annotation types are `box`, `circle`, `highlight`, `shadow`, `arrow`,
`lob`, `poly`, and `text`. Each object has image- or pitch-coordinate geometry,
style, provenance-aware geometry keyframes, and optional show/hide keyframes.
Only boxes and circles support pitch coordinates in the current editor.

### Pin annotation document

`webapp/lib/types/annotations.ts` defines `annotations.v2`:

```ts
interface Annotations {
  schema: 'annotations.v2';
  annotationId: string;
  clipId: string;
  pinId: string;
  frame: VideoFrame;
  image: { width: number; height: number };
  shapes: ExportShape[];
  perspective?: { quad: { x: number; y: number }[] };
}
```

The document filename, reference ID, clip ID, pin ID, and immutable pin frame
must agree. The background is rasterized lazily from video; no still image is
stored. Multiple documents may exist on one pin, but annotation IDs remain
unique across that clip's shared `annotations/` directory.

### Presentation document

`webapp/lib/types/presentation.ts` defines schema number `2`. A presentation
contains unique-ID slides, exactly `max(slides.length - 1, 0)` transitions, and
an optional theme.

Slide kinds:

- `clip`: animated clip playback, an all/selected/none pin-pause policy, and
  optional per-pin hold and annotation cues;
- `pin`: one frozen pin with all/selected/none annotation documents and
  optional enter/exit cues; and
- `title`: title, section, or divider content with an optional hold.

Transitions are `cut` or `match_video`. A match-video transition is valid only
between resolving, forward-ordered pin slides from the same video. Its trim is
stored as frame offsets and must produce a non-empty source range.

## 7. Project lifecycle and safety

### Open and restore

The app stores the selected directory handle in IndexedDB under key `project`.
Restore requests read/write permission, validates schema and required folders,
loads or installs the board, performs trash cleanup, and runs integrity checks
before context is populated. Denied, stale, or invalid handles are cleared.

`project.v1` receives a specific refusal message rather than a generic parser
failure.

### Video import

Import uploads to `/video/normalize/start` (the compatibility URL now fronts a
smart import job), polls it, and receives authoritative per-video metadata. The
UI reports upload, analysis, remux/transcode, probe, and download progress in an
always-visible panel. Import chooses one of three strategies:

- `preserve`: CFR H.264/yuv420p MP4 with browser-compatible audio is stored from
  the original browser `File`, with no FFmpeg encode or sidecar re-download;
- `remux`: a compatible CFR H.264 stream is repackaged as MP4 without video
  encoding; or
- `transcode`: variable-frame-rate or incompatible video is converted to CFR
  H.264 while preserving its native FPS and dimensions.

On macOS, transcode prefers `h264_videotoolbox`; software fallback uses
`libx264` `veryfast` with at most four encoder threads and two filter threads.
Long-video timeouts scale with source duration, and jobs are serialized
globally. The prepared file is written under `media/`, then the manifest is
committed; a manifest failure removes the new media file. Failed/canceled jobs
clean up their temporary directory, and successful jobs clean up after preserve
acknowledgement or file delivery.

There is no browser-duration multiplication fallback in v2.

### Clip mutation boundary

Every clip-subtree mutation uses the same Web Lock,
`annotate:clip:<clipId>`, through `webapp/lib/fs/clipRepository.ts`. Mutators
read the latest document inside the lock and replace only their owned field
(`annotations`, `pins`, or `tags`) rather than writing stale snapshots. Web
Locks support is mandatory.

Pin annotation saves nest inside this clip lock. Clip tombstones reject queued
or late writes after deletion.

### Trash and undo

The File System Access API cannot move directories. Deletion therefore copies
the entity to `.trash/`, inventories and verifies the copy, writes an operation
record, and only then removes the source. Clip deletion also writes a durable
tombstone. Restore copies the verified payload back under the same clip lock.

Cleanup runs after a successful open or through Empty Trash. Defaults are 30
days and 500 MiB, oldest first. Tombstones remain until their clip is restored
so stale tabs cannot recreate deleted IDs.

Deletion is not blocked by presentation references. Missing assets degrade
visibly in playback and are reported by integrity checks.

### Integrity report

`webapp/lib/utils/projectIntegrity.ts` checks:

- unreadable clip and presentation files;
- missing project media;
- clips whose video does not resolve;
- missing, malformed, mismatched, or orphan pin documents;
- unresolved presentation clips, pins, or annotation IDs;
- invalid presentation cues; and
- invalid match-video transitions.

The dashboard shows errors and warnings with stable issue codes and paths.
Integrity is diagnostic; it does not silently rewrite authored data.

## 8. Routes and user-visible behavior

| Route | Current role |
|---|---|
| `/` | Project setup/open, dashboard, video import, project controls, integrity, clip-report export, and presentation library |
| `/player` | Video playback, tagging-board capture, clip tree, re-tagging, delete/undo, and clip navigation |
| `/clip/[clipId]` | Frame-native clip editor, pins, pin annotation, tracking, and homography |
| `/presentations` | Full presentation library view; the dashboard embeds the same library |
| `/presentation/[presentationId]` | Presentation authoring and full-screen present mode |
| `/metadata` | Match and team metadata editor/importers |
| `/quick-annotate` | Standalone single-image compatibility utility, outside project.v2 |
| `/segmentation-test` | Experimental foreground-segmentation sandbox, not primary navigation |
| `/api/football-data` | Server-side football-data.org proxy |

There are no `/stills`, `/annotate/[stillId]`, `/player-legacy`,
`/dropdown-test`, or temporary `/v2` routes in the canonical application.

## 9. Capture and tagging

The player has resizable video, board, and clip-tree areas.

An **instant** board button creates a clip around the current presented frame:
`leadFrames = round(leadSeconds × video.fps)` (and likewise for lag), then
`start = frame - leadFrames`, `end = frame + lagFrames + 1`, clamped to the
video. A **range** button press arms that tag; a later press of the same button
closes the range with an inclusive final frame represented by exclusive
`endFrame = frame + 1`. Multiple different ranges may be armed concurrently.
Reverse or zero-length closure waits rather than creating invalid data.

Applicable armed facets are snapshotted when capture begins and then consumed.
Requirement rules are enforced, and changing a primary tag prunes facets that
are no longer applicable. Untagged and unknown-tag clips remain separate tree
buckets. Re-tagging is paused-only and can be performed from the board or by
dragging a clip onto a board-derived tree group.

## 10. Clip editor

The clip editor uses three persisted resizable regions: viewer, inspector, and
timeline. It loads the original video locally and separately registers a
temporary `videoRef` with the sidecar for CV operations.

### Animated annotation layer

- Drawing creates a geometry keyframe at the current absolute frame.
- Moving any object at an unkeyed frame inserts a manual or correction
  keyframe.
- Geometry is interpolated between keyframes; the shared renderer is used by
  both the editor and presentation playback.
- `K`, `S`, and `H` add position, show, and hide keyframes.
- Arrow keys step exactly one frame; Space toggles playback.
- Cmd/Ctrl-Z and redo shortcuts operate on editor history.
- Delete removes the selected keyframe; Shift-Delete removes the object.
- Manual/correction and visibility keyframes can be dragged horizontally.
  Tracked/lost geometry keyframes are intentionally fixed.
- The timeline horizontally zooms and scrolls. Pins have their own lane.

Selecting a shape on the object lane makes it the movement target even when
another shape visually overlaps it.

### Tracking

Only `highlight` objects can seed tracking. The seed bbox is foot-anchored to
match how analysts place a highlight at a player's feet. The sidecar detects
all players and uses OC-SORT plus an Annotate continuity adapter; raw tracker
IDs are preference signals rather than absolute identity because early-frame
IDs can be immature or reassigned.

Normal forward tracking runs from the selected frame to the next non-tracked
geometry boundary or clip end. Range and correction modes are also available.
Returned timestamps are converted to nearest absolute source frames before
merging. Image-space annotations whose `trackingAnchorId` points at the
highlight receive the same translated motion, preserving linked arrows, lobs,
shadows, and polygons.

### Homography and pitch coordinates

The editor requests PnLCalib samples across the clip, currently at 5 samples
per second. The provider smooths/interpolates results; the web layer rejects
unusable jumps and resolves a matrix for the current frame. Results are cached
under `homography-cache/<videoId>/range-<startMs>-<endMs>.json` because this is
a regenerable sidecar-boundary artifact and equal ranges in different videos
must not collide.

When a usable matrix exists, box and circle tools default to pitch drawing.
Their keyframes store pitch-plane geometry and project through the current
homography at render time. All other tactical tools remain image-space.

## 11. Pins and frozen-frame annotation

Creating or opening a pin rasterizes its exact absolute frame and opens the
shared Konva editor. Opening a pin with no documents creates its initial
default document; additional named sets may be created, deleted to trash, and
restored.

The toolbar supports select, box, circle, highlight, cover shadow, arrow,
lobbed pass, polygon, and text, plus stroke pattern/width, linked stroke/fill
colors, fill opacity, font controls, and manual perspective calibration.
PnLCalib can automatically populate the perspective quad when the sidecar is
available.

Holding Left or Right previews video at 1x for at most five seconds on either
side of the pin. Releasing stops; Space returns to the pin. Drawings are hidden
and editing is locked away from the pin frame, while zoom and pan remain
available.

Pin documents are independent from the clip's animated layer. "Import into
clip" explicitly copies one saved document into clip annotations at the pin
frame, generates fresh object IDs, and remaps highlight-link references.
Repeated imports intentionally create independent objects.

## 12. Presentations

The presentation authoring layout uses resizable asset browser, canvas, deck,
and inspector regions. Present mode is intentionally panel-free and fills the
viewport for every slide kind.

The asset browser is clip-first and supports tag and chronological views.
Clips and their pins are drag sources; title cards can also be inserted. Slides
can be reordered in the deck.

Clip slides play source motion with the shared animated-annotation renderer.
Pins are automatic pause points according to `pausePins`; the playback state
machine triggers only on a forward crossing, consumes the pin for that pass,
resumes without immediately retriggering, and re-arms future pins after a
seek. At a pause, selected pin annotation documents can appear according to
wall-clock cues.

Pin slides rasterize one exact source frame and its selected annotation
documents. Title slides render authored text.

Prepared clip and transition MP4s are stored below
`derived-media/presentations/<presentationId>/`. Every media index entry records
its absolute `sourceStartFrame` and exclusive `sourceEndFrame`, so local media
frame zero maps back to the correct source frame. A late handoff from original
media to a prepared asset preserves play intent and the requested source frame.

Missing clips, pins, documents, or prepared files never crash the deck. The
canvas shows a missing state and integrity reports the broken reference.

## 13. Exports

The dashboard's report export scans validated clips and writes:

- `exports/report/clips.json`;
- `exports/report/clips.csv`; and
- `exports/report/annotated/<clip>-f<frame>-<pin>-<annotation>.png`.

Rows include frame bounds, duration, primary/facet tags, pin counts, animated
annotation counts, document/shape totals, and annotated output paths. Pin PNGs
are rendered at the owning video's native resolution through the same
payload renderer used by the editor.

Exports are deterministic and replace the previous report folder. A bad pin
document is recorded as a partial failure while other clips/documents continue.
No source video is copied. The sidecar still exposes generic frame-to-MP4
encoding endpoints, but the current 0.2 UI does not expose clip MP4 export.

## 14. Internationalization and layout

`webapp/lib/i18n/index.tsx` provides `en` and `zh-CN`, named placeholder
interpolation, `Intl` number/date formatting, and development diagnostics for
missing keys. Locale is stored under `annotate:locale`; storage failure falls
back safely to English. The provider updates `<html lang>` and
`data-locale`.

The two catalogs currently contain the same 512 keys and placeholder tokens.
Primary route chrome, statuses, accessibility labels, integrity descriptions,
and structured export progress are localized. Low-level browser, filesystem,
or sidecar diagnostic strings may remain English. The Simplified Chinese copy
has CJK font/wrapping/layout support but still needs native-speaker review.

Resizable panels use visible, focusable separators, minimum sizes, keyboard
operation, and `autoSaveId` persistence. Dashboard, player, clip editor, and
presentation authoring are panelized. Metadata forms and present mode are
intentionally ordinary, non-panel layouts.

## 15. Match metadata

`matchInfo` remains optional manifest data and includes home/away teams,
players, coach, formation, score, date, kickoff, competition, season, round,
venue, referee, substitutions, and notes. The metadata route supports manual
entry, teamsheet paste/CSV/TSV import, and football-data.org lookup through the
Next.js API proxy.

There is no period-boundary feature or period-aware timestamp model.

## 16. Sidecar boundary details

The browser normally uploads a `File` to `POST /video/register`, receives a
temporary opaque `videoRef`, and unregisters it when no longer needed. Absolute
`videoPath` is retained only as a legacy/manual sidecar option; relative paths
are rejected.

Important live endpoints:

| Method | Endpoint | Webapp use |
|---|---|---|
| `GET` | `/health` | Capability/model status |
| `POST` | `/video/normalize/start` | Upload and start observable preserve/remux/transcode import |
| `GET/DELETE` | `/video/normalize/{jobId}` | Poll, acknowledge preserve, or cancel import |
| `GET` | `/video/normalize/{jobId}/file` | Download remux/transcode result and clean up job |
| `POST` | `/video/normalize` | Synchronous compatibility endpoint |
| `POST` | `/video/probe` | Available authoritative non-normalizing metadata API |
| `POST` | `/video/register` | Temporary CV/media locator |
| `DELETE` | `/video/{videoRef}` | Temporary-file cleanup |
| `POST` | `/track` | Highlight tracking |
| `POST` | `/homography` | Clip/pin PnLCalib calibration |
| `POST` | `/segment` | Available foreground-mask API; no canonical v2 UI |
| `POST` | `/derived-media/exact-motion` | Prepared presentation motion |
| `POST/GET/DELETE` | `/export/*` | Available client/service boundary; no current clip-export button |

Authoritative probing first uses a positive container `nb_frames` value, which
avoids scanning ordinary long MP4s. If absent, `ffprobe -count_frames` scans
packets, with an explicit decode/count fallback. Browser duration is never used
to invent a frame count.

## 17. Verification

The 2026-07-11 implementation gate completed with:

- 205 Vitest tests across 35 files;
- 28 sidecar pytest tests;
- 22 Playwright Chromium flows;
- clean TypeScript checking;
- clean production build;
- clean `git diff --check`; and
- ESLint with no errors and five pre-existing warnings in the shared Editor
  and experimental segmentation page.

Commands:

```bash
npm test
npm run test:e2e
npm run build
npm --prefix webapp run lint
sidecar/.venv/bin/pytest sidecar/tests
```

Playwright owns `webapp/e2e/**`; Vitest excludes those files. Browser coverage
includes project lifecycle, frame-native capture, board semantics, clip
editing, pins, presentations, exports, panel persistence, navigation/restore,
and both locales.

## 18. Known release boundaries

- Chromium and Web Locks are required.
- 0.1 projects cannot open in 0.2.
- The sidecar is required for v2 video import, tracking, homography, and exact
  motion; authoring can continue without CV once imported media exists.
- PnLCalib needs its upstream assets/weights at a configured discovery path.
- The tagging board is file-configurable but has no in-app board designer.
- Tracking is single-highlight per operation in the current v2 editor; linked
  followers move with that highlight, but multi-object batch tracking is not
  exposed.
- Foreground segmentation is experimental and not enabled in the canonical pin
  annotation flow.
- Clip MP4 rendering is not exposed in the current v2 UI.
- Simplified Chinese needs native copy review.
- Quick Annotate is retained but is not a design or compatibility constraint
  on the project.v2 workflow.

For implementation rationale and the checked work ledger, see
`plans/v0.2/implementation-plan.md` and
`plans/v0.2/project-v2-schema-and-migration.md`.
