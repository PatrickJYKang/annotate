# Clips Feature

> **Goal:** Add video clip support — time-range segments with keyframed,
> trackable annotations. This is the prerequisite for the presentation
> feature.

> **Status note:** This is now mainly a historical planning/spec document.
> The active implementation truth lives in
> [clips-implementation-checklist.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/clips-implementation-checklist.md)
> and [clips-roadmap.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/clips-roadmap.md).
> Some detailed assumptions below are now outdated, especially around
> trackable tool types, pitch/image coexistence, and how the sidecar treats raw
> tracker IDs.

---

## 1  Core concepts

### Clips are time ranges, not video files

A clip is `{ startMs, endMs }`, optionally pinned to marks
(`startMarkId`, `endMarkId`). No video data is copied — the source
video must remain available, just like stills reference the source
rather than storing raw PNGs.

- Both `startMs`/`endMs` AND `startMarkId`/`endMarkId` are stored.
  The mark ID is a binding. **Resolution is lazy** — on clip load,
  the system looks up `startMarkId` → current mark ms and overwrites
  `startMs` in memory. The on-disk ms is a stale cache, refreshed on
  next save. If the mark is deleted, the mark ID is nulled and the
  ms value is retained as a free timestamp.

**Clips live parallel to stills** on the stills page (combined
stills+clips view). Marks remain pure timestamps.

Clips are discovered by listing `clips/*.json`, matching how stills
are discovered by listing `stills/`. No manifest registration needed.

### Clips are containers for keyframed annotations

Each clip holds annotations that vary over time. An annotation has
keyframes at specific timestamps; the system interpolates between them
for smooth playback.

**Keyframe timestamps are relative to clip start** (`tMs: 0` = first
frame of clip). This keeps clips self-contained and movable. The
playback system resolves `clip.startMs + keyframe.tMs` for video sync.

```
Clip {
  schema: 1,
  id, videoId,
  startMs, endMs, startMarkId?, endMarkId?,
  annotations: [
    {
      id,
      type: 'highlight' | 'box' | 'circle' | 'arrow' | 'text' | 'poly',
      coordMode: 'image' | 'pitch',
      source: 'manual' | 'auto' | 'corrected',
      text?: string,          // for type: 'text' — content doesn't vary over time
      style: {
        stroke, fill, fillOpacity, strokeWidth, strokePattern,
        fontSize?, fontFamily?, textHighlight?   // text-specific
      },
      keyframes: [ ... ]   // type-specific geometry, see below
    }
  ]
}
```

`videoId` is required — a project can have multiple videos, and the
clip editor needs to know which video to load.

### Keyframe schemas (type-specific)

Different annotation types have different geometry. Each keyframe
contains `tMs` plus type-specific properties:

| Type | Keyframe properties |
|------|-------------------|
| `box` | `tMs, x, y, w, h` (or perspective quad: `tMs, points: [x,y]×4`) |
| `circle` | `tMs, cx, cy, rx, ry` |
| `arrow` | `tMs, x1, y1, x2, y2` |
| `text` | `tMs, x, y` |
| `poly` | `tMs, points: [x,y]×N` |
| `highlight` | `tMs, cx, cy, radius` |

Style properties (`stroke`, `fill`, `fillOpacity`, `strokeWidth`,
`strokePattern`) are set per-annotation, not per-keyframe — style
does not vary over time.

For `poly` and perspective `box` (quad), vertex count N is **fixed at
creation time** and cannot change across keyframes. Interpolation
requires matching arrays.

A keyframe may have `visible: false` to indicate the tracked object
is not visible (occluded, out of frame). The annotation is hidden
for that range rather than interpolated through the gap.

### Interpolation

- **Dense keyframes** (auto-tracked, per-frame): linear interpolation.
  Frames are close enough that linear is indistinguishable from smooth.
- **Sparse keyframes** (manual, seconds apart): cubic interpolation
  for smooth motion between user-placed keyframes.
- The system infers density from keyframe spacing. Adjacent keyframes
  ≤2 frames apart → linear; otherwise → cubic.
- **Cubic only applies to simple numeric properties** (`x`, `y`, `w`,
  `h`, `cx`, `cy`, `radius`, etc.). Point arrays (`poly` points,
  perspective quad points) always use linear to avoid self-intersections.

### Two coordinate modes

Annotations have an explicit coordinate mode, set at creation time:

| Mode | Meaning | Use case |
|------|---------|----------|
| `image` | Pixel coordinates in the video frame | Tracks a visual object (e.g., highlight following a player) |
| `pitch` | Pitch coordinates (metres), projected per-frame via homography | Anchored to the pitch (e.g., box marking a zone) |

Auto-tracking naturally produces image-space keyframes. The system can
convert to pitch-space if a homography is available.

---

## 2  Two-level keyframe model

### User level (coarse intent)

The user interacts at a high level:

- "Track this player from 1s to 4s"
- Draw a box on one frame, hit Track
- Scrub to where tracking drifted, correct, re-track forward

### System level (per-frame positions)

Under the hood, the tracking backend determines the position of the
object at each frame and stores per-frame keyframes. Playback reads
these stored keyframes and interpolates — no inference at render time.

**Compute happens at creation time, not playback time.** This means
playback works on weak hardware.

---

## 3  Tracking backend (pluggable)

The clip editor and data model are agnostic to the tracking backend.
They just consume and produce keyframes.

```
┌───────────────────────────────────────────────┐
│ Clip data model (JSON)                         │
│ - time range + annotations with keyframes      │
│ - source: 'manual' | 'auto' | 'corrected'     │
├───────────────────────────────────────────────┤
│ Clip Editor (frontend, Konva)                  │
│ - renders keyframes at current playback time   │
│ - interpolates between keyframes               │
│ - user can add/edit/delete keyframes           │
│ - "Track" button → sends request to backend    │
├───────────────────────────────────────────────┤
│ Tracking backend (pluggable)                   │
│ - Interface: video path + bbox + time range    │
│   → returns per-frame keyframes                │
│ - Implementations:                             │
│   a) Local Python sidecar (YOLO+BoTSORT,       │
│      MobileSAM for occlusion)                   │
│   b) Remote API                                │
│   c) None (manual keyframing only)             │
└───────────────────────────────────────────────┘
```

### Backend options

| Option | Pros | Cons |
|--------|------|------|
| **Local Python sidecar** | Full ecosystem (PyTorch, ultralytics, MobileSAM), fast w/ GPU | User needs Python + deps, complicates distribution |
| **Remote API** | Offloads compute | Needs internet, latency, cost, privacy |
| **None (manual)** | Zero deps, works on any machine | Tedious for long clips |

**Primary target: local Python sidecar.** Analysts on decent machines
can `pip install` the tracking package. The sidecar runs as a local
HTTP server that the Next.js app talks to via localhost.

### Sidecar API contract

The sidecar receives **file paths + time ranges**, not raw frame data.
It extracts frames itself (via OpenCV / ffmpeg), avoiding the overhead
of shipping image data over HTTP.

**All timestamps in the sidecar API are absolute video ms**, not
clip-relative. The frontend converts between clip-relative (used in
the data model) and absolute (used in sidecar calls).

```
POST /track
{ videoPath, startMs, endMs, bbox: {x,y,w,h}, seedFrameMs }
→ { keyframes: [ { tMs, x, y, w, h, visible }, ... ] }

POST /segment
{ videoPath, frameMs }
→ { mask: base64-encoded PNG alpha mask }

POST /homography
{ videoPath, startMs, endMs }
→ { frames: [ { tMs, matrix: [9 floats] }, ... ] }

GET /health
→ { capabilities: ['track', 'segment', 'homography'] }
```

The `/health` endpoint lets the webapp discover which features are
available and show/hide UI accordingly.

---

## 4  Three tracking problems

| Problem | What it does | When it runs | Output | Potato-safe? |
|---------|-------------|-------------|--------|-------------|
| **Player tracking** | Follows a target object across frames | At clip creation | Per-frame bboxes (image-space keyframes) | Yes (pre-computed) |
| **Pitch registration** | Estimates camera→pitch homography per frame | Batch per-video or lazily per-clip-range | Per-frame 3×3 matrices | Yes (cached) |
| **Pitch-coord projection** | Projects pitch-space annotations into image space | At render time | Pixel positions for drawing | Yes (trivial matrix multiply) |

### Player tracking

- **YOLO + ByteTrack/BoT-SORT**: mature detection+tracking pipeline
  for multi-object tracking in sports video. YOLO is a detection model
  (not segmentation), which is the right tool for bbox tracking.
- Speed (per frame):
  - YOLOv8-nano: ~300fps GPU / ~30fps CPU
  - YOLOv8-small: ~150fps GPU / ~15fps CPU
- A 1–4s clip is ~30–120 frames. Even on CPU with YOLOv8-small,
  processing takes <10s. On GPU, under 1s.
- Nano/small is likely sufficient for sports — players on a pitch are
  large, well-separated objects.

**Target selection**: the user draws a bbox on one frame. The sidecar
runs YOLO on that frame, finds the detection with the highest IoU
against the user's bbox, and uses that as the tracking seed. ByteTrack
then associates that detection ID across subsequent frames. If no
detection matches (IoU < threshold), the sidecar returns an error and
the user can adjust their bbox.

**Bbox → annotation geometry**: `/track` always returns bboxes. The
frontend converts these to the annotation's native type: for a
highlight, bbox center → `cx, cy` and size → `radius`; for a circle,
bbox → `cx, cy, rx, ry`; for box/arrow/text, the bbox is used
directly or mapped to the relevant properties.

**Occlusion / out-of-frame**: when ByteTrack loses the target for
more than `track_buffer` frames, keyframes for that range are marked
`visible: false`. Short gaps (< track_buffer) are bridged by
ByteTrack's re-identification.

### Pitch registration

- **Static camera** (tripod, amateur/training): existing single-frame
  homography calibration covers the whole clip. Near-free.
- **Moving camera** (broadcast): per-frame estimation needed. We use
  **Narya** (`narya/tracker/homography_estimator.py`), which provides
  a two-model fallback system with pre-trained weights:

  1. **Primary — KeypointDetectorModel** (EfficientNetB3-FPN, 29 pitch
     keypoints). Predicts landmark locations (line intersections, arc
     points, etc.) in the image. If ≥4 found → `cv2.findHomography`
     with RANSAC. Accurate when pitch markings are visible.
  2. **Fallback — DeepHomoModel** (ResNet18 + pyramid layer). Directly
     predicts 4 corner displacements → homography. Used when the
     keypoint model finds <4 points (close-ups, heavy occlusion).

  Pre-trained weights hosted on GCS — download and run, no training
  required (`deep_homo_model.h5`, `keypoint_detector.h5`).

  **Temporal processing** (from Narya's `FootballTracker`):
  - `scipy.interpolate.interp1d` for skipped/failed frames
  - Savitzky-Golay filter (`savgol_filter`) for smoothing jitter
  - `skip_homo` parameter to reuse previous homography (perf opt)

  **Future upgrade path**: merge Narya's training data with SoccerNet
  Camera Calibration dataset and retrain, but pre-trained weights are
  sufficient for v1.

- For a 90-min match at 30fps, per-frame homography is ~160K matrices
  (9 floats each ≈ 5MB). Trivial to store, significant to compute.
  **Lazy per-clip-range computation** is more practical than
  whole-video batch for v1.
- **Note**: Narya uses TensorFlow/Keras. The sidecar will carry a TF
  dependency alongside PyTorch (for YOLO + MobileSAM). Alternatively,
  the models can be ported to PyTorch or exported to ONNX to unify
  the runtime — but not required for v1.

### Pitch-coord projection

Given player bbox (image-space) + homography for that frame, projecting
to pitch coords (or vice versa) is a matrix multiply. Already
implemented in Editor (`applyHomography` / `applyHomographyInv`).

---

## 5  User correction loop

Auto-tracking will drift, especially with occlusion (players crossing,
going off-screen). The correction workflow:

1. User requests tracking ("track this player, 1s–4s")
2. System generates per-frame keyframes
3. User plays back, spots drift at e.g. 2.5s
4. User scrubs to problem frame, adjusts annotation position
5. User can re-track forward from the correction point, or re-track
   only a sub-range (e.g., 2.5s–3.5s) to preserve good keyframes
   outside the problem region
6. Repeat until satisfied

Annotation source field tracks provenance: `'manual'` → `'auto'` →
`'corrected'` (auto-tracked then manually adjusted).

---

## 6  Foreground occlusion (MobileSAM)

The existing stills annotation system has foreground occlusion (Sobel
edge detection + a poor ML approach). MobileSAM replaces both with
high-quality segmentation via the Python sidecar.

### Why MobileSAM

MobileSAM is a distilled version of SAM ViT-H — ~95% mask quality at
a fraction of the cost. Full SAM is too slow on CPU.

| Model | GPU | CPU |
|-------|-----|-----|
| SAM ViT-H | ~0.5s/frame | ~8–15s/frame |
| MobileSAM | ~0.01s/frame | ~0.5–1s/frame |
| FastSAM | ~0.02s/frame | ~0.3–0.5s/frame |

### How occlusion works

MobileSAM is a prompted model — it needs point or bbox prompts.
The `/segment` endpoint internally runs **YOLO to detect people →
uses YOLO bboxes as MobileSAM box prompts → merges resulting masks
into a single alpha channel**. This means the sidecar needs YOLO
loaded for both tracking and occlusion.

The rendering pipeline:

1. Render annotations on the Konva canvas
2. Composite the foreground mask on top — pixels where the mask is
   opaque hide the annotations beneath, creating the illusion that
   annotations are behind players

The mask is a single-channel alpha image at frame resolution.

### When occlusion runs

Masks are **never stored** in the project — occlusion is a rendering
effect, not data.

| Context | Approach | Latency budget | Fits? |
|---------|----------|---------------|-------|
| **Stills (editor)** | MobileSAM, on-demand | 1–2s (one image) | ✅ ~0.5–1s CPU |
| **Clips (editor, paused)** | MobileSAM, current frame only | 1–2s (user is paused) | ✅ same |
| **Clips (editor, playing)** | None (or Sobel fallback) | Must be real-time | N/A |
| **Export** | MobileSAM, pre-generate all frames, bake into output | Minutes (batch) | ✅ ~90s/120 frames CPU |

During slow scrubbing (frame-by-frame while paused), the last N masks
can be cached in memory (~30 frames) for smooth occlusion. Cache is
ephemeral — discarded when the clip closes or playback resumes.

### Upgrade path for stills

MobileSAM replaces the current Sobel/ML occlusion in the still-frame
Editor immediately. Same workflow (generate on demand, never store),
much better mask quality. This can ship independently of the clips
feature — just swap the occlusion backend to call MobileSAM via the
sidecar.

---

## 7  Clip editor

A **new `ClipEditor` component** — separate from the stills Editor
but using Konva for shape rendering to maintain visual consistency.
It has its own:

- **Video playback**: integrated `<video>` element with play/pause/
  seek controls
- **Timeline strip**: shows clip duration with keyframe diamonds
  per annotation
- **Keyframe editing**: scrub to frame, move/resize annotation, set
  keyframe
- **Track button**: sends bbox + time range to sidecar, receives
  per-frame keyframes
- **Annotation tools**: same tools as stills (box, circle, arrow,
  text, highlight, poly) adapted for keyframed placement

The stills Editor and ClipEditor share utility code (shape rendering
helpers, Konva primitives, style handling) but are separate components
with different lifecycles.

---

## 8  Playback detail

### Video seek on open

When the clip editor opens, it seeks the `<video>` element to
`clip.startMs / 1000`. Until the seek completes (`seeked` event),
annotations render at `tMs: 0` (first keyframe positions).

### Video-annotation sync

`video.timeupdate` only fires ~4Hz. Smooth annotation rendering at
display refresh rate requires:

1. `requestAnimationFrame` loop reads `video.currentTime`
2. Resolve to clip-relative time: `tMs = (currentTime * 1000) - clip.startMs`
3. For each annotation, find bracketing keyframes and interpolate
4. Update Konva node positions/properties
5. Call `layer.batchDraw()`

### Seeking

When the user seeks (scrubs), annotations jump instantly to the
correct position — no animation/tweening. The rAF loop handles this
naturally since it reads `currentTime` each frame.

### Clip boundaries

When playback reaches `clip.endMs`, the clip pauses (does not loop).
The user can replay or return to the clip list.

### Konva performance

Konva is canvas-based and not optimised for 60fps video-synced
updates. For clips with many annotations, may require:

- Limiting visible annotations to those with keyframes in the current
  time range
- Using `Konva.FastLayer` for annotation rendering
- Throttling inspector/UI updates to ~10fps while video is playing

---

## 9  Python sidecar summary

The sidecar serves three functions over localhost HTTP:

| Endpoint | Model | Purpose |
|----------|-------|---------|
| `/track` | YOLO + ByteTrack | Player/object tracking → per-frame keyframes |
| `/segment` | MobileSAM | Foreground occlusion mask for a single frame |
| `/homography` | Narya (KeypointDetector + DeepHomo fallback) | Per-frame camera→pitch homography |
| `/health` | — | Capability discovery for the webapp |

All endpoints are optional — the app degrades gracefully (manual
keyframes, Sobel fallback for occlusion, manual calibration).

### Startup

The sidecar is a standalone Python process (`python -m annotate_sidecar`
or similar). The user starts it manually. The webapp polls `/health`
on page load to detect availability and shows a status indicator
(connected / not connected).

---

## 10  Storage

```
project/
  stills/
    ...
  clips/
    clip-abc123.json    # { schema, id, startMs, endMs, annotations: [...] }
    clip-def456.json
  homography-cache/
    range-0-120000.json       # one file per requested range (clip-driven)
    range-120000-240000.json  # range = startMs-endMs of the /homography call
```

Clip JSON files include a `schema` version field for forward
compatibility (matching the pattern used by stills annotations).

Clips are discovered by listing `clips/*.json` (no manifest entry).

---

## 11  Export

Clips can be exported as **annotated MP4 video files** with
annotations and occlusion burned in. This is a **frontend-driven**
batch process — annotation rendering lives in JS/Konva and cannot be
reimplemented server-side without duplication.

### Export pipeline

1. Frontend seeks video to each frame in the clip range
2. Frontend renders annotations at that timestamp on a Konva canvas
3. Frontend requests occlusion mask from sidecar (`/segment`)
4. Frontend composites video frame + annotations + mask into a final
   frame image (canvas → blob)
5. Frontend sends the frame image to a sidecar **`/export/frame`**
   endpoint (or batches them)
6. Sidecar collects frames and encodes to MP4 (ffmpeg)

The sidecar handles frame extraction (for the raw video frame if
needed) and MP4 encoding. The frontend handles annotation rendering
and compositing because that logic already exists in Konva.

Export is also the path the **presentation feature** will use to
produce playable clip segments.

---

## 12  Non-goals (for now)

- Real-time inference during playback
- Automatic full-video tracking (user initiates per-clip)
- Changes to the marks system
- Stored occlusion masks (always generated on-demand or at export)

---

## 13  Implementation checklist

### Phase 1 — Types & storage helpers

**Types** (`webapp/lib/types/clip.ts` — new file):

- [x] `ClipId` string alias
- [x] `CoordMode = 'image' | 'pitch'`
- [x] `AnnotationSource = 'manual' | 'auto' | 'corrected'`
- [x] `ClipAnnotationType = 'box' | 'circle' | 'arrow' | 'text' | 'poly' | 'highlight'`
- [x] Per-type keyframe interfaces:
  - `BoxKeyframe { tMs, x, y, w, h, visible? }`
  - `BoxQuadKeyframe { tMs, points: [number,number][], visible? }`
  - `CircleKeyframe { tMs, cx, cy, rx, ry, visible? }`
  - `ArrowKeyframe { tMs, x1, y1, x2, y2, visible? }`
  - `TextKeyframe { tMs, x, y, visible? }`
  - `PolyKeyframe { tMs, points: [number,number][], visible? }`
  - `HighlightKeyframe { tMs, cx, cy, radius, visible? }`
- [x] `ClipKeyframe` — discriminated union of the above
- [x] `ClipAnnotationStyle { stroke, fill, fillOpacity, strokeWidth,
      strokePattern, fontSize?, fontFamily?, textHighlight? }`
- [x] `ClipAnnotation { id, type, coordMode, source, text?, style,
      keyframes: ClipKeyframe[] }`
- [x] `Clip { schema: 1, id, videoId, startMs, endMs, startMarkId?,
      endMarkId?, annotations: ClipAnnotation[] }`

**Storage** (`webapp/lib/fs/clipStorage.ts` — new file):

- [x] `listClips(projectDir) → Promise<Clip[]>` — iterate
      `clips/*.json`, parse each, return array sorted by startMs
- [x] `readClip(projectDir, clipId) → Promise<Clip | null>` — read
      single clip file
- [x] `writeClip(projectDir, clip) → Promise<void>` — write to
      `clips/clip-{id}.json`, create `clips/` dir if missing
- [x] `deleteClip(projectDir, clipId) → Promise<void>` — remove file
- [x] `resolveMarkPinning(clip, marks) → Clip` — look up
      `startMarkId`/`endMarkId` in marks array, overwrite
      `startMs`/`endMs` in memory. Null out markId if mark not found.
- [x] `migrateClipSchema(raw: unknown) → Clip` — validate + migrate
      from older schema versions

**Tests** (`webapp/lib/fs/clipStorage.test.ts`):

- [x] Round-trip: write → read → compare
- [x] `listClips` returns sorted, ignores non-JSON files
- [x] `resolveMarkPinning` updates ms, nulls missing marks
- [x] `migrateClipSchema` handles version 1 and unknown versions

### Phase 2 — Stills+clips page

**Page changes** (`webapp/app/stills/page.tsx`):

- [x] State: `clips: Clip[]`, loaded via `listClips(projectDir)` on
      mount and after create/delete
- [x] Resolve mark pinning on load: `clips.map(c =>
      resolveMarkPinning(c, manifest.marks))`
- [x] Clip list section below stills grid (or tabbed):
  - Each clip card shows: start–end time range, annotation count,
    first-frame thumbnail
  - Hover actions: Edit (navigate to clip editor), Delete
- [x] "New Clip" button in navbar:
  - Modal/popover: select start mark + end mark from dropdowns
    (filtered to current video), or manual ms entry
  - On create: generate ID (`crypto.randomUUID()`), set `videoId`
    from `selectedVideoId`, write clip JSON, refresh clip list
- [x] Clip thumbnail generation:
  - On clip list load, for each clip without a cached thumbnail:
    seek a hidden `<video>` to `clip.startMs`, capture frame to
    canvas, convert to blob URL
  - Cache thumbnail blob URLs in state (ephemeral, not persisted)
- [x] Navigate to clip editor: `router.push(/clip/${clip.id})` +
      pass project handle via `postMessage` (same pattern as
      stills → annotate)
- [x] Delete clip: call `deleteClip`, refresh list, show toast

**Route** (`webapp/app/clip/[clipId]/page.tsx` — new file):

- [x] Page shell: load clip via `readClip`, resolve video URL from
      manifest (`manifest.videos.find(v => v.id === clip.videoId)`),
      handle missing clip / missing video errors
- [x] Project handle restoration: same `postMessage` listener and
      `navigator.storage.getDirectory()` pattern as annotate page
- [x] Render `ClipEditor` component (dynamic import, no SSR)
- [ ] Toolbar: tool selection, style controls, save status, sidecar
      status indicator, coordinate mode toggle — Phase 4
- [x] Keyboard shortcuts: Space (play/pause), Left/Right (frame step),
      Cmd+S (save)

### Phase 3 — Clip editor core

**Shared utilities** (extract from `Editor.tsx` into new files):

- [x] `webapp/lib/annotate/shapeRendering.ts` — extract `hexToRgba`,
      `contrastStrokeForHex`, `dashFromStrokePattern`, `makeId` from
      `Editor.tsx` so both Editor and ClipEditor can import them
- [x] `webapp/lib/annotate/homography.ts` — extract `invert3`,
      `computeHomographyFromUnitSquareToQuad`, `applyHomography` from
      `Editor.tsx`
- [x] Update `Editor.tsx` imports to use shared modules (no behaviour
      change, just de-duplication)

**ClipEditor component** (`webapp/components/clip/ClipEditor.tsx`):

- [x] Props: `clipId, clip, videoUrl, videoFps, tool, defaultColor,
      defaultStrokeWidth, ...` (mirror annotate page pattern)
- [x] Internal state: `annotations` (from clip), `selectedAnnotationId`,
      `currentTMs` (clip-relative), `isPlaying`
- [x] `<video>` element: ref, `src={videoUrl}`, hidden controls,
      `onLoadedMetadata` → seek to `clip.startMs / 1000`
- [x] Wait for `seeked` event before rendering first frame
- [x] Konva `<Stage>` + `<Layer>` overlaid on video via absolute
      positioning (same as stills Editor pattern)

**Playback sync loop**:

- [x] `useEffect` with `requestAnimationFrame`:
  - Read `videoRef.current.currentTime`
  - Compute `tMs = (currentTime * 1000) - clip.startMs`
  - Clamp to `[0, clip.endMs - clip.startMs]`
  - If `tMs >= clip.endMs - clip.startMs`: pause video, set
    `isPlaying = false`
  - Store `currentTMs` in state (or ref for perf)
- [x] Play/pause: `videoRef.current.play()` / `.pause()`,
      toggle `isPlaying`
- [x] Frame step: when paused, `video.currentTime += 1/fps` or
      `-= 1/fps`, clamp to clip bounds

**Interpolation engine** (`webapp/lib/clip/interpolation.ts`):

- [x] `interpolateKeyframes(keyframes, tMs, type) → interpolated
      properties | null`
- [x] Binary search to find bracketing keyframes
- [x] Before first keyframe → clamp to first; after last → clamp to
      last
- [x] If either bracket has `visible: false` → return null (hidden)
- [x] Determine interpolation mode: if bracket gap ≤ 2 frames apart
      (need fps param) → linear; else → cubic
- [x] Linear: `lerp(a, b, t)` for each numeric property
- [x] Cubic: Catmull-Rom or Hermite spline for simple numeric props
      (`x, y, w, h, cx, cy, radius, rx, ry, x1, y1, x2, y2`)
- [x] Point arrays (`poly` points, quad points): always linear,
      per-vertex
- [x] Unit tests (`interpolation.test.ts`):
  - Linear between two close keyframes
  - Cubic between two distant keyframes
  - `visible: false` returns null
  - Clamp before/after range
  - Point array linear interpolation

**Annotation rendering**:

- [x] For each annotation: call `interpolateKeyframes(ann.keyframes,
      currentTMs, ann.type)` → if null, skip; else render Konva shape
      at interpolated position
- [x] Konva shape mapping: same shape types as stills Editor (KRect,
      KEllipse, KArrow, KText, KLine for poly, etc.) but driven by
      interpolated keyframe data instead of static Shape objects
- [x] Apply `ann.style` to each shape (stroke, fill, opacity, dash
      pattern, fontSize)
- [x] `layer.batchDraw()` after updating all shapes each rAF tick

**Bbox → annotation geometry** (`webapp/lib/clip/bboxConvert.ts`):

- [x] `bboxToBox(bbox) → { x, y, w, h }`
- [x] `bboxToCircle(bbox) → { cx, cy, rx, ry }` (centre + half
      width/height)
- [x] `bboxToHighlight(bbox) → { cx, cy, radius }` (centre + avg of
      half-dims)
- [x] `bboxToArrow(bbox) → { x1, y1, x2, y2 }` (centre-left to
      centre-right)
- [x] `convertTrackingKeyframes(rawKeyframes, annotationType) →
      ClipKeyframe[]` — apply correct converter per type, convert
      sidecar absolute tMs to clip-relative tMs
- [x] Unit tests for each converter

### Phase 4 — Clip editor editing

**Timeline strip** (`webapp/components/clip/TimelineStrip.tsx`):

- [x] Horizontal bar showing clip duration (0 → endMs - startMs)
- [x] Playhead indicator synced to `currentTMs`
- [x] Per-annotation row/lane with diamond markers at each keyframe
      tMs
- [x] Click on timeline → seek video to that time
- [x] Click on diamond → select that annotation + seek to keyframe
      time
- [x] Selected annotation highlighted in timeline
- [x] Drag playhead for scrubbing

**Manual keyframe editing**:

- [x] When paused and tool = 'select': click annotation on canvas →
      select it
- [x] Drag selected annotation → updates position
- [x] On drag end: insert or update keyframe at `currentTMs` with new
      position. If keyframe already exists at this tMs (within 1-frame
      tolerance), update it; otherwise insert new keyframe, keep
      keyframes sorted by tMs.
- [x] Delete keyframe: select annotation, Backspace/Delete key while
      a specific keyframe is selected in timeline. Cannot delete if
      only 1 keyframe remains.
- [x] Set annotation `source = 'corrected'` if it was `'auto'` and
      the user edits it

**Annotation creation** (drawing new annotations):

- [x] Same tool-based creation as stills Editor (box, circle, arrow,
      text, highlight, poly) but creates a `ClipAnnotation` with a
      single keyframe at `currentTMs`
- [x] Uses `defaultColor`, `defaultStrokeWidth`, etc. from toolbar
      state
- [x] For text: prompt for text string (or inline editable), store in
      `annotation.text`
- [x] New annotation gets `source: 'manual'`, `coordMode: 'image'`
      (default; user can toggle to 'pitch' if homography available)

**Delete annotation**: select → Delete key → remove from clip ✅

**Save**:

- [x] Debounced auto-save (800ms, matching stills pattern) via
      `writeClip(projectDir, clip)`
- [x] Save status indicator (idle / saving / saved / error)

### Phase 5 — Sidecar scaffold

**Package structure**:

```
sidecar/
  annotate_sidecar/
    __init__.py
    __main__.py              # python -m annotate_sidecar
    server.py                # FastAPI app, CORS, port config
    routes/
      __init__.py
      health.py              # GET /health
      track.py               # POST /track
      segment.py             # POST /segment
      homography.py          # POST /homography
      export.py              # POST /export/frame, /export/encode
    services/
      __init__.py
      frame_extractor.py     # cv2.VideoCapture → frames by ms
      tracker.py             # YOLO + ByteTrack wrapper
      segmenter.py           # YOLO + MobileSAM wrapper
      homography_estimator.py  # Narya wrapper
      encoder.py             # ffmpeg MP4 encoding
    models/                  # downloaded weights cached here
  requirements.txt           # fastapi, uvicorn, ultralytics,
                             # mobile-sam, tensorflow, narya deps,
                             # opencv-python, scipy, numpy
  README.md                  # setup + run instructions
```

**Server** (`server.py`):

- [x] FastAPI app with CORS (`allow_origins=["http://localhost:3000",
      "http://localhost:*"]`)
- [x] Configurable port (default 8321, via `--port` arg)
- [x] Mount route modules
- [x] Startup event: log which models are available

**`/health`** (`routes/health.py`):

- [x] Check which model files exist / which imports succeed
- [x] Return `{ capabilities: [...], models: { yolo: bool,
      mobilesam: bool, narya: bool } }`

**Frame extraction** (`services/frame_extractor.py`):

- [x] `extract_frame(video_path, frame_ms) → np.ndarray` — open
      video, seek to ms, read frame, return BGR array
- [x] `extract_frames(video_path, start_ms, end_ms, fps) →
      Iterator[(ms, np.ndarray)]` — yield frames at intervals
- [x] Handle seek failures gracefully (return nearest frame)
- [x] Cache `cv2.VideoCapture` objects per video path (avoid
      re-opening for every call)

**`__main__.py`**: parse args (port, log level), run uvicorn

**README**: Python 3.10+, `pip install -r requirements.txt`,
`python -m annotate_sidecar --port 8321`

### Phase 6 — Player tracking (`/track`)

**Tracker service** (`services/tracker.py`):

- [x] Load YOLO model on first call (configurable: yolov8n.pt or
      yolov8s.pt, auto-download from ultralytics hub)
- [x] `detect_frame(frame, classes=[0]) → list[BBox]` — run YOLO on
      single frame, filter to person class (COCO class 0), return
      bboxes with confidence
- [x] `match_seed_bbox(detections, user_bbox, iou_threshold=0.3) →
      detection_index | None` — compute IoU of user bbox against each
      detection, return best match if above threshold
- [x] `track_range(video_path, start_ms, end_ms, seed_bbox,
      seed_frame_ms, fps) → list[KeyframeDict]`:
  - Extract frames for range
  - Run YOLO + ByteTrack on all frames (`model.track(persist=True)`)
  - Match seed bbox on seed frame to get target track ID
  - For each frame: if target ID present → bbox keyframe; if absent
    for > track_buffer → `visible: false`
  - Return keyframes with absolute video ms timestamps
- [x] Handle: target never found (return error), target lost
    permanently (keyframes up to loss point + visible:false after)

**`/track` route** (`routes/track.py`):

- [x] Validate request: videoPath exists, startMs < endMs,
      seedFrameMs within range, bbox has positive dimensions
- [x] Call `tracker.track_range(...)`
- [x] Return `{ keyframes: [...], trackId: int, detectionCount: int }`
- [x] Error responses: 404 if video not found, 422 if no matching
      detection at seed frame (include detected bboxes in error so
      frontend could show them)

**Frontend integration**:

- [x] `webapp/lib/clip/sidecarClient.ts` — new file:
  - `sidecarBaseUrl` (default `http://localhost:8321`)
  - `checkHealth() → Promise<{ capabilities: string[] } | null>`
  - `requestTracking(params) → Promise<TrackingResult>`
  - `requestSegmentation(params) → Promise<Blob>`
  - `requestHomography(params) → Promise<HomographyResult>`
- [x] Sidecar connection context (`webapp/lib/state/SidecarContext.tsx`
      — new file):
  - React context providing `{ connected: bool, capabilities:
    string[] }`
  - Poll `/health` on mount, re-poll every 30s or on manual retry
  - Used by clip editor and stills page to show/hide ML features
- [x] ClipEditor "Track" button:
  - Visible only if sidecar connected + 'track' in capabilities
  - User selects annotation → clicks Track → sends bbox at
    currentTMs + clip time range to `requestTracking`
  - Convert absolute-ms response keyframes to clip-relative via
    `convertTrackingKeyframes`
  - Replace annotation keyframes, set `source: 'auto'`
  - Show spinner during request, error toast on failure

### Phase 7 — User correction loop

**Re-tracking**:

- [x] After user drags a tracked annotation to a new position
      (creating a corrected keyframe), show "Re-track from here"
      button in toolbar
- [x] "Re-track from here" (full forward):
  - Call `/track` with `seedFrameMs = currentTMs + clip.startMs`,
    `startMs = seedFrameMs`, `endMs = clip.endMs`, `bbox` from the
    corrected keyframe position
  - On success: keep all keyframes ≤ currentTMs, replace all
    keyframes > currentTMs with new tracking result
  - Set `source: 'corrected'`
- [x] "Re-track range" (sub-range):
  - User specifies end of re-track range (e.g., via shift-click on
    timeline to set a range endpoint)
  - Call `/track` with the sub-range
  - On success: keep keyframes before start and after end of range,
    replace only the middle
- [x] Undo: if re-tracking produces worse results, Ctrl+Z reverts to
      previous keyframes (requires storing a snapshot before re-track)

### Phase 8 — Pitch registration (`/homography`)

**Homography service** (`services/homography_estimator.py`):

- [x] Wrap Narya's `HomographyEstimator` — import, instantiate with
      `pretrained=True` (triggers GCS weight download on first use)
- [x] `estimate_frame(frame) → (np.ndarray[3,3], str)` — run
      estimator, return homography matrix + method ('cv' or 'torch')
- [x] `estimate_range(video_path, start_ms, end_ms, fps,
      skip_interval=0) → list[HomographyFrame]`:
  - Extract frames, run estimator on each (or skip per interval)
  - Apply temporal smoothing:
    - `scipy.interpolate.interp1d` for skipped/failed frames
    - `scipy.signal.savgol_filter` with window=5, polyorder=3
  - Return list of `{ tMs (absolute), matrix: [9 floats] }`

**`/homography` route** (`routes/homography.py`):

- [x] Validate request, call service, return frames array
- [x] Include `{ method: 'keypoints' | 'deep_homo' | 'interpolated' }`
      per frame for debugging

**Cache** (`webapp/lib/fs/homographyCache.ts` — new file):

- [x] `writeHomographyCache(projectDir, startMs, endMs, frames) →
      void` — write to `homography-cache/range-{start}-{end}.json`
- [x] `readHomographyCache(projectDir, startMs, endMs) →
      HomographyFrame[] | null` — exact range match
- [x] `findOverlappingCache(projectDir, startMs, endMs) →
      HomographyFrame[] | null` — list `homography-cache/*.json`, find
      any range that fully contains the requested range, extract subset

**Frontend integration**:

- [x] ClipEditor: on open, check `findOverlappingCache` for clip range
  - If found: load into state, enable pitch-space rendering
  - If not found: show "Compute homography" button (requires sidecar)
- [x] "Compute homography" button:
  - Call `requestHomography`, show progress
  - On success: write cache, enable pitch-space rendering
- [x] Pitch-space annotation rendering: for each annotation with
      `coordMode: 'pitch'`, look up homography matrix for current
      frame tMs, apply homography to convert pitch coords →
      image coords, render at image coords (reuse `applyHomography`
      from shared utils)

### Phase 9 — Foreground occlusion (`/segment`)

**Segmenter service** (`services/segmenter.py`):

- [x] Load YOLO model (separate instance; shared singleton deferred to Phase 11)
- [x] Load MobileSAM model on first call (auto-download weights)
- [x] `segment_frame(frame) → np.ndarray[H,W] (uint8 alpha)`:
  - Run YOLO on frame, filter to person class
  - For each person bbox: prompt MobileSAM with box coordinates
  - Merge all per-person masks into single alpha mask (union via
    `np.maximum`)
  - Return alpha mask (0 = background, 255 = foreground)
- [x] Handle: no people detected → return all-zero mask

**`/segment` route** (`routes/segment.py`):

- [x] Extract frame at requested ms, run segmenter
- [x] Encode alpha mask as PNG, base64 encode
- [x] Return `{ mask: "data:image/png;base64,...", width, height, personCount }`

**Frontend compositing** (`webapp/lib/clip/occlusionCompositor.ts`):

- [x] `fetchOcclusionMask(videoPath, frameMs) → Promise<ImageBitmap>`
      — call sidecar, decode base64 PNG to ImageBitmap
- [x] Compositing strategy for Konva:
  - Add a Konva `Image` node on a layer ABOVE annotations
  - The image source is: for each pixel, if mask is opaque → show
    video frame pixel; if transparent → show nothing (letting
    annotations below show through)
  - This requires rendering the video frame onto the mask: create
    an offscreen canvas, draw video frame, apply mask as alpha
    (`globalCompositeOperation: 'destination-in'`), use result as
    Konva Image source
  - Redraw this composited foreground layer whenever mask changes
- [x] Ephemeral cache: `OcclusionCache` (LRU, 30 entries) keyed by
      rounded frame ms. Clear on unmount or play start.

**Integration with ClipEditor**:

- [x] "Occ" toggle in transport bar (only visible if sidecar has
      'segmentation' capability)
- [x] When enabled + paused: fetch mask for current frame, render
      foreground layer via KImage on Layer above annotations
- [x] When playing: disable occlusion layer (clear cutout)
- [x] On frame step while paused: check cache first, fetch if miss

**Stills Editor upgrade**:

- [ ] Deferred: Editor.tsx sidecar occlusion requires absolute video
      path which is unavailable in browser (File System Access API).
      Existing 'edge' and 'ml' methods remain functional.

### Phase 10 — Export

**Sidecar export endpoints** (`routes/export.py`):

- [x] `POST /export/start { clipId, fps, width, height } →
      { sessionId }` — create a temporary directory for frames
- [x] `POST /export/frame { sessionId, frameIndex, image:
      base64-jpeg }` — decode image, write to temp dir as
      `frame_{frameIndex:06d}.jpg`
- [x] `POST /export/encode { sessionId, outputPath?, fps } →
      { outputPath }` — run ffmpeg with libx264, CRF 18, faststart
- [x] `DELETE /export/{sessionId}` — clean up temp directory

**Frontend export loop** (in ClipEditor or dedicated export modal):

- [x] "Export" button in transport bar → opens ExportModal
- [x] Export flow:
  1. Call `/export/start` to get sessionId
  2. For each frame index `i` in `[0, totalFrames)`:
     a. Seek video to `clip.startMs + (i / fps * 1000)`
     b. Wait for `seeked` event
     c. Capture video frame: `offscreenCanvas.drawImage(videoEl, ...)`
     d. Render annotations at tMs onto offscreen Konva stage (or
        second offscreen canvas)
     e. If occlusion enabled: fetch mask from `/segment`, composite
        foreground layer
     f. Composite all layers onto final canvas (video + annotations
        + foreground mask)
     g. Export final canvas as JPEG blob
        (`canvas.toBlob('image/jpeg', 0.95)`)
     h. Send to `/export/frame`
     i. Update progress bar (`i / totalFrames`)
  3. Call `/export/encode`
  4. Show "Export complete" with path to MP4
  5. Call `DELETE /export/{sessionId}` to clean up
- [x] Cancel button: abort loop, call DELETE to clean up
- [x] Error handling: abort after 3 consecutive frame send failures
- [x] Note: uses `canvas.toDataURL('image/jpeg', 0.95)` — works
      with File System Access API + object URLs (no CORS taint).

### Phase 11 — Polish & verification

**Sidecar status**:

- [x] `SidecarContext` indicator in ClipEditor transport bar (green
      dot = connected, grey = disconnected, tooltip shows capabilities)
- [x] Re-poll on focus (`visibilitychange` listener)
- [x] `retry()` method exposed on SidecarState (components can call it)

**Graceful degradation**:

- [x] When sidecar unavailable: Track, Re-track, Compute H, Occ,
      and Export buttons are all conditionally hidden via `canTrack`,
      `canComputeHomography`, `canSegment`, `canExport` flags
- [x] Manual-only mode fully functional: create clips, add
      annotations, set keyframes by hand, play back

**Performance**:

- [ ] Profile rAF loop: measure time from `currentTime` read to
      `batchDraw()` complete. Budget: <8ms for 120fps, <16ms for
      60fps.
- [ ] If over budget: reduce to `Konva.FastLayer` (if Konva version
      supports it), or skip rendering every other rAF tick, or limit
      annotation count warning
- [ ] Test with 10+ annotations, 120-frame clip, on CPU-only machine

**Tests**:

- [x] `clipStorage.test.ts` — 32 tests passing
- [x] `interpolation.test.ts` — 31 tests passing
- [x] `bboxConvert.test.ts` — 12 tests passing
- [ ] Sidecar integration test: start sidecar, call `/health`, verify
      response
- [ ] E2E manual test script: create clip → add annotation → track
      → correct → export → verify MP4 plays

**Documentation**:

- [x] Update project README with clips feature overview
- [x] Sidecar README: installation, startup, supported hardware,
      troubleshooting (ffmpeg, MobileSAM, TensorFlow, model downloads)
