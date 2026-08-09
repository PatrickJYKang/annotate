# `trackers` Repo Integration Map

> **Historical integration map.** It records the import path that led to the
> current sidecar. Use the [sidecar reference](../../../sidecar/README.md) for
> the live endpoint and provider boundary.

## Goal

Map how the separate `PatrickJYKang/trackers` repo can be used as a demo/reference repo now, and gradually mined for reusable CV components later.

This note assumes:

- `trackers` is not yet the source of truth for the whole product
- `annotate` remains the main product repo
- `trackers` is currently valuable as an experimental CV sandbox and packaging surface

The question is not:

- "Should `annotate` become the `trackers` repo?"

The question is:

- "What can be pulled from `trackers` into `annotate`, what should stay there, and in what order?"

Current state note:

- the key tracking and calibration primitives have now already been vendored into `annotate`
- the older bespoke ByteTrack / Narya paths have been removed from the live sidecar path
- this document is now mostly about boundary protection and any future move from vendored code to a formal dependency

---

## Current roles

### `annotate`

`annotate` owns:

- project model
- marks, stills, clips, presentations
- webapp/editor behavior
- clip annotation schema and interpolation
- presentation behavior
- sidecar HTTP contract used by the app
- correction UX and retracking semantics

### `trackers`

`trackers` currently acts more like:

- a CV demo and experimentation repo
- a reusable tracking/calibration package
- a cleaner packaging surface for tracker cores, pitch calibration, projection, and motion utilities

That makes it useful even before any deep integration work.

---

## What `trackers` already does well

From the current repo shape, `trackers` already has a cleaner split than `annotate` in a few important areas:

- reusable tracker cores under `trackers/core/*`
- a public tracker API surface in `trackers/__init__.py`
- pitch calibration providers under `trackers/calibration/*`
- `PnLCalibProvider` as a real provider abstraction
- calibration smoothing and projection helpers
- motion/projection utilities
- CLI/demo/eval surfaces that are useful for experimentation but do not belong in `annotate`

That means the repo is already valuable as a component source, not just as a demo.

---

## What should move into `annotate`

The main rule is:

- pull reusable CV primitives and provider abstractions into `annotate`
- do not pull in demo concerns or let `trackers` own editor semantics

### 1. Tracker core usage

The best candidate for near-term adoption is the tracker core itself.

Desired outcome:

- `annotate` sidecar tracking should stop owning low-level tracker implementation details
- instead it should wrap a tracker implementation from `trackers`

Current `annotate` file:

- `sidecar/annotate_sidecar/services/tracker.py`

Current problem:

- it is a YOLO + ByteTrack specific service
- it owns too much low-level tracking orchestration directly

Current implementation:

- `/track` stays in `annotate`
- `videoRef` resolution and app-specific request validation stay in `annotate`
- low-level tracker execution now runs through vendored OC-SORT primitives from `trackers`
- the annotate-owned adapter still owns seed matching, spatial continuity / continuity fallback, and response shaping

What moves conceptually:

- tracker class selection
- tracking-core state logic
- association algorithm implementation

What stays in `annotate`:

- absolute-video-ms API contract
- seed bbox matching behavior as exposed to the app
- conversion into clip annotation keyframes
- correction/retracking merge policy

### 2. Pitch calibration provider pattern

The second strong candidate is the calibration provider layer.

Current `annotate` file:

- `sidecar/annotate_sidecar/services/homography_estimator.py`

Current problem:

- it mixes multiple concerns:
  - color heuristic fallback
  - optional Narya fallback
  - temporal estimation logic
  - app-specific output shaping

The `trackers` repo already has a cleaner abstraction:

- `trackers/calibration/base.py`
- `trackers/calibration/providers/pnlcalib.py`
- `trackers/calibration/smoothing.py`

Current implementation:

- `/homography` stays in `annotate`
- clip/time-range request semantics stay in `annotate`
- internal calibration now already runs through a provider-driven layer on the vendored `PnLCalib` path

Best near-term reusable pieces:

- `PnLCalibProvider`
- calibration smoothing / gap filling
- projection helpers

### 3. Projection and motion utilities

These are good candidates for reuse as pure utilities.

Examples from `trackers`:

- homography application/inversion
- image-to-pitch projection
- pitch-to-image projection
- motion transformation helpers

These should be reused where they simplify `annotate`, but without forcing the app to adopt the `trackers` CLI/runtime model.

---

## What should stay out of `annotate`

Some parts of `trackers` are useful there precisely because they are not part of the main app repo.

These should generally stay separate:

- benchmarking code
- evaluation metrics and dataset tooling
- demo app surfaces
- generic CLI tooling for tracking/eval/download
- repository-level experiments that are not directly tied to the product

These are useful for research and validation, but they should not become product dependencies unless there is a strong reason.

---

## What must stay owned by `annotate`

There are several important things that should not move to `trackers`.

### 1. Editor correction semantics

The `trackers` repo can provide tracking primitives.

It should not own:

- correction points
- retrack-from-here behavior
- sub-range replacement semantics
- how tracked spans merge into clip annotations
- how `visible: false` is represented in the product model

Those are product/editor concerns.

### 2. Clip schema and keyframe model

The clip file format and annotation model belong to `annotate`.

That includes:

- clip-relative time
- annotation types
- keyframe interpolation behavior
- provenance fields like `manual` / `auto` / `corrected`

### 3. App-specific sidecar API

The `annotate` webapp needs a stable local sidecar contract.

That includes:

- `videoRef` registration
- absolute path handling
- project-local filesystem behavior
- request/response shapes expected by the web UI

Even if the internals are powered by `trackers`, the route contract should remain owned by `annotate`.

---

## Recommended integration shape

The most sensible long-term shape is:

### `trackers`

Owns:

- tracker implementations
- calibration providers
- projection/smoothing helpers
- generic CLI/demo/eval utilities

### `annotate` sidecar

Owns:

- app-specific HTTP routes
- `videoRef` registration and resolution
- request validation
- conversion between tracker outputs and app data structures
- app-specific defaults and heuristics

### `annotate` webapp

Owns:

- clip editing
- correction workflow
- retracking UX
- annotation import/merge
- presentation usage

This is the cleanest boundary.

---

## Adoption strategies

There are two broad ways to consume `trackers` from `annotate`.

### Option A: Vendor/copy selected modules

Copy specific stable modules into `annotate` when they are mature enough.

Pros:

- simplest runtime story
- full local control
- no extra packaging dependency between repos

Cons:

- duplication risk
- harder to keep fixes synced

Best for:

- small utility layers
- early stabilization phase

### Option B: Treat `trackers` as a Python dependency

Install `trackers` into the sidecar environment and import it directly.

Pros:

- cleaner separation
- fewer duplicate implementations
- easier to improve the CV package independently

Cons:

- extra packaging/release coordination
- more care needed for version compatibility
- the sidecar becomes dependent on the package being installed correctly

Best for:

- tracker cores
- calibration providers
- stable reusable utilities

### Practical recommendation

Use a hybrid adoption path:

1. Keep using `trackers` as a demo/reference repo immediately.
2. Import or vendor only the pieces that simplify `annotate` right now.
3. Once the APIs stabilize, move toward treating `trackers` as a real dependency for the sidecar.

---

## Suggested migration order

### Phase 1: Tracker-core replacement

Goal:

- stop maintaining low-level tracking logic directly in `annotate`

Actions:

- keep `sidecar/annotate_sidecar/routes/track.py`
- keep `sidecar/annotate_sidecar/services/tracker.py` as a thin adapter
- keep low-level OC-SORT execution in vendored `trackers` code

Important constraint:

- keep the existing app-facing `/track` API stable

### Phase 2: Calibration provider adoption

Goal:

- replace ad hoc homography service logic with a provider-oriented layer

Actions:

- keep provider selection inside `annotate`
- keep the vendored `PnLCalibProvider` path active
- keep `/homography` output shape stable for the app

### Phase 3: Projection utility reuse

Goal:

- reduce duplicate projection math and calibration helpers

Actions:

- reuse image/pitch projection helpers from `trackers`
- align any pitch-coordinate workflows in `annotate` with the same math

### Phase 4: Optional package dependency

Goal:

- decide whether `trackers` is stable enough to become a formal sidecar dependency

This should only happen once:

- tracker-core imports feel stable
- calibration providers feel stable
- the repo boundaries are clear

---

## Concrete file mapping

### Tracking

`annotate` today:

- `sidecar/annotate_sidecar/services/tracker.py`
- `sidecar/annotate_sidecar/routes/track.py`

`trackers` source:

- `trackers/core/ocsort/tracker.py`
- `trackers/core/ocsort/tracklet.py`
- `trackers/core/bytetrack/tracker.py`

Recommended outcome:

- route stays in `annotate`
- service becomes an adapter
- algorithm lives in `trackers`

### Calibration

`annotate` today:

- `sidecar/annotate_sidecar/services/homography_estimator.py`
- `sidecar/annotate_sidecar/routes/homography.py`

`trackers` source:

- `trackers/calibration/base.py`
- `trackers/calibration/providers/pnlcalib.py`
- `trackers/calibration/smoothing.py`

Recommended outcome:

- route stays in `annotate`
- provider abstraction and smoothing come from `trackers`
- app-specific request/response shaping stays in `annotate`

### Projection / motion

`annotate` today:

- spread across sidecar and future clip logic

`trackers` source:

- `trackers/calibration/projection.py`
- `trackers/motion/*`

Recommended outcome:

- reuse utility math where it reduces duplication
- do not import CLI/runtime concerns

---

## Risks

### 1. API drift between repos

If `trackers` evolves quickly as a demo repo, `annotate` can end up chasing unstable internals.

Mitigation:

- only depend on small stable surfaces
- add thin adapters in `annotate`

### 2. Packaging/dependency weight

Bringing `trackers` in as a dependency too early may complicate sidecar setup.

Mitigation:

- start with selective reuse
- defer full dependency adoption until the surface stabilizes

### 3. Boundary confusion

It would be easy to let editor semantics leak into `trackers`.

Mitigation:

- keep correction UX, retracking semantics, and clip data ownership firmly in `annotate`

---

## Working recommendation

Treat `PatrickJYKang/trackers` as:

- a demo repo now
- a component source next
- a possible sidecar dependency later

Do not try to merge the product into it.

Instead:

- pull tracker-core and calibration abstractions inward
- keep app routes and editor semantics in `annotate`
- keep experimentation, benchmarking, and generic CLI tooling in `trackers`

That gives the product the benefit of the cleaner CV architecture without losing control of the actual authoring experience.
