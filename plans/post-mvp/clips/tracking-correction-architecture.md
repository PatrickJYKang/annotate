# Tracking Correction Architecture

## Goal

Define the next-stage architecture for clip tracking after the current baseline is already good enough to build on.

This note assumes the current practical stack is:

- player tracking via `roboflow/trackers` using `OC-SORT`
- pitch homography via `PnLCalib`

The main problem this note addresses is no longer "how do we get any tracking at all?"

It is:

- how to correct tracking cleanly
- how to handle gaps and loss of lock
- how to let the user recover quickly when the tracker makes a small number of mistakes

This is intentionally not a "replace the tracker again" document.

---

## Current stance

The tracker is already good enough that the next bottleneck is correction UX and gap policy, not core tracker quality.

That means the product should now optimize for:

- editable tracking output
- explicit visibility handling
- local corrections
- easy re-tracking from a correction point
- preserving good spans rather than recomputing everything

The authoring model remains human-led.

Tracking is assistive.

One implementation detail worth calling out now that the baseline is live:

- raw OC-SORT IDs are useful, but they are not stable enough to be treated as the sole truth in the app adapter
- the seed frame can legitimately expose immature detections with `track_id = -1`
- later sampled frames can reassign IDs even when the actual followed player is still obvious spatially

So the current `annotate` sidecar adapter now treats tracker IDs as a preference signal, not an absolute identity contract.

---

## Core principles

### 1. The editor owns the truth

The canonical artifact is the clip annotation keyframe sequence stored in the clip.

Tracking does not own the annotation.

Tracking only proposes or populates keyframes.

Once keyframes are in the clip:

- they are inspectable
- they are editable
- they are the truth for playback

### 2. Correction beats perfect automation

The system does not need to solve every failure automatically.

It needs to make the common fix workflow fast:

1. track
2. notice drift or loss
3. correct one frame
4. retrack from there

That loop is more important than marginal tracker accuracy improvements.

Related current rule:

- if the old preferred tracker ID would imply an unreasonable positional jump, the adapter should follow the spatially nearest plausible continuation instead of snapping to that raw ID blindly

### 3. Do not hallucinate through uncertainty

If the tracker loses the object for a meaningful span:

- do not invent motion through the gap
- mark the annotation hidden for that range
- let the user decide whether to retrack or correct manually

### 4. Preserve good spans

When the user corrects a bad section, the system should not throw away the parts that were already correct.

Re-tracking should normally be scoped to:

- from here to end
- from here to next correction
- an explicit user-selected sub-range

---

## Desired mental model

The user should experience tracked annotations as:

- normal clip annotations with keyframes
- plus a few convenience actions for generating or repairing those keyframes

Not as a separate "AI object" living outside the main annotation model.

That means:

- tracked highlights become normal highlight keyframes
- tracked boxes become normal box keyframes
- tracked polygons are still just polygon keyframes if produced later

The user should always be able to drag or edit the result directly.

---

## Gap handling policy

Gap handling should be explicit and conservative.

### Short gaps

For very short losses, it is reasonable to keep continuity.

Typical behavior:

- retain the last good and next good tracked positions
- let normal interpolation cover the gap

This should only happen when the gap is small enough that the implied motion is still believable.

### Medium or long gaps

For larger losses, the annotation should become hidden.

Represent that as:

- normal keyframes before loss
- a `visible: false` keyframe when the object is considered lost
- a visible keyframe again when the object is reacquired or manually corrected

This is preferable to drawing fake continuity.

### Default recommendation

The initial implementation should bias toward hiding too early rather than hallucinating too much.

That is a better failure mode for tactical analysis.

---

## Correction workflow

The correction workflow should be first-class in the clip editor.

### Baseline flow

1. User seeds tracking on a frame.
2. Sidecar returns dense keyframes for the requested range.
3. User scrubs the result.
4. If drift occurs, the user corrects the annotation on the bad frame.
5. The system offers re-track actions anchored on that corrected frame.

### Core re-track actions

The editor should support:

- `Re-track from here to end`
- `Re-track from here to next correction`
- `Re-track selected range`

These are more useful than "track the whole clip again."

### Correction point semantics

A manual edit inside a previously auto-tracked span should be treated as a correction point.

Conceptually, correction points divide a tracked annotation into editable spans.

This does not necessarily require a new persisted object type.

It can simply mean:

- a user-edited keyframe exists here
- future re-tracking should respect that boundary

---

## Track stitching model

The system should think in terms of stitched spans or tracklets, even if the persisted clip file still only stores flat keyframes.

Useful internal model:

- a tracked annotation is made of one or more contiguous spans
- each span has a seed point and a generation method
- spans can be replaced independently

Example:

- frames `0-38`: good auto-tracked span
- frames `39-44`: hidden / lost
- frames `45-80`: corrected + retracked span

Playback still only needs the final ordered keyframes.

But the editor/runtime should reason in spans when offering repair actions.

---

## Recommended persistence stance

Do not overcomplicate the saved clip schema too early.

The persisted source of truth can remain:

- clip annotations
- ordered keyframes
- `source: 'manual' | 'auto' | 'corrected'`

That is enough for playback.

If needed later, richer provenance can be added as optional metadata.

For now, prefer:

- simple persisted model
- richer editor/runtime behavior

Possible later metadata if genuinely needed:

```ts
tracking?: {
  backend: 'ocsort';
  spans: Array<{
    startTMs: number;
    endTMs: number;
    seedTMs: number;
    status: 'tracked' | 'lost' | 'corrected';
  }>;
}
```

But this should not be required up front.

---

## Sidecar contract direction

The sidecar contract should stay narrow.

Its job is to return track data for a bounded request, not to own editor semantics.

The current `/track` shape is already close to what is needed:

```txt
POST /track
{ videoPath|videoRef, startMs, endMs, seedBbox, seedFrameMs, ... }
-> { keyframes, trackId, detectionCount }
```

What may be useful to add later:

- loss / reacquisition markers
- per-frame confidence or quality scores
- a reason for termination if tracking stops early
- optional debug detections for hard cases

But the key design principle is:

- the sidecar returns data
- the editor decides how to merge, hide, replace, or preserve spans

---

## Homography's role

`PnLCalib` is important, but it should not become the main recovery mechanism for player identity.

Its strongest near-term uses are:

- projecting pitch-space annotations consistently
- helping visualize motion in tactical context
- supporting plausibility checks or smoothing later

It should not be the first answer to:

- "the tracker briefly lost this player"

That remains primarily a tracking span / correction problem.

---

## Suggested UI behaviors

The clip editor should make tracked annotations feel easy to inspect and repair.

Useful behaviors:

- highlight which annotations were auto-tracked
- show where visibility drops out
- expose a simple "lost here" state rather than silently continuing
- make corrected keyframes visually distinct
- surface retrack actions directly near the current frame / selection

The user should be able to understand:

- what came from tracking
- what was corrected manually
- where the system thinks the target was lost

Without needing to inspect raw CV output.

---

## MVP implementation order

The recommended order is:

1. Keep the current tracker/homography baseline.
2. Make `visible: false` handling clean and explicit.
3. Tighten manual correction of tracked annotations.
4. Add robust `re-track from here` and `re-track range`.
5. Only after that, consider more advanced gap filling or confidence-aware smoothing.

This order maximizes product value fastest.

---

## What not to do next

Avoid spending the next cycle on:

- another tracker bake-off unless the current setup clearly fails
- ambitious automatic gap hallucination
- a complex new persisted tracking object model
- using homography as the main identity-recovery system

Those may all have value later, but they are not the highest-leverage next step.

---

## Working summary

- `OC-SORT + PnLCalib` is already a strong practical baseline.
- The next architecture problem is correction, not tracker replacement.
- Tracking output should become normal editable annotation keyframes.
- Gaps should be handled conservatively, with `visible: false` for real loss.
- Manual correction points should anchor partial re-tracking.
- The editor should preserve good spans and only repair the bad ones.
