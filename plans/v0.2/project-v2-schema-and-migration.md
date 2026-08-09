# project.v2 – Schema Sketch and Migration Plan

Date: 2026-08-08 (documentation sync amendment)
Status: Locked and implemented
Parent: [v0.2-scope.md](v0.2-scope.md)

## Purpose

Sketch the `project.v2` on-disk format for Annotate 0.2, and the plan for migrating the **application code** to it (§4). There is no data migration and no backwards compatibility: 0.2 does not read, write, or convert `project.v1` folders — it refuses them, and old projects stay on 0.1 via the pinned release tag.

This is the locked storage contract. Its exact TypeScript types and runtime parsers landed in phase 0; later field changes require an explicit contract amendment here and corresponding parser/fixture updates.

---

## 1. Media positions are frames

- Every stored **media position** is an integer frame index, 0-based.
- **Every stored frame is an absolute video frame.** Pins, keyframes, and visibility keyframes all share one axis. Clip-relative values (`clipFrame = videoFrame − startFrame`) are derived at UI edges only (timeline layout) and never stored or passed between modules. This also removes a latent v1 hazard: re-derived clip bounds silently shifted the meaning of clip-relative keyframes.
- Frame indices are relative to the **owning video's fps**, stored on that video entry. A project may contain videos with different FPS and dimensions; presentations resolve each slide through its owning video.
- Ranges are **half-open**: `[startFrame, endFrame)`. Duration = `endFrame − startFrame`. `endFrame` may equal the video's `frameCount`; **no frame exists at `endFrame`** — the last displayable frame is `endFrame − 1`.
- `frameMath` owns every frame/time conversion:
  - video writes seek to `frame / fps`; playback reads the currently presented frame from `requestVideoFrameCallback().mediaTime`, with a floor-plus-epsilon and clamp fallback when frame callbacks are unavailable;
  - sidecar timestamps use `frame × 1000 / fps` at the HTTP edge, and sidecar result timestamps map to the nearest source frame;
  - regenerable homography/exact-motion cache keys may remain ms-based because they are sidecar artifacts, not project-domain positions.
- Presentation **wall-clock durations** (`holdMs`, cue enter/exit times) remain milliseconds. Match-video trims are media positions and therefore become frame offsets.

### 1a. Locked contracts

Frozen before phase 0 code; later changes are explicit amendments.

1. **Absolute media frames** — as above. Branded types (`VideoFrame`, `FrameBoundary` for exclusive ends, `Milliseconds`) enforce the distinction in the types/storage/frameMath layer; component props stay plain numbers.
2. **Video-element mapping** — seeking writes an exact frame timestamp; playback frame identity comes from presented-frame media time, not `round(currentTime × fps)`. Every result clamps to `[0, frameCount - 1]`; the exclusive `frameCount` boundary is never a displayable frame.
3. **Sidecar boundary rule** — the sidecar samples **inclusively** through `endMs` (`frame_extractor.py:139`). Tracking/homography requests therefore end at `frameToMs(endFrame − 1)`, never `frameToMs(endFrame)`; export/encode durations use the exclusive bound. Source-video FPS and requested sample FPS are separate. One-frame clips are valid, but range-based sidecar actions are unavailable because the current sidecar requires `endMs > startMs`.
4. **Pin/document invariants** — per clip: folder id equals `clip.id`, unique pin ids, at most one pin per frame, pins sorted, and pin frames within `[startFrame, endFrame)`; annotation ids are unique across the entire clip, paths are relative and confined to its `annotations/` directory, and each pin has at most one `role: 'default'` document. Every document's annotation id and anchor (clipId/pinId/frame) equal its owning reference. Pin frames are immutable. Duplicate pins across overlapping clips are allowed by design because clips are independent.
5. **Deletion policy** — the browser cannot move local directories. Deletion therefore copies to `.trash/`, verifies file count/byte sizes, writes an operation record/tombstone, then recursively removes the source. Undo copies back under the same lock. Cleanup runs after a successful open or explicit Empty Trash, not on unreliable close events. Cleanup may remove old recovery payloads but retains clip tombstones until restore, permanently preventing stale tabs from recreating deleted ids. Clip, pin, and annotation deletion never hard-blocks on presentation references; affected slides degrade to `missing` and integrity reports them.
6. **Single mutation boundary and field ownership** — every mutation in a clip subtree (`clip.json` and annotation documents) uses the same per-clip Web Lock. `clip.json` callers submit field mutations (`annotations`, `pins`, or `tags`), not stale whole-clip snapshots; document saves nest any per-document lock inside the clip lock. Delete/restore uses that lock, and tombstones make queued autosaves refuse deleted clips.
7. **Presentation playback** — clip slides render the clip's animated annotations via the shared frame-parameterized renderer; pin pauses use a crossing state machine (forward-crossing detection, consumed-pin set per playback, resume without retrigger, seek re-arms pins ahead of the target). Clip and match-video scenes always seek and play their absolute `sourceStartFrame`/`sourceEndFrame` range directly from the owning original video. Prepared media is neither preferred nor a compatibility fallback.
8. **Board semantics (middle path)** — a fixed coordinate surface of flat groups/buttons, plus per-button `facetGroupIds` (applicability) and per-facet-group `requiresAny` ported from the YAML schema. Deep primary-tree nesting is not ported. Every primary button is an exact-frame start/stop range toggle with no automatic lead/lag; different buttons may be armed concurrently. Re-tagging prunes *inapplicable* facets rather than clearing all. **A v2 project always has a board** — the default is auto-installed when missing.
9. **Per-video media authority** — FPS, frame count, width, and height belong to each `VideoEntry`; there is no project-wide FPS/resolution contract. Sidecar import/probe metadata is authoritative and `frameCountSource: 'normalize' | 'probe'` is required. Probing first accepts positive container `nb_frames`, then explicitly counts packets/decoded frames; it never infers count from browser duration. Compatible CFR H.264 MP4 is preserved, compatible streams are remuxed, and only VFR/incompatible media is transcoded at its native FPS/dimensions. Import fails atomically if metadata is unavailable. This contract was amended on 2026-07-11 after long-match normalization proved operationally unacceptable.
10. **Parallel-route state** — v2 routes use a separately typed provider and namespaced persisted handle until the flip. A `ProjectManifestV2` or board is never placed in the v1 `ProjectContext`; shared components receive versioned data/project handles explicitly.

`webapp/lib/clip/frameMath.ts` already holds most edge conversions; phase 0 promotes it to the single conversion point and removes ad-hoc `t_ms` math.

---

## 2. On-disk layout

```text
MyMatch/
  project.json                      # schema: "project.v2"
  tagging-board.json                # button board (replaces tagging-schema.yaml)
  media/                            # source videos (unchanged)
  analysis/
    clips/
      <clipId>/                     # a clip is a self-contained folder
        clip.json                   # clip.v2 document
        annotations/
          <annotationId>.json       # annotations.v2; id unique within clip
  presentations/
    <presentationId>.json           # presentation.v2
  homography-cache/                 # regenerable, project-level, ms-keyed sidecar artifact
  derived-media/                    # regenerable cache (unchanged role)
  exports/                          # rendered outputs only; never media copies
  cache/                            # regenerable (unchanged role)
  .trash/
    clips/                          # verified deletion copies
    pins/
    annotations/
    tombstones/                     # blocks late writes to deleted clips
```

Gone from v1: `stills/`, `thumbnails/`, `tagging-schema.yaml`, root-level `clips/` and `annotations/`, `reports/` (reports render into `exports/`).

**Annotations live under each clip, not in a parallel tree.** The clip is the unit of analysis, so its folder is self-contained: deleting, copying, or inspecting a clip touches one subtree and there is no cross-project-level annotation index to synchronize. A crash between a document write and its `clip.json` reference update can still leave an unreferenced file, so open-time integrity detects and reports clip-local orphans. The trade-off is that clips become folders rather than single JSON files, so clip discovery scans directories (`analysis/clips/*/clip.json`) instead of files. The rejected alternative — a parallel `analysis/annotations/<clipId>/` tree with single-file clips — keeps the v1 scan shape but reintroduces cross-tree ID pairing and orphan states. This under-clip layout is a settled 0.2 decision.

Thumbnails become derived data: generated on demand from the video at a pin's frame, cached under `cache/` or `derived-media/`, never authored. Trash is app-managed recovery data, not analysis content. Cleanup runs on a successful open (30-day/500-MiB defaults, oldest first) or explicit Empty Trash; current-session undo entries are retained. Clip tombstones are tiny and are not purged with payloads; restore removes the corresponding marker.

---

## 3. Schemas

### 3.1 `project.json` (`project.v2`)

The manifest shrinks. Clips and annotations are **not indexed in the manifest**; they are discovered by directory scan (the v1 annotations index already worked this way — rebuilt on open).

```jsonc
{
  "schema": "project.v2",
  "name": "MyMatch",
  "created": "2026-07-07T00:00:00.000Z",
  "videos": [
    {
      "id": "vid_…",
      "label": "First half",
      "file": "media/first-half.mp4", // relative path, as in v1
      "fps": 30,                      // authoritative for this video's frames
      "frameCount": 81000,            // replaces durationMs
      "frameCountSource": "normalize",// "normalize" | "probe"; required
      "width": 1920,
      "height": 1080
    }
  ],
  "matchInfo": { /* unchanged from v1 (teams, score, substitutions, notes) */ }
}
```

Dropped from v1: `marks[]`, `stills[]`, `annotations[]` (index), `durationMs` (→ `frameCount`).

Every v2 import commits its own media contract. The sidecar result supplies `fps`, `frameCount`, width, and height; a missing/invalid count aborts the import and leaves neither a manifest entry nor a partial media file. Early development v2 manifests with top-level `fps`/`resolution` still parse, but those obsolete fields are ignored and omitted on the next write.

### 3.2 Clip document (`clip.v2`, `analysis/clips/<clipId>/clip.json`)

The clip absorbs marks (as pins) and carries tags.

```jsonc
{
  "schema": "clip.v2",
  "id": "clip_…",
  "videoId": "vid_…",
  "label": "Counter press regain",
  "startFrame": 12300,                // half-open range
  "endFrame": 12750,
  "tags": {                           // moved from the v1 mark; ids defined
    "primary": "in_possession.build_up",   // by the tagging board
    "facets": { "zone.vertical_third": ["middle_third"] }
  },
  "pins": [                           // former marks, now clip-local moments
    {
      "id": "pin_…",
      "frame": 12480,                 // ABSOLUTE video frame, within [startFrame, endFrame)
      "label": "Regain moment",
      "annotations": [                // documents inside this clip's folder
        { "id": "ann_…", "file": "annotations/ann_….json", "role": "default" }
      ]
    }
  ],
  "annotations": [                    // the clip's animated layer (v1 shape,
    {                                 // frame-keyed): one entry per drawn object
      "id": "cann_…",
      "type": "highlight",
      "coordMode": "image",
      "source": "auto",
      "style": { /* unchanged from v1 */ },
      "keyframes": [                  // ABSOLUTE video frames, same axis as pins
        { "frame": 12310, "cx": 812.4, "cy": 511.0, "radius": 38 }
      ],
      "visibilityKeyframes": [ { "frame": 12600, "action": "hide" } ]
    }
  ]
}
```

This example is canonical. A matching JSON fixture is imported by a compile/parse test using `satisfies ClipV2`; markdown is updated from that fixture whenever the type changes. There are no `tracking`/`homography` fields on the clip document: tracking output lives in `annotations[].keyframes` (provenance-tagged, as in v1), and the homography cache remains a **project-level, ms-keyed** store (`homography-cache/`, a sidecar-boundary artifact — see Appendix C of the implementation plan).

Notes:
- A pin is the annotate entry point: scrub → Annotate → editor opens on the pin's frame → the saved document is `annotations.v2` inside the clip folder (`annotations[].file` is relative to the clip folder).
- **Pin annotations and clip annotations are unrelated layers.** `keyframes` is the clip's own animated-annotation track, rendered during playback. A pin's documents are still-style drawings for that single frame, shown when playback pauses on the pin (or when the pin is used directly as a presentation slide). Neither reads or writes the other.
- Multiple annotation documents per pin keep the v1 default/alternate model.
- Annotation ids are unique across the clip, not merely within one pin, because filenames share the clip's `annotations/` directory.
- A pin's frame is immutable. Moving the analytical moment means creating a new pin (and explicitly copying/importing any wanted documents), avoiding a multi-file anchor rewrite disguised as a drag operation.
- `pins[]` ordering (by frame) drives default pause points in presentation clip playback; per-slide pin deselection lives in the presentation document, not here (§3.4).

### 3.3 Annotation document (`annotations.v2`)

Same drawing payload as v1 (shapes, styles, perspective quad — the editor and `renderAnnotatedPng` are unchanged); only the anchor changes.

```jsonc
{
  "schema": "annotations.v2",
  "annotationId": "ann_…",
  "clipId": "clip_…",
  "pinId": "pin_…",
  "frame": 12480,
  "image": { "width": 1920, "height": 1080 },   // no file field; the frame
                                                 // is decoded from the video
  "shapes": [ /* unchanged from annotations.v1 */ ],
  "perspective": { "quad": [ /* unchanged */ ] }
}
```

The editor's background image is produced by seeking the owning video to `frame` and rasterizing, replacing the v1 still PNG. (This is what still capture did — done lazily now, with the raster cacheable under `cache/`.) The document filename, `annotationId`, and owning `PinAnnotationRef.id` must agree; its relative path must remain inside the owning clip's `annotations/` directory.

### 3.4 Presentation document (`presentation.v2`)

**The default slide unit is the clip.** Pins are automatic pause points inside a clip slide, not primary presentation objects.

```jsonc
{
  "schema": 2,
  "id": "presentation_…",
  "name": "Breaking the first press",
  "createdAt": "2026-07-10T00:00:00.000Z",
  "updatedAt": "2026-07-10T00:00:00.000Z",
  "slides": [
    {
      "id": "slide_clip_…",
      "kind": "clip",
      "clipId": "clip_…",
      "pausePins": null,          // null = all current/future pins;
                                  // ["pin_a"] = only these; [] = none
      "pauseCues": [
        {
          "pinId": "pin_…",
          "holdMs": 2500,         // optional; auto-resume after this delay
          "annotationIds": null,  // null = all docs; [] = none
          "annotationCues": [     // times relative to this pause
            { "annotationId": "ann_…", "enterAtMs": 0, "exitAtMs": 2000 }
          ]
        }
      ],
      "notes": ""
    },
    {
      "id": "slide_pin_…",
      "kind": "pin",
      "clipId": "clip_…",
      "pinId": "pin_…",
      "showAnnotations": true,
      "annotationIds": null,      // null = all docs; [] = none
      "annotationCues": [],       // wall-clock timing relative to slide start
      "holdMs": 3000,
      "notes": ""
    },
    {
      "id": "slide_title_…",
      "kind": "title",
      "template": "section",
      "title": "The consequence",
      "body": "",
      "holdMs": 2000
    }
  ],
  "transitions": [
    { "mode": "cut" },
    { "mode": "cut" }
  ],
  "theme": { "background": "#0b0d10", "textColor": "#f4f1e8" }
}
```

Canonical types:

- `ClipSlideV2 { id; kind: 'clip'; clipId; pausePins: string[] | null; pauseCues?: ClipPauseCueV2[]; notes?; holdMs? }`.
- `ClipPauseCueV2 { pinId; holdMs?; annotationIds?: string[] | null; annotationCues?: PinAnnotationCueV2[] }`. Missing `holdMs` means manual advance resumes; a value means automatic resume after that wall-clock delay.
- `PinSlideV2 { id; kind: 'pin'; clipId; pinId; showAnnotations; annotationIds?: string[] | null; annotationCues?: PinAnnotationCueV2[]; notes?; holdMs? }` remains the secondary frozen-moment path.
- `PinAnnotationCueV2 { annotationId; enterAtMs?; exitAtMs? }`; cue times are presentation wall-clock values, not video positions.
- `TitleSlideV2` retains `kind: 'title'`, template/title/body/notes/hold.
- `transitions.length === max(slides.length - 1, 0)`. `cut` works between any slides. `match_video` is valid only between forward-ordered pin slides on the same video and stores `startOffsetFrames >= 0`, `endOffsetFrames <= 0`, `playbackRate?`, and `hideAnnotationsDuringPlayback`. The resulting source range must remain non-empty and within the two pins.

`pausePins` references pins by id; pins added later are included when it is `null` and ignored for explicit arrays. Pause/annotation cue ids must refer to the slide's effective pins/documents; invalid ids are integrity issues.
- During clip playback the clip's own keyframed annotations render (via the shared frame-parameterized renderer extracted from the clip editor — a required deliverable, not an assumption); at a pause point the pin's documents are shown. The two annotation layers stay independent (§3.2).
- Pin pauses follow the crossing state machine. Every scene carries an absolute source range on its owning video; playback media time maps directly to that video's absolute frame before pin and annotation evaluation.
- Asset browsing filters by **clip tags** (replacing mark-tag browsing).

### 3.5 Tagging board (`tagging-board.json`, replaces `tagging-schema.yaml`)

The v1 YAML schema modeled a dropdown tree; the v2 artifact models a **button board** and moves to JSON. The board *is* the tag vocabulary: buttons define tag identity, toggles define facets, and the tag folder tree view derives its grouping from board groups. There is no separate schema document.

```jsonc
{
  "schema": "tagging-board.v1",
  "layout": {
    "width": 960,
    "height": 900,
    "modifierSlots": [
      { "x": 24, "y": 650, "width": 210, "height": 226 }
    ]
  },
  "defaults": {
    "leadSeconds": 0,
    "lagSeconds": 0,
    "mode": "range"
  },
  "groups": [
    {
      "id": "offensive.open_play",
      "label": "Offensive - open play",
      "labelRect": { "x": 24, "y": 20, "width": 912, "height": 24 },
      "buttons": [
        {
          "id": "offensive.open_play.possession",
          "label": "Possession",
          "rect": { "x": 24, "y": 52, "width": 176, "height": 110 },
          "hotkey": "p",
          "facetGroupIds": [
            "zone.vertical_third"
          ]
        }
      ]
    }
  ],
  "facets": [
    {
      "id": "zone.vertical_third",
      "label": "Vertical third",
      "mode": "single",
      "options": [
        { "id": "middle_third", "label": "Middle third", "hotkey": "2" }
      ]
    },
    {
      "id": "outcome.general",
      "label": "Outcome",
      "mode": "single",
      "options": [
        { "id": "goal", "label": "Goal" },
        { "id": "turnover", "label": "Turnover" }
      ]
    },
    {
      "id": "goal.method",
      "label": "Goal method",
      "mode": "single",
      "requiresAny": [
        { "facetGroupId": "outcome.general", "optionId": "goal" }
      ],
      "options": [
        { "id": "header", "label": "Header" }
      ]
    }
  ]
}
```

Layout is authored in board coordinates and scaled as one stable surface; group labels, buttons, and modifier slots do not become navigable menus. Rectangles are presentation-only and never affect tag identity. Validation rejects invalid/out-of-bounds rectangles, duplicate ids, unresolved applicability/dependency references, dependency cycles, and invalid capture defaults. Hotkey collisions are warnings that disable every conflicting binding until the board is corrected; runtime dispatch never chooses one silently.

The schema parser still accepts `mode`, `leadSeconds`, `lagSeconds`, and the early-v2 `leadFrames`/`lagFrames` compatibility form. The canonical capture resolver deliberately normalizes every button to `mode: "range"` with zero lead/lag. A first press starts at the presented frame and the second closes at exclusive `presentedFrame + 1`; overlapping active buttons are valid.

---

## 4. Application migration plan (moving the codebase to the v2 model)

"Migration" here means migrating **the app**, not project data. There is no data migrator: 0.2 does not read, convert, or repair `project.v1` folders. On open, a v1 project gets a clear refusal ("This project was created by Annotate 0.1 and cannot be opened by 0.2."). Anyone who needs an old project keeps using 0.1 via the pinned release tag. This is deliberate: the install base is a pre-release, and a correct migrator would cost more than the data it would save.

### 4.1 Boundary decisions that contained the change

These decisions kept the v2 rework from spreading into code that did not need to move:

- **The Python sidecar API stays ms-based at analysis boundaries.** Smart video import exposes authoritative per-video metadata plus its preserve/remux/ transcode strategy (locked contract 9); container/browser duration is never used to invent frame count. Tracking/homography clients still convert frames ↔ ms only through the `frameMath` boundary helpers (locked contract 3).
- **`Editor.tsx`'s drawing core stays shared.** `lib/annotate/documentPayload.ts` separates the renderable payload (image dimensions + shapes + perspective) from anchor-specific serializers. Pin annotation receives an explicit project handle and persistence adapter; quick-annotate retains its isolated v1 anchor. `renderAnnotatedPng` consumes the shared payload rather than either stored schema.
- **`ClipEditor` persistence is injected** through `persistAnnotations`. The canonical route replaces only the latest clip's annotation field through the repository (locked contract 6); no stale whole-clip save remains.
- **The primitive File System Access wrappers remain small.** v2 adds an explicit recursive copy/verify helper for trash because directory move is unavailable; layout, tombstone, retention, and recovery policy live above those primitives.
- **Quick-annotate survived as a best-effort utility, not a constraint.** It rides the payload refactor while retaining independent v1 OPFS documents.

### 4.2 Final module inventory

**Dies** (deleted, not adapted):

- `/stills` page, still capture, thumbnail management
- mark machinery in `/player` and `VideoPlayerUnit`
- `sourceMarkId` integrity repairs in `projectIntegrity.ts`
- `TaggingMenu`, `/dropdown-test`, `/player-legacy`
- YAML schema parsing in `lib/tagging/schema.ts` (replaced by board loading)
- v1 types (`marks[]`, `stills[]`, manifest `annotations[]` index)

**Canonical v2 modules**:

- `lib/types/project.ts` — `project.v2` manifest; videos gain `frameCount` and required `frameCountSource`, lose `durationMs`
- `lib/types/clip.ts` — `clip.v2`: frames, `tags`, `pins[]`
- `lib/fs/projectFolder.ts` — v2 structure create/validate; **refuse v1**
- `lib/fs/clipStorage.ts` — folder-per-clip scan (`analysis/clips/*/clip.json`)
- `lib/fs/pinAnnotationStorage.ts` — clip-scoped safe paths, `annotations.v2` identity/anchor and pin/document trash operations
- `lib/fs/presentationStorage.ts` + presentation types — clip slides with `pausePins`, pin slides
- `lib/clip/frameMath.ts` — promoted to the single ms↔frame conversion point
- `lib/utils/projectIntegrity.ts` — v2 rules (clip `videoId` resolves, pin frames in range, annotation anchors resolve, no `[start, end)` inversions)
- `lib/export/clipExport.ts` — clip/tag JSON and CSV reports plus annotated pin-document PNGs
- clip editor, player, home dashboard, presentation pages — per the scope doc's phases
- `lib/tagging/board.ts` — `tagging-board.json` load/validate/default template
- `lib/fs/clipRepository.ts` — the locked mutation boundary for `clip.json` and annotation documents, with field-owned mutations and deletion tombstones
- `lib/fs/trash.ts` — verified copy/delete/restore and bounded retention
- `lib/state/ProjectContext.tsx` + `handlePersistence.ts` — canonical v2 provider and validated handle restoration (the temporary parallel provider was promoted at the flip)
- `lib/annotate/documentPayload.ts` — shared renderable payload + anchor serializers (v1 still / v2 pin)
- `lib/clip/renderClipAnnotations.ts` — shared temporal resolution + pure canvas painter consumed by clip editing and presentation playback
- `lib/clip/pinImport.ts` and `components/clip/PinAnnotator.tsx` — explicit frozen-frame document to animated-layer import and shared annotation UI
- `lib/media/frameRaster.ts` — video frame to editor/export raster with a variant-keyed cache and serialized seeks
- `sidecar/annotate_sidecar/services/video_probe.py`, background import jobs, and `/video/normalize` metadata — fast authoritative frame count and preserve/remux/transcode preparation
- `components/tagging/TagBoard.tsx`, `components/panels/Panels.tsx`, and `lib/i18n/` — final tagging, panel, and locale foundations

### 4.3 Implemented order of work (phases 0–1)

Each step landed green (build + tests). Two guiding rules were: **the v1 app kept working until the flip** (the v2 vertical slice was built in parallel at temporary `/v2` routes, so browser coverage never dropped), and **v1 types were deleted last** — once everything was re-anchored, deleting them turned the compiler into the completeness check.

1. **Schema lock** (§1a signed off), then frames/brands/boundary helpers and v2 types — compile-only additions.
2. **Shared foundations, still v1-neutral**: board module, storage v2 + clip repository + trash + integrity (incl. presentation references, structured read errors), generic verified trash/tombstones, variant-keyed frame rasterizer, annotation payload + Editor anchor adapters + pin/doc storage/trash adapters, the shared animated clip renderer (extracted from the clip editor's export painter and adopted by it immediately), field-owned `ClipEditor` persistence injection, sidecar `frame_count` probe, native-v2 fixtures.
3. **v2 vertical slice** at `/v2/…`: project entry (create refuses non-empty targets; open runs integrity and surfaces a report) → capture player → frames-native clip editor (forked shell on new frame-keyed lib APIs) → pins + pin annotator + pin→clip import → presentations (animated-annotation overlay, pause machine, original-media timebase mapping, pin slides) → clip-based exports.
4. **The flip**: `/v2` routes become canonical; delete v1 routes, the v1 editor shell, ms-variant APIs, still/mark modules, v1 fixtures and specs, and finally the v1 types; grep-gate the result.

### 4.4 Caches and side stores

Nothing to convert — with no v1 projects opening, stale caches are unreachable:

- `homography-cache/` remains project-level and ms-keyed because it mirrors the sidecar boundary; v2 callers wrap it in frame-based APIs.
- `derived-media/` exact-motion helpers and ms-derived generation keys remain implemented as dormant export-oriented infrastructure. Interactive presentation playback never reads them. Tracking output is not a separate cache: it lives in clip annotation keyframes.
- IndexedDB autosave backups (`annotate-backup-db`): anchor-shaped v2 doc keys cannot collide with v1. Old v1 entries remain unreachable; no unimplemented automatic aging is assumed.
- OPFS quick-annotate storage: untouched.

---

## 5. Verification coverage

The implemented contract suite covers displayed-frame/exact-seek conversion, half-open and inclusive-sidecar bounds, sparse sample FPS, one-frame range refusal, board references/cycles/hotkey collisions, folder-per-clip storage, field-owned repository races, verified trash round-trips/tombstones, payload anchors, v2 integrity, presentation references, and v1 refusal. It also covers mixed video FPS/resolution, exact-frame overlapping range capture, smart import strategy selection, per-video homography cache identity, and mixed-media presentation timebase mapping.

Browser fixtures use non-zero clip starts and assert sidecar request bounds, absolute-frame keyframes, pin/document lifecycle and import, direct original-media source mapping with no exact-motion playback requests, pause-at-pin crossings, animated overlays, export contents, panel persistence, handle restoration, and locale switching across the four aligned catalogs. The temporary v1/v2 spec sets were renamed or deleted at the canonical flip.

The latest 2026-08-09 release-candidate gate passed 263 Vitest tests across 44 files, 42 sidecar pytest tests, and 30 Playwright Chromium flows against both development and production servers, plus TypeScript, strict zero-warning ESLint, the production build and launcher, clean JavaScript lockfile installation, dependency audits, and real PnLCalib and YOLO provider smoke tests. The remaining manual check is native-speaker editorial review of the French, Spanish, and Simplified Chinese catalogs.
