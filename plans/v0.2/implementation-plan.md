# Annotate 0.2 – Implementation Plan

Date: 2026-08-08 (rev 9, documentation sync amendment)
Status: All non-manual phases verified; non-English editorial review pending
Parents: [v0.2-scope.md](v0.2-scope.md) · [project-v2-schema-and-migration.md](project-v2-schema-and-migration.md)

## How to read this

- Steps are numbered `phase.step` and ordered — each lands **green**
  (build + `npm test`; e2e where stated) before the next starts.
- Phase 1 builds a complete **v2 vertical slice in parallel** with the
  working v1 app (temporary `/v2/…` route namespace). The flip to v2-only
  is the *last* step of phase 1, after the slice is green end-to-end. v1
  e2e specs keep running until the flip, so browser coverage never drops.
- File paths are relative to `webapp/` unless prefixed. Line references
  locate today's code and will drift.
- Phase steps preserve the implementation-time sequence and temporary names.
  Step 1.7 records their promotion/deletion; canonical as-built paths are in
  `../../technical_document.md` and the schema document's final inventory.
- Adopted decisions: every primary tag button is an exact-frame start/stop
  range toggle with no automatic pre/post-roll; exports are renders only;
  four aligned UI locales ship in phase 5;
  `/player-legacy` + `/dropdown-test` deleted; annotations under each clip
  folder; **board middle-path semantics** (flat board + per-button facet
  applicability + `requiresAny`; vetoable, see scope doc); **deletion =
  trash + degrade**, never hard-block.
- Analysis sidecar APIs stay ms-based at their HTTP boundaries. The media
  import boundary is the explicit amendment: authoritative per-video metadata
  plus preserve/remux/transcode strategy and progress (step 0.9).
- Presentation playback always reads absolute frame ranges from each original
  project video. Exact-motion encoding/storage remains implemented and tested
  only as dormant export-oriented infrastructure, never as a playback fallback.
- Quick-annotate is a **best-effort survivor**: it rides the annotation
  payload refactor for free if that stays cheap, and is deleted without
  ceremony if preserving its v1 documents complicates the v2 boundary.

## Implementation progress

The implementation lives on `codex/v0.2-foundations`. The frozen 0.1 app
remains independently runnable from the `v0.1.0-pre.3` tag. Completed work
is checked against this plan rather than inferred from route availability.

| Step | State | Evidence |
|---|---|---|
| 0.0 schema lock | `[x]` | §1a contracts adopted as the implementation boundary; later review changes require an explicit amendment |
| 0.1 frame math | `[x]` | branded boundary types, purpose-specific conversions, inclusive-sidecar regression tests |
| 0.2 v2 types | `[x]` | runtime parsers and clip invariant suite |
| 0.3 tagging board | `[x]` | mandatory board module, canonical JSON, validation/applicability tests |
| 0.4 storage/repository/trash/integrity | `[x]` | structured reads, one clip lock, field-owned writes, verified trash, cross-document report suite |
| 0.5 frame rasterizer | `[x]` | variant-keyed cache and serialized-seek tests |
| 0.6 annotation payload | `[x]` | shared payload/anchors, Editor persistence injection, pin lifecycle tests |
| 0.7 shared renderer | `[x]` | v1 export consumes shared resolver/painter; deterministic command tests |
| 0.8 ClipEditor persistence | `[x]` | all annotation saves cross the injected field-owned callback |
| 0.9 per-video media authority | `[x]` | strict per-video metadata, fast container/probe count, preserve/remux/transcode strategy tests |
| 0.10 v2 fixtures | `[x]` | happy/retrieval/broken graphs parse through runtime contracts and integrity checks |
| 1.1 v2 project entry | `[x]` | isolated provider/key, create/open/refusal/report dashboard, refresh and legacy-key isolation e2e |
| 1.2 capture player | `[x]` | frame-exact range capture, board tree/re-tag, trash/undo, atomic per-video import; persistence and rollback e2e |
| 1.3 clip editor | `[x]` | absolute-frame shell/timeline, frame-domain API parity, exact sidecar boundaries, tracking/followers/ranges, homography cache, pitch authoring, repository persistence e2e |
| 1.4 pins, annotator, import | `[x]` | timeline pins, shared full-parity annotator, trash/undo, explicit batch-remapped import, persistence and preview-lock e2e |
| 1.5 presentations | `[x]` | source-preview drag authoring, thumbnail storyboard, shared pins-only timeline, edit-clip handoff/refresh, distinct titles, direct source playback, pause machine and degradation e2e |
| 1.6 exports | `[x]` | deterministic clip JSON/CSV, per-document annotated PNGs, progress and partial failure reporting, complete-folder e2e |
| 1.7 canonical flip | `[x]` | canonical routes/provider/storage/types, v1 deletion sweep, handle-key migration, forbidden-domain grep and full gate |
| 2.1 board panel | `[x]` | fixed coordinate layout, armed-state display, dynamic modifiers, advisory applicability, enforced requirements, collision-safe hotkeys |
| 2.2 capture engine | `[x]` | exact start/stop bounds, facet snapshots/updates, overlapping/reversed ranges, cancellation and hotkey unit coverage |
| 2.3 player integration | `[x]` | board-only capture, explicit untagged/paused re-tag actions, repository writes and operation-backed undo |
| 2.4 tag tree | `[x]` | board-derived groups, DnD re-tagging with facet pruning, separate Untagged/Unknown buckets |
| 2.5 tagging tests | `[x]` | persisted browser workflow for capture, facets, hotkeys, ranges, re-tag, DnD, delete/restore and reload |
| 3.1 dashboard hierarchy | `[x]` | parallel Analysis/Presentations wings, video-scoped counts, full presentation operations and project sidebar controls |
| 3.2 navigation edges | `[x]` | project/metadata/player/editor peer links, clip-owned video preselection and deep-route restoration |
| 3.3 handle persistence | `[x]` | canonical-key state helper validates permission/schema/board/integrity before context population and clears stale handles |
| 3.4 navigation tests | `[x]` | dashboard, CRUD, route reload, denied/stale recovery and v1 refusal browser coverage |
| 4.1 panel shell | `[x]` | typed styled wrappers over the pinned panel dependency, persisted groups, visible/focusable handles and enforced minima |
| 4.2 clip editor panels | `[x]` | viewer/timeline/inspector shell extraction with nested persisted groups and unchanged editor-owned state |
| 4.3 player panels | `[x]` | resizable video/board/tree layout with transport and capture hotkeys preserved after handle focus |
| 4.4 presentation panels | `[x]` | resizable asset/canvas/deck/inspector authoring layout while present mode remains panel-free |
| 4.5 remaining screens/tests | `[x]` | meaningful dashboard split, ordinary metadata forms retained, minima/persistence/keyboard/narrow-viewport browser coverage |
| 5.1 i18n mechanism | `[x]` | persisted locale provider, interpolation, missing-key diagnostics, Intl helpers, global locale control and catalog contract tests |
| 5.2 extraction sweep | `[x]` | primary route chrome, statuses, accessibility text, structured export progress, validation and integrity descriptions use the shared catalog |
| 5.3 non-English catalogs | `[-]` | complete aligned French, Spanish, and Simplified Chinese catalogs plus CJK layout pass; native-speaker review remains a manual sign-off |
| 5.4 i18n e2e | `[x]` | chooser plus every primary route, reload persistence, interpolation, editable English board content and raw-key absence |
| Stabilization: per-video media import | `[x]` | preserve/remux/transcode jobs, real progress, fast long-MP4 probe, native media contracts, bounded fallback, cancellation/cleanup, and global serialization |

Phase 0 exit verification on 2026-07-11: 308 Vitest tests, 21 sidecar
pytest tests, 10 existing Playwright flows, TypeScript, lint (warning-only
legacy baseline), and the production build all pass.

Phase 1.2 exit verification on 2026-07-11: 312 Vitest tests, 21 sidecar
pytest tests, all 19 Playwright flows (v1 and v2), TypeScript, lint (the
same 39-warning legacy baseline with no v2 warnings), `git diff --check`,
and the production build all pass. The browser suite covers capture,
re-tag, trash/undo, reload persistence, project-handle isolation, and
atomic import rollback when authoritative import metadata is absent.

Phase 1.3 exit verification on 2026-07-11: 317 Vitest tests, 21 sidecar
pytest tests, all 20 Playwright flows (v1 and v2), TypeScript, lint (the
same 39-warning legacy baseline with no v2 warnings), `git diff --check`,
and the production build all pass. The v2 clip-editor browser contract uses
a non-zero clip start and covers absolute-frame tracking plus linked follower
motion, forward/backward range re-tracking with an in-range seed, exact
inclusive-sidecar end conversion, independently configured 5 FPS homography,
pitch drawing, keyframe add/delete/undo/redo, visibility events, manual
keyframe drag retiming, and repository persistence without stored `tMs`.

Phase 1.4 exit verification on 2026-07-11: 320 Vitest tests, 21 sidecar
pytest tests, all 21 Playwright flows (v1 and v2), TypeScript, lint (the
same 39-warning legacy baseline with no new warnings), `git diff --check`,
and the production build all pass. The v2 pin browser contract covers
create/reuse/label/delete/undo, annotation-set create/delete/undo, every
tactical tool through the shared still/pin toolbar, linked-object drawing,
Editor undo/redo and save/reload, mocked exact calibration bounds, the
five-second preview lock, and explicit pin-to-clip import with fresh ids and
remapped highlight references. Unit coverage also checks every tactical
shape type, perspective payloads, and repeated imports.

Phase 1.5 exit verification on 2026-07-11: 328 Vitest tests, 21 sidecar
pytest tests, all 23 Playwright flows (v1 and v2), TypeScript, lint (no
new warnings beyond the legacy baseline), `git diff --check`, and the
production build all pass. Presentation coverage includes clip-first
tag/chronological browsing, expandable pin drag sources, persisted deck
insertion/reordering, title/clip/pin inspection, pause/document/cue controls,
animated annotation pixel output through the shared renderer, rasterized
annotated pin frames, forward-crossing pause/resume without retrigger,
direct-source clip and match-video paths, absolute source-range timebase
mapping, early-scrub/media-readiness race protection, and visible
missing-reference degradation. The 2026-08-07 amendment additionally proves
that Present makes no exact-motion request and ignores existing prepared
assets. The browser contract also passed three consecutive repetitions before
the full-suite gate.

Phase 1.6 exit verification on 2026-07-11: 330 Vitest tests, 21 sidecar
pytest tests, all 24 Playwright flows (v1 and v2), TypeScript, lint (no
new v2 warnings), `git diff --check`, and the production build all pass.
The browser export contract inspects the fixture filesystem and verifies
clip JSON/CSV rows, deterministic per-document PNG names, non-empty renders,
animated/pin totals, tag/facet serialization, progress completion, and that
no source media is copied into `exports/`. Unit coverage verifies
collision-safe naming and report continuation after an individual annotation
document fails. The presentation early-scrub contract also passed five
consecutive repetitions after pending-seek callback arbitration was added.

Phase 1.7 exit verification on 2026-07-11: 189 canonical Vitest tests,
21 sidecar pytest tests, and all 14 canonical Playwright flows pass;
TypeScript, `git diff --check`, and the production build are clean. Lint is
warning-only with eight remaining warnings (shared Editor, metadata importer,
temporary TaggingMenu, and experimental segmentation page). `/` and the
canonical player/clip/presentation routes now own the frame-native slice;
the `/v2` namespace, v1 routes, v1 storage/types/presentation stack, YAML
schema IO, millisecond clip APIs, v1 fixtures, and v1 browser specs are gone.
All coexistence-era `*V2` files and exports were promoted to canonical names.
The project-handle store writes `project` and migrates the temporary
`project-v2` key. The production grep gate is empty for mark/still and
millisecond-domain fields; `annotations.v1` remains only for the explicitly
retained standalone quick-annotate parser/session. The frozen
`v0.1.0-pre.3` release remains the rollback/use path.

Phase 2 exit verification on 2026-07-11: 195 canonical Vitest tests,
21 sidecar pytest tests, and all 14 canonical Playwright flows pass;
TypeScript, `git diff --check`, and the production build are clean. Lint is
warning-only with six pre-existing warnings in the shared Editor, metadata
importer, and experimental segmentation page; the new tagging surface is
warning-free. The board is now the only tagging surface: the interim video
capture controls, pause/menu path, legacy schema adapter, and YAML-era menu
types are deleted. Browser coverage reads persisted clip documents to verify
simultaneous range capture, inclusive stop frames, facet snapshot/update and
requirements, hotkey exclusions, paused-only re-tagging, DnD facet pruning,
explicit untagged capture, trash restore, and reload. The later board UX
amendment made all primary controls exact-frame range toggles, added authored
coordinate layout, and exposed pending captures on group-derived timeline
lanes.

Phase 3 exit verification on 2026-07-11: 196 canonical Vitest tests,
21 sidecar pytest tests, and all 16 canonical Playwright flows pass;
TypeScript, `git diff --check`, and the production build are clean. Lint
remains warning-only with the same six pre-existing warnings. The dashboard
now exposes parallel Analysis and Presentations wings, presentation
create/rename/duplicate/delete/open operations, video-scoped clip counts,
and project-level save/import/trash/metadata controls. A single state-layer
handle helper owns the canonical IndexedDB key and completes permission,
schema, board, cleanup, and integrity work before context is populated.
Browser coverage reloads every deep route and proves denied and stale handles
are cleared without exposing partial project state.

Phase 4 exit verification on 2026-07-11: 196 canonical Vitest tests,
21 sidecar pytest tests, and all 20 canonical Playwright flows pass;
TypeScript, `git diff --check`, and the production build are clean. Lint
remains warning-only with the same six pre-existing warnings. Clip, player,
presentation-authoring, and dashboard layouts now use persisted resizable
groups with reachable minima, visible keyboard-operable separators, and no
page-level narrow-viewport overflow. Present mode and ordinary metadata
forms remain intentionally panel-free. Browser coverage exercises every
major split, reload persistence, keyboard resizing, post-resize player
hotkeys, and mobile fallback. The former late prepared-asset handoff was
removed by the 2026-08-07 direct-source amendment. Asynchronous clip loading
now changes the resolved scene identity so playback initializes at the clip's
real start frame; the pause-at-pin path remains covered end to end.

Phase 5 implementation verification on 2026-07-11: 198 canonical Vitest
tests, 21 sidecar pytest tests, and all 21 canonical Playwright flows pass;
TypeScript, `git diff --check`, and the production build are clean. Lint is
warning-only with five pre-existing warnings, one fewer than Phase 4 after
the metadata importer callback dependency was corrected. The locale provider
persists `en`/`fr`/`es`/`zh-CN`, updates document language, supports named
interpolation and `Intl` formatting, reports missing keys in development,
and tolerates blocked local storage. All four catalogs contain the same 522 keys
and interpolation tokens. The extraction covers setup/dashboard, player and
the user-authored board/tree, clip tools/timeline/pins, presentation
authoring/playback, metadata/importers, statuses/errors, accessibility text,
and locale-neutral structured export progress. Chinese-specific font,
line-height, wrapping, and responsive-modal guards are present. Browser
coverage switches before project open, traverses every primary route,
persists French and Spanish switching, exercises the Simplified Chinese
primary-route surface, checks interpolated values and raw-key absence, and
proves default board content remains editable English project data. Native
speakers have not yet reviewed the non-English copy, so 5.3 remains `[-]`
rather than being overstated as complete.

Post-plan media stabilization on 2026-07-11 first replaced blocking all-core
`libx264` work with observable background jobs, VideoToolbox, bounded software
fallback, cancellation, and serialization. The contract was then amended after
a two-hour source exposed the deeper problem: projects no longer impose one FPS
or resolution. Compatible CFR H.264 MP4 is preserved, compatible streams are
remuxed without video encoding, and only VFR/incompatible media is transcoded
at native dimensions/FPS. Container `nb_frames` avoids scanning ordinary long
MP4s; packet/decode counting remains the exact fallback. Homography cache
identity includes `videoId`, and annotation defaults scale with source
resolution. Final gate evidence is recorded below.

Per-video media amendment gate on 2026-07-11: 205 Vitest tests across 35
files, 28 sidecar pytest tests (including real preserve/remux media), all 22
Playwright Chromium flows, TypeScript, production build, `git diff --check`,
and ESLint with no errors and the unchanged five-warning baseline all pass.

Documentation-sync and presentation-authoring amendment gate on 2026-08-08:
259 Vitest tests across 44 files, 41 sidecar pytest tests, and all 30
Playwright Chromium flows pass. TypeScript, the production build,
`git diff --check`, and local Markdown-link validation are clean. ESLint has no
errors and one warning in the experimental segmentation page. The browser
suite includes source-preview/deck independence, direct original-video
playback with no exact-motion requests, pins-only authoring transport,
slide-switch timeline and animation reset, cross-tab clip editing entry, dense
tracked-timeline performance, and four-catalog locale switching coverage.

Release-hardening amendment gate on 2026-08-09: production startup now
supervises the built webapp and sidecar, PnLCalib source and weights are pinned
and mandatory, large video uploads stream to disk, project-manifest writes are
serialized, disposable project folders self-heal, and third-party notices are
included. Exact JavaScript and Python environments were refreshed and locked.
The clean-install gate passes 263 Vitest tests across 44 files, 42 sidecar
pytest tests, all 30 Playwright Chromium flows against both development and
production servers, TypeScript, strict zero-warning ESLint, the production
build and launcher smoke, npm and Python dependency audits, and real
PnLCalib/YOLO provider smoke tests.

The browser pixel assertion from 0.7 and route-level atomic-import assertion
from 0.9 attach to the first runnable v2 routes in 1.1–1.3; their unit and
service boundaries are already covered.

---

## Phase 0 — Contracts and shared foundations (v1 behavior unchanged)

### 0.0 Schema lock

**Goal**: freeze the contracts everything else builds on. No code.

**Do**: finalize the **Locked contracts** section of the schema doc (§1a)
covering, at minimum:
- absolute video frames as the only stored media position (pins *and*
  keyframes; clip-relative derived only at UI edges),
- half-open ranges and the sidecar boundary rule (sample through
  `endFrame − 1`; encode with exclusive duration),
- pin and document invariants,
- deletion policy (trash + degrade-to-missing),
- clip-subtree single-mutation/field-ownership rule,
- presentation playback contracts (animated-annotation rendering,
  pause-at-pin crossing machine, direct original-media timebase mapping),
- board semantics (middle path),
- `frameCount` authority,
- pin/document lifecycle rules and presentation-reference degradation,
- the v1/v2 context boundary during the parallel-route window.

**Done when**: schema doc §1a is reviewed and signed off (one read-through
by the owner). Any later change to a locked contract is an explicit
amendment, not drift.

### 0.1 Frame math, branded types, boundary contract

**Do**
- `lib/clip/frameMath.ts`:
  - Branded types: `VideoFrame` (index of an existing frame),
    `FrameBoundary` (exclusive range end; may equal `frameCount`),
    `Milliseconds`. Brands live in the **types/storage/frameMath layer
    only** — component props stay plain numbers.
  - Use purpose-specific conversions rather than an ambiguous
    `msToFrame`: `mediaTimeToVideoFrame(seconds, fps, frameCount)` uses
    the presented frame's `requestVideoFrameCallback().mediaTime` during
    playback and a floor-plus-epsilon fallback; `timestampMsToNearestFrame`
    maps sidecar timestamps; `frameToMs`, `frameToSeconds`, `clampFrame`,
    and `frameRangeDuration` cover the inverse/range cases.
  - Boundary helpers that encode the sidecar rule once:
    `lastFrameOfRange(start, end): VideoFrame` (= `end − 1`),
    `sidecarSampleEndMs(range, videoFps)` (= `frameToMs(end − 1)`),
    `encodeDurationMs(range, videoFps)` (exclusive). The owning video's
    FPS and the sidecar's requested sample FPS are separate parameters.
  - One-frame clips are valid for static/pin workflows. Range-based
    tracking and homography require at least two frames and are disabled
    with a clear message instead of sending the sidecar an invalid
    `endMs === startMs` request.
- Keep today's ms-snap helpers; deleted at the flip (1.7).

**Tests**: exact-seek round-trips at 25/30/50/60 fps; displayed-frame
mapping on both sides of a frame boundary; `endFrame === frameCount`;
one-frame range handling. Simulate `frame_extractor.py:139` at both the
video FPS and a sparse 5 FPS sample rate and assert that every emitted
timestamp maps inside `[startFrame, endFrame)` and that none reaches the
exclusive end. Do not equate sparse sample count with clip frame count.

### 0.2 v2 types (canonical, absolute frames)

**Do**
- `lib/types/projectV2.ts`: `ProjectManifestV2` — `schema: 'project.v2'`,
  `name`, `created`, `videos: VideoEntryV2[]`
  (`id`, `label`, `file`, `fps` required, `frameCount: FrameBoundary`
  required, `frameCountSource: 'normalize' | 'probe'` required, `width`,
  `height`), `matchInfo?` (reused from v1 types).
- `lib/types/clipV2.ts` — **the canonical clip document** (a JSON fixture
  uses `satisfies ClipV2`, is parse-tested, and mirrors schema doc §3.2):
  - `FrameKeyed<K> = Omit<K, 'tMs'> & { frame: VideoFrame }` applied to
    the nine keyframe types + `ClipVisibilityKeyframe`. **Keyframe frames
    are absolute video frames**, same axis as pins.
  - `ClipPin { id; frame: VideoFrame; label?; annotations:
    PinAnnotationRef[] }`, `PinAnnotationRef { id; file; role; label? }`.
  - `ClipV2 { schema: 'clip.v2'; id; videoId; startFrame: VideoFrame;
    endFrame: FrameBoundary; label?; tags: TaggingSelection;
    pins: ClipPin[]; annotations: ClipAnnotationV2[] }`.
  - Invariant helpers: `validateClipV2(clip): ClipIssue[]` (folder id =
    document id, unique pin ids, ≤1 pin per frame, pins sorted, annotation
    ids unique **across the clip**, safe clip-relative annotation paths,
    ≤1 `default` doc per pin, pin frames within `[startFrame, endFrame)`).
    Duplicate pins across *overlapping clips* are allowed by design.
- `lib/types/annotationsV2.ts`: `AnnotationsV2` with anchor
  `{ clipId; pinId; frame }` + the shared payload (0.6).
- `lib/types/presentationV2.ts`: the complete schema-2 surface from the
  schema doc §3.4: `PresentationV2`, `ClipSlideV2`, `PinSlideV2`,
  `TitleSlideV2`, `ClipPauseCueV2`, `PinAnnotationCueV2`, and frame-based
  match-video transition trims. This type exists before fixtures.

**Tests**: invariant helpers; compile-coverage constructors.

### 0.3 Tagging board module (middle path)

**Do**
- `lib/tagging/board.ts`:
  - `TaggingBoard { schema: 'tagging-board.v1'; layout?; defaults {
    leadSeconds; lagSeconds; mode }; groups: BoardGroup[];
    facets: BoardFacetGroup[] }`. Layout defines one fixed board coordinate
    space, modifier slots, group-label rectangles, and button rectangles.
  - `BoardButton { id; label; hotkey?; leadSeconds?; lagSeconds?; mode?;
    facetGroupIds?: string[] }` — per-button facet applicability
    (ports the YAML `facet_group_ids`).
  - `BoardFacetGroup { id; label; mode: 'single' | 'multi';
    requiresAny?: { facetGroupId; optionId }[]; options: { id; label;
    hotkey? }[] }` — ports `requires_any` (e.g. goal-method requires
    goal). Deep primary-tree nesting is **not** ported — groups are one
    level; the tag tree derives from groups.
  - `parseTaggingBoard`, `readTaggingBoard`, `writeDefaultTaggingBoard`,
    `validateTaggingBoard`,
    `resolveButtonCapture`, `boardTagTree`,
    `applicableFacetGroups(board, buttonId)`,
    `pruneInapplicableFacets(board, buttonId, selection)` — used on
    re-tag instead of v1's clear-all-facets.
  - **Boards are mandatory**: v2 open auto-installs the default board when
    missing (no prompt, no optional path).
  - The parser retains `mode` and lead/lag fields for early-v2 board
    compatibility. The canonical resolver normalizes every primary button to
    exact-frame range capture with zero lead/lag.
  - Validation errors: duplicate ids, unresolved `facetGroupIds`, invalid
    `requiresAny` group/option references, dependency cycles, and invalid
    capture defaults. Hotkey collisions are structured warnings; every
    conflicted hotkey is disabled until the board is corrected rather than
    picking a winner silently.
- Move `TaggingSchema`/`TaggingNode`/`TaggingFacetGroup` **type**
  declarations into `lib/tagging/legacySchemaTypes.ts` so `TaggingMenu`
  keeps compiling after `schema.ts` (YAML IO) is deleted at the flip;
  both die together in 2.3. `TaggingSelection` helpers move to
  `lib/tagging/selection.ts` (schema.ts re-exports meanwhile).
- `public/tagging/board.json`: default template hand-ported from
  `public/tagging/schema.yaml` **including** facet applicability and
  requires-any content.

**Tests**: parse/validate including bad references and cycles; hotkey
collision behavior; applicability resolution; requiresAny gating;
prune-on-retag; canonical template parses without issues.

### 0.4 Storage v2, clip repository, trash, integrity

**Do**
- `lib/fs/projectFolderV2.ts`: as before (create/validate/refuse-v1;
  `presentations/` validated), **plus**: `createProjectV2` refuses a
  non-empty destination or an existing `project.json` — "Create" must
  never overwrite what "Open" would refuse (also a live 0.1 bug,
  `app/page.tsx:93-105`).
- `lib/fs/clipStorageV2.ts`: reads return **structured results** —
  `readClipV2 → { ok: true; clip } | { ok: false; clipId; error }`;
  `listClipsV2 → { clips; errors[] }` (no silent skips).
- `lib/fs/presentationStorageV2.ts`: minimal schema-2 read/write/list with
  structured errors. It lands here because integrity must resolve
  presentation references before the authoring UI exists; Phase 1.5 builds
  behavior on this storage rather than introducing it late.
- `lib/fs/clipRepository.ts` establishes the **single mutation boundary**
  for a clip subtree. In this step it owns `clip.json`, exposes the internal
  `withClipExclusive` primitive that document adapters consume in 0.6, and
  implements clip create/delete/restore:
  - `mutateClipExclusive(projectDir, clipId, mut: (latest) => next)` uses
    `navigator.locks.request('annotate:clip:' + clipId, 'exclusive')`,
    checks the clip tombstone, reads the latest document, applies the
    mutation, validates, writes, and returns the persisted document.
    Web Locks is required alongside the already-required Chromium File
    System Access API; unsupported browsers fail clearly.
  - Field-owned wrappers prevent stale snapshots:
    `replaceClipAnnotationsExclusive`, `replaceClipPinsExclusive`, and
    `replaceClipTagsExclusive` merge only their field into the latest
    document. Editor autosave never submits a whole clip. Capture uses
    `createClipExclusive`; re-tag and pin operations use the wrappers.
  - Deletion and restoration acquire the **same clip lock**. A persistent
    `.trash/tombstones/{clipId}.json` makes every later mutator refuse a
    deleted clip, so a queued editor autosave cannot recreate it.
- `lib/fs/trashV2.ts` implements the File System Access API operation the
  browser actually supports: recursively copy → verify file count and byte
  sizes → write operation record/tombstone → recursively delete the source.
  There is no directory `move()` assumption.
  - `deleteClipToTrash` stores `.trash/clips/{clipId}-{operationId}/`;
    `restoreClipFromTrash` verifies the destination is absent, copies back,
    verifies, then removes the tombstone and trash entry.
  - Trash is cleaned after a successful project open and by an explicit
    Empty Trash action, not on tab/project close. Default retention is 30
    days and 500 MiB, evicting oldest entries first while preserving the
    current session's undo entries. Cleanup removes recoverable payloads,
    not tiny clip tombstones; a tombstone remains until restore so an old
    tab can never reuse/recreate that clip id.
  - This step supplies generic file/subtree trash operations. Pin/document
    adapters land with their serializers in 0.6, avoiding a forward
    dependency.
- `lib/utils/projectIntegrityV2.ts`: rules from 0.2's `validateClipV2`
  **plus cross-document checks**: clip `videoId` resolves; annotation
  file anchors equal owner clip/pin/frame; orphan documents in clip
  folders; clip folder id equals `clip.id`; paths cannot escape their clip;
  source video files resolve; **presentation references** (pin/clip slides,
  explicit `pausePins`, pause/annotation cues, and match-video pin edges)
  resolve — unresolved targets are
  reported and degrade to the player's existing `missing` state
  (`playerController.ts:35-78`), never hard-block.
  `checkProjectOnOpen(...)` is **wired into the v2 open path** (1.1) and
  surfaces a report UI, not just a return value.

**Tests**: repository lock serialization (racing annotations-field/tag
mutators preserve both changes); queued autosave after deletion is rejected;
copy/verify/delete and clip trash round-trip; interrupted copy leaves the
source authoritative; retention policy; structured read errors; every
integrity rule including presentation refs. Mock FS gains
byte-sized files, nested-copy support, and `{ recursive: true }`
enforcement — deleting a non-empty directory without it throws, as the
real API does.

### 0.5 Frame rasterizer (variant-keyed, serialized)

**Do**
- `lib/media/frameRaster.ts`:
  - Cache key includes the variant: `cache/frames/{videoId}/{frame}@{w}.png`
    (`w` = output width; full-res uses the video width). A thumbnail can
    never be served as an export-quality raster.
  - `createFrameRasterQueue(videoFileOrEl)` — seeks are serialized
    through one hidden `<video>` element per source; concurrent
    thumbnail requests queue rather than race the seek position.

**Tests**: key/variant separation; queue ordering (mocked seek).

### 0.6 Annotation payload generalization (Editor internals)

**Goal**: one renderable payload; anchors become adapters. v1 behavior
unchanged; this unblocks pin documents *and* keeps quick-annotate viable
for free.

**Do**
- `lib/annotate/documentPayload.ts`: `AnnotationPayload { image: { width;
  height }; shapes: ExportShape[]; perspective?: { quad } }` +
  `AnnotationAnchor = { kind: 'still'; stillId } | { kind: 'pin';
  clipId; pinId; frame: VideoFrame }` + serializers
  `toAnnotationsV1(payload, stillAnchor)`, `toAnnotationsV2(payload,
  pinAnchor)`, `parseAnnotationDocument(json) → { anchor; payload } |
  error` (accepts both schemas).
- `lib/export/d7Render.ts`: `renderAnnotatedPng({ bmp, payload })` —
  takes the payload; `AnnotationsV1` remains only as a parse target.
- `components/annotate/Editor.tsx`: internally loads/saves through
  `parseAnnotationDocument`/serializers chosen by an `anchor` prop
  (default: still — current behavior). It also accepts an optional
  `projectDir` prop and optional `persistDocument` adapter; v1 defaults to
  the existing context/storage, while v2 passes its route-local handle and
  `savePinAnnotationExclusive`. Backup doc-keys
  (`Editor.tsx:77-121`) and the BroadcastChannel event payload become
  anchor-shaped and include the annotation id; the save Web Lock uses that
  same full document key. The v1 schema-rejection check (`Editor.tsx:400`)
  moves into the parser.
- `lib/fs/annotationStorage.ts`: generic `readAnnotationDocument`
  (L152, currently hard-rejects non-v1) delegates to the parser;
  `writeAnnotationDocument` takes serialized output. Still-specific
  helpers untouched (they die at the flip).
- `lib/fs/pinAnnotationStorage.ts`: paths are
  `analysis/clips/{clipId}/annotations/{annotationId}.json`; ids are
  clip-wide unique. `savePinAnnotationExclusive` plus pin/document
  create/delete/restore operations run through `withClipExclusive`; any
  per-document lock nests inside the clip lock. Saves re-read `clip.json`
  and refuse deleted pin/document refs, so a stale Editor cannot recreate
  one. Creation writes the document before its ref (an interrupted write
  can leave a reportable orphan); deletion removes the ref only after a
  verified `.trash/pins/` or `.trash/annotations/` copy, then removes the
  source. Pin frame is immutable and pin restore requires its frame to be
  free.

**Tests**: parser accepts v1+v2, rejects garbage with structured errors;
serializer round-trips; Editor save-path coverage for anchor and injected
persistence; pin/document trash round-trips; a pin save racing clip
deletion serializes under the clip lock; quick-annotate e2e re-run
(unchanged behavior proves the refactor is neutral).

### 0.7 Shared animated clip-annotation renderer

**Goal**: the renderer presentations need in 1.5 exists *before* any
route work, proven by ClipEditor itself using it.

**Do**
- Extract `lib/clip/renderClipAnnotations.ts` from ClipEditor's canvas
  export painter (`renderAnnotationsToCanvas`, `ClipEditor.tsx:3832`) in
  two layers:
  - `resolveClipDrawables(annotations, sample, temporalAdapter,
    homographyLookup)` resolves interpolation, linked highlights/vertices,
    visibility, pitch projection, and style into time-agnostic drawable
    geometry.
  - `paintClipDrawablesToCanvas(ctx, drawables, size)` performs only Canvas
    2D commands. `renderClipAnnotationsToCanvas` composes the two.
- A `millisecondTemporalAdapter` wraps today's v1 interpolation/homography
  functions, so ClipEditor's `ExportModal` switches immediately without
  pretending its keyframes are already frame-native. The frame adapter
  lands with the v2 interpolation APIs in 1.3 and is reused by presentation
  playback in 1.5.
- The Konva interactive layer stays in ClipEditor (it is editor chrome);
  only the paint-to-canvas path is shared.

**Tests**: Node/Vitest has no canvas implementation, so the unit test uses
a recording mock `CanvasRenderingContext2D` and asserts deterministic draw
commands for known annotations. Real rendering remains in Playwright:
export deterministic annotations and assert known filled/stroked pixels
with a small tolerance, alongside the existing export-flow coverage.

### 0.8 ClipEditor persistence injection (v1-neutral)

**Goal**: remove the editor's own storage coupling so the v2 slice can
inject the repository (the rev-1 "ms adapter" is dead — the editor calls
`writeClip` itself at `ClipEditor.tsx:29,594,2347` and would persist
adapted objects through the old path).

**Do**
- `ClipEditorProps` gains
  `persistAnnotations: (annotations: ClipAnnotation[]) => Promise<Clip>`;
  both autosave and Cmd/Ctrl+S route through it, and `onClipUpdate` receives
  the returned persisted clip. The v1 route reads its latest clip and
  replaces only `annotations`; the v2 route uses
  `replaceClipAnnotationsExclusive`. No whole-clip snapshot crosses this
  boundary.

**Tests**: existing clip e2e green; unit test that saves flow through
the injected callback.

### 0.9 Per-video media authority and smart import

**Do**
- Sidecar: background `/video/normalize/*` jobs analyze first and choose
  `preserve`, `remux`, or `transcode`. Preserve handles compatible CFR H.264
  MP4 with no encode; remux copies compatible video into MP4; transcode handles
  VFR/incompatible media at source FPS/dimensions. Progress covers upload,
  analysis, FFmpeg work, probing, and download. VideoToolbox is preferred on
  macOS and software fallback is bounded.
- Probe positive container `nb_frames` first, then `ffprobe -count_frames`,
  then explicit decode/count. Container/browser duration never creates a frame
  count. Responses expose FPS, dimensions, source, and strategy metadata.
- Webapp: remove project-level FPS/resolution from the canonical manifest and
  setup UI. Each import commits its own authoritative media contract and rolls
  back media if the manifest commit fails. Early v2 top-level media fields are
  accepted and stripped on write. Presentation/clip/export resolution always
  follows the owning video.
- Board compatibility fields remain parseable, while canonical capture
  normalizes every primary button to exact-frame range mode. Homography caches
  are namespaced by `videoId`; new annotation defaults scale relative to
  source resolution.

**Tests**: real sidecar CFR MP4 preserve and MOV remux tests; strict metadata,
atomic rollback, mixed-FPS/resolution manifest, duration capture, cache
isolation, mixed-video playback timebase, and browser preserve-import tests.

### 0.10 v2 fixtures

- Author `e2e/fixtures/clip-editor-project-v2/`: v2 `project.json` with
  authoritative `frameCountSource`, default board, one non-zero-start clip
  with absolute-frame manual/tracked/visibility keyframes, two pins, two
  annotation documents, and a schema-2 presentation containing title,
  clip, and pin slides plus pause cues.
- Author `e2e/fixtures/retrieval-project-v2/`: one source video, two
  tagged clips replacing the old marks, overlapping clip bounds with a pin
  at the same absolute frame in each clip (the deliberate independence
  case), and an empty presentation.
- Add a deliberately broken derivative fixture for open-time integrity:
  bad clip/video reference, mismatched annotation anchor, orphan document,
  and missing presentation target. Do not corrupt the main happy fixture.
- Keep all v1 fixtures untouched until 1.7. Every canonical JSON fixture is
  imported by a compile/parse test so the markdown examples and TypeScript
  types cannot drift unnoticed.

**Phase 0 exit**: v1 app behaviorally unchanged (0.6–0.8 are internal
refactors proven by existing suites); all shared v2 foundations tested.

---

## Phase 1 — v2 vertical slice, then the flip

The slice lives at temporary routes (`/v2`, `/v2/player`, `/v2/clip/[id]`,
`/v2/presentation/[id]`). It does **not** put v2 values into the v1-typed
`ProjectContext`:

- `lib/state/ProjectV2Context.tsx` owns `ProjectManifestV2`, the board,
  selected video, and project handle for v2 routes; `app/v2/layout.tsx`
  installs it.
- Its IndexedDB handle key is namespaced (`project-v2`) during coexistence,
  so opening one schema cannot make the other route restore it.
- Shared components receive `projectDir`/versioned data explicitly. The v1
  context and routes stay unchanged until the flip. Phase 3 later extracts
  the common handle-persistence mechanics after only v2 remains.

v1 routes and e2e keep working; new v2 specs are added per step.

### 1.1 v2 project entry

- `/v2` home: create (via `createProjectV2` — refuses non-empty
  destinations) / open (v1 refusal message; auto-installs default board
  when missing) / dashboard stats (videos · clips · presentations).
- All v2 pages use `ProjectV2Provider`; refresh restores only the
  namespaced v2 handle and validates it before state is populated. A v1
  handle in the old key cannot leak into the slice.
- **Open-time integrity**: `checkProjectOnOpen` runs and surfaces a
  collapsible report panel (malformed clips from structured read errors,
  bad anchors, duplicate pins, missing presentation targets, orphan
  documents). Opening proceeds; the report is informational.
- e2e: `v2-home.spec.ts` (create/open/refusal/report), reusing a
  deliberately-broken fixture clip for the report case.

### 1.2 Capture player (v2)

- `/v2/player`: playback + "New clip" capture (`c`) via the repository;
  clip list panel = `ClipTagTree` (grouped by `boardTagTree`); DnD
  re-tag through `replaceClipTagsExclusive` with
  `pruneInapplicableFacets`; interim right-click `TaggingMenu` fed by
  `boardToLegacySchema` shim (typed via `legacySchemaTypes.ts`).
- Deletion: `deleteClipToTrash` + undo restores; presentations degrade
  per policy.
- `VideoPlayerUnit`: additive frame-native API — `ranges` use absolute
  frames, `onCaptureClip({ startFrame, endFrame })`, and imperative
  `getCurrentFrame`/`seekFrame`. Playback updates use video-frame callback
  media time; pointer scrubbing clamps to an existing frame. The ms/mark
  props remain for v1 until the flip.
- e2e: `v2-capture.spec.ts` (capture → tree → re-tag → delete → undo →
  reload persistence).

### 1.3 Clip editor (v2, frames-native)

- Frame-native lib APIs added alongside ms ones (`interpolation.ts`,
  `editorState.ts`, `trackingState.ts`, `bboxConvert.ts`,
  `occlusionCompositor.ts` gain `*AtFrame` variants; keyframes are
  **absolute frames** — `bboxConvert` keeps sidecar `tMs` → absolute
  frame, no clip-relative conversion anymore). TimelineStrip derives
  clip-relative layout via `frame − startFrame` at render only.
- Add `frameTemporalAdapter` for the shared renderer. Tests feed the same
  equivalent v1-ms/v2-frame samples through both adapters and require the
  same resolved drawable geometry.
- `/v2/clip/[clipId]`: ClipEditor shell forked to
  `components/clip/ClipEditorV2.tsx` wired frames-native to the new
  APIs, `persistAnnotations` = repository field wrapper, renderer from 0.7,
  sidecar calls via
  the step-0.1 boundary helpers (`sidecarSampleEndMs` for track/homography —
  never `frameToMs(endFrame)`). The fork is an accepted transition cost;
  phase 4's panel split consumes it. ms-based lib variants and the v1
  shell die at the flip.
- Sidecar response `tMs` values map through
  `timestampMsToNearestFrame`; controls refuse range operations on a
  one-frame clip. Homography's 5 FPS sampling and tracking's configured
  sampling are tested independently from the source-video FPS.
- e2e: `v2-clip-editor.spec.ts` — port of the v1 tracking spec **plus
  contract assertions in the sidecar mocks**: request `startMs/endMs`
  within the source range, `endMs === frameToMs(endFrame − 1)`,
  seed frame within bounds, non-zero `startFrame` fixture.

### 1.4 Pins, pin annotator, pin→clip import

- Pin create/read/label/delete in ClipEditorV2 (timeline pin lane; ≤1
  pin/frame enforced by reusing the existing pin at that frame). A pin's
  frame is immutable; changing the moment creates a new pin. Delete/undo
  uses the pin trash operation and missing presentation references degrade
  visibly. `PinAnnotator` overlay
  hosting `Editor` with `anchor: { kind: 'pin', … }`, the extracted
  `AnnotateToolbar` (full parity: all tools, styles, linked colors,
  undo, annotation sets over `pin.annotations`, Manual H + sidecar
  Calibrate, and the ±5s video-preview scrub that hides annotations off
  the anchor frame — `annotate/[stillId]/page.tsx:480-596`). It passes the
  v2 `projectDir` explicitly rather than relying on the v1 context.
- **Pin→clip import**: adapt `stillImport.ts` →
  `lib/clip/pinImport.ts` (`importPinDocumentToClip(payload,
  atFrame)`); the "import annotations from a frozen frame into the
  animated layer" workflow survives with pins as the source. Layers
  stay independent; import is an explicit copy. Every imported object gets
  a fresh clip-annotation id and linked highlight/vertex references are
  remapped within the imported batch.
- e2e: `v2-clip-pins.spec.ts` — multi-tool drawing, set create/switch,
  undo, save/reload, pin→clip import, calibrate (mocked), preview-scrub
  hides annotations.

### 1.5 Presentations (v2)

- Use Phase 0's `presentationStorageV2` (schema 2 only; no migrator because
  v1 projects never open). Constructors and validators use the canonical
  Phase-0 types: clip slides default
  `pausePins: null`; pin slides use `kind: 'pin'`; annotation/pause cues
  have concrete ids and wall-clock cue durations.
- `lib/presentation/authoringV2.ts`: asset index and chronological groups
  over clips/pins; `createClipSlide`, `createPinSlide`, and frame-based
  match-video edge validation. `PresentationAssetBrowser` groups clips by
  board-derived tag tree and exposes expandable pin rows with drag payloads
  `{ kind: 'clip' | 'pin' }`.
- **Animated annotations during playback**: `PresentationCanvas` layers
  a canvas driven by `renderClipAnnotationsToCanvas` with the frame temporal
  adapter (0.7/1.3) over clip
  playback, keyed by current **source frame**.
- **Timebase mapping**: every resolved scene includes
  `sourceStartFrame`/`sourceEndFrame`. `toSourceFrame(asset,
  mediaTimeSeconds, video)` maps the owning original video's presented time
  to an absolute frame and clamps it to that scene range. Clip scenes use the
  clip range; trimmed match-video scenes use their actual pin/offset range.
  Pin crossing and annotation lookup use this helper exclusively.
- **Pause-at-pin state machine** (per locked contract): track previous
  source frame; trigger on **forward crossing** into a pin (never exact
  equality); consumed-pin set per slide playback; resume from a paused
  pin does not retrigger it; seeking clears consumed pins ahead of the
  seek target and marks those behind as consumed; a pin at `startFrame`
  triggers on playback start.
- Pin-pause rendering uses frame raster + selected annotation documents.
  `pauseCues[].holdMs` auto-resumes when present; otherwise advance resumes
  manually. `annotationCues` are relative to the pause/slide wall clock.
- Match-video remains valid only between forward-ordered pin slides on the
  same video. `startOffsetFrames >= 0` and `endOffsetFrames <= 0` trim the
  source range. Playback seeks and stops directly against the original video;
  no sidecar request or derived file is created.
- Authoring UI: independent clip/pin source preview, empty-bucket suppression,
  a 16:9 thumbnail storyboard, three distinct title templates, and a compact
  inspector with collapsed pin details. Wall-clock values remain milliseconds
  in storage but are edited as seconds.
- Clip preview reuses `TimelineStrip` in a pins-only variant, preserving
  frame-snapped click/drag seek, zoom/manual-scroll behavior, pin markers, and
  transport controls. Present mode intentionally has no scrubber.
- A selected clip or clip-backed pin can open `/clip/[clipId]` in a new tab.
  Clip repository writes broadcast a local change event, while focus recovery
  provides a second refresh path, so presentation assets and scenes adopt clip
  edits made in that tab.
- e2e: `v2-presentation.spec.ts` — source preview, deck authoring, exact pointer
  seeking, animated-annotation
  visibility during clip playback (pixel sample), pause→advance→resume
  without retrigger, source-video clip/transition playback with zero
  exact-motion requests, no present-mode timeline, pin slide rendering,
  missing-reference degradation.

### 1.6 Exports (v2)

- `lib/export/clipExport.ts` replaces `d7Export.ts`:
  `exportAll({ projectDir, manifest, clips, board, onProgress })` writes
  `exports/report/clips.json` and `clips.csv`, one row per clip: id, label,
  video label, start/end/duration frames, formatted duration, primary tag,
  facets, pin count, and animated/pin annotation totals.
- Render one PNG per pin document from frame raster + shared payload at
  `exports/report/annotated/{clipId}-f{frame}-{pinId}-{annotationId}.png`.
  Every component is sanitized; including `annotationId` makes names
  deterministic and collision-free.
- Exports never tolerance-match timestamps and never copy source media.
  Dashboard exposes "Export report…" with progress plus per-file failures.
- Delete `d7Export.ts` at the flip; retain/rename the shared shape/render
  module used by pin and quick annotation.
- Unit: row building, facet serialization, naming, one-document-one-file,
  and partial failure reporting. e2e `v2-export.spec.ts` asserts the complete
  folder output against the fixture filesystem.

### 1.7 The flip + deletions sweep

1. Entry points switch: `/` renders the v2 home; `/v2/*` routes become
   canonical (`/player`, `/clip/[id]`, …); redirects removed.
2. Delete v1: routes (`stills`, `player-legacy`, `dropdown-test`,
   `annotate/[stillId]`, old player/clip pages), `ClipEditor.tsx` (v1
   shell), ms-variant lib APIs + ms-snap frameMath helpers,
   `stillImport/stillRelationship` (superseded by `pinImport`),
   `schema.ts` YAML IO, v1 `projectFolder/clipStorage`, still-specific
   annotation helpers, v1 integrity, `d7Export.ts`, v1 types
   (**deleted last** — compiler as completeness check), v1 fixtures +
   v1 e2e specs.
3. Remove the v1 `ProjectContext`; promote `ProjectV2Context`, its handle
   key, and `*V2` files/exports to canonical names.
4. Grep gate: `t_ms|sourceMarkId|startMarkId|manifest\.marks|manifest\.stills|StillSlide|startOffsetMs|endOffsetMs|annotations\.v1`
   → only quick-annotate (and `parseAnnotationDocument`'s v1 arm) may
   retain `annotations.v1`; sidecar/cache boundary modules may retain
   explicitly branded millisecond fields. If quick-annotate is the only
   thing keeping the v1 arm alive and it costs anything further, delete
   both (per the demotion note).

**Phase 1 exit**: v2-only app, full vertical slice e2e-covered; at no
point during the phase did the shipping (v1) app lose features.

---

## Phase 2 — Tagging window

### 2.1 Board panel component

- `components/tagging/TagBoard.tsx`: renders the project-authored coordinate
  surface as one stable board. Groups, labels, primary buttons, and modifier
  slots scale together; no tag navigation menu or board scrolling is needed.
  Buttons show range-armed state; single facets behave as radios and multi
  facets latch. Applicable modifiers may update a capture while it is active.
- Props: `board`, `armedFacets`, `activeRangeCaptures`, `mode`, `disabled?`,
  `onButtonPress`, `onFacetToggle`, `onCancelRange`.
- Facets render per-button applicability: hovering/focusing/arming a button
  dims inapplicable groups. `requiresAny` disables a dependent group until
  one referenced option is selected and explains why in its tooltip.
- Keyboard focus and selected state remain visible; hotkey labels are
  omitted for collisions disabled by validation.

### 2.2 Capture engine

- `lib/tagging/capture.ts`:
  - `createCaptureEngine({ board, videoFrameCount })` exposes
    `pressButton(buttonId, playheadFrame)`, `cancelRange(buttonId)`,
    `cancelMostRecentRange()`, and `getActiveRanges()`.
  - Every first button press snapshots applicable facets,
    clears those armed facets for subsequent captures, and records the
    absolute start frame. Different range buttons may be active
    simultaneously; the same button has at most one active range.
  - Second press closes at `playheadFrame + 1` so the displayed stop frame
    is included. If that boundary is not after the start, no clip is
    created and the range remains armed until a forward close or cancel.
  - Modifier changes can replace the applicable facet snapshot on an active
    range without affecting other active captures.
  - Escape cancels the most recently armed range; an explicit panel action
    cancels an individual range. Project/video switches cancel all active
    ranges with a warning rather than carrying frame axes across videos.
  - `buildHotkeyMap(board)` ignores input/textarea/select/contenteditable
    targets and modified shortcuts. Validation-disabled collisions never
    dispatch.
- Unit tests: range lifecycle, same/reversed frame close, stop-frame
  inclusion, simultaneous ranges, facet snapshot/clear/update, applicability,
  requiresAny, clamping, cancellation, project/video reset, and hotkeys.

### 2.3 Player integration and menu removal

- `app/player/page.tsx`: `TagBoard` replaces the interim New clip flow;
  retain one explicit "Untagged clip" action. Capture-engine output goes
  through `createClipExclusive`, refreshes the tree, and records
  operation-based undo.
- With a clip selected and playback paused, the panel can enter an explicit
  **Re-tag selected** mode. In that mode a button only replaces tags through
  `replaceClipTagsExclusive`; it cannot accidentally begin capture. Escape
  exits re-tag mode before cancelling ranges.
- Keydown dispatch checks board hotkeys before transport keys only when the
  target is eligible; transport behavior otherwise remains unchanged.
- The player timeline derives one lane per board group, renders pending ranges
  before they close, packs overlaps into subtracks, defaults to a one-minute
  viewport, and suppresses playhead auto-follow until five seconds after
  manual scrolling ends.
- Delete `TaggingMenu`, `boardToLegacySchema`, and
  `legacySchemaTypes.ts`. No YAML schema behavior remains.

### 2.4 Tag tree alignment

- `ClipTagTree` groups directly through `boardTagTree(board)`, supports DnD
  re-tagging through the repository, and retains Untagged and Unknown tag
  buckets for board edits made after capture.
- DnD applies the target primary tag and prunes only facets inapplicable to
  that button; still-applicable values survive.

### 2.5 Tests

- `tagging-board.spec.ts`: range arm/close/cancel; simultaneous ranges; exact
  frame bounds; facets snapshot, update, then clear; applicability and
  `requiresAny`; hotkey and focus exclusions; live pending timeline ranges;
  explicit re-tag mode; DnD re-tag; reload persistence.

**Phase 2 exit**: pause→menu is gone and the board is the only tagging
surface.

## Phase 3 — Hierarchy and navigation

### 3.1 Dashboard: Analysis ∥ Presentations

- `app/page.tsx`: two parallel wings. Analysis lists videos, clip counts,
  player entry, import, and export. Presentations lifts the current list
  operations into the dashboard: create, rename, duplicate, delete, open.
  `/presentations` remains a thin deep-link-compatible wrapper.
- Sidebar: project name/metadata, Match info, Import video, Save now, Empty
  Trash, and Close. No still/mark counts survive.

### 3.2 Navigation edges

- Player: Project and Match info links; no linear wizard navigation.
- Clip editor: Player with its video preselected, and Project.
- Presentation editor: Project. All direct/deep links restore and validate
  the same v2 project handle before rendering.

### 3.3 Shared handle persistence

- `lib/state/handlePersistence.ts` extracts IndexedDB handle save/load,
  permission re-request, validation, and stale-handle clearing from the
  route implementations. After the flip it uses the canonical `project`
  key; the temporary v1/v2 keys are removed.
- `restoreProjectFromHandle` never populates context until schema,
  permission, board, and open-time integrity reads complete.

### 3.4 Tests

- `navigation.spec.ts`: dashboard wings; video → player → clip → back;
  presentation create/open/back; reload in each deep route; denied/stale
  handle recovery; v1 folder refusal remains clear.

## Phase 4 — Panelization

### 4.1 Panel shell

- Add `react-resizable-panels` as the one planned dependency.
- `components/panels/Panels.tsx` wraps styled `PanelGroup`, `Panel`, and
  `PanelResizeHandle`. Every meaningful group gets
  `autoSaveId="annotate:{route}:{groupName}"`; minimum sizes prevent
  controls becoming unreachable.

### 4.2 Clip editor panels and shell split

- Split the v2 shell into `ViewerPanel`, `TimelinePanel`, and
  `InspectorPanel`, extracting `TransportBar`, `TrackingToolbar`,
  `AnnotationInspector`, and `PinList`. State remains in the editor and is
  passed by typed props; this is behavior-preserving extraction, not a
  state-management rewrite.
- Viewer/timeline use a vertical group; inspector/clip tree/tag board use a
  horizontal/nested group. Existing draggable timeline height remains
  internal to TimelinePanel and does not fight the outer panel handle.

### 4.3 Player panels

- `VideoPanel | (TagBoardPanel / ClipTreePanel)` with a horizontal outer
  group and vertical right group. Hotkeys continue to target the player,
  not whichever resize handle was last used.

### 4.4 Presentation editor panels

- `AssetBrowserPanel | CanvasPanel | InspectorPanel`, with `DeckStrip`
  below Canvas in a nested vertical group. Present mode remains panel-free.

### 4.5 Remaining screens and tests

- Use panels on dashboard/metadata only where resizing is meaningful;
  ordinary forms remain flex layouts.
- `panels.spec.ts`: drag each major editor handle, enforce minima, reload
  and assert persisted bounding boxes, keyboard navigation on handles, and
  mobile fallback without horizontal overflow.

## Phase 5 — Internationalization

### 5.1 Mechanism

- `lib/i18n/index.tsx`: `LocaleProvider` with localStorage locale (`en`
  default), `useT()`, `{param}` interpolation, missing-key diagnostics in
  development, and aligned `en`, `fr`, `es`, and `zh-CN` catalogs.
- Locale control in header; user-facing dates/numbers use `Intl`. CSV/JSON
  exports retain locale-independent machine formats.

### 5.2 Extraction sweep

Extract in stable-screen order: dashboard/setup; player/board/tree; clip
editor/pin annotator; presentation authoring/present mode; metadata;
toasts/errors/exports. One screen group lands green before the next, with a
grep gate for literal user-facing strings in completed directories.

### 5.3 Non-English catalogs and 5.4 e2e

- Maintain aligned French, Spanish, and Simplified Chinese catalogs, obtain
  native-speaker editorial review, and fix CJK overflow and line-height issues
  found during that pass. The user-authored default board stays English and
  editable.
- `i18n.spec.ts`: persist French and Spanish switching, traverse the primary
  route surface in Simplified Chinese, verify core labels and interpolation,
  and reject raw translation keys.

Always last; this phase slips to 0.3 before delaying structural work.

---

## Appendix A — Unit-test disposition

| Test file | Fate |
|---|---|
| `clip/frameMath.test.ts` | extended 0.1 (brands, boundary contract); ms cases die at flip |
| `clip/interpolation.test.ts`, `trackingState`, `editorState`, `bboxConvert` | frame-variant suites added 1.3; ms suites die at flip |
| `clip/stillImport.test.ts`, `stillRelationship.test.ts` | superseded by `pinImport.test.ts` (1.4); die at flip |
| `videoLocator`, `sidecarClient`, `homographyInterpolation`, `pitchProjection` | survive |
| `fs/clipStorage.test.ts` | v1 cases die at flip; v2 suites from 0.4 (incl. structured errors, repository locks, trash) |
| `fs/annotationStorage.test.ts` | parser/payload suites from 0.6; still-specific cases die at flip |
| `fs/presentationStorage.test.ts` | v2 acceptance/refusal (0.10/1.5) |
| `fs/derivedMediaStorage.test.ts`, `presentation/derivedMediaServing.test.ts` | survive |
| `utils/projectIntegrity.test.ts` | replaced by `projectIntegrityV2` suite (0.4, incl. presentation refs) |
| `presentation/authoring.test.ts` | rewritten over clips/pins (1.5) |
| `export/d7Export.test.ts` | replaced by `clipExport.test.ts` (1.6) |
| `annotate/quickSession.test.ts` | survives while quick-annotate survives |
| New | board (0.3), repository/trash/integrity (0.4), raster (0.5), payload (0.6), renderer command recorder (0.7), authoritative frame metadata (0.9), capture engine (2.2), timebase/`toSourceFrame` + pause machine (1.5) |

## Appendix B — e2e disposition

| Spec | Fate |
|---|---|
| v1 specs (`home`, `clip-editor`, `clip-homography`, `clip-occlusion`, `clip-save-reload`, `presentation-*`) | **keep running unchanged until 1.7**, then deleted with v1 |
| New v2 specs | `v2-home` (1.1), `v2-capture` (1.2), `v2-clip-editor` (1.3, with mock contract assertions), `v2-clip-pins` (1.4), `v2-presentation` (1.5), `v2-export` (1.6), renamed to canonical at 1.7 |
| Later | `tagging-board` (2.5), `navigation` (3.4), `panels` (4), `i18n` (5.4) |

## Appendix C — ms-field fate map

| Today | Fate |
|---|---|
| `videos[].durationMs` | → `frameCount` + required `frameCountSource: 'normalize' | 'probe'`; no estimated v2 fallback |
| `marks[].t_ms`, `stills[].t_ms`, `sourceMarkId` | deleted at flip |
| `Clip.startMs/endMs`, keyframe `tMs` (clip-relative), visibility `tMs` | → **absolute** `VideoFrame` values (`startFrame`/`endFrame`/`frame`) |
| `HomographyFrame.tMs`, `homography-cache/<videoId>/range-{ms}` | stays ms (video-namespaced sidecar artifact); frame wrappers only |
| sidecar params `startMs/endMs/frameMs/seedFrameMs` | stay ms; produced only by step-0.1 boundary helpers |
| presentation `holdMs`, cue `enterAtMs/exitAtMs` | stay ms because they measure presentation wall-clock duration, not media position |
| transition `startOffsetMs/endOffsetMs` | → `startOffsetFrames/endOffsetFrames`; applied directly to the original-video source range |
| exact-motion generation keys / `durationMs` metadata | dormant export-oriented sidecar/cache artifacts; never consulted by interactive playback |

## Appendix D — contract test matrix (new)

| Contract | Where tested |
|---|---|
| Displayed-frame mapping vs exact seek mapping | frameMath unit + frame-callback player e2e (0.1/1.2) |
| Inclusive sidecar sampler vs half-open ranges at source and sparse sample FPS | frameMath unit (0.1) + mock assertions (1.3) |
| One-frame clips never send invalid sidecar ranges | frameMath/editor unit + `v2-clip-editor` |
| Absolute-frame keyframes with non-zero `startFrame` | fixture design (0.10) + `v2-clip-editor` |
| Original media time ↔ absolute scene source range | `toSourceFrame` unit + `v2-presentation` |
| Pause-at-pin crossing/consumed/resume/seek | pause-machine unit + `v2-presentation` |
| Single-writer field merges under concurrency | repository unit with racing annotation/tag mutators |
| Queued autosave cannot recreate a deleted clip | repository/tombstone unit |
| Copy/verify/delete and recursive-delete semantics | trash unit + mock FS enforcement (0.4) |
| Clip-wide annotation ids and safe paths | clip validator + integrity suite |
| v1/v2 context and handle isolation | provider unit + `v2-home` reload e2e |
| Per-video FPS/resolution and mixed-media presentation playback | import/storage unit + playback unit + home/presentation e2e |
| Smart import preserve/remux/transcode selection | real tiny-media sidecar pytest + client progress/preserve unit + home e2e |
| Duration-based board capture across FPS | board migration + capture engine unit |
| Homography cache collision across videos | cache isolation unit |
| Board references, cycles, and hotkey collisions | board validation unit |
| Capture boundary/facet snapshot/simultaneous ranges | capture engine unit + `tagging-board` e2e |
| Create-refuses-non-empty | `v2-home` e2e |

## Appendix E — sequencing summary

```
0.0 schema lock → 0.1 frameMath/brands → 0.2 types → 0.3 board → 0.4 storage+repo+trash+integrity
  → 0.5 raster → 0.6 payload/Editor → 0.7 clip renderer → 0.8 persistence injection
  → 0.9 sidecar frame_count → 0.10 fixtures
1.1 /v2 entry → 1.2 capture → 1.3 clip editor → 1.4 pins+annotator+import
  → 1.5 presentations → 1.6 exports → 1.7 FLIP (delete v1; types last)
2 tagging window → 3 hierarchy/nav → 4 panels → 5 i18n
```

Rewriting `technical_document.md` for the v2 app closes 0.2, after phase
5 (or phase 4 if i18n slips).
