# Annotate 0.2 As-Built Technical Reference

Updated: 2026-09-04

Status: Annotate 0.2.2 browser application plus an in-development native Electron host with unsigned `0.2.2-desktop.1` preview packaging for Apple Silicon macOS and Windows x64. Windows runtime and clean-machine release verification remain outstanding. The code is authoritative if this document drifts.

## 1. Product model

Annotate is a browser-based, self-hosted football analysis application. The canonical workflow is:

1. Create a local project and enter its match metadata.
2. Import video. The sidecar preserves its own FPS/resolution where possible.
3. Watch the video and press tagging-board buttons to capture clips.
4. Open a clip to animate tactical shapes and mark important frames with pins.
5. Annotate a pin's exact video frame with one or more drawing documents.
6. Build a presentation from clips, pins, and title cards.
7. Export clip reports and annotated pin images into the project folder.

The three main analysis concepts are deliberately distinct:

- A **clip** is a half-open passage of play in one video and owns animated tactical annotations.
- A **pin** is one important absolute frame inside a clip.
- A **pin annotation document** is a frozen-frame drawing attached to a pin.

Pins are clip-local. Two overlapping clips may each have a pin at the same video frame because the clips are independent analyses.

## 2. Compatibility boundary

Annotate 0.2 reads and writes only `project.v2`. It explicitly refuses `project.v1` and has no data migrator. Existing 0.1 projects must remain on the pinned `v0.1.0-pre.3` application.

The exception is the standalone `/quick-annotate` utility. It retains its independent `annotations.v1` OPFS session format and does not participate in a project.

## 3. Runtime architecture

### Web application

- Next.js 15.5.21 App Router
- React 19.2 and TypeScript
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
webapp/lib/fs/              shared project repositories and persistence operations
webapp/lib/host/            host contracts and browser capability adapters
webapp/lib/clip/            frame math, interpolation, tracking adapters
webapp/lib/presentation/    authoring and playback logic
webapp/lib/tagging/         board parsing and capture engine
webapp/lib/i18n/            locale provider and catalogs
```

`webapp/app/layout.tsx` installs one `LocaleProvider` and one `ProjectProvider`. The project provider exposes the validated manifest, board, selected video, directory handle, and integrity report. It never publishes partially validated project state.

### Host boundary

`webapp/lib/host/contracts.ts` defines `AppHost` and renderer-facing filesystem/window capabilities. Repositories and React components use `ProjectDirectory`, `ProjectFile`, and `ProjectWritable` rather than native browser handles. The isolated Electron preload selects the native adapter; normal browsers use the browser adapter. Project schemas, frame contracts and drawing code are shared.

The browser adapter wraps File System Access handles, routes folder/video selection and OPFS scratch storage, and owns IndexedDB project bookmarks. The existing raw native handle at `annotate-db` version 1, store `handles`, key `project` remains compatible. Additional `project-session:<id>` handle entries identify directories using `isSameEntry` under a Web Lock; `recent-project-session` records the latest id. Reopening an existing directory refreshes both the recent and session handle without changing its identity. File/blob access and writes retain the existing behavior without additional media buffering.

Editor opening is project-aware. Browser clip/pin URLs include `projectSession`; session storage preserves the originating project through route changes and refresh. An unavailable explicit session refuses fallback. Pin creation still reserves a blank browser tab synchronously before saving and navigating. Native windows instead bind their project in the host and deduplicate by clip/pin identity. Opening another project changes the recent bookmark, not existing editors.

Manifest/clip/document Web Locks, clip-change channels, and annotation backup/change keys include `ProjectDirectory.scopeId`. Old unscoped backups are left untouched but not automatically adopted because project identity is ambiguous. All open editors should be reloaded when moving from the old lock namespace to this build.

`webapp/lib/host/runtime.ts` resolves launch-time sidecar URLs and optional authorization from `window.__ANNOTATE_RUNTIME__`, retaining the browser environment/default and legacy `__SIDECAR_URL` override. Authenticated fetches send bearer headers only to the configured endpoint and reject redirects. XHR video uploads also carry the session header. The optional runtime's `host` field configures connection validation; it does not select a native filesystem host.

`desktop/main.mjs` runs the shared production renderer in sandboxed, context-isolated Electron windows with no renderer Node integration. Native dialogs return opaque grants; named commands execute the shared repositories in the host, preserving schemas, clip locks, pin anchors, tombstones and trash behavior. Original window baselines protect clip/manifest field changes; annotation/presentation saves check document revisions. Generic writes are restricted to auxiliary cache/export directories. Replies are plain envelopes, with DOM errors reconstructed in the renderer. File handles, methods and mutation callbacks do not cross IPC.

Native media uses authorized Range/HEAD URLs for video playback, pin rasterization, presentation thumbnails and report exports. The renderer holds metadata capabilities rather than whole-video Blobs. The host privately registers the original source with the sidecar and retains file ownership. Import reuses the existing preparation strategy, reports progress, supports cancellation, copies directly into the project and commits the manifest or rolls back. The per-window CV proxy rejects paths, foreign video references and private host routes; the upstream sidecar token is never exposed to the renderer.

`npm run build:desktop-renderer` prepares standalone production output; `npm run desktop:dev` builds the host bundle and launches Electron with developer-provided Python, ffmpeg and models. Packaged builds resolve only their bundled runtime, validate required resource checksums and put writable files in user data. Python 3.12.14, the sidecar dependency lock, model weights/source and platform-specific ffmpeg are staged by `npm run stage:desktop -- <target>`. `npm run package:desktop -- <target>` builds an unsigned DMG or NSIS installer. Startup displays service progress; services get private dynamic ports and stop on graceful quit after editor save guards finish. Windows certification, clean-machine testing, publisher signing, durable native recovery, origin-independent preferences and abrupt-crash cleanup remain release gates. Browser and native locks are not cross-host: avoid simultaneous editing of one project in both. See [Desktop Preview](desktop/README.md) and [Pre-Electron Implementation Checklist](plans/pre-electron-implementation-checklist.md).

### Python sidecar

The local FastAPI service runs on `http://127.0.0.1:8321` by default. It owns:

- smart video preparation and authoritative frame probing;
- YOLO detection plus vendored OC-SORT tracking;
- vendored PnLCalib homography estimation;
- ffmpeg export-session encoding APIs; and
- an available exact-motion segment primitive retained for future exports.

`npm run dev` starts both development services. `npm run build` followed by `npm run start` runs the production web build with the sidecar. The client base URL can be changed with `NEXT_PUBLIC_SIDECAR_URL`. See `sidecar/README.md` for the full HTTP contract and model requirements.

## 4. Frame contract

Every authored media position is an absolute, zero-based source-video frame. The domain does not store clip-relative frame numbers or media timestamps.

- A displayable position has branded type `VideoFrame`.
- An exclusive end has branded type `FrameBoundary`.
- Clip ranges are `[startFrame, endFrame)`.
- The last displayable clip frame is `endFrame - 1`.
- `endFrame` may equal the video's `frameCount`.
- Presentation cue durations remain wall-clock milliseconds because they are not media positions.

`webapp/lib/clip/frameMath.ts` is the only conversion boundary. Seeking writes `frame / fps`. Presented-frame identity prefers `requestVideoFrameCallback().mediaTime` and floors with an epsilon; it clamps to `[0, frameCount - 1]`.

Tracking and pin calibration use timestamp-based sidecar requests. Their frame sampler includes `endMs`, so a domain range sends `frameToMs(endFrame - 1)`, not the exclusive boundary. Clip homography uses `startFrame`, exclusive `endFrame`, `sourceFps`, and `everyNFrames` instead; output/cache timestamps remain milliseconds for compatibility. One-frame clips are valid data, but the editor currently enables tracking and homography range actions only for clips of at least two frames.

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

`project.json` is the creation commit marker. Project creation refuses a non-empty destination, creates the directory structure and default board, then writes the manifest last. A partial tree without a valid manifest is not an openable project.

`media/`, `analysis/`, `analysis/clips/`, and `presentations/` are authoritative and must exist when a project opens. Generated stores (`homography-cache/`, `derived-media/`, `exports/`, `cache/`, and the `.trash/` subtree) are recreated if missing. A missing tagging board is restored from the release default.

Clips and presentations are discovered by directory scan rather than indexed in `project.json`. Homography files are regenerable caches. The legacy presentation exact-motion storage contract remains readable but is not used by interactive playback. `exports/` contains rendered outputs, never copied source video.

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

Manifest parsing is strict. Video IDs must be unique, paths must stay in `media/`, and each video's FPS, dimensions, and authoritative frame count must be positive. Early development `project.v2` manifests with top-level `fps` and `resolution` still open; those obsolete fields are ignored and omitted on the next manifest write.

### `tagging-board.json`

The required `tagging-board.v1` file contains:

- an optional fixed coordinate layout with board dimensions, modifier slots, group-label rectangles, and button rectangles;
- flat visual groups of primary-tag buttons;
- optional per-button hotkeys and compatibility capture fields;
- per-button applicable facet-group IDs; and
- single- or multi-select facet groups with optional `requiresAny` rules.

The parser rejects duplicate or unresolved IDs, invalid defaults, dependency cycles, and malformed requirements. Conflicting hotkeys disable every binding in that collision rather than selecting one implicitly. If a valid v2 project is missing its board, open installs the default board from `webapp/public/tagging/board.json`.

Older v2 board files using `leadFrames`/`lagFrames` are read as 30 FPS reference durations and converted in memory to seconds. These fields, along with `leadSeconds`, `lagSeconds`, and `mode`, remain parser-compatible, but canonical capture deliberately resolves every button to exact-frame range mode with zero lead/lag.

Board labels are project-authored data. They are intentionally displayed as stored and are not translated by the application locale.

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

Animated annotation types are `box`, `circle`, `highlight`, `shadow`, `arrow`, `lob`, `poly`, and `text`. Each object has image- or pitch-coordinate geometry, style, and provenance-aware geometry keyframes. The editor does not expose manual show/hide keyframes; optional legacy visibility data is still read to preserve older projects' playback. Re-tracking replaces legacy visibility markers within the replaced range along with geometry. Automatic tracking stop/loss markers are unchanged. Only boxes and circles support pitch coordinates in the current editor.

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
  animations?: Array<{
    id: string;
    shapeIds: string[];
    effect: 'appear' | 'fade' | 'grow' | 'wipe';
    trigger: 'on_click' | 'with_previous' | 'after_previous';
    delayMs: number;
    durationMs: number;
  }>;
}
```

The document filename, reference ID, clip ID, pin ID, and immutable pin frame must agree. The background is rasterized lazily from video; no still image is stored. Multiple documents may exist on one pin, but annotation IDs remain unique across that clip's shared `annotations/` directory.

`animations` is an optional ordered entrance sequence owned entirely by the annotation document. Every step has a unique ID, references existing shapes, and no shape may appear in more than one entrance step. Static documents without the field remain valid. Static rendering and report export show the final fully visible state; the editor preview, clip pin pauses, and presentation pin playback sample the sequence through the shared canvas renderer.

### Presentation document

`webapp/lib/types/presentation.ts` defines schema number `2`. A presentation contains unique-ID slides, exactly `max(slides.length - 1, 0)` transitions, and an optional theme.

Slide kinds:

- `clip`: animated clip playback, an all/selected/none pin-pause policy, and optional per-pin hold and annotation cues;
- `pin`: one frozen pin with all/selected/none annotation documents and optional enter/exit cues; and
- `title`: title, section, or divider content with an optional hold.

Transitions are `cut` or `match_video`. A match-video transition is valid only between resolving, forward-ordered pin slides from the same video. Its trim is stored as frame offsets and must produce a non-empty source range.

## 7. Project lifecycle and safety

### Open and restore

The app stores the recent directory handle in IndexedDB under key `project` and independent editor bindings under `project-session:<id>`. Restore prefers the explicit editor/tab session and checks read/write permission without prompting during page load. If the stored handle is not granted, it first requests a live handle from another authorized tab of the same project over a project-scoped BroadcastChannel, with a one-second timeout. Responses must match the origin, request nonce, and exact directory (`isSameEntry`), and retain granted read/write access. This makes new editor tabs and refreshes automatic while another authorized project tab remains open, without permission prompts or media copying. If no authorized peer can supply access, the stored handle and session remain intact and the project screen, capture player, or clip/pin editor offers Reconnect project. That click requests permission directly under user activation, then opens the same folder without a directory picker; denial leaves the action available for retry. With permission granted, opening validates schema and required folders, loads or installs the board, performs trash cleanup, and runs integrity checks before context is populated. Other failed restores can clear their matching recent bookmark but retain the editor's identity so refresh cannot redirect to a different project. Normal close clears that tab's binding without revoking sibling editors. Async open/restore/close publication is guarded against stale results, with bookmark side effects serialized within the provider.

`project.v1` receives a specific refusal message rather than a generic parser failure.

### Video import

Import uploads to `/video/normalize/start` (the compatibility URL now fronts a smart import job), polls it, and receives authoritative per-video metadata. The UI reports upload, analysis, remux/transcode, probe, and download progress in an always-visible panel. Import chooses one of three strategies:

- `preserve`: CFR H.264/yuv420p MP4 with browser-compatible audio is stored from the original browser `File`, with no FFmpeg encode or sidecar re-download;
- `remux`: a compatible CFR H.264 stream is repackaged as MP4, or compatible near-CFR H.264 MP4 is placed on a regular frame clock, without video encoding; or
- `transcode`: more irregular variable-frame-rate or incompatible video is converted to CFR H.264 while preserving its native FPS and dimensions.

`services/timestamp_normalization.py` implements the near-CFR fast path. A packet scan checks the entire source: compatible codecs and geometry, bounded cadence/gaps, no more than 200 ms of displacement from the original timing, and valid decode/presentation ordering. It generates a bounded timestamp expression, including sparse ordering corrections around missing source frames. Two chained `setts` filters first rescale timestamps without erasing B-frame ordering, then reconstruct PTS/DTS on the regular clock. A second packet scan verifies every output timestamp, ordering, duration, and count before accepting the result. Encoded pictures and audio remain unchanged, but their frame timing is slightly redistributed. Up to two terminal reference pictures outside an original edit list may be exposed; leading or interior discarded pictures force fallback. The path is limited to one million packets and 512 sparse corrections, does not apply to explicit FPS/resolution conversion requests, and falls back to encoding on rejection or validation failure. `ANNOTATE_NORMALIZE_RETIME=0` disables it.

`VideoImportProgress` uses `ProgressEstimate` to show a current-step ETA based on observed throughput. `VideoNormalizationProgress.phaseProgress` carries the actual step fraction independently of the browser bar's weighted overall percentage; desktop import progress already has per-step fractions. Estimates use a rolling 30-second sample window, require observed advancement over at least 1.5 seconds, reset on phase changes/retries, and become unavailable after 15 seconds without advancement. They do not predict unmeasured future steps from earlier transfer speed.

On macOS, transcode prefers `h264_videotoolbox`. `services/parallel_normalization.py` uses at most two hardware-decode/encode workers for H.264/yuv420p inputs at least two minutes long with unchanged dimensions, square pixels, and no rotation. Segment preroll and absolute-frame trimming preserve the serial path's frame selection. B-frames are disabled so the stream-copy join can reconstruct exact packet timestamps instead of inheriting rounded segment durations; frame count, rate, and timebase are checked before returning the result. Compatible AAC/MP3 audio is copied from the original input. Aggregate progress reserves its final 5% for joining, and cancellation or worker failure stops both workers and removes temporary segments. Joining temporarily needs an extra output file's worth of space. `ANNOTATE_NORMALIZE_PARALLEL=0` disables this optimization; unsupported inputs or failures retry the original single-stream path.

Software fallback uses `libx264` `veryfast` with at most four encoder threads and two filter threads. Long-video timeouts scale with source duration, and import jobs are serialized globally. The prepared file is written under `media/`, then the manifest is committed; a manifest failure removes the new media file. Failed/canceled jobs clean up their temporary directory, and successful jobs clean up after preserve acknowledgement or file delivery.

There is no browser-duration multiplication fallback in v2.

### Project manifest mutation boundary

Every post-creation `project.json` write uses the exclusive `annotate:project:<scopeId>:manifest` Web Lock through `webapp/lib/fs/projectManifestRepository.ts`. Mutators read the latest manifest inside the lock and replace only their owned field. Video preparation remains outside the lock; filename allocation, media commit, and the video-entry append are serialized together so concurrent imports cannot collide or discard match metadata.

### Clip mutation boundary

Every clip-subtree mutation uses the same project-scoped Web Lock, `annotate:project:<scopeId>:clip:<clipId>`, through `webapp/lib/fs/clipRepository.ts`. Mutators read the latest document inside the lock and replace only their owned field (`annotations`, `pins`, or `tags`) rather than writing stale snapshots. Web Locks support is mandatory.

Pin annotation saves nest inside this clip lock. Clip tombstones reject queued or late writes after deletion.

### Trash and undo

The File System Access API cannot move directories. Deletion therefore copies the entity to `.trash/`, inventories and verifies the copy, writes an operation record, and only then removes the source. Clip deletion also writes a durable tombstone. Restore copies the verified payload back under the same clip lock.

Cleanup runs after a successful open or through Empty Trash. Defaults are 30 days and 500 MiB, oldest first. Tombstones remain until their clip is restored so stale tabs cannot recreate deleted IDs.

Deletion is not blocked by presentation references. Missing assets degrade visibly in playback and are reported by integrity checks.

Dashboard video deletion requires explicit confirmation and runs through `webapp/lib/fs/videoDeletion.ts` (`video.delete` in the native host). It holds the project-manifest lock, then all affected clip locks in sorted order. Clip folders, including pin documents and rasters, are moved through the existing verified trash path; the latest manifest is committed without the video, then its confined `media/` file is removed non-recursively. Other videos, original input files, exports, and presentation decks are not deleted. A file shared by another manifest entry is retained. Missing media is tolerated; unreadable clips stop deletion before mutation. Handled failures restore the manifest and clip payloads; recovery failures leave backups and report an error. This is not a crash-atomic filesystem transaction, and deleting a video has no Undo action.

Clip creation and restoration also acquire the manifest lock before the clip lock and reject absent video IDs. Trash cleanup takes the manifest lock so it cannot consume an in-progress video's rollback payloads. Project-change notifications refresh sibling browser tabs and native windows without switching their bound project; native annotation-only notifications do not reload unchanged manifests.

### Integrity report

`webapp/lib/utils/projectIntegrity.ts` checks:

- unreadable clip and presentation files;
- missing project media;
- clips whose video does not resolve;
- missing, malformed, mismatched, or orphan pin documents;
- unresolved presentation clips, pins, or annotation IDs;
- invalid presentation cues; and
- invalid match-video transitions.

The dashboard shows errors and warnings with stable issue codes and paths. Integrity is diagnostic; it does not silently rewrite authored data.

## 8. Routes and user-visible behavior

| Route | Current role |
|---|---|
| `/` | Project setup/open, dashboard, video import, project controls, integrity, clip-report export, and presentation library |
| `/player` | Video playback, tagging-board capture, clip tree, re-tagging, delete/undo, and clip navigation |
| `/clip/[clipId]` | Frame-native clip editor, pins, pin annotation, tracking, and homography |
| `/presentations` | Full presentation library view; the dashboard embeds the same library |
| `/presentation/[presentationId]` | Presentation authoring and full-screen present mode |
| `/metadata` | Match and team metadata editor/importers |
| `/userguide` | In-app first-use workflow, indexed product reference, glossary, shortcuts, and troubleshooting |
| `/quick-annotate` | Standalone single-image compatibility utility, outside project.v2 |
| `/api/football-data` | Server-side football-data.org proxy |

There are no `/stills`, `/annotate/[stillId]`, `/player-legacy`, `/dropdown-test`, or temporary `/v2` routes in the canonical application.

## 9. Capture and tagging

The player has resizable video, board, and clip-tree areas. Clicking a timeline clip selects and reveals its row in the clip tree, scrolling only that panel and only when the row is outside its visible area (including its sticky heading). Clicking an already selected timeline clip reveals it again after manual list scrolling. Clicking a clip-tree row seeks to the clip start and reveals it in the timeline.

The project-authored board is a fixed coordinate surface rather than a scrolling menu. `layout.width`/`height`, group `labelRect` values, button `rect` values, and modifier slots determine its visual arrangement. The board still owns tag identity, facet applicability, requirements, and optional hotkeys.

Every primary button is an exact-frame range toggle. The first press arms that tag at the current frame; the second press closes it with an inclusive final frame represented by exclusive `endFrame = frame + 1`. There is no automatic lead/lag or pre-roll in the canonical capture workflow. Multiple different buttons may remain armed concurrently, so clips can overlap. A reverse or zero-length closure waits rather than creating invalid data.

Applicable armed facets are snapshotted when capture begins and then consumed; modifier changes can update the active range independently. During capture, the modifier panel stays on the most recently started active range, including keyboard-started ranges; hovering or focusing another action does not switch it. Ending that range returns the panel to any remaining active range. Requirement rules are enforced, and changing a primary tag prunes facets that are no longer applicable. Untagged and unknown-tag clips remain separate tree buckets. Re-tagging is paused-only and can be performed from the board or by dragging a clip onto a board-derived tree group.

The tagging timeline derives one lane from each board group and shows both persisted clips and in-progress captures. Overlapping intervals are packed into subtracks. Its default viewport is one minute, it can zoom out to the whole video or up to 64x beyond the default scale, and manual scrolling suspends playhead auto-follow until five seconds after interaction ends.

## 10. Clip editor

The clip editor uses three persisted resizable regions: viewer, inspector, and timeline. It loads the original video locally and separately registers a temporary `videoRef` with the sidecar for CV operations.

### Animated annotation layer

- Drawing creates a geometry keyframe at the current absolute frame.
- Moving any object at an unkeyed frame inserts a manual or correction keyframe.
- Geometry is interpolated between keyframes; the shared renderer is used by both the editor and presentation playback.
- Gaps bounded by two tracked highlight keyframes are linearly interpolated regardless of gap length, without adding stored keyframes. Explicit lost/stop markers and show/hide events still apply. Manual/correction keyframes and other annotation types keep their existing interpolation behavior; older tracked highlights without per-keyframe provenance use the annotation source as before.
- `K` adds a position keyframe. Visibility still exists in persisted clips but is not exposed as a manual editor control.
- Arrow keys step exactly one frame; Space toggles playback.
- Cmd/Ctrl-Z and redo shortcuts operate on editor history.
- Delete removes the selected keyframe; Shift-Delete removes the object.
- Manual/correction geometry keyframes can be dragged horizontally. Tracked/lost geometry keyframes are intentionally fixed; legacy visibility markers have no timeline editing controls.
- The timeline horizontally zooms and scrolls. Pins have their own lane.
- Trim mode keeps the clip's entry range as a fixed outer boundary and moves frame-snapped in/out handles inward. Apply atomically writes the narrowed range, filters pins and keyframes outside it, and samples boundary geometry so retained animation does not jump. Cancel writes nothing; the immediate Undo trim action restores the complete pre-trim clip. A later edit intentionally expires that trim undo snapshot.

Selecting a shape on the object lane makes it the movement target even when another shape visually overlaps it.

### Tracking

`Track` detects every player at the current frame and draws provisional, foot-anchored highlights. Selecting one creates the highlight; `Start` runs OC-SORT plus the Annotate continuity adapter forward from that exact frame. Raw tracker IDs are preference signals rather than absolute identity because early-frame IDs can be immature or reassigned.

The interactive tracking request stops inference at the first frame where no reasonable continuity match exists. That frame receives an explicit hidden boundary and becomes the next reacquisition point. While provisional players are visible, the analyst can play or step to a usable frame and select the target again. Annotate linearly fills every intervening absolute frame, marks the human endpoint as a correction, then waits. `Continue` resumes tracking from that correction; `Stop` keeps the current work. Using `Stop` before `Start` retains only the selected seed keyframe. Tracking also ends automatically at clip end.

While tracking runs, `/track/stream` emits each trusted keyframe as NDJSON. The clip editor applies those frames to its in-memory annotation state immediately, so the canvas and keyframe timeline grow live, then performs one persisted commit from the final result. The original `/track` JSON endpoint remains available.

The video follows incoming tracked frames through a bounded preview scheduler: at most 10 seeks per second, one decode in flight, and only the latest pending target retained. The annotation playhead advances on `seeked`, so geometry uses the displayed frame rather than running ahead of decoding. This is paused-frame preview, not normal playback, and does not trigger pin pauses. The tracker never waits for video seeks and all received keyframes are retained even when intermediate preview frames are skipped. Stop, cancellation, and run completion dispose the follower before seeking to the origin or loss/end frame.

Returned timestamps are converted to nearest absolute source frames before merging. Image-space annotations whose `trackingAnchorId` points at the highlight receive the same translated motion, preserving linked arrows, lobs, shadows, and polygons.

`Re-track from here` repairs an existing highlight tail. It snapshots the annotation layer, provisionally removes the selected highlight's future frames and those of its linked followers, and enters the same candidate/reacquisition workflow used after ordinary tracking loss. Candidate selection, streamed tracking, and repeated loss recovery remain in memory until `Done`; `Cancel` restores the snapshot without writing, and `Done` records the replacement as one undoable persisted edit.

### Homography and pitch coordinates

Clip homography solves every 15 source frames, anchored at the clip's start frame, with the exclusive end frame omitted. At 30 fps this doubles the previous density of one solution per 30 frames. The sampled-video preprocessing retains intermediate samples every three source frames; PnLCalib solves every fifth such sample. The provider discards invalid/corrupt solutions, fills and interpolates the sparse results, and the web layer rejects unusable jumps before resolving a matrix for the current frame. Results are cached under `homography-cache/<videoId>/range-<startMs>-<endMs>.json` because this is a regenerable sidecar-boundary artifact and equal ranges in different videos must not collide. Existing cached ranges remain usable; Recompute H replaces them at the new density.

Clip computation uses `/homography/stream`: NDJSON progress reports preparation/model-loading phases and actual completed/total calibration samples, followed by the final result. The editor shows a determinate bar and Cancel; cancellation leaves any existing cached result intact and stops the worker at its next checkpoint. Pin calibration retains `/homography`. Both paths run off the HTTP event loop through a serialized calibration service that reuses models between requests. The default device selection is CUDA, then Apple MPS, then CPU; model weights load on CPU before transfer. The existing sampled-video preprocessing and solution filtering remain unchanged.

When a usable matrix exists, box and circle tools default to pitch drawing. Their keyframes store pitch-plane geometry and project through the current homography at render time. All other tactical tools remain image-space.

## 11. Pins and frozen-frame annotation

Creating or opening a pin rasterizes its exact absolute frame and opens the shared Konva editor. Opening a pin with no documents creates its initial default document; additional named sets may be created, deleted to trash, and restored.

The toolbar supports select, box, circle, highlight, cover shadow, arrow, lobbed pass, polygon, and text, plus stroke pattern/width, linked stroke/fill colors, fill opacity, font controls, and manual perspective calibration. PnLCalib can automatically populate the perspective quad when the sidecar is available.

Holding Left or Right previews video at 1x for at most five seconds on either side of the pin. Releasing stops; Space returns to the pin. Drawings are hidden and editing is locked away from the pin frame, while zoom and pan remain available.

Pin documents are independent from the clip's animated layer. "Import into clip" explicitly copies one saved document into clip annotations at the pin frame, generates fresh object IDs, and remaps highlight-link references. Repeated imports intentionally create independent objects.

The pin inspector can assign one ordered entrance step to a selected shape or shape group. Supported effects are appear, fade, grow, and horizontal wipe. Trigger modes are on-click, with-previous, and after-previous, with non-negative delay and duration values stored in milliseconds. The preview canvas uses the same timing compiler and renderer as downstream playback. Importing into the clip does not copy this sequence because it belongs to the frozen annotation document rather than the clip's frame-keyframed object layer.

## 12. Presentations

The presentation authoring layout uses resizable asset browser, canvas, deck, and inspector regions. Present mode is intentionally panel-free and fills the viewport for every slide kind.

The asset browser is clip-first and supports tag and chronological views; empty tag buckets are omitted. Clips and pins can be previewed independently from the selected deck slide, and both remain drag sources. The deck is a horizontal 16:9 thumbnail storyboard with drag reordering rather than a text-only strip. Title cards use three visually distinct templates.

Authoring clip previews reuse the clip editor timeline in a pins-only variant. The shared controls provide frame-snapped click/drag seeking, single-frame and two-second transport, horizontal zoom, five-second manual-scroll override, pin markers, and the current-frame playhead. Full-screen present mode deliberately does not render a timeline or scrubber.

Clip slides play source motion with the shared animated-annotation renderer. Pins are automatic pause points according to `pausePins`; the playback state machine triggers only on a forward crossing, consumes the pin for that pass, resumes without immediately retriggering, and re-arms future pins after a seek. At a pause, selected pin annotation documents can appear according to wall-clock cues. Inspector timing fields are displayed and edited in seconds; the schema retains millisecond values for presentation wall-clock durations.

Pin annotation documents render over the rasterized source frame on a separate live canvas. Presentation-level cues determine when a whole document is visible; the document's own ordered animation sequence determines how its shapes enter after that point. A canvas click, Space, Play, presentation Next, or Right first consumes the next pending on-click step. Only when no step is pending does the same action resume a paused clip or advance the scene. Automatic slide/pause holds do not bypass a pending click step.

Pin slides rasterize one exact source frame and its selected annotation documents. Title slides render authored text.

When a clip or clip-backed pin is selected, **Edit clip** opens its clip editor in a new browser tab. Clip writes broadcast a project-local change event, and presentation authoring also refreshes on window focus, so edits made in that tab update the asset browser, selected slide, and playback source without reopening the presentation.

Clip slides and match-video transitions always play an absolute frame range from the owning video's original local file. Entering Present does not upload, prepare, transcode, or copy presentation media, and existing prepared assets are ignored. Range completion, seeking, pin crossings, and annotation sampling all map the original media time back through that video's own FPS.

The exact-motion endpoint and `derived-media/presentations/` storage helpers remain implemented and tested as dormant export-oriented infrastructure. They are not a compatibility fallback for interactive playback.

Missing clips, pins, documents, or source videos never crash the deck. The canvas shows a missing state and integrity reports the broken reference.

## 13. Exports

The dashboard's report export scans validated clips and writes:

- `exports/report/clips.json`;
- `exports/report/clips.csv`; and
- `exports/report/annotated/<clip>-f<frame>-<pin>-<annotation>.png`.

Rows include frame bounds, duration, primary/facet tags, pin counts, animated annotation counts, document/shape totals, and annotated output paths. Pin PNGs are rendered at the owning video's native resolution through the same payload renderer used by the editor.

Exports are deterministic and replace the previous report folder. A bad pin document is recorded as a partial failure while other clips/documents continue. No source video is copied. The sidecar still exposes generic frame-to-MP4 encoding endpoints, but the current 0.2 UI does not expose clip MP4 export.

## 14. Internationalization and layout

`webapp/lib/i18n/index.tsx` provides `en`, `fr`, `es`, and `zh-CN`, named placeholder interpolation, `Intl` number/date formatting, and development diagnostics for missing keys. Locale is stored under `annotate:locale`; storage failure falls back safely to English. The provider updates `<html lang>` and `data-locale`.

The four catalogs currently contain the same 555 keys and placeholder tokens. Primary route chrome, statuses, accessibility labels, integrity descriptions, structured export progress, and pin-animation authoring controls are localized. Low-level browser, filesystem, or sidecar diagnostic strings may remain English. CJK font/wrapping/layout support is in place; French, Spanish, and Simplified Chinese still need native-speaker editorial review.

Resizable panels use visible, focusable separators, minimum sizes, keyboard operation, and `autoSaveId` persistence. Dashboard, player, clip editor, and presentation authoring are panelized. Metadata forms and present mode are intentionally ordinary, non-panel layouts.

## 15. Match metadata

`matchInfo` remains optional manifest data and includes home/away teams, players, coach, formation, score, date, kickoff, competition, season, round, venue, referee, substitutions, and notes. The metadata route supports manual entry, teamsheet paste/CSV/TSV import, and football-data.org lookup through the Next.js API proxy.

There is no period-boundary feature or period-aware timestamp model.

## 16. Sidecar boundary details

The browser normally uploads a `File` to `POST /video/register`, receives a temporary opaque `videoRef`, and unregisters it when no longer needed. Uploads are streamed to a temporary file in 1 MiB chunks rather than copied into one sidecar memory buffer. Absolute `videoPath` is retained only as a legacy/manual sidecar option; relative paths are rejected.

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
| `POST` | `/track/stream` | Live NDJSON highlight tracking |
| `POST` | `/track/detect` | Per-frame provisional player detection |
| `POST` | `/homography` | Non-streaming pin/compatibility PnLCalib calibration |
| `POST` | `/homography/stream` | Clip PnLCalib progress and final result; disconnect cancels remaining computation |
| `POST` | `/derived-media/exact-motion` | Dormant exact-motion primitive retained for future export use |
| `POST/GET/DELETE` | `/export/*` | Available client/service boundary; no current clip-export button |

Authoritative probing first uses a positive container `nb_frames` value, which avoids scanning ordinary long MP4s. If absent, `ffprobe -count_frames` scans packets, with an explicit decode/count fallback. Browser duration is never used to invent a frame count.

## 17. Verification

The 2026-09-04 native integration pass has 305 Vitest tests across 52 files, 49 sidecar tests, 22 native contract tests and all 38 browser Playwright flows passing locally. Strict lint, TypeScript, browser and standalone production builds pass. The actual Electron suite exercises native project opening, preserve import and initial cancellation, separate clip/pin windows, video seeking, drawing, disk persistence/reload, close-time pin autosave, a real YOLO detection request, annotated PNG export, presentation save/playback, window deduplication, stale-write conflicts, denied IPC operations and graceful helper shutdown. Native tests use actual files/processes; chooser selection uses a main-process fixture seam. The copied standalone Chromium checks remain available. This uses installed Python/dependencies/models, not a self-contained runtime, Windows certification or CV-quality benchmark.

The 2026-08-22 Annotate 0.2.2 development gate completed with:

- 274 Vitest tests across 47 files;
- 42 sidecar pytest tests;
- 35 Playwright Chromium flows against the development server, including trim, provisional re-track, pin-animation authoring/persistence, clip-pause cue consumption, and presentation pixel output;
- clean TypeScript checking;
- clean production build;
- a clean install from both JavaScript lockfiles;
- zero known npm or Python dependency vulnerabilities;
- successful real PnLCalib and YOLO provider smoke tests; and
- strict ESLint with no errors or warnings.

Commands:

```bash
npm test
npm run test:e2e
npm run build
npm --prefix webapp run lint
(cd sidecar && .venv/bin/python -m pytest tests)
```

Playwright owns `webapp/e2e/**`; Vitest excludes those files. Browser coverage includes project lifecycle, frame-native capture, board semantics, clip editing, pins, animation authoring/playback, presentations, exports, panel persistence, navigation/restore, and locale switching across the four aligned catalogs.

## 18. Known release boundaries

- Chromium and Web Locks are required.
- 0.1 projects cannot open in 0.2.
- The sidecar is required for v2 video import, tracking, and homography; authoring can continue without CV once imported media exists. Exact-motion encoding is dormant and matters only to direct API consumers or future export work.
- PnLCalib is mandatory. The installer provisions its source and checksum-verified weights; the release launcher refuses to start if the provider is unavailable.
- The tagging board is file-configurable but has no in-app board designer.
- Tracking is single-highlight per interactive session; linked followers move with that highlight, but multi-object batch tracking is not exposed.
- Clip MP4 rendering is not exposed in the current v2 UI.
- French, Spanish, and Simplified Chinese need native copy review.
- Quick Annotate is retained but is not a design or compatibility constraint on the project.v2 workflow.

For implementation rationale and the checked work ledger, see `plans/v0.2/implementation-plan.md` and `plans/v0.2/project-v2-schema-and-migration.md`.
