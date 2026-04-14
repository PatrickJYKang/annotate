# Clips Implementation Checklist

## Purpose

This is the current actionable implementation checklist for clips.

It supersedes the older checklist sections in [clips-feature.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/clips-feature.md) where the product model has since changed.

Use this document for planning and execution.

Use the other docs like this:

- [clips-roadmap.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/clips-roadmap.md): high-level roadmap
- [clip-still-domain-model.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/analysis-model/clip-still-domain-model.md): domain rules
- [tracking-correction-architecture.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/tracking-correction-architecture.md): correction and retracking model
- [trackers-repo-integration-map.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/trackers-repo-integration-map.md): repo boundary and CV adoption plan

---

## Status key

- `[x]` done or already in tree
- `[ ]` not done yet
- `[-]` partly done or needs follow-up / rework

---

## 1. Domain invariants

### 1.1 Still uniqueness

- [x] Enforce one still per `(videoId, t_ms)` at still creation time.
- [x] Prevent duplicate still creation in the stills UI.
- [x] Prevent duplicate still creation from presentation mark materialization flows.
- [x] Add repair logic or validation for existing projects that already contain duplicates.
Current behavior: legacy duplicate-still timestamps are treated as compatibility warnings during project validation so older projects still open, but new duplicate creation is blocked.
- [-] Add tests covering duplicate prevention and project-open handling.

### 1.2 Clip/still relationship

- [x] Treat clip/still relationship as fully derived from time bounds everywhere in UI logic.
- [x] Remove or avoid any new explicit clip-to-still link fields.
- [x] Audit clip-related UI code so it does not assume stored membership.
- [x] Document the boundary rule in code comments or helper docs where useful:
  - `clip.startMs <= still.t_ms <= clip.endMs`
Current implementation: shared helpers in [stillRelationship.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/stillRelationship.ts) define and document the rule, and current clip-facing UI uses those helpers instead of hand-rolled membership logic.

### 1.3 Still import semantics

- [x] Define and implement one clear import action:
  - import one annotation set from one still onto the corresponding clip frame
- [x] Ensure the import flow does not assume multiple still variants at the same timestamp.
- [x] Decide how imported annotations are marked in clip provenance, if at all.
Current behavior: clip import reads exactly one annotation document at a time for one still. It prefers the still's default annotation set when available and otherwise falls back to the first available saved set. Imported annotations remain `source: 'manual'` because they are user-authored starting points rather than auto-tracked output.

---

## 2. Clip creation and browsing

### 2.1 Clip list and editor entry

- [x] Clip storage and basic clip route exist.
- [x] Clip editor route exists at [page.tsx](/Users/patrickkang/Documents/code/annotate/webapp/app/clip/[clipId]/page.tsx).
- [x] Clip editor component exists at [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx).

### 2.2 Clip browser usability

- [ ] Review the stills/clips page layout with the newer clip-first workflow in mind.
- [ ] Decide whether clips remain primarily surfaced on the stills page or need a more dedicated entry pattern later.
- [ ] Improve clip card metadata so sequence work is easier to scan quickly.
- [ ] Verify clip creation flows work cleanly when multiple videos are present.

### 2.3 In-bounds still surfacing

- [x] Surface all stills within clip bounds automatically inside the clip editor.
- [x] Order surfaced stills chronologically.
- [-] Decide UI treatment for surfaced stills:
  - inline timeline markers
  - side rail
  - filmstrip
  - inspector/browser section
Current implementation uses a dedicated in-editor still browser strip with `Jump` and `Import` actions.
- [ ] Make it obvious which stills are within bounds vs outside the clip.
- [x] Ensure surfaced stills update automatically when clip bounds change.

---

## 3. Still-to-clip bridge

### 3.1 Import entrypoint

- [x] Add "Import from still" entrypoint inside the clip editor.
- [x] Allow import from any still whose timestamp falls within the clip bounds.
- [x] Show the importable stills in chronological order.

### 3.2 Import behavior

- [x] Convert the still timestamp to clip-relative `tMs`.
- [x] Copy the still annotation set into clip annotations as keyframes at that frame.
- [x] Preserve annotation geometry and styles where possible.
- [x] Define how annotation IDs are regenerated or remapped on import.
- [x] Decide how text and multi-shape still annotation sets are handled.
Current behavior: import uses the still's primary saved annotation set, regenerates clip annotation IDs, and flattens perspective-backed still shapes into image-space clip annotations where needed.

### 3.3 Conflict handling

- [ ] Decide what happens if the clip already has annotations of the same apparent semantic role at that frame.
- [ ] Choose initial behavior:
  - append imported annotations
  - replace selected annotations
  - user chooses merge mode
- [ ] Add tests for repeated import into the same clip frame.

---

## 4. Clip editor core polish

### 4.1 Editing baseline

- [x] Basic keyframed annotation editing exists.
- [x] Timeline strip exists.
- [x] Manual creation/editing exists.

### 4.2 UX polish

- [ ] Review the clip editor against the "After Effects lite for tactical analysis" target.
- [ ] Improve toolbar clarity and tool affordances.
- [ ] Improve selection state visibility for annotations and keyframes.
- [ ] Make keyframe editing less fiddly where needed.
- [ ] Add missing tactical tool presets once the shared annotation language expands.

### 4.3 Playback context

- [x] Basic playback, pause, and frame step exist.
- [ ] Improve local shuttle/scrub ergonomics for analysis.
- [ ] Consider short-loop playback around the current frame.
- [ ] Keep the clip editor out of full NLE territory.
- [ ] Treat frame holds / dwell behavior as later work, not a prerequisite.

### 4.4 Save / undo / safety

- [x] Auto-save exists.
- [ ] Verify save behavior is robust during rapid keyframe edits.
- [ ] Verify undo/redo coverage for all major clip-editing actions.
- [ ] Add tests for import, retrack, range replace, and delete flows.

---

## 5. Tracking integration

### 5.1 Current baseline

- [x] `annotate` already has a local `/track` route and tracking client flow.
- [x] Clip keyframes already support tracked output and `visible: false`.

### 5.2 Tracker-core refactor toward `trackers`

- [ ] Refactor [tracker.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/tracker.py) into a thinner app adapter.
- [ ] Move low-level tracker ownership toward `trackers` primitives rather than bespoke `annotate` logic.
- [ ] Keep `/track` request and response shapes stable for the webapp.
- [ ] Keep `videoRef` handling and path resolution inside `annotate`.
- [ ] Decide whether first step is:
  - vendoring selected `trackers` modules, or
  - making `trackers` a sidecar dependency

### 5.3 Tracker configuration

- [ ] Expose or centralize the practical OC-SORT defaults you want to use.
- [ ] Decide where tracker tuning belongs:
  - `annotate` sidecar config
  - `trackers` config
  - both, with app-level overrides
- [ ] Record the chosen defaults in one place.

---

## 6. Tracking correction and retracking

### 6.1 Correction UX

- [ ] Make correction points explicit enough in the clip editor.
- [ ] Show clearly when an annotation span came from tracking vs manual edits.
- [ ] Show where the tracker lost the object.
- [ ] Make corrected keyframes visually distinct enough to inspect.

### 6.2 Re-track actions

- [x] Re-track from here exists in some form.
- [x] Re-track range exists in some form.
- [ ] Verify the current flows preserve good spans exactly as intended.
- [ ] Add "re-track to next correction" semantics if that is not already modeled cleanly.
- [ ] Make range selection for retrack more discoverable and less fiddly.

### 6.3 Gap policy

- [ ] Define the actual threshold policy for short-gap interpolation vs hiding.
- [ ] Bias initial implementation toward conservative hiding.
- [ ] Ensure `visible: false` spans are cleanly represented in editor and playback.
- [ ] Add tests for:
  - short gap interpolation
  - long gap hidden span
  - correction after hidden span
  - retrack replacing only the targeted span

### 6.4 Span reasoning

- [ ] Keep persisted clip schema simple.
- [ ] Add richer runtime span reasoning in editor logic if needed.
- [ ] Only add persisted tracking span metadata later if it becomes clearly necessary.

---

## 7. Homography and pitch-space support

### 7.1 Current baseline

- [x] `annotate` already has homography routes and cache infrastructure.
- [x] Pitch-space support exists in some form.

### 7.2 Provider refactor toward `trackers`

- [ ] Introduce or mirror a provider-oriented calibration layer inside `annotate`.
- [ ] Pull in the `PnLCalibProvider` pattern from `trackers`.
- [ ] Pull in calibration smoothing / gap-filling helpers from `trackers`.
- [ ] Keep `/homography` route shape stable for the app.

### 7.3 Pitch-space authoring

- [ ] Verify pitch/image projection math is shared and not duplicated.
- [ ] Improve pitch-space annotation workflows in the clip editor.
- [ ] Decide how pitch-space and image-space tools should coexist in the UI.
- [ ] Add tests for projection correctness at clip playback time.

---

## 8. Segmentation / occlusion

### 8.1 Current baseline

- [x] Segmentation route and occlusion compositor exist.

### 8.2 Product fit

- [ ] Re-evaluate whether current occlusion behavior is actually helpful in real clip analysis workflows.
- [ ] Improve the paused-frame occlusion workflow if it proves valuable.
- [ ] Keep this subordinate to core clip editing and tracking correction.

### 8.3 Future use

- [ ] Consider whether segmentation should later help with:
  - highlight assist
  - player silhouette-based visuals
  - better foreground layering in exports

---

## 9. Presentation integration

### 9.1 Clip asset usage

- [ ] Make clips first-class presentation assets.
- [ ] Ensure clip slides behave cleanly in the presentation editor and player.
- [ ] Keep presentation as a consumer of clip analysis, not a place where clips are authored.

### 9.2 Source browsing

- [ ] Improve presentation browsing to support:
  - still/tag view
  - still/chronological view
  - later clip-centered view
- [ ] Make sure this browsing model aligns with derived clip/still relationship rather than explicit linking.

### 9.3 Match-video relationship

- [ ] Leave `match_video` conceptually as a supporting effect.
- [ ] Avoid reshaping the clip model around presentation transition behavior.

---

## 10. `trackers` repo adoption

### 10.1 Immediate use

- [ ] Keep using `trackers` as the main demo / experimentation repo for CV work.
- [ ] Use it to validate tracker and calibration choices without destabilizing `annotate`.

### 10.2 Selective adoption

- [ ] Pull in reusable tracker-core pieces first.
- [ ] Pull in calibration/provider abstractions second.
- [ ] Pull in projection and smoothing utilities where they clearly reduce duplication.

### 10.3 Boundary protection

- [ ] Do not move correction UX into `trackers`.
- [ ] Do not move clip schema into `trackers`.
- [ ] Do not move app-specific sidecar route contracts into `trackers`.

---

## 11. Verification checklist

### 11.1 Domain verification

- [ ] Confirm duplicate still prevention works in all still-creation entrypoints.
- [ ] Confirm clip/still relationship is purely derived in UI behavior.
- [ ] Confirm clip import works from one still at a time.

### 11.2 Editor verification

- [ ] Manual test: create clip, add annotations, scrub, save, reload.
- [ ] Manual test: import still annotations into clip.
- [ ] Manual test: edit imported annotations and verify save/load.
- [ ] Manual test: clip with many in-bounds stills remains usable.

### 11.3 Tracking verification

- [ ] Manual test: seed tracking on a player and inspect result.
- [ ] Manual test: correct a bad frame and retrack from there.
- [ ] Manual test: retrack only a bounded range.
- [ ] Manual test: long loss produces hidden span instead of fake continuity.
- [ ] Manual test: undo after retrack restores prior state.

### 11.4 Homography verification

- [ ] Manual test: compute homography for a clip and use pitch-space annotations.
- [ ] Manual test: calibration gaps are handled acceptably.
- [ ] Manual test: projection still looks correct after scrub and playback.

### 11.5 Presentation verification

- [ ] Manual test: add clip slides to a presentation.
- [ ] Manual test: combine clips and stills in a single deck.
- [ ] Manual test: presentation browsing still makes sense once clips become important.

---

## 12. Sequencing recommendation

If work needs to be sequenced strictly, the recommended order is:

1. Domain invariants
2. In-bounds still surfacing
3. Still-to-clip import
4. Clip editor polish
5. Tracking correction hardening
6. Tracker-core refactor toward `trackers`
7. Calibration/provider refactor toward `trackers`
8. Presentation integration improvements

This order keeps the product model coherent while also focusing on the highest-value user workflows first.
