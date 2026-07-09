# Annotate 0.2 – Implementation Plan

Date: 2026-07-08
Status: Planning
Parents: [v0.2-scope.md](v0.2-scope.md) · [project-v2-schema-and-migration.md](project-v2-schema-and-migration.md)

## How to read this

- Steps are numbered `phase.step` and are ordered — each step lands **green**
  (build + `npm test`; e2e where stated) before the next starts. One step ≈
  one coherent commit (or a short branch).
- "Green but reduced" is allowed mid-phase-1: the app builds and tests pass,
  but amputated features (stills, mark browsing) are absent until their
  clip-based replacements land. The scope doc's risk section covers this.
- File paths are relative to `webapp/` unless prefixed. Line references are
  to current `main` and will drift — they locate today's code, not
  tomorrow's.
- Adopted defaults (open decisions 1–5 in the scope doc): tag buttons
  support both `instant` and `range` modes, default `instant`; exports are
  renders only; zh-CN only in phase 5; `/player-legacy` + `/dropdown-test`
  are deleted; annotations live **under each clip folder**. A veto on #5
  changes steps 0.4 and 1.3 only.
- The sidecar is not modified in 0.2. All frame↔ms conversion happens in the
  webapp at the `sidecarClient.ts` call sites and the `<video>` element.
- Quick-annotate (`app/quick-annotate/`, `lib/annotate/quickSession.ts`) is
  not touched by any step. It keeps using the generic annotation-document
  read/write functions, which survive.

---

## Phase 0 — Foundations (additive; app behavior unchanged)

### 0.1 Canonical frame math

**Goal**: one conversion point for frames ↔ ms before anything stores frames.

**Do**
- Extend `lib/clip/frameMath.ts` with the v2 API:
  - `msToFrame(ms: number, fps: number): number` (round)
  - `frameToMs(frame: number, fps: number): number`
  - `frameToSeconds(frame: number, fps: number): number` (for
    `video.currentTime` writes)
  - `videoFrameCount(durationMs: number, fps: number): number`
  - `clampFrame(frame, [start, end))`, `frameRangeDuration(start, end)`
- Keep today's ms-snap helpers (`snapClipRelativeMsToVideoFrame`,
  `stepClipRelativeFrame`, `roundAbsoluteMsToVideoFrame`,
  `getFrameDurationMs`) untouched — they are deleted in 1.2.

**Tests**: extend `lib/clip/frameMath.test.ts` — round-trips at 25/30/50/60
fps, half-open range semantics, clamping, off-by-one at range ends.

**Green state**: no callers changed.

### 0.2 v2 types, parallel to v1

**Goal**: the full v2 type surface exists and compiles alongside v1.

**Do**
- `lib/types/projectV2.ts`: `ProjectManifestV2` — `schema: 'project.v2'`,
  `name`, `created`, `fps`, `resolution`, `videos: VideoEntryV2[]`
  (`id`, `label`, `file`, `fps` **required**, `frameCount` required,
  `width`, `height` — replaces `durationMs`), `matchInfo?: MatchInfo`
  (import `MatchInfo` from `types/project.ts`; it survives unchanged).
  No `marks`/`stills`/`annotations`/`reports`/`thumbnails`.
  `defaultProjectManifestV2(name)`, `getProjectFpsV2`,
  `getProjectResolutionV2` mirroring the v1 helpers
  (`types/project.ts:35-49`).
- `lib/types/clipV2.ts`: `CLIP_V2_SCHEMA = 'clip.v2'`.
  - Keyframes: reuse v1 geometry via mapped types —
    `type FrameKeyed<K> = Omit<K, 'tMs'> & { frame: number }`, applied to
    the nine keyframe types and `ClipVisibilityKeyframe` from
    `types/clip.ts` (L35-106). `ClipAnnotationV2` = v1 `ClipAnnotation`
    (L128) with frame-keyed keyframe arrays.
  - `ClipPin`: `{ id: string; frame: number; label?: string; annotations:
    PinAnnotationRef[] }`; `PinAnnotationRef`: `{ id: string; file: string;
    role: 'default' | 'alternate'; label?: string }` (`file` relative to the
    clip folder, e.g. `annotations/ann_x.json`).
  - `ClipV2`: `{ schema: 'clip.v2'; id: ClipId; videoId: string;
    startFrame: number; endFrame: number; label?: string;
    tags: TaggingSelection; pins: ClipPin[];
    annotations: ClipAnnotationV2[] }`. No `startMarkId`/`endMarkId`.
- `lib/types/annotationsV2.ts`: `AnnotationsV2` — `{ schema:
  'annotations.v2'; clipId: string; pinId: string; frame: number;
  image: { width: number; height: number }; shapes: ExportShape[];
  perspective?: { quad: {x,y}[] } }` (reuse `ExportShape` from
  `lib/export/d7Render.ts:9`; no `image.file` — background comes from the
  video).
- `lib/tagging/selection.ts`: move `TaggingSelection`,
  `createEmptyTaggingSelection`, `ensureTaggingSelection`,
  `selectionToTagList` out of `lib/tagging/schema.ts` (L34-79) verbatim;
  `schema.ts` re-exports them so existing imports keep compiling. (Imports
  are flipped to `selection.ts` opportunistically; `schema.ts` dies in 1.7.)

**Tests**: type-only step; add a trivial compile-coverage test that
constructs one of each v2 object.

### 0.3 Tagging board module

**Goal**: `tagging-board.json` parse/IO/default, decoupled from the YAML
schema.

**Do**
- `lib/tagging/board.ts`:
  - Types per the schema doc §3.5: `TaggingBoard { schema:
    'tagging-board.v1'; defaults: { leadFrames; lagFrames; mode };
    groups: BoardGroup[]; facets: BoardFacetGroup[] }`,
    `BoardGroup { id; label; buttons: BoardButton[] }`,
    `BoardButton { id; label; hotkey?; leadFrames?; lagFrames?;
    mode?: 'instant' | 'range' }`,
    `BoardFacetGroup { id; label; mode: 'single' | 'multi';
    options: { id; label; hotkey? }[] }`.
  - `parseTaggingBoard(json: string): TaggingBoard` (validate: unique
    button/facet ids, sane defaults) · `readTaggingBoard(dir):
    Promise<TaggingBoard | null>` (reads `tagging-board.json`) ·
    `writeDefaultTaggingBoard(dir): Promise<TaggingBoard>` ·
    `fetchDefaultTaggingBoard()` from `public/tagging/board.json`.
  - `resolveButtonCapture(board, buttonId): { leadFrames; lagFrames; mode }`
    (button override → board default).
  - `boardTagTree(board)`: grouping structure for the clip tag tree
    (group → buttons), plus `Untagged` / `Unknown tag` bucket semantics
    mirroring today's `TagFolderTree` behavior.
- `public/tagging/board.json`: default template — port the meaning of the
  current `public/tagging/schema.yaml` (top-level tree nodes → groups,
  leaf/limb nodes → buttons, `facet_groups` → `facets`), authored by hand.

**Tests**: new `lib/tagging/board.test.ts` — parse/validate errors,
defaults resolution, tag-tree derivation, hotkey uniqueness warning.

### 0.4 Storage layer v2

**Goal**: all v2 disk IO exists and is unit-tested against the mock-FS
pattern already used in `lib/fs/annotationStorage.test.ts` (`createMockFS`).

**Do**
- `lib/fs/projectFolderV2.ts`:
  - `ensureProjectFolderStructureV2(dir, name?)` — creates `media/`,
    `analysis/clips/`, `presentations/`, `exports/`, `cache/`,
    `project.json` (v2), default `tagging-board.json`.
  - `readManifestV2`, `writeManifestV2`, `validateProjectFolderStructureV2`
    — required: `media/`, `analysis/`, `presentations/` (fixes the v1
    wart where `presentations/` was created but never validated,
    `projectFolder.ts:54`).
  - **v1 refusal**: `validateProjectFolderStructureV2` returns
    `{ ok: false, reason: 'This project was created by Annotate 0.1 and
    cannot be opened by 0.2.' }` when it finds `schema: 'project.v1'`.
- `lib/fs/clipStorageV2.ts`: `readClipV2(dir, clipId)` ←
  `analysis/clips/{clipId}/clip.json`; `writeClipV2`; `deleteClipV2`
  (recursive folder remove); `listClipsV2(dir)` (scan
  `analysis/clips/*/clip.json`, skip invalid with `console.warn`, matching
  `clipStorage.ts:192` behavior).
- `lib/fs/pinAnnotationStorage.ts`:
  `buildPinAnnotationPath(clipId, annotationId)` →
  `analysis/clips/{clipId}/annotations/{annotationId}.json`;
  `readPinAnnotationDocument`, `writePinAnnotationDocument`,
  `deletePinAnnotationDocument` (thin wrappers over the generic
  read/write in `annotationStorage.ts:152-188`, which survive);
  `createEmptyAnnotationsV2(clip, pin, image)`.
- `lib/utils/projectIntegrityV2.ts`: `checkProjectIntegrityV2(manifest,
  clips)` → issues: `unresolved_clip_video`, `pin_frame_out_of_range`,
  `unresolved_pin_annotation_file`, `inverted_clip_range`. Report-only (no
  auto-repair in v2 — repairs were a marks/stills artifact).

**Tests**: new suites for each module (CRUD round-trips, scan behavior,
refusal, integrity rules) via mock FS.

### 0.5 Frame rasterizer

**Goal**: shared "video frame → bitmap/PNG" service (replaces still capture
as infrastructure).

**Do**
- `lib/media/frameRaster.ts`:
  - `rasterizeVideoFrame(videoEl, frame, fps, opts?: { maxWidth? }):
    Promise<Blob>` — seek (`frameToSeconds`) + canvas capture; generalize
    the capture code currently in `app/stills/page.tsx:211-241`
    (`captureToBlob`, `createThumbnailBlob`).
  - `buildFrameCachePath(videoId, frame)` →
    `cache/frames/{videoId}/{frame}.png`; `readCachedFrameRaster` /
    `writeCachedFrameRaster(projectDir, …)`.
- No callers yet.

**Tests**: cache-path unit tests; capture itself is covered by e2e later.

### 0.6 v2 e2e fixtures

**Goal**: native-v2 fixture projects exist before any spec needs them.

**Do**
- Author `e2e/fixtures/clip-editor-project-v2/`: v2 `project.json`
  (1 video, fps 25, `frameCount` 50 for the 2000 ms sample),
  `tagging-board.json`, `analysis/clips/clip-playwright-1/clip.json`
  (`startFrame 5`, `endFrame 35`, one pin at frame 10 with one annotation
  doc), `presentations/` with the existing title-slide deck, same
  `media/retrieval-sample.mp4` (3282 B). This also retires the v1 fixture
  bug where `still-playwright-1.png` was referenced but absent.
- Author `e2e/fixtures/retrieval-project-v2/`: 1 video, two tagged clips
  (replacing the two marks), one clip with a pin; empty presentation.
- Old fixtures stay until 1.7.

**Phase 0 exit**: suite green; app behavior identical; every v2 module has
tests.

---

## Phase 1 — Clips as the unit

### 1.1 The flip: v2 projects only, amputate marks/stills surfaces

**Goal**: create/open produce and require v2; everything that depended on
marks/stills is either stubbed or removed. Largest single step; purely
mechanical where possible via a thin ms-adapter.

**Do**
- `app/page.tsx` (home):
  - `createProjectFromSetup` (L86) → `ensureProjectFolderStructureV2` +
    `writeManifestV2`; keep `ProjectSetupScreen` untouched (fps/resolution/
    matchInfo are v2 concepts too).
  - `handleOpen` (L120) → `validateProjectFolderStructureV2`; the v1
    refusal reason surfaces in the existing toast. Load board via
    `readTaggingBoard`, defaulting via `writeDefaultTaggingBoard` prompt
    (mirrors today's YAML prompt, L134-145).
  - Dashboard stats: videos / clips / presentations (clip count via
    `listClipsV2`, presentations via `listPresentations`).
  - Video import: on import, set `frameCount` via
    `videoFrameCount(meta.durationMs, projectFps)` instead of storing
    `durationMs` (`addVideosToManifest`, L173).
- `lib/state/ProjectContext.tsx`: `manifest: ProjectManifestV2 | null`;
  `taggingSchema: TaggingSchema | null` → `taggingBoard: TaggingBoard |
  null` (setter renamed). Fix all consumers (compiler-guided).
- `app/player/page.tsx`: strip to playback-only — delete mark state,
  `addMarkAt`, undo/redo stacks, tag-menu state, `TagFolderTree` usage,
  mark keyboard bindings (`m`, `c`, Backspace, ⌘←/→ from
  `page.tsx:276-313`); keep video loading, transport, `VideoPlayerUnit`
  with `marks={[]}`/`showAddMarkButton={false}`. Navbar: drop "Stills →".
  (Clip capture arrives in 1.4; this page is temporarily view-only.)
- `app/clip/[clipId]/page.tsx`: load via `readClipV2`; drop
  `resolveMarkPinning` (`page.tsx:138-141`). Add the **temporary
  ms-adapter**: `lib/clip/clipV2MsAdapter.ts` with
  `clipV2ToMsClip(clip, fps): Clip` and `msClipPatchToV2(...)` so
  `ClipEditor` keeps its ms internals for one more step. Hide the
  still-import panel and `inBoundsStills` wiring (ClipEditor
  `4448-4485`, `411-414`) behind deletion (it has no v2 source).
- Presentations: `PresentationAssetBrowser` temporarily clips-only —
  `buildPresentationAssetIndex`/`buildChronologicalMarkGroups`/
  `buildChronologicalStillGroups`/`buildClipCenteredStillGroups`
  (`authoring.ts:195-347`) replaced by a minimal
  `buildClipAssetGroups(clips, board)`; still-slide creation and mark rows
  removed from the browser; existing `StillSlide` rendering stubs to a
  placeholder ("unsupported slide"). `presentationHelpers.ts` (e2e)
  updated in 1.5.
- Exports: hide the Export UI (it lived on the stills page, which is
  deleted next step, so nothing to hide elsewhere).
- Delete routes now (they only consume v1): `app/stills/`,
  `app/player-legacy/`, `app/dropdown-test/`. Move any still-needed capture
  code into `frameRaster.ts` first (done in 0.5).
- `app/annotate/[stillId]/`: keep compiling against v1 types for one more
  step by feeding it nothing — remove all links to it (stills page gone);
  route reachable only by URL; deleted in 1.3 when the pin annotator
  replaces it.
- `HeaderControls.tsx` / any nav referencing removed routes: prune.

**Tests**
- Update `home.spec.ts` (copy + dashboard stats), add
  `v1-refusal.spec.ts` (open old fixture → toast with refusal message —
  keep one tiny v1 fixture for exactly this).
- Clip specs (`clip-editor`, `clip-homography`, `clip-occlusion`) run
  against `clip-editor-project-v2` through the adapter; strip the
  still-import assertions from `clip-editor.spec.ts:162,337-357`.
  `clip-save-reload.spec.ts` is deleted (premise was still import) — its
  save/reload coverage is re-established in 1.3's pin spec.
- Unit: delete `stillRelationship.test.ts`, `stillImport.test.ts`,
  `projectIntegrity.test.ts` (v1) — their modules go with them;
  `clipStorage.test.ts` drops the `resolveMarkPinning` + mark-ID blocks.
- `presentation-*` specs: temporarily reduce to what still stands
  (title-slide flows, clip-slide drag from `presentation-clips.spec.ts`);
  mark-based specs (`presentation-domain`, `presentation-retrieval`,
  `presentation-present`, `presentation-transition-preview`) are disabled
  by deletion in this step and reborn in 1.5. Note this shrinks e2e
  coverage until 1.5 — accepted in the scope doc.

**Green state**: v2-only app; player is view-only; presentations author
clips+titles only; no exports; clip editor fully works via adapter.

### 1.2 Clip editor goes frames-native

**Goal**: delete the adapter; `ClipEditor` + timeline + clip libs operate
in frames end-to-end.

**Do**
- `lib/clip/` conversions (types first, then callers — compiler-guided):
  - `interpolation.ts`: `interpolateKeyframes(keyframes, frame, type)`,
    `interpolateAnnotationAtTime(ann, frame, clipDurationFrames)` — the
    "cubic when gap > 2 frames" rule becomes a direct frame comparison
    (today it converts via fps).
  - `editorState.ts`: `mergeTrackedKeyframesIntoAnnotation` and history
    ops keyed on `frame`; `currentTMs`/`rangeEndMs` params → frames.
  - `trackingState.ts`: spans/gaps in frames
    (`MAX_INTERPOLATED_TRACK_GAP_FRAMES = 6` already exists; drop
    `..._MS = 250` and `getTrackingGapThresholdMs`); tolerance param in
    frames (exact match ±0 replaces `currentFrameToleranceMs`).
  - `bboxConvert.ts`: `convertTrackingKeyframes(raw, type, clipStartFrame,
    fps)` — sidecar returns absolute `tMs`; convert to clip-relative frames
    **here** (the boundary).
  - `occlusionCompositor.ts`: cache keyed by integer frame;
    `fetchOcclusionMask(locator, frame, fps)` converts to `frameMs` at the
    `requestSegmentation` call.
  - `homographyInterpolation.ts`: unchanged signature (sidecar frames are
    ms-keyed); add `resolveHomographyAtFrame(frames, frame, fps)` wrapper.
  - `frameMath.ts`: delete the ms-snap helpers; internal stepping is
    `frame ± 1`.
- `components/clip/ClipEditor.tsx`: `currentTMs`/`currentTMsRef` →
  `currentFrame`/ref; `clipDurationMs` → `clipDurationFrames`;
  `analysisLoopRange`/`ANALYSIS_LOOP_OPTIONS_MS` → frame counts derived
  from fps; `SHORT/LONG_SHUTTLE_MS` → frame steps; RAF `tick` maps
  `video.currentTime` → frame once (`msToFrame(video.currentTime*1000,
  fps)`); `seekToMs`→`seekToFrame` writes `frameToSeconds`. Sidecar calls
  (`requestTracking` `ClipEditor:1384`, `requestHomography` `:1808`,
  occlusion `:871`) convert frames→ms inline at the call.
- `components/clip/TimelineStrip.tsx`: props to frames (`durationFrames`,
  `currentFrame`, `onSeek(frame)`, keyframe descriptors by frame);
  `playheadFrac = currentFrame / durationFrames`.
- `components/clip/ExportModal.tsx`: loop is already frame-indexed; seek
  via `frameToSeconds(clip.startFrame + i, fps)`; total =
  `frameRangeDuration(clip.startFrame, clip.endFrame)`.
- Delete `lib/clip/clipV2MsAdapter.ts`.

**Tests**: rewrite `interpolation.test.ts`, `trackingState.test.ts`,
`editorState.test.ts`, `bboxConvert.test.ts`, `frameMath.test.ts` in
frames; e2e clip specs re-run unchanged (UI-level).

### 1.3 Pins + the annotate surface

**Goal**: "scrub → Annotate → editor pops out → saved under the clip."

**Do**
- `components/annotate/Editor.tsx` (minimal, additive): new optional prop
  `anchor?: { kind: 'still'; stillId } | { kind: 'pin'; clipId; pinId;
  frame }`. `performSave` (L649) writes `annotations.v2` body when anchor
  kind is `pin` (via `writePinAnnotationDocument`), `annotations.v1`
  otherwise (quick-annotate unchanged). Load path mirrors. The
  `backgroundVideoElement`/`backgroundFrameTick` props (L174-175) already
  support video-backed rendering — the pin annotator uses them instead of
  a still PNG.
- `components/clip/PinAnnotator.tsx` (new): full-screen overlay panel
  hosting `Editor` with the clip's video element seeked to the pin frame,
  the annotate toolbar subset (tools + styles + Manual H + Calibrate reuse
  from `app/annotate/[stillId]/page.tsx:985-1003` — extract the toolbar
  into `components/annotate/AnnotateToolbar.tsx` shared component),
  annotation-set switcher over `pin.annotations` (default/alternate roles,
  create/rename/delete mirroring `page.tsx:129-232`), save status line.
- `ClipEditor`: pins state on the clip — pin lane on `TimelineStrip`
  (markers at pin frames, click = seek, double-click = open annotator);
  transport-bar **Annotate** button: creates a pin at `currentFrame` (or
  reuses one within ±0) and opens `PinAnnotator`; pin list in the side
  panel (label edit, delete → deletes documents via
  `deletePinAnnotationDocument`).
- Delete `app/annotate/[stillId]/` and its page-only machinery (IndexedDB
  handle code moves to 3.3's shared module if not already; the sidecar
  video preview logic is already available in the clip editor context).
- Thumbnails for pins where needed use `frameRaster` + cache.

**Tests**
- Unit: pin CRUD helpers; Editor anchor switch (write path selects schema
  by anchor).
- e2e (new `clip-pins.spec.ts`, fixture v2): create pin → annotate (draw a
  box) → save → reload → pin + drawing persist → export document exists
  under `analysis/clips/{id}/annotations/`. This restores the coverage
  deleted with `clip-save-reload.spec.ts`.

### 1.4 Capture path: player creates clips

**Goal**: the player becomes the clip-capture surface (interim manual
capture; the board replaces the button in phase 2).

**Do**
- `app/player/page.tsx`:
  - "New clip" button + `c` key: `createClipAtPlayhead()` — ClipV2
    `[playheadFrame − defaults.leadFrames, playheadFrame +
    defaults.lagFrames)` clamped to `[0, video.frameCount)`, empty tags,
    `writeClipV2`, select it.
  - Clip list panel (right side, where `TagFolderTree` sat): rework
    `components/tagging/TagFolderTree.tsx` → `ClipTagTree` — same
    collapsible tree, grouped via `boardTagTree(board)` +
    `ensureTaggingSelection(clip.tags).primary`; rows show clip label +
    frame-range timestamp (`frameToMs` → existing `formatRawTime`);
    row click = seek to `startFrame`, double-click = open `/clip/{id}`;
    DnD re-tag sets `clip.tags = { primary: nodeId, facets: {} }` and
    `writeClipV2` (mirrors `handleDropMarkOnNode`, player `page.tsx:236`).
  - Interim tagging: right-click a clip row → `TaggingMenu` fed by a
    board-derived `TaggingSchema` shim (`boardToLegacySchema(board)` in
    `board.ts`, ~20 lines) so tagging works before phase 2. Deleted with
    the menu in 2.3.
  - Undo/redo stacks over clip create/delete/retag (same snapshot pattern,
    now snapshotting the clip list).
- `components/player/VideoPlayerUnit.tsx`: `marks` pips (L451-476) →
  `ranges?: { id; startFrame; endFrame; selected }[]` rendered as strips on
  the track lane; `onAddMark`/`addMark()` → `onCaptureClip`/`captureClip()`
  (same currentTime→frame read); `Mark` type import dropped.

**Tests**: e2e `player-capture.spec.ts` (fixture v2): open video → capture
clip → appears in tree under Untagged → re-tag via menu → tree regroups →
persists on reload. Unit: capture range clamping.

### 1.5 Presentations on the v2 model

**Goal**: clip slides with pause-at-pin playback; pin slides; tag-based
browsing; presentation schema v2.

**Do**
- `lib/types/presentation.ts`:
  - `PRESENTATION_SCHEMA_VERSION = 2`. `ClipSlide` gains
    `pausePins: string[] | null` (null = all) and per-pause annotation
    timing `pauseCues?: { pinId; holdMs?; annotationIds?: string[] }[]`.
  - `StillSlide` → **`PinSlide`**: `{ id; kind: 'pin'; clipId; pinId;
    showAnnotations; annotationIds?; notes?; holdMs? }` (annotation-set
    cues collapse to selecting pin documents by id — the set concept maps
    to the pin's default/alternate documents).
  - `PresentationTransition.match_video` validated over **pin slides**
    (`validateMatchVideoEdge`, `playerController.ts:92`: two pin slides,
    same video, forward frame order; offsets stay ms at the derived-media
    boundary, computed via `frameToMs`).
  - `holdMs`/`enterAtMs`-style presentation timing stays **ms** (it times
    on-screen presentation, not video frames) — document this exception in
    the file header.
- `lib/fs/presentationStorage.ts`: `migratePresentationSchema` (L171)
  simplifies to "accept v2, refuse others" (no data migration).
- `lib/presentation/authoring.ts`: asset index over clips —
  `buildPresentationAssetIndex(clips, board)` (tag tree of clips),
  `buildChronologicalClipGroups(clips, videos)`; `createPinSlide(clip,
  pin)`; `createClipSlide` gains `pausePins: null` default;
  `defaultTransitionForSlides` reworked for pin slides (same video, gap ≤
  5000 ms via `frameToMs`).
- `components/presentation/PresentationAssetBrowser.tsx`: clips grouped by
  tag (from 1.1's interim) + expandable pin rows per clip; drag payloads
  `{ kind: 'clip' | 'pin' }` (`drag.ts` MIME extended).
- `components/presentation/PresentationCanvas.tsx`:
  - Pin slide rendering: frame raster (cache) + annotation overlay — reuse
    `renderAnnotatedPng` (`d7Render.ts:47`) against `AnnotationsV2` +
    rasterized frame to build `annotatedStillUrlById`-equivalent
    (`pinRenderUrlByKey`).
  - Clip playback pause-at-pin: while `state.mode === 'clip'`, watch
    `currentFrame`; entering a pin in `effectivePausePins` pauses, overlays
    the pin's documents (same render path), "advance" resumes; slide
    completes at `endFrame` (`onVideoComplete` unchanged).
- `components/presentation/PresentationInspector.tsx`: pin-slide fields
  (document selection, hold); clip-slide `pausePins` checklist (all pins
  listed, checkboxes; null ⇄ explicit list per schema doc §3.4).
- `lib/presentation/playerController.ts`: state `still` → `pin`
  (`backdropStillId` → `backdropPinKey`); mark-based retrieval states go.
- `lib/presentation/presentPreparation.ts` + `derivedMediaKeys.ts`: bounds
  from `frameToMs(clip.startFrame/endFrame)`; generation keys unchanged in
  shape (still hash ms — deterministic from frames).
- `e2e/support/presentationHelpers.ts`: mark helpers → clip/pin row
  helpers.

**Tests**
- Unit: `authoring.test.ts` rewritten (clip groups, pin slides,
  transitions); `presentationStorage.test.ts` v2 acceptance/refusal;
  playerController pin states.
- e2e rebirth: `presentation-clips.spec.ts` (clip + pin drag, deck counts),
  `presentation-present.spec.ts` (present with a pause pin: plays → pauses
  at pin → advance resumes; exact-motion upgrade path preserved),
  `presentation-transition-preview.spec.ts` (pin-slide match_video edge).
  `presentation-domain/retrieval` premises are gone; a slim
  `presentation-pin-retrieval.spec.ts` asserts pin preview without proxy
  requests.

### 1.6 Exports, clip-based

**Goal**: reports and renders derive from clips/pins; nothing reads stills.

**Do**
- `lib/export/clipExport.ts` (new; replaces `d7Export.ts`):
  `exportAll({ projectDir, manifest, clips, board, onProgress })`:
  - `exports/report/clips.json` + `clips.csv` — one row per clip:
    id, label, video label, `startFrame`, `endFrame`, duration (frames +
    h:mm:ss via `frameToMs`), primary tag, facets, pin count, annotation
    totals.
  - `exports/report/annotated/{clipId}-{pinLabel|frame}.png` per pin
    document: `frameRaster` at pin frame + `renderAnnotatedPng`.
  - No tolerance matching, no `sourceMarkId` (the v1 divergence noted in
    `d7Export.ts:161-174` dies with it), no media copies.
- Export entry point: dashboard sidebar button "Export report…" (home
  page) with the progress/failure toast pattern from
  `app/stills/page.tsx:541-566`.
- Delete `lib/export/d7Export.ts`; keep `d7Render.ts` (renamed export
  types stay — `ExportShape`, `renderAnnotatedPng`, `AnnotationsV1` kept
  only for quick-annotate; move `AnnotationsV1` type next to it with a
  comment).

**Tests**: `clipExport.test.ts` (row building, naming, facet
serialization); e2e assertion appended to `player-capture.spec.ts` or a
small `export.spec.ts` (export → files exist in fixture FS mock).

### 1.7 Deletions sweep — v1 types last

**Goal**: no v1 code remains; the compiler proves it.

**Do (in order)**
1. Delete modules: `lib/clip/stillImport.ts`, `lib/clip/stillRelationship.ts`,
   `lib/tagging/schema.ts` (YAML; keep `selection.ts`),
   `lib/utils/projectIntegrity.ts` (v1), `lib/fs/projectFolder.ts` (v1),
   old `lib/fs/clipStorage.ts`, still-specific helpers in
   `annotationStorage.ts` (`buildDefaultAnnotationPath`,
   `deriveAnnotationStillId`, `listAnnotationEntriesForStill*`,
   `getPrimaryAnnotationEntry`, `createEmptyAnnotations`,
   `readAnnotationDocumentsForStill`, `readPrimaryAnnotationDocumentForStill`,
   `readMergedAnnotationsForStill`, `scanAnnotationEntries` — generic
   read/write/delete/merge stay), `components/tagging/TaggingMenu.tsx`
   stays (phase 2 deletes it).
2. Delete v1 types: `ProjectManifestV1` + `marks`/`stills`/annotation-index
   fields, v1 `Clip`, `StillSlide`, cue types that died. Rename the v2
   files to canonical names (`projectV2.ts` → `project.ts` merge,
   `clipV2.ts` → `clip.ts`, `clipStorageV2.ts` → `clipStorage.ts`,
   `projectFolderV2.ts` → `projectFolder.ts`, drop `V2` suffixes from
   exported names).
3. Chase the compiler until clean; then grep-gate:
   `grep -rn "t_ms\|sourceMarkId\|startMarkId\|marks\[\]\|manifest.marks\|manifest.stills\|StillSlide\|still\." webapp/lib webapp/app webapp/components`
   must return only quick-annotate and generic words. (`stillId` remains
   inside quick-annotate and `AnnotationsV1` only.)
4. Delete old fixtures (`clip-editor-project`, `retrieval-project` v1) and
   the v1-refusal fixture stays (it is the refusal spec's input).
5. Update `technical_document.md` is **not** in this plan — as-built doc is
   rewritten at the end of 0.2, tracked separately.

**Tests**: full suite + build + `bash`-level grep gate above; e2e all
green on v2 fixtures.

**Phase 1 exit**: v2-only app with capture → tag (interim menu) → clip
editor + pins + annotate → presentations with pause-at-pin → exports.

---

## Phase 2 — Tagging window

### 2.1 Board panel component

- `components/tagging/TagBoard.tsx`: renders `board.groups` as button
  grids + `board.facets` as toggle strips. Visual: square dark buttons,
  active-capture state (pulsing border for armed `range` buttons),
  facet toggles latch (single-mode radio behavior / multi-mode check).
  Props: `board`, `armedFacets`, `activeRangeCaptures`, `disabled?`,
  `onButtonPress(buttonId)`, `onFacetToggle(groupId, optionId)`.

### 2.2 Capture engine

- `lib/tagging/capture.ts`:
  - `createCaptureEngine({ board, fps, videoFrameCount })` with:
    `pressButton(buttonId, playheadFrame)` → for `instant`: returns a new
    ClipV2 (lead/lag via `resolveButtonCapture`, tags = button id + armed
    facets, then facets clear); for `range`: first press arms
    (`activeRangeCaptures[buttonId] = startFrame`), second press closes →
    clip `[startFrame, playheadFrame)`.
    `cancelRange(buttonId)`, `getActiveRanges()`.
  - Hotkey map builder `buildHotkeyMap(board)` (button + facet hotkeys;
    collision warnings surfaced once).
- Unit tests: instant/range lifecycles, facet application + clearing,
  clamping, hotkeys.

### 2.3 Player integration + menu removal

- `app/player/page.tsx`: `TagBoard` panel replaces the interim "New clip"
  button (button stays as "untagged capture"); keydown routes through
  `buildHotkeyMap` before transport keys; capture engine output →
  `writeClipV2` + tree refresh + undo stack.
- Re-tagging: with a clip selected and video paused, pressing a board
  button re-tags the selection (explicit mode indicator in the panel
  header: "Capture" vs "Re-tag selected").
- Delete `components/tagging/TaggingMenu.tsx`, `boardToLegacySchema`, and
  the right-click menu path.

### 2.4 Tag tree alignment

- `ClipTagTree` grouping switches from shim to `boardTagTree(board)`
  directly; Unknown-tag bucket for clip tags whose id is not on the board
  (board edits after capture).

### 2.5 e2e

- `tagging-board.spec.ts`: press instant button → tagged clip appears
  under its group; arm+close a range button → range clip; facet toggles
  applied then cleared; hotkey capture; re-tag selected clip.

**Phase 2 exit**: pause→menu flow is gone; board is the only tagging
surface.

---

## Phase 3 — Hierarchy and navigation

### 3.1 Dashboard: Analysis ∥ Presentations

- `app/page.tsx` dashboard: two-wing layout — **Analysis** (video rows →
  `/player`; per-video clip counts; "Export report…") and
  **Presentations** (inline list with create/rename/duplicate/delete —
  lift the list UI from `app/presentations/page.tsx`, which becomes a thin
  wrapper or is folded in; keep the route for deep links).
- Sidebar: project name/meta, Match info, Import video, Save now, Close.

### 3.2 Navigation edges

- Player navbar: `← Project`, `Match info`; no linear "next" links.
- Presentation editor navbar: `← Project`.
- Clip editor navbar: `← Player` (with video preselected) and `← Project`.

### 3.3 Shared handle persistence

- `lib/state/handlePersistence.ts`: extract the triplicated IndexedDB
  code (`annotate-db`/`handles`/`'project'`) from
  `app/clip/[clipId]/page.tsx:46-106`,
  `app/presentation/[presentationId]/page.tsx:19-57` (the annotate page is
  already deleted): `saveProjectHandle(dir)`, `loadProjectHandle()`,
  `restoreProjectFromHandle(setters)`. Home page now also saves on
  open/create — refresh restores everywhere.

### 3.4 e2e

- `navigation.spec.ts`: dashboard wings render; open video → player →
  back; open presentation from wing → editor → back; reload inside player
  restores project.

---

## Phase 4 — Panelization

### 4.1 Panel shell

- Add dependency `react-resizable-panels` (the one new package of 0.2).
- `components/panels/Panels.tsx`: styled wrappers `PanelGroup`, `Panel`,
  `PanelResizeHandle` (square dark handles per `globals.css` tokens);
  every group gets `autoSaveId="annotate:{route}:{groupName}"`
  (localStorage persistence for free).

### 4.2 Clip editor panels (+ the split)

- Restructure `ClipEditor` render into: `ViewerPanel` (stage) /
  `TimelinePanel` (`TimelineStrip` + transport) / `InspectorPanel`
  (annotation + pin lists, tracking controls) — extracting
  `components/clip/TransportBar.tsx`, `components/clip/TrackingToolbar.tsx`,
  `components/clip/AnnotationInspector.tsx`, `components/clip/PinList.tsx`
  from the monolith (state stays in `ClipEditor`, passed by props). This
  is the sanctioned bite out of the 4.8k-line file — extraction only, no
  behavior change.

### 4.3 Player panels

- `VideoPanel` | `TagBoardPanel` | `ClipTreePanel` (horizontal group,
  board and tree vertically split on the right).

### 4.4 Presentation editor panels

- `AssetBrowserPanel` | `CanvasPanel` | `InspectorPanel` with `DeckStrip`
  docked below Canvas (nested vertical group) — current layout, now
  resizable.

### 4.5 Remaining screens

- Dashboard wings and metadata page wrapped in panel groups where resizing
  is meaningful; otherwise plain flex stays (panels are not mandatory
  chrome).

**Tests**: e2e `panels.spec.ts` — drag a handle in clip editor, reload,
size persisted (assert via bounding boxes); unit tests only for any layout
math helpers.

---

## Phase 5 — Internationalization (always last)

### 5.1 Mechanism

- `lib/i18n/index.tsx`: `LocaleProvider` (locale in localStorage, default
  `en`), `useT()` returning `t(key, params?)` with `{param}`
  interpolation; `messages/en.json`, `messages/zh-CN.json` (flat
  dot-namespaced keys: `player.captureClip`, `board.retagMode`, …).
- Locale toggle in `components/HeaderControls.tsx`.
- Dates/numbers through `Intl` with the active locale where they surface
  (dashboard created-date, export CSV stays machine-format).

### 5.2 Extraction sweep (screen order)

1. Dashboard + project setup, 2. player + tag board + clip tree,
3. clip editor + pin annotator, 4. presentation editor + present mode,
5. metadata screens, 6. toasts/errors/export strings.
Rule: extraction PR per screen; no literal user-facing strings left in
that screen's components (grep gate per directory).

### 5.3 zh-CN pass

- Translate `messages/zh-CN.json`; native-speaker review round (the
  interested friend); fix overflow layouts flagged during review (CJK
  line-height/width in buttons and panel headers).

### 5.4 e2e

- `i18n.spec.ts`: toggle to zh-CN → key screens render translated strings
  → persists across reload.

**Explicitly out**: URL-locale routing, zh-TW (post-0.2), translating the
default board template (user content; ships English with a note that
boards are per-project editable).

---

## Appendix A — Unit-test disposition

| Test file | Fate |
|---|---|
| `clip/frameMath.test.ts` | extended (0.1), rewritten frames-native (1.2) |
| `clip/interpolation.test.ts`, `clip/trackingState.test.ts`, `clip/editorState.test.ts`, `clip/bboxConvert.test.ts` | rewritten in frames (1.2) |
| `clip/stillImport.test.ts`, `clip/stillRelationship.test.ts` | deleted (1.1) |
| `clip/videoLocator.test.ts`, `clip/sidecarClient.test.ts`, `clip/homographyInterpolation.test.ts`, `clip/pitchProjection.test.ts` | survive |
| `fs/clipStorage.test.ts` | mark-pinning blocks deleted (1.1); rest re-pointed at folder-per-clip storage (0.4/1.7) |
| `fs/annotationStorage.test.ts` | still-centric cases deleted; generic doc IO cases survive; pin-path cases added (0.4) |
| `fs/presentationStorage.test.ts` | v2 acceptance/refusal (1.5) |
| `fs/derivedMediaStorage.test.ts`, `presentation/derivedMediaServing.test.ts` | survive (keys still ms-hashed) |
| `utils/projectIntegrity.test.ts` | deleted; replaced by `projectIntegrityV2` suite (0.4) |
| `presentation/authoring.test.ts` | rewritten over clips/pins (1.5) |
| `metadata/*.test.ts`, `annotate/pitchCalibration.test.ts`, `components/annotate/*.test.ts` | survive |
| `export/d7Export.test.ts` | replaced by `clipExport.test.ts` (1.6) |
| `annotate/quickSession.test.ts` | survives untouched (isolated feature) |
| New | `tagging/board.test.ts` (0.3), storage v2 suites (0.4), `tagging/capture.test.ts` (2.2), i18n key-coverage check (5.2) |

## Appendix B — e2e disposition

| Spec | Fate |
|---|---|
| `home.spec.ts` | updated copy/stats (1.1) |
| `clip-editor.spec.ts` | still-import block stripped (1.1); runs on v2 fixture |
| `clip-homography.spec.ts`, `clip-occlusion.spec.ts` | survive on v2 fixture (1.1/1.2) |
| `clip-save-reload.spec.ts` | deleted (1.1); coverage reborn in `clip-pins.spec.ts` (1.3) |
| `presentation-clips.spec.ts` | reduced (1.1) → rebuilt with pins (1.5) |
| `presentation-domain/retrieval/present/transition-preview` | deleted (1.1) → reborn as pin/clip variants (1.5) |
| New | `v1-refusal.spec.ts` (1.1), `clip-pins.spec.ts` (1.3), `player-capture.spec.ts` (1.4), `export.spec.ts` (1.6), `tagging-board.spec.ts` (2.5), `navigation.spec.ts` (3.4), `panels.spec.ts` (4), `i18n.spec.ts` (5.4) |

## Appendix C — ms-field fate map

| Today (owner → field) | Fate |
|---|---|
| `videos[].durationMs` | → `frameCount` (0.2/1.1) |
| `marks[].t_ms`, `stills[].t_ms`, `sourceMarkId` | deleted with entities (1.1/1.7) |
| `Clip.startMs/endMs`, keyframe `tMs`, visibility `tMs` | → `startFrame/endFrame`, `frame` (0.2/1.2) |
| `HomographyFrame.tMs`, cache `range-{startMs}-{endMs}` | **stays ms** (sidecar boundary artifact); frame wrapper added (1.2) |
| sidecar params `startMs/endMs/frameMs/seedFrameMs` | stay ms; converted at call sites (1.2) |
| presentation `holdMs`, cue `enterAtMs/exitAtMs`, transition `startOffsetMs/endOffsetMs` | **stay ms** (presentation-time, not video-time); documented exception (1.5) |
| derived-media generation keys hashing ms | stay ms, derived via `frameToMs` (1.5) |
| `ExactMotionAssetIndexEntry.durationMs` | stays ms (media metadata) |

## Appendix D — sequencing summary

```
0.1 frameMath → 0.2 types → 0.3 board → 0.4 storage → 0.5 raster → 0.6 fixtures
1.1 FLIP (v2-only + amputation) → 1.2 frames-native editor → 1.3 pins+annotator
   → 1.4 capture → 1.5 presentations → 1.6 exports → 1.7 sweep (v1 types last)
2.1 board panel → 2.2 capture engine → 2.3 player integration (menu dies)
   → 2.4 tree alignment → 2.5 e2e
3.1 dashboard wings → 3.2 nav edges → 3.3 handle persistence → 3.4 e2e
4.1 panel shell → 4.2 clip editor split → 4.3 player → 4.4 presentation → 4.5 rest
5.1 i18n mechanism → 5.2 extraction sweep → 5.3 zh-CN → 5.4 e2e
```

Rewriting `technical_document.md` to describe the v2 app is the closing
task of 0.2, after phase 5 (or after phase 4 if i18n slips to 0.3).
