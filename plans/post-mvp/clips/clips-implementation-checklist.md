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

- [x] Review the stills/clips page layout with the newer clip-first workflow in mind.
- [x] Decide whether clips remain primarily surfaced on the stills page or need a more dedicated entry pattern later.
Current stance: keep clips primarily surfaced on the stills page for now, but make the selected-video scope explicit and revisit a dedicated clip browser only when cross-video browsing becomes a real pain point.
- [x] Improve clip card metadata so sequence work is easier to scan quickly.
- [x] Verify clip creation flows work cleanly when multiple videos are present.
Current implementation: the stills page and new-clip modal now make the current-video scope explicit, clip cards surface duration / bounds / annotation counts / in-bounds still counts more clearly, and clip creation can pull start or end times directly from the current player position when manual bounds are being used.

### 2.3 In-bounds still surfacing

- [x] Surface all stills within clip bounds automatically inside the clip editor.
- [x] Order surfaced stills chronologically.
- [x] Decide UI treatment for surfaced stills:
  - inline timeline markers
  - side rail
  - filmstrip
  - inspector/browser section
Current implementation uses a dedicated in-editor still browser strip for in-bounds stills only, ordered chronologically, with click-to-jump and explicit import actions.
- [x] Make it obvious which stills are within bounds vs outside the clip.
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
Current behavior: import uses the still's default annotation set when available and otherwise the first available saved set, regenerates clip annotation IDs, and flattens perspective-backed still shapes into image-space clip annotations where needed.

### 3.3 Conflict handling

- [x] Decide what happens if the clip already has annotations of the same apparent semantic role at that frame.
- [x] Choose initial behavior:
  - append imported annotations
  - replace selected annotations
  - user chooses merge mode
Current behavior: still import does not attempt semantic matching or replacement. If the clip already has annotations at the target frame, the imported annotations are appended as additional manual annotations and the UI makes that explicit.
- [x] Add tests for repeated import into the same clip frame.

---

## 4. Clip editor core polish

### 4.1 Editing baseline

- [x] Basic keyframed annotation editing exists.
- [x] Timeline strip exists.
- [x] Manual creation/editing exists.

### 4.2 UX polish

- [x] Review the clip editor against the "After Effects lite for tactical analysis" target.
- [x] Improve toolbar clarity and tool affordances.
- [x] Improve selection state visibility for annotations and keyframes.
- [x] Make keyframe editing less fiddly where needed.
- Current implementation: the clip page now exposes a clearer tool palette with per-tool hints, the editor shows a dedicated selected-annotation status strip, selected shapes/keyframes are more visibly emphasized, and current-frame keyframe actions (`KF Here`, `Delete KF`) make timeline editing less fiddly.
- [x] Add missing tactical tool presets once the shared annotation language expands.
Current implementation: the clip editor now supports `shadow` and `lob` as first-class tactical tools, with schema/interpolation/import/rendering support so those shapes can be created directly in clips and imported from stills.

### 4.3 Playback context

- [x] Basic playback, pause, and frame step exist.
- [x] Improve local shuttle/scrub ergonomics for analysis.
- [x] Consider short-loop playback around the current frame.
- [x] Keep the clip editor out of full NLE territory.
Current implementation: the clip transport now adds short analysis-oriented shuttle jumps (`250 ms` and `1 s`) plus a simple local loop around the current frame with timeline feedback, while still avoiding broader NLE-style timeline editing.
- [x] Treat frame holds / dwell behavior as later work, not a prerequisite.
Current stance: dwell / hold behavior remains deferred and is not required for the current clip-analysis editing model.

### 4.4 Save / undo / safety

- [x] Auto-save exists.
- [x] Verify save behavior is robust during rapid keyframe edits.
- [x] Verify undo/redo coverage for all major clip-editing actions.
- [x] Add tests for import, retrack, range replace, and delete flows.
Current implementation: clip editor save/history/tracking merge logic now runs through shared helpers in [editorState.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/editorState.ts), with targeted tests in [editorState.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/editorState.test.ts). Import coverage continues to live in [stillImport.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/stillImport.test.ts), the re-track range merge now correctly normalizes bounded replacement behavior, and major clip-editor flows now also have end-to-end coverage in [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts).

---

## 5. Tracking integration

### 5.1 Current baseline

- [x] `annotate` already has a local `/track` route and tracking client flow.
- [x] Clip keyframes already support tracked output and `visible: false`.

### 5.2 Tracker-core refactor toward `trackers`

- [x] Refactor [tracker.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/tracker.py) into a thinner app adapter.
- [x] Move low-level tracker ownership toward `trackers` primitives rather than bespoke `annotate` logic.
- [x] Keep `/track` request and response shapes stable for the webapp.
- [x] Keep `videoRef` handling and path resolution inside `annotate`.
- [x] Decide whether first step is:
  - vendoring selected `trackers` modules, or
  - making `trackers` a sidecar dependency
Current implementation: the first step is vendoring selected tracking-core primitives into [vendor/trackers](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/vendor/trackers). [tracker.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/tracker.py) now acts as the annotate-owned adapter that keeps seed-match semantics and `/track` response shaping stable, while the vendored core owns model loading, frame sampling, and Ultralytics/ByteTrack execution. Backend coverage for the adapter and route now lives in [test_tracker_service.py](/Users/patrickkang/Documents/code/annotate/sidecar/tests/test_tracker_service.py) and [test_track_route.py](/Users/patrickkang/Documents/code/annotate/sidecar/tests/test_track_route.py).

### 5.3 Tracker configuration

- [x] Expose or centralize the practical tracker defaults you want to use.
- [x] Decide where tracker tuning belongs:
  - `annotate` sidecar config
  - `trackers` config
  - both, with app-level overrides
- [x] Record the chosen defaults in one place.
Current implementation: practical tracker defaults now live in [tracking.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/config/tracking.py), exposed via `/health` and used by `/track` whenever request-level overrides are omitted. The chosen stance is `both, with app-level overrides`: the vendored tracker core can keep low-level implementation details, while `annotate` sidecar owns the practical app defaults (`backend`, detector model, sampling FPS, classes, confidence / IoU thresholds, and track-buffer policy). Request fields remain explicit per-call overrides. Coverage now lives in [test_tracking_config.py](/Users/patrickkang/Documents/code/annotate/sidecar/tests/test_tracking_config.py) and the updated [test_track_route.py](/Users/patrickkang/Documents/code/annotate/sidecar/tests/test_track_route.py).

---

## 6. Tracking correction and retracking

### 6.1 Correction UX

- [x] Make correction points explicit enough in the clip editor.
- [x] Show clearly when an annotation span came from tracking vs manual edits.
- [x] Show where the tracker lost the object.
- [x] Make corrected keyframes visually distinct enough to inspect.

Current implementation: clip keyframes now carry lightweight provenance (`manual`, `tracked`, `correction`, `lost`) in [clip.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/types/clip.ts), with derived helpers in [trackingState.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/trackingState.ts). The clip editor surfaces this in three places: a status badge / summary strip in [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx), provenance-colored selection treatment in the same editor, and timeline markers / lost-span bands in [TimelineStrip.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/TimelineStrip.tsx). Tracking conversions and still import now stamp provenance explicitly in [bboxConvert.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/bboxConvert.ts) and [stillImport.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/stillImport.ts), with coverage in [trackingState.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/trackingState.test.ts), [bboxConvert.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/bboxConvert.test.ts), [editorState.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/editorState.test.ts), and the end-to-end [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts).

### 6.2 Re-track actions

- [x] Re-track from here exists in some form.
- [x] Re-track range exists in some form.
- [x] Verify the current flows preserve good spans exactly as intended.
- [x] Add "re-track to next correction" semantics if that is not already modeled cleanly.
- [x] Make range selection for retrack more discoverable and less fiddly.

Current implementation: retrack merging is now verified in both pure state logic and the browser flow. The core merge rules live in [editorState.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/editorState.ts), where `forward`, `range`, and `to_correction` now preserve good spans intentionally. In [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx), the editor now exposes three partial repair actions directly: `Re-track →`, `Re-track range`, and `To Next Correction`. Range selection is no longer only a hidden Shift-click affordance: the user can explicitly `Mark Range End`, see the active range, and `Clear Range`, while Shift-click on the timeline still works as a faster alternate path. Verification was strengthened in [editorState.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/editorState.test.ts) and [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts), including exact preserved keyframe/provenance expectations and a browser regression check for the range-boundary merge bug that was fixed during this pass.

### 6.3 Gap policy

- [x] Define the actual threshold policy for short-gap interpolation vs hiding.
- [x] Bias initial implementation toward conservative hiding.
- [x] Ensure `visible: false` spans are cleanly represented in editor and playback.
- [x] Add tests for:
  - short gap interpolation
  - long gap hidden span
  - correction after hidden span
  - retrack replacing only the targeted span

Current implementation: gap handling now lives in shared runtime helpers instead of new persisted schema. In [trackingState.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/trackingState.ts), tracked/corrected annotations now use a conservative short-gap threshold of `min(250ms, 6 frames)` via `getTrackingGapThresholdMs()`. Longer tracking-related gaps become runtime hidden spans through `getHiddenSpans()`, while manual-only annotations still interpolate freely. Playback and editor rendering now consume this through [interpolation.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/interpolation.ts) and the clip editor / timeline UI in [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx) and [TimelineStrip.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/TimelineStrip.tsx). Coverage now includes short-gap continuity, long-gap hiding, correction-after-hidden behavior, and targeted retrack preservation in [trackingState.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/trackingState.test.ts), [interpolation.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/interpolation.test.ts), [editorState.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/editorState.test.ts), and [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts).

### 6.4 Span reasoning

- [x] Keep persisted clip schema simple.
- [x] Add richer runtime span reasoning in editor logic if needed.
- [x] Only add persisted tracking span metadata later if it becomes clearly necessary.

Current implementation: the persisted clip file remains flat keyframes plus per-keyframe provenance in [clip.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/types/clip.ts); no new stored span objects were added. Instead, richer span reasoning now happens at runtime through the hidden-span / next-correction helpers in [trackingState.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/trackingState.ts) and the annotation-aware interpolation wrapper in [interpolation.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/interpolation.ts). That gives the editor enough structure to reason about stitched tracked spans, correction boundaries, and hidden gaps without locking us into a heavier persisted schema prematurely.

---

## 7. Homography and pitch-space support

### 7.1 Current baseline

- [x] `annotate` already has homography routes and cache infrastructure.
- [x] Pitch-space support exists in some form.

### 7.2 Provider refactor toward `trackers`

- [x] Introduce or mirror a provider-oriented calibration layer inside `annotate`.
- [x] Mirror the `PnLCalibProvider` pattern from `trackers`.
- [x] Pull in calibration smoothing / gap-filling helpers from `trackers`.
- [x] Keep `/homography` route shape stable for the app.

Current implementation: `annotate` now has a provider-oriented calibration layer under [services/calibration](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/calibration), with a shared [CalibrationService](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/calibration/service.py), provider base classes in [base.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/calibration/base.py), and a first adapter in [legacy_narya.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/calibration/providers/legacy_narya.py). This mirrors the `PnLCalibProvider` style from `trackers` without yet switching the active provider away from the existing Narya-backed estimator. Short failed-gap smoothing now lives in [smoothing.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/calibration/smoothing.py), the live [homography.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/routes/homography.py) route now runs through the shared service while preserving the existing app JSON shape, and `/health` now exposes the active homography provider metadata via [health.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/routes/health.py). Coverage now lives in [test_calibration_service.py](/Users/patrickkang/Documents/code/annotate/sidecar/tests/test_calibration_service.py) and [test_homography_route.py](/Users/patrickkang/Documents/code/annotate/sidecar/tests/test_homography_route.py).

### 7.3 Pitch-space authoring

- [x] Verify pitch/image projection math is shared and not duplicated.
- [x] Improve pitch-space annotation workflows in the clip editor.
- [x] Decide how pitch-space and image-space tools should coexist in the UI.
- [x] Add tests for projection correctness at clip playback time.

Current implementation: pitch projection math for clip playback and pitch-space creation now runs through shared helpers in [pitchProjection.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/pitchProjection.ts) rather than remaining duplicated inline in [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx). The clip editor now uses the same shared projection path for pitch-space bounds and on-frame rendering, pitch-space `lob` creation/rendering is supported alongside the existing pitch-capable tools, and the UI now distinguishes the preferred draw mode from the effective one by surfacing when pitch drawing is selected but the current frame or current tool forces a fallback to image-space creation. Projection correctness is covered in [pitchProjection.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/pitchProjection.test.ts), with the broader clip authoring flow still covered by [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts).

---

## 8. Segmentation / occlusion

### 8.1 Current baseline

- [x] Segmentation route and occlusion compositor exist.

### 8.2 Product fit

- [-] Re-evaluate whether current occlusion behavior is actually helpful in real clip analysis workflows.
- [-] Improve the paused-frame occlusion workflow if it proves valuable.
- [x] Keep this subordinate to core clip editing and tracking correction.
Current state: occlusion remains a paused-frame-only assist, not a core editing primitive. The clip editor now surfaces explicit occlusion status text in [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx), and the paused-frame behavior has browser coverage in [clip-occlusion.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-occlusion.spec.ts). Real product-fit judgment is still deferred to later hands-on use.

### 8.3 Future use

- [-] Consider whether segmentation should later help with:
  - highlight assist
  - player silhouette-based visuals
  - better foreground layering in exports
Current stance: these remain intentionally deferred. No new segmentation responsibilities were added beyond paused-frame foreground occlusion, so core clip editing and tracking correction remain the priority.

---

## 9. Presentation integration

### 9.1 Clip asset usage

- [x] Make clips first-class presentation assets.
- [x] Ensure clip slides behave cleanly in the presentation editor and player.
- [x] Keep presentation as a consumer of clip analysis, not a place where clips are authored.
Current implementation: presentations can insert clip slides directly via [PresentationAuthoringEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/presentation/PresentationAuthoringEditor.tsx), [PresentationAssetBrowser.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/presentation/PresentationAssetBrowser.tsx), and `createClipSlide()` in [authoring.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/presentation/authoring.ts). The presentation browser exposes clips as consumable assets only; no clip authoring controls were added there. Browser coverage now lives in [presentation-clips.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-clips.spec.ts).

### 9.2 Source browsing

- [x] Improve presentation browsing to support:
  - still/tag view
  - still/chronological view
  - later clip-centered view
- [x] Make sure this browsing model aligns with derived clip/still relationship rather than explicit linking.
Current implementation: the asset browser now supports tag-bucket, chronological, and clip-centered still browsing. Clip-centered grouping is derived on read from clip bounds via `listStillsWithinClipBounds()` in [stillRelationship.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/stillRelationship.ts) and `buildClipCenteredStillGroups()` in [authoring.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/presentation/authoring.ts), not from stored clip-to-still links. Browser coverage lives in [presentation-clips.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-clips.spec.ts) and unit coverage in [authoring.test.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/presentation/authoring.test.ts).

### 9.3 Match-video relationship

- [x] Leave `match_video` conceptually as a supporting effect.
- [x] Avoid reshaping the clip model around presentation transition behavior.
Current implementation: `match_video` remains a presentation transition mode in [authoring.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/presentation/authoring.ts) and the presentation editor/player flow; it does not add new clip ownership or clip authoring semantics. Browser coverage lives in [presentation-present.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-present.spec.ts) and [presentation-transition-preview.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-transition-preview.spec.ts).

---

## 10. `trackers` repo adoption

### 10.1 Immediate use

- [x] Keep using `trackers` as the main demo / experimentation repo for CV work.
- [x] Use it to validate tracker and calibration choices without destabilizing `annotate`.
Current stance: `trackers` remains the experimentation/demo repo, while `annotate` only vendors or mirrors the pieces it needs. This matches [trackers-repo-integration-map.md](/Users/patrickkang/Documents/code/annotate/plans/post-mvp/clips/trackers-repo-integration-map.md) and avoids destabilizing app-level workflows while CV work continues separately.

### 10.2 Selective adoption

- [x] Pull in reusable tracker-core pieces first.
- [x] Pull in calibration/provider abstractions second.
- [x] Pull in projection and smoothing utilities where they clearly reduce duplication.
Current implementation: reusable tracker-core code now lives under [vendor/trackers](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/vendor/trackers), calibration/provider abstractions live under [services/calibration](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/services/calibration), and shared clip-side projection logic now lives in [pitchProjection.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/clip/pitchProjection.ts). This matches the intended selective-adoption sequence rather than importing the whole repo wholesale.

### 10.3 Boundary protection

- [x] Do not move correction UX into `trackers`.
- [x] Do not move clip schema into `trackers`.
- [x] Do not move app-specific sidecar route contracts into `trackers`.
Current implementation: correction UX remains in [ClipEditor.tsx](/Users/patrickkang/Documents/code/annotate/webapp/components/clip/ClipEditor.tsx) and related webapp helpers, clip schema remains in [clip.ts](/Users/patrickkang/Documents/code/annotate/webapp/lib/types/clip.ts), and app-specific route contracts stay in [track.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/routes/track.py) and [homography.py](/Users/patrickkang/Documents/code/annotate/sidecar/annotate_sidecar/routes/homography.py).

---

## 11. Verification checklist

### 11.1 Domain verification

- [-] Confirm duplicate still prevention works in all still-creation entrypoints.
- [-] Confirm clip/still relationship is purely derived in UI behavior.
- [-] Confirm clip import works from one still at a time.
Current verification: duplicate prevention already has unit/integration coverage, and browser coverage now includes presentation mark materialization reuse in [presentation-domain.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-domain.spec.ts). Derived clip/still browsing is browser-covered in [presentation-clips.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-clips.spec.ts), and one-still-at-a-time clip import is browser-covered in [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts) plus persistence/reload coverage in [clip-save-reload.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-save-reload.spec.ts). These are intentionally marked partial until broader real-world/manual verification is done.

### 11.2 Editor verification

- [-] Manual test: create clip, add annotations, scrub, save, reload.
- [-] Manual test: import still annotations into clip.
- [-] Manual test: edit imported annotations and verify save/load.
- [ ] Manual test: clip with many in-bounds stills remains usable.
Current browser coverage: [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts) covers create/edit/scrub/save-oriented flows, and [clip-save-reload.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-save-reload.spec.ts) now covers import persistence across reload. The many-stills usability case still needs a more realistic fixture or a real manual pass.

### 11.3 Tracking verification

- [-] Manual test: seed tracking on a player and inspect result.
- [-] Manual test: correct a bad frame and retrack from there.
- [-] Manual test: retrack only a bounded range.
- [-] Manual test: long loss produces hidden span instead of fake continuity.
- [-] Manual test: undo after retrack restores prior state.
Current browser coverage: [clip-editor.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-editor.spec.ts) covers seeded tracking, forward retrack, bounded retrack, retrack-to-next-correction, and history behavior around editing/tracking flows. Long-loss handling is still more strongly covered in unit tests than in browser visuals, so these remain partial rather than complete.

### 11.4 Homography verification

- [-] Manual test: compute homography for a clip and use pitch-space annotations.
- [ ] Manual test: calibration gaps are handled acceptably.
- [-] Manual test: projection still looks correct after scrub and playback.
Current browser coverage: [clip-homography.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/clip-homography.spec.ts) covers homography computation, cached homography persistence, pitch-space authoring, and a basic scrub check after homography is loaded. Calibration-gap quality still needs real visual/manual judgment.

### 11.5 Presentation verification

- [-] Manual test: add clip slides to a presentation.
- [-] Manual test: combine clips and stills in a single deck.
- [-] Manual test: presentation browsing still makes sense once clips become important.
Current browser coverage: [presentation-clips.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-clips.spec.ts) covers clip insertion, still insertion, and clip-centered browsing; [presentation-retrieval.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-retrieval.spec.ts), [presentation-present.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-present.spec.ts), and [presentation-transition-preview.spec.ts](/Users/patrickkang/Documents/code/annotate/webapp/e2e/presentation-transition-preview.spec.ts) continue to cover the surrounding presentation playback flows. These remain partial until a real manual deck-building pass is done.

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
