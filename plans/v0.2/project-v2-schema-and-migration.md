# project.v2 – Schema Sketch and Migration Plan

Date: 2026-07-07
Status: Planning
Parent: [v0.2-scope.md](v0.2-scope.md)

## Purpose

Sketch the `project.v2` on-disk format for Annotate 0.2, and the plan for
migrating the **application code** to it (§4). There is no data migration
and no backwards compatibility: 0.2 does not read, write, or convert
`project.v1` folders — it refuses them, and old projects stay on 0.1 via
the pinned release tag.

This is a planning sketch. Field names are directional; exact TypeScript
types land with phase 0.

---

## 1. Units: frames, not milliseconds

- Every stored time value is an **integer frame index**, 0-based.
- Frame indices are relative to the **owning video's fps** (stored on the
  video entry; imports are normalized to project fps, so in practice this
  equals project fps — the per-video field is the authoritative tie-breaker).
- Ranges are **half-open**: `[startFrame, endFrame)`. Duration =
  `endFrame − startFrame`. Adjacent clips share a boundary frame index
  without overlapping.
- Milliseconds survive at exactly two boundaries, converted in one place
  (`frameMath`):
  - the video element — read: `frame = round(video.currentTime × fps)`;
    write: `video.currentTime = frame / fps`
  - the sidecar HTTP API, which stays ms-based (§4.1) —
    `ms = frame × 1000 / fps` at the client edge.

`webapp/lib/clip/frameMath.ts` already holds most edge conversions; phase 0
promotes it to the single conversion point and removes ad-hoc `t_ms` math.

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
          <annotationId>.json       # annotations.v2, pin-anchored
  presentations/
    <presentationId>.json           # presentation.v2
  derived-media/                    # regenerable cache (unchanged role)
  exports/                          # rendered outputs only; never media copies
  cache/                            # regenerable (unchanged role)
```

Gone from v1: `stills/`, `thumbnails/`, `tagging-schema.yaml`, root-level
`clips/` and `annotations/`, `reports/` (reports render into `exports/`).

**Annotations live under each clip, not in a parallel tree.** The clip is
the unit of analysis, so its folder is self-contained: deleting, copying, or
inspecting a clip is one folder operation, and orphaned annotation documents
are structurally impossible. The trade-off is that clips become folders
rather than single JSON files, so clip discovery scans directories
(`analysis/clips/*/clip.json`) instead of files. The rejected alternative —
a parallel `analysis/annotations/<clipId>/` tree with single-file clips —
keeps the v1 scan shape but reintroduces cross-tree ID pairing and orphan
states. (Open decision #5 in the scope doc; veto before phase 0.)

Thumbnails become derived data: generated on demand from the video at a
pin's frame, cached under `cache/` or `derived-media/`, never authored.

---

## 3. Schemas

### 3.1 `project.json` (`project.v2`)

The manifest shrinks. Clips and annotations are **not indexed in the
manifest**; they are discovered by directory scan (the v1 annotations index
already worked this way — rebuilt on open).

```jsonc
{
  "schema": "project.v2",
  "name": "MyMatch",
  "created": "2026-07-07T00:00:00.000Z",
  "fps": 30,                          // project default fps
  "resolution": { "width": 1920, "height": 1080 },
  "videos": [
    {
      "id": "vid_…",
      "label": "First half",
      "file": "media/first-half.mp4", // relative path, as in v1
      "fps": 30,                      // authoritative for this video's frames
      "frameCount": 81000,            // replaces durationMs
      "width": 1920,
      "height": 1080
    }
  ],
  "matchInfo": { /* unchanged from v1 (teams, score, substitutions, notes) */ }
}
```

Dropped from v1: `marks[]`, `stills[]`, `annotations[]` (index),
`durationMs` (→ `frameCount`).

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
      "frame": 12480,                 // within [startFrame, endFrame)
      "label": "Regain moment",
      "annotations": [                // documents inside this clip's folder
        { "id": "ann_…", "file": "annotations/ann_….json", "role": "default" }
      ]
    }
  ],
  "keyframes": { /* v1 keyframed-annotation model with frame indices
                    replacing ms on every keyframe time */ },
  "tracking": { /* unchanged shape; times in frames */ },
  "homography": { /* cache reference; times in frames */ }
}
```

Notes:
- A pin is the annotate entry point: scrub → Annotate → editor opens on the
  pin's frame → the saved document is `annotations.v2` inside the clip
  folder (`annotations[].file` is relative to the clip folder).
- **Pin annotations and clip annotations are unrelated layers.** `keyframes`
  is the clip's own animated-annotation track, rendered during playback.
  A pin's documents are still-style drawings for that single frame, shown
  when playback pauses on the pin (or when the pin is used directly as a
  presentation slide). Neither reads or writes the other.
- Multiple annotation documents per pin keep the v1 default/alternate model.
- `pins[]` ordering (by frame) drives default pause points in presentation
  clip playback; per-slide pin deselection lives in the presentation
  document, not here (§3.4).

### 3.3 Annotation document (`annotations.v2`)

Same drawing payload as v1 (shapes, styles, perspective quad — the editor
and `renderAnnotatedPng` are unchanged); only the anchor changes.

```jsonc
{
  "schema": "annotations.v2",
  "clipId": "clip_…",
  "pinId": "pin_…",
  "frame": 12480,
  "image": { "width": 1920, "height": 1080 },   // no file field; the frame
                                                 // is decoded from the video
  "shapes": [ /* unchanged from annotations.v1 */ ],
  "perspective": { "quad": [ /* unchanged */ ] }
}
```

The editor's background image is produced by seeking the owning video to
`frame` and rasterizing, replacing the v1 still PNG. (This is what still
capture did — done lazily now, with the raster cacheable under `cache/`.)

### 3.4 Presentation document (`presentation.v2`)

**The default slide unit is the clip.** Pins are automatic pause points
inside a clip slide, not primary presentation objects.

- **Clip slides** (`{ type: "clip", clipId, … }`, times in frames) play the
  clip and pause on its pins by default: play → pause at pin → show the
  pin's annotation documents → resume on advance. Each slide carries a pin
  selection so pins can be deselected per slide:

  ```jsonc
  {
    "type": "clip",
    "clipId": "clip_…",
    "pausePins": null,        // null = pause on all pins (default);
                              // ["pin_a"] = only these; [] = no pauses
    "annotationTiming": { /* per-pause annotation-set timing */ }
  }
  ```

  `pausePins` references pins by id; pins added to the clip later are
  included automatically when the value is `null` and ignored otherwise.
- **Pin slides** (`{ type: "pin", clipId, pinId, annotationTiming }`) remain
  available for deliberately presenting a single frozen moment — the
  secondary path, kept for when a frozen frame genuinely is the slide.
- During clip playback the clip's own keyframed annotations render; at a
  pause point the pin's documents are shown. The two annotation layers stay
  independent (§3.2).
- Title cards unchanged.
- Asset browsing filters by **clip tags** (replacing mark-tag browsing).

### 3.5 Tagging board (`tagging-board.json`, replaces `tagging-schema.yaml`)

The v1 YAML schema modeled a dropdown tree; the v2 artifact models a
**button board** and moves to JSON. The board *is* the tag vocabulary:
buttons define tag identity, toggles define facets, and the tag folder tree
view derives its grouping from board groups. There is no separate schema
document.

```jsonc
{
  "schema": "tagging-board.v1",
  "defaults": {
    "leadFrames": 90,               // board-wide capture defaults
    "lagFrames": 90,
    "mode": "instant"               // "instant" | "range"
  },
  "groups": [                       // visual rows/sections of the board
    {
      "id": "in_possession",
      "label": "In possession",
      "buttons": [
        {
          "id": "in_possession.build_up",   // tag identity (clip.tags.primary)
          "label": "Build-up",
          "hotkey": "b",                    // optional
          "leadFrames": 150,                // optional per-button overrides
          "mode": "range"
        }
      ]
    }
  ],
  "facets": [                       // toggle strips, applied to the next/current capture
    {
      "id": "zone.vertical_third",
      "label": "Vertical third",
      "mode": "single",             // "single" | "multi"
      "options": [
        { "id": "middle_third", "label": "Middle third", "hotkey": "2" }
      ]
    }
  ]
}
```

Layout niceties (button colors, column spans) can join later as optional
fields; they are presentation-only and never affect tag identity.

---

## 4. Application migration plan (moving the codebase to the v2 model)

"Migration" here means migrating **the app**, not project data. There is no
data migrator: 0.2 does not read, convert, or repair `project.v1` folders.
On open, a v1 project gets a clear refusal ("This project was created by
Annotate 0.1 and cannot be opened by 0.2."). Anyone who needs an old project
keeps using 0.1 via the pinned release tag. This is deliberate: the install
base is a pre-release, and a correct migrator would cost more than the data
it would save.

### 4.1 Boundary decisions that contain the change

These keep the v2 rework from spreading into code that doesn't need to move:

- **The Python sidecar API stays ms-based and unchanged.** `sidecarClient.ts`
  converts frames ↔ ms at the HTTP boundary. Zero sidecar changes in 0.2.
- **`Editor.tsx`'s drawing core is unchanged.** Shapes, styles, perspective,
  and `renderAnnotatedPng` carry over; only the anchor (stillId →
  clipId/pinId/frame) and the background source (still PNG → frame rasterized
  from the video) change at the edges.
- **The File System Access layer (`lib/fs/utils`) is unchanged.** Only the
  layout logic above it moves.
- **Quick-annotate is not touched.** It already runs the Editor against its
  own OPFS directory; if a refactor breaks it, quarantine or remove per the
  scope doc.

### 4.2 Module inventory

**Dies** (deleted, not adapted):

- `/stills` page, still capture, thumbnail management
- mark machinery in `/player` and `VideoPlayerUnit` (mark pips stay only if
  reused to visualize clip ranges)
- `sourceMarkId` integrity repairs in `projectIntegrity.ts`
- `TaggingMenu`, `/dropdown-test`, `/player-legacy`
- YAML schema parsing in `lib/tagging/schema.ts` (replaced by board loading)
- v1 types (`marks[]`, `stills[]`, manifest `annotations[]` index)

**Changes** (adapted to the v2 model):

- `lib/types/project.ts` — `project.v2` manifest; videos gain `frameCount`,
  lose `durationMs`
- `lib/types/clip.ts` — `clip.v2`: frames, `tags`, `pins[]`
- `lib/fs/projectFolder.ts` — v2 structure create/validate; **refuse v1**
- `lib/fs/clipStorage.ts` — folder-per-clip scan (`analysis/clips/*/clip.json`)
- `lib/fs/annotationStorage.ts` — clip-scoped paths, `annotations.v2` anchor
- `lib/fs/presentationStorage.ts` + presentation types — clip slides with
  `pausePins`, pin slides
- `lib/clip/frameMath.ts` — promoted to the single ms↔frame conversion point
- `lib/utils/projectIntegrity.ts` — v2 rules (clip `videoId` resolves, pin
  frames in range, annotation anchors resolve, no `[start, end)` inversions)
- `lib/export/d7Export.ts` — clip/tag-based reports; PNG renders from pins
- clip editor, player, home dashboard, presentation pages — per the scope
  doc's phases

**New**:

- `lib/tagging/board.ts` — `tagging-board.json` load/validate/default template
- pin model + Annotate surface in the clip editor
- frame rasterizer (video frame → editor background / thumbnail, cached)
- tagging window (phase 2), panel shell (phase 4)

### 4.3 Order of work (phases 0–1 internally)

Each step lands green (build + tests). The guiding trick: **v1 types are
deleted last** — once everything is re-anchored, deleting them turns the
compiler into the completeness check.

1. **Frames + types**: promote `frameMath`, land v2 types alongside v1
   (compile-only addition; no behavior change).
2. **Storage layer**: v2 create/validate/refuse-v1 in `projectFolder`,
   folder-per-clip `clipStorage`, clip-scoped `annotationStorage`, board
   loader with default template; unit tests + both e2e fixture projects
   re-authored as **native v2** (hand-authored, no converter needed).
3. **Clip editor re-anchor**: pins model, Annotate surface (Editor anchored
   to clipId/pinId, background from the frame rasterizer), clip tags
   editable in the inspector.
4. **Capture path**: `/player` becomes the mark-free capture surface
   (manual clip creation interim; the tagging window replaces it in
   phase 2).
5. **Presentations**: clip slides with `pausePins` playback, pin slides,
   tag-based asset browsing.
6. **Exports + deletions sweep**: clip-based exports, then delete the
   "dies" list and finally the v1 types; fix everything the compiler
   surfaces.

### 4.4 Caches and side stores

Nothing to convert — with no v1 projects opening, stale caches are unreachable:

- `derived-media/`, homography/tracking caches: v2 keys embed frames and
  clip IDs; regenerable by design.
- IndexedDB autosave backups (`annotate-backup-db`): v2 doc keys never
  collide with v1; old entries age out.
- OPFS quick-annotate storage: untouched.

---

## 5. Test plan sketch

- Unit: frame conversion (round-trips, half-open ranges, per-video fps);
  board load/validate + default template; folder-per-clip storage CRUD and
  scan; annotation anchor resolution; v2 integrity rules; refusal of a v1
  manifest.
- e2e: fixture projects re-authored native v2; specs rewritten alongside
  each step of §4.3 (clip capture → pin annotate → present with pause
  points → export); one spec asserting the v1-refusal message.
- The deletions sweep (§4.3 step 6) is complete when no source file
  references the v1 type names and the full suite is green.
