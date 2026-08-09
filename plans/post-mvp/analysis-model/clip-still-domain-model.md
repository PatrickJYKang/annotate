# Clip / Still Domain Model

> **Historical pre-project.v2 design.** The current model replaces marks and stills with clip-local pins and pin annotation documents. See the [0.2 schema](../../v0.2/project-v2-schema-and-migration.md).

## Goal

Capture the working product model for clips, stills, clip editing, and presentations.

This is not a full implementation spec. It is a domain note intended to guide future work and keep the product model coherent as clip support expands.

This note refines parts of the earlier clip and presentation planning docs. In particular, it moves away from treating stills and clips as purely parallel assets in the user workflow.

---

## Core definitions

### Marks

A mark is a timestamp in a source video that is worth bookmarking semantically.

- Marks are lightweight.
- Marks are the place where tagging naturally belongs.
- Marks are not themselves presentation assets.

### Stills

A still is a specific moment in time that is worth freezing and drawing special attention to.

- A still is anchored to one source video and one timestamp.
- A still is the natural unit for static tactical analysis.
- A still can exist on its own even if it is not part of any clip.

### Clips

A clip is a bounded passage of play that is worth analyzing over time.

- A clip is defined by two points in time in a single source video.
- A clip is not a rendered video file. It is a time range plus analysis data.
- A clip is the natural unit for sequence analysis.

### Presentations

A presentation is a curated playlist of stills and clips arranged to prove a point.

- Presentation is a composition layer, not an analysis-authoring layer.
- `match_video` remains a rhetorical visual effect used inside presentations.
- `match_video` is not the foundational model for clips or stills.

---

## Product stance

The working stance is:

- Stills and clips are both first-class assets.
- In real analysis workflow, stills often feel like they belong within clips.
- That belonging should be derived from time bounds, not stored as hard ownership.

In other words:

- In the UX, clips can become the natural home for sequence-related stills.
- In the data model, stills should still remain independently usable.

This matters because:

- analysts will often want to use a still inside a clip workflow
- some stills will remain standalone
- a still may reasonably relate to more than one clip
- overlapping clips should remain possible

So the model should support clip-centric workflow without making clips exclusive containers.

---

## Recommended relationship model

### Stills do not become children of clips

Avoid making a still be owned by exactly one clip.

That would be too rigid for:

- overlapping clips
- standalone still analysis
- reusing the same moment in multiple analytical contexts

### Stills can be related to clips

A still is related to a clip when its timestamp falls within the clip bounds.

This relationship should be fully derived at read time from time bounds rather than stored explicitly.

That means:

- no explicit clip-to-still membership links
- no user-managed pinning in the core model
- no clip ownership of stills

If clip bounds change, still membership changes automatically.

This keeps the model simple, avoids stale relationship data, and naturally supports overlapping clips.

Recommended boundary rule:

- `clip.startMs <= still.t_ms <= clip.endMs`

### Tags remain parallel

Tagging should continue to run in parallel to clip membership.

- tags describe meaning
- clip relationships describe temporal context

Clips should not replace tagging, and tagging should not be forced to carry clip structure.

---

## Editor responsibilities

### Still editor

The still editor is for precise static analysis.

- freeze a moment
- annotate shapes
- label players and tactical ideas
- create a canonical visual frame for reference and presentation

### Clip editor

The clip editor is the temporal analysis workspace.

The closest useful mental model is:

- After Effects lite for tactical analysis

That means:

- the same annotation language as the still editor
- shapes animate over time
- keyframes are aligned to the underlying match video frames
- every frame in the clip editor corresponds to a real frame in the source video

The clip editor is not intended to become a full nonlinear video editor.

Its job is to let the analyst explain movement over time using:

- keyframed shapes
- temporal annotation cues
- CV-assisted interpolation and proposal generation

Possible later enhancement:

- hold on a specific frame for a configured dwell time

That is useful, but not part of the core model.

### Presentation editor

The presentation editor is not where analysis is authored.

Its job is to:

- choose stills and clips
- order them
- configure lightweight rhetorical behavior
- present the final argument clearly

`match_video` should remain a transition effect that helps prove a point, not the core analysis abstraction.

---

## Shared annotation language

Stills and clips should share the same annotation primitives as much as possible.

Examples:

- highlights
- arrows
- boxes
- circles
- polygons
- text
- any future tactical presets such as defensive cover shadow or lobbed pass

The difference is not the tool vocabulary. The difference is time.

- stills use static annotations
- clips use the same kinds of shapes, but keyframed over time

This keeps the product legible and makes still-to-clip workflows much more natural.

---

## Still-to-clip bridge

One of the most important bridges to build is:

- import shapes from a still into a clip

Conceptually:

- find the clip-relative frame corresponding to the still timestamp
- copy the still's annotations onto that frame
- turn them into initial clip keyframes

This should be a first-class workflow.

Why this matters:

- it preserves the value of still analysis
- it gives the clip editor a fast starting point
- it avoids making tracking mandatory
- it makes stills and clips feel like one coherent analysis system

Recommended stance:

- stills seed clip work
- clips extend still analysis through time

### Still uniqueness

There should only be one still per `(videoId, t_ms)`.

The product model should not allow multiple stills at the same timestamp in the same source video.

This keeps still identity clean and makes still-to-clip import much simpler.

If a clip imports from a still:

- it imports one annotation set from one still at a time
- there is no need to resolve between competing still variants at the same moment

---

## Role of CV and tracking

CV is assistive, not foundational.

The authoring model remains human-authored tactical analysis.

CV should help with:

- populating frames between keyframes
- following highlighted players or objects between corrections
- proposing likely positions
- assisting with player highlighting and connection logic

CV should not replace the core editing model.

The desired behavior is:

- user places or imports keyframes
- tracking/CV fills in the gaps
- output lands as normal editable shapes/keyframes

That means CV outputs should be:

- inspectable
- editable
- correctable

### Current practical rule

In the current clip editor implementation, tracking is anchored on `highlight` annotations rather than generic boxes or circles.

- the highlight is the tracked player marker
- linked `arrow`, `lob`, and `poly` annotations can follow that highlight through time
- tracked highlight geometry is treated as foot-anchored so the user's selection aligns with where a footballer is actually planted on the ground

Pitch-space authoring remains available for pitch-grounded primitives, but normal tactical shapes and tracking anchors continue to live in image space.
- non-magical

Avoid treating tracking results as a separate opaque object type that sits outside the normal annotation system.

---

## What clips are not

Clips are not:

- a separate video export format
- a generic video editing timeline
- a place where CV becomes the main product concept

Clips are analytical time windows.

The clip editor should be designed around tactical explanation, not around general media production.

---

## Presentation implications

This model implies a future presentation browser that can eventually support multiple ways of finding source material:

- standalone stills
- clips
- stills in clip context
- tagging-based browsing
- chronological browsing

This is compatible with the idea that:

- presentations are playlists of stills and clips arranged to prove a point
- stills remain valuable on their own
- clips become the natural home for many multi-still sequences

`match_video` remains useful and should be left alone conceptually.

It is a supporting visual effect, not the thing that defines clip structure.

---

## Non-goals

This note does not propose:

- forcing every still to belong to a clip
- removing standalone still workflows
- making tracking-between-stills the core abstraction
- turning the clip editor into Premiere or Resolve
- moving presentation logic into clip authoring

---

## Open questions

The main unresolved questions are now mostly UI and implementation questions rather than product-identity questions.

### Presentation browsing

How should the presentation editor browse material once clips become more important?

Likely options:

- tag view
- chronological view
- clip-centered view

### Frame holds / dwell behavior in clips

This seems useful, but should be treated as a later playback behavior rather than a prerequisite for the domain model.

### Clip editor still surfacing

If a clip contains many stills, how should the clips editor surface them?

Current likely direction:

- automatically show all stills whose timestamps fall within the clip bounds
- order them chronologically

But the exact UI treatment is still open.

---

## Working summary

- Clips are bounded passages of play worth analyzing over time.
- Stills are moments worth freezing and emphasizing.
- Stills often belong within clip workflow, but should not be hard-owned by clips.
- The clip editor is a temporal annotation workspace using the same annotation language as stills.
- Still annotations should be importable onto the corresponding frame in a clip.
- CV and tracking assist with interpolation and proposal generation, but do not define the authoring model.
- Presentations remain curated playlists of stills and clips, with `match_video` as a supporting effect.
