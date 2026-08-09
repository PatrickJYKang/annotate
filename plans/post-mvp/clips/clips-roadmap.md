# Clips Roadmap

> **Historical roadmap.** Use the [as-built reference](../../../technical_document.md) and [0.2 implementation ledger](../../v0.2/implementation-plan.md) for current behavior and status.

## Purpose

This document is the broader planning note for clips.

It combines and updates ideas from:

- [clips-feature.md](clips-feature.md)
- [clip-still-domain-model.md](../analysis-model/clip-still-domain-model.md)
- [tracking-correction-architecture.md](tracking-correction-architecture.md)
- [trackers-repo-integration-map.md](trackers-repo-integration-map.md)

This is not the detailed implementation checklist. It is the higher-level product and architecture roadmap for how clips should develop from here.

---

## Working product model

### Clips

Clips are bounded passages of play worth analyzing over time.

- A clip is defined by a source `videoId`, `startMs`, and `endMs`.
- A clip is not a rendered video asset.
- A clip is the main analysis container for sequence work.

### Stills

Stills are moments worth freezing and emphasizing.

- A still is anchored to one source video and one timestamp.
- There should only be one still per `(videoId, t_ms)`.
- Stills remain independently usable outside any clip context.

### Clip/still relationship

Clip/still relationship is fully derived from time bounds.

- A still belongs to a clip context if `clip.startMs <= still.t_ms <= clip.endMs`.
- No explicit clip-to-still links are stored.
- No pinning or clip ownership exists in the core model.

### Presentations

Presentations remain playlists of stills and clips arranged to prove a point.

- They are not where clip analysis is authored.
- `match_video` remains a useful rhetorical transition effect.
- It should not be treated as the fundamental clip model.

---

## Target user experience

### Still editor

The still editor is for precise static analysis.

It should remain best for:

- freezing the key moment
- drawing tactical structure clearly
- creating reference images for later use in clips and presentations

### Clip editor

The clip editor is the temporal analysis workspace.

The intended feel is:

- After Effects lite for tactical analysis

That means:

- same annotation language as stills
- shapes animated over time
- keyframes aligned to actual match-video frames
- human-led tactical explanation rather than generic video editing

### Presentation editor

The presentation editor remains a composition surface.

Its job is to:

- select stills and clips
- arrange them into an argument
- configure lightweight presentational behavior

Not to replace still or clip authoring.

---

## Core architecture stance

### `annotate` owns the product

`annotate` remains the source of truth for:

- project model
- clip/still/presentation data
- editor behavior
- correction UX
- retracking semantics
- sidecar API contract for the app

### `trackers` is a component source

The separate `trackers` repo should be treated as:

- a demo and experimentation repo now
- a source of reusable CV components next
- a possible formal sidecar dependency later

It should not become the product repo.

### Separation of responsibilities

The intended boundary is:

- `trackers` owns reusable CV primitives:
  - tracker cores
  - calibration providers
  - projection/smoothing helpers
  - generic CLI/demo/eval tooling
- `annotate` sidecar owns:
  - app-specific HTTP routes
  - `videoRef` registration and resolution
  - request/response shaping
  - app-specific defaults
  - conversion between CV outputs and app data
- `annotate` webapp owns:
  - clip editor
  - correction workflow
  - retrack-from-here behavior
  - annotation import and merge
  - presentation integration

---

## CV stance

### Current baseline

The current practical baseline is:

- player tracking via `OC-SORT`
- pitch homography via `PnLCalib`

In the live `annotate` tree, that baseline is now no longer just conceptual:

- the sidecar is fully on the vendored `trackers` OC-SORT + PnLCalib path
- tracking is seeded from clip-editor highlights, not generic boxes
- tracked highlight geometry is treated as foot-anchored
- the sidecar adapter now follows spatial continuity when raw tracker IDs are immature (`-1`) or reassign between frames

That is already strong enough to build on.

### What matters next

The next bottleneck is not finding a different tracker.

The next bottleneck is:

- correction
- gap handling
- repair UX
- preserving good spans

### Product rule

CV is assistive, not foundational.

That means:

- user-authored keyframes remain the truth
- CV proposes or populates keyframes
- correction is first-class
- CV output must be editable

Tracking should not become a separate opaque object system.

Tracked results should become normal clip keyframes.

---

## Key workflows

### 1. Still-to-clip seeding

One of the most important bridges in the product is:

- import annotations from a still into a clip at the corresponding frame

This should be treated as a first-class workflow because it:

- preserves the value of still analysis
- gives clip analysis a fast starting point
- avoids making tracking mandatory
- makes stills and clips feel like one system

### 2. Track, correct, retrack

This is the core CV-assisted clip workflow:

1. user seeds tracking on a frame
2. sidecar returns dense keyframes
3. user scrubs and inspects the result
4. user corrects the bad frame when drift happens
5. user retracks from that correction point or within a bounded range

This loop matters more than squeezing a little more benchmark accuracy out of the tracker.

### 3. Conservative gap handling

When the tracker loses the target:

- short plausible gaps can be interpolated
- real loss should become `visible: false`
- the system should prefer hiding too early over hallucinating too much

That is the better failure mode for tactical analysis.

---

## Clip editor direction

The clip editor should develop around five main capabilities.

### 1. Keyframed annotation editing

- draw shapes
- edit shapes
- create and move keyframes
- scrub and preview animation

### 2. Still surfacing inside clip context

Stills within clip bounds should surface automatically in the clip editor.

Current likely direction:

- show all in-bounds stills
- order them chronologically

The exact UI treatment is still open, but the relationship itself is derived and automatic.

### 3. Tracking and correction

- track annotation from a seed frame
- show loss clearly
- correct manually
- retrack from here
- retrack range
- keep following the same player even when raw tracker IDs are unstable

### 4. Pitch-space support

Where homography is available, the clip editor should support:

- pitch-coordinate reasoning
- image/pitch projection
- pitch-aware tactical structures

This should build on calibration and projection primitives, not on custom one-off math.

### 5. Playback context

The clip editor should support enough playback to make temporal analysis usable, but it should not turn into a full NLE.

That means:

- local scrubbing
- frame stepping
- controlled playback
- maybe later frame holds/dwell behavior

---

## Recommended implementation sequence

### Phase 1. Lock the domain model

Keep the following decisions stable:

- one still per `(videoId, t_ms)`
- clip/still relationship derived from time bounds
- clips are the sequence-analysis container
- stills remain first-class static analysis assets

### Phase 2. Make still-to-clip flow feel natural

Prioritize:

- importing annotations from still to clip
- surfacing in-bounds stills in the clip editor
- keeping annotation primitives shared between stills and clips

This is one of the highest-value product integrations.

### Phase 3. Harden the clip editor core

Build out:

- keyframe editing
- selection and manipulation
- scrubbing and timeline control
- reliable save/load behavior

This is the core authoring surface and must feel solid before advanced CV features matter.

### Phase 4. Shift tracking from “demo works” to “product usable”

Focus on:

- editable tracking output
- retrack-from-here
- retrack-range
- explicit gap handling
- preserving good spans
- robust player continuity when tracker IDs mature late or reassign

This is the most important near-term CV milestone.

### Phase 5. Adopt reusable CV components from `trackers`

Gradually replace ad hoc internals in `annotate` with clearer reusable layers:

- tracker core
- calibration provider pattern
- smoothing and projection utilities

Do this without giving up ownership of app routes or editor semantics.

### Phase 6. Expand pitch-aware workflows

Once tracking/correction is solid:

- improve pitch-space annotation usage
- rely more on reusable calibration/projection math
- make tactical structures easier to build in pitch context

### Phase 7. Improve presentation integration

Once clips are stable:

- make clips first-class presentation assets
- improve browsing of stills and clips together
- keep presentation logic simple and focused on argument construction

---

## What not to prioritize next

Avoid spending the next cycle on:

- another tracker bake-off unless the current baseline clearly fails
- complicated new persisted tracking object types
- pushing too much product logic into the `trackers` repo
- making the clip editor behave like a generic video editor
- making CV the conceptual center of the app

These are all lower leverage than correction, integration, and editor quality.

---

## Relationship to existing docs

Use the other docs like this:

- [clips-feature.md](clips-feature.md)
  - detailed feature and implementation checklist
- [clip-still-domain-model.md](../analysis-model/clip-still-domain-model.md)
  - domain rules for stills, clips, and presentations
- [tracking-correction-architecture.md](tracking-correction-architecture.md)
  - next-stage correction and retracking model
- [trackers-repo-integration-map.md](trackers-repo-integration-map.md)
  - repo boundary and component adoption strategy

This roadmap is the high-level synthesis layer across those notes.

---

## Working summary

- Clips are the main container for temporal analysis.
- Stills are key emphasized moments and remain first-class.
- Stills relate to clips purely by time bounds, not explicit links.
- The clip editor should feel like After Effects lite for tactical analysis.
- Still-to-clip import is one of the highest-value bridges to build.
- `OC-SORT + PnLCalib` is already the active clip CV baseline.
- The next real CV problem is correction UX, not tracker replacement.
- `trackers` should be treated as a reusable CV component source, while `annotate` retains ownership of product behavior.
