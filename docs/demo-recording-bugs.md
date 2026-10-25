# Issues Found While Recording

Updated: 2026-10-23. App bugs and behaviour questions noticed while recording the user-guide tutorials with the packaged demo build (Annotate 0.2.2-desktop.2). All fifteen observations have now been reviewed, with Patrick approving the last two fixes together. **#1, #2, #4-9 and #11-15 are implemented in the working tree, awaiting packaged verification; #3 was investigated but could not be reproduced; #10 is intentional behaviour.** Add new findings here as recording continues; mark an item shipped only after the fix is verified in the build used for recording, and note which tutorial videos would then need re-recording.

Context for recordings: [handoff](demo-recording-handoff.md). Local session folders are under `$HOME/Documents/Annotate Demos/`.

## Open

No confirmed issue from the original list remains unimplemented. #3 remains unconfirmed below; packaged verification and the associated tutorial retakes are still outstanding.

## Implemented, awaiting packaged verification

### 1. Re-tagging generated clip names

Approved on 2026-10-12: generated names follow the new primary tag; custom names stay unchanged. Implemented in the shared clip repository for browser and desktop, including drag-and-drop re-tagging. New clips record their last generated name; older clips use an exact match against the previous tag label, preserving unrecognized names. Tags and names save atomically. Regression coverage includes generated/custom names, repeated re-tagging, clearing tags, legacy documents, concurrent saves, native repository persistence, and the browser capture/re-tag flow. The working tree is not yet packaged or released.

Retake affected: the re-tagging segment of Capture and tagging, in all four languages, after packaged verification. The existing videos still show the old behaviour. Combine with the saved-name translation fix in #13.

### 2. Exclusive capture groups

Approved on 2026-10-13: retain intentional overlaps, with optional schema-defined exclusive groups separate from the visual board groups. The default board makes only Offensive Possession and Defensive Possession mutually exclusive. Starting one ends the other at the same frame boundary; a Pass or another unrelated capture continues. There are no new UI controls, one-way activation/deactivation links, or hardcoded football rules in the engine.

The previous range is saved as `[startFrame, switchFrame)` and the new range starts at `switchFrame`. Switching at the original start replaces the empty draft; switching before it leaves the original capture intact. Save failure also retains the original range and modifiers for retry. Exact older default boards receive the rule in memory without a file rewrite; custom boards and an explicit empty exclusions array keep their authored behaviour. Existing saved clips are not changed.

Regression coverage includes board validation, arbitrary groups, adjacent boundaries, overlap preservation, modifiers, same-frame/backward switches, failed saves and pending-save races, earlier default boards in all four languages, and real browser capture with mouse clicks, hotkeys, playback, persistence and a simulated disk-write failure. Packaged desktop verification remains outstanding; this is not yet released.

Retake affected: the overlap segment of Capture and tagging in all four languages. The published videos demonstrate Offensive and Defensive Possession overlapping. After packaged verification, demonstrate automatic possession switching and intentional Pass-within-Possession overlap instead, alongside the #1 re-tagging retake. No recordings have been replaced yet.

### 4. Redundant keyframes at trim boundaries

Confirmed and fixed on 2026-10-13. `trimClip.ts` inserted a real, persisted keyframe at each trim boundary unconditionally, even before the first existing keyframe or after the last. This was not a timeline positioning error. Boundary sampling now only replaces geometry removed on that side of the trim. Existing holds remain holds without an extra keyframe; cuts through animation still sample the boundary, and required hidden/lost sentinels remain intact. No timeline styling or tracking/interpolation rules changed. Previously saved boundary samples are not removed automatically because they cannot reliably be distinguished from intentional edits.

Verified before/after in Electron using disposable APFS copies of the original Tottenham v Chelsea trimming project and actual video. The old recording build saved and displayed an extra square at f10620 on both highlight lanes. The current renderer trims to `[10620, 10800)` while both first keyframes remain at f10631; the retained keyframes exactly match the original in-range data. Preview/Cancel, Apply, Undo and reopening passed without page errors, and the original demo project was not changed. Local screenshots and diagnostics are ignored under `output/playwright/trim/`. Five new unit cases cover redundant edge samples, unchanged ranges, held geometry with no original keyframes remaining, and hidden boundary state. The existing browser trim regression also passes. The desktop renderer was built and tested, but no installer/release was rebuilt.

Retake affected: Clip trimming in all four languages, after packaged verification. The existing recordings show the redundant start squares.

### 5. Capture-player selection and frame stepping

Confirmed and fixed on 2026-10-13 using the original export/recovery and capture/tagging footage on disposable project copies. Two rounding errors combined: `frame / fps` was truncated by the browser to microseconds just before the requested frame, so selecting f9438 displayed f9437; flooring the decoded frame's quantized `mediaTime` then labelled it f9436. The f12539 case similarly displayed f12538 but labelled it f12537. Step Forward could seek the same boundary again and leave the picture unchanged while updating the label optimistically. The stored FPS matches the file's rational rate (`421059/16843`); no media or metadata repair was needed.

The shared capture player now seeks to the middle of the requested frame using `frameToCenterSeconds`. Decoded-frame callbacks use `presentedTimeToVideoFrame`, which maps the timestamp to the nearest frame boundary. Arbitrary playback-clock timestamps and the no-frame-callback fallback retain floor semantics. This fix does not change saved clip ranges, pins, FPS, source media or the clip/presentation playback implementations.

Before/after Electron checks cover six actual clip starts, including f9438 and f12539, list and timeline selection, forward/backward stepping, rapid selection changes and play/pause. After the fix, decoded timestamps and readouts agree with the requested frames, with no saved clip rewrites or page errors. Diagnostics and screenshots are local and ignored under `output/playwright/seek/`. Unit coverage includes fractional FPS, microsecond timestamp quantization, long-video positions and seek centres; the browser clip-selection regression checks actual decoded-frame callbacks as well as the readout. No installer/release was rebuilt.

Retake affected: the clip-selection segments of Export and recovery and Capture and tagging in all four languages after packaged verification. Capture and tagging already needs a retake for #1/#2; combine the changes rather than recording twice.

### 6. Localized default title-slide names

Fixed on 2026-10-13. The authoring UI now supplies the localized default title when creating a slide instead of the factory hardcoding English. English, French, Spanish and Simplified Chinese have explicit catalog entries. The result is saved as ordinary authored slide text: switching language does not rewrite an existing title, including an older English default, because saved titles have no reliable generated-versus-custom distinction. No storage migration or rendering change was needed.

Verified in an isolated browser with the repository's disposable presentation fixture: create a slide in each language, inspect the title field, preview, thumbnail and present-mode rendering, switch languages, and reopen the presentation. Defaults persist in their creation language; existing and custom titles remain unchanged. Unit coverage tests all four catalog defaults and supplied/blank titles. All 428 unit tests, three existing presentation browser regressions, TypeScript and lint pass. Local verification scripts and screenshots are ignored under `output/playwright/title-locale/`. No installer/release was rebuilt.

Retake affected: the Add title segment of Presentation authoring in French, Spanish and Simplified Chinese after packaged verification. English is unchanged. Combine this with the #7 wording change rather than recording twice.

### 7. French and Spanish Exit wording

Fixed on 2026-10-13. The presentation Exit button now uses the action verbs "Quitter" in French and "Salir" in Spanish instead of the signage nouns "Sortie" and "Salida". Only `presentation.exit` changed; the separate exit-timing labels and button behaviour are unchanged. Packaged verification remains outstanding.

Retake affected: the present-mode segment of Presentation authoring in French and Spanish wherever the Exit control is visible. Combine with the #6 retake after packaged verification.

### 8. Clipped video-row actions

Reproduced and fixed on 2026-10-13. The dashboard video list used an implicit grid column whose minimum width grew to fit the filename and actions. The Analysis panel then clipped the wider row: with the recorded Tottenham filename at 1440 px, Delete extended about 16 px beyond the panel in English and 45 px in French. The list now uses an explicit `minmax(0, 1fr)` column (`grid-cols-1`), allowing the existing filename ellipsis to work while keeping Open and Delete fully visible. Hovering the truncated label shows the full filename. No deletion or navigation behaviour changed.

An isolated browser fixture passed before/after layout checks in all four languages at 900, 1024, 1280 and 1440 px. Both buttons fit inside the panel, their text fits, and their right edges remain clickable. Widening the sidebar, opening/cancelling deletion confirmation in every language, and opening the capture player and returning also passed. No video was deleted and no user project was changed. All 428 unit tests, TypeScript and lint pass. Local scripts and screenshots are ignored under `output/playwright/video-row/`; packaged verification is still outstanding.

Retake affected: dashboard shots in Export and recovery where the clipped row is visible, particularly English, French and Spanish. Combine with the #5 selection retake after packaged verification.

### 9. Singular clip frame counts

Fixed on 2026-10-13. The capture player's clip list now selects singular wording for a range containing exactly one frame: "1 frame" in English, "1 image" in French and "1 fotograma" in Spanish. Chinese retains "1 帧". Longer clips keep their existing plural wording. Frame counts still use `endFrame - startFrame`, and the displayed final frame remains `endFrame - 1`; no stored ranges or playback behaviour changed.

Verified one-frame, two-frame and 40-frame clip rows, language switching and row selection in an isolated browser fixture across all four languages, with no page errors. All 432 unit tests, TypeScript and lint pass. Local verification scripts are ignored under `output/playwright/frame-plural/`. No installer/release was rebuilt; packaged verification remains outstanding.

Retake affected: the one-frame clip-list shot in Export and recovery in English, French and Spanish. Combine with the #5/#8 retake after packaged verification; Chinese wording is unchanged.

### 11. Clip-editor initial selection and Escape deselection

Reproduced and fixed on 2026-10-13. The clip editor now opens without selecting an object. When no drawing, trim or re-track operation is in progress, Escape clears all selected objects and the selected keyframe without changing the playhead, pausing playback or closing the editor. Escape retains its existing cancellation priority for active drawing, trim and re-track operations; a subsequent press clears the selection. Text-field input and the separate pin annotator retain their own keyboard handling. Pin selection is unchanged.

Verified before/after in an isolated browser fixture. Checks cover initial state, timeline and canvas selection, multi-selection, keyframe selection, Delete after deselection, text fields, arrow/poly/box cancellation, trim/re-track cancellation, playback and the separate pin tab. The saved clip remained unchanged and there were no page errors. All 433 unit tests, nine existing clip-editor/pin browser regressions, TypeScript and lint pass. Local scripts and screenshots are ignored under `output/playwright/clip-selection/`. No installer/release was rebuilt; packaged verification remains outstanding.

Retake affected: the opening/selection segment of Clip trimming where the old automatic selection is visible. Combine with the #4 retake after packaged verification; existing Cmd-click deselection remains supported.

### 12. Ultralytics analytics and HUB defaults

Approved and implemented on 2026-10-14. A shared sidecar loader now selects an Annotate-private configuration directory and disables `sync` and `hub` before YOLO prediction callbacks load. Both health checks and model loading use it. Packaged desktop retains its existing profile location, so older profiles are corrected on next startup without replacing other settings. Source runs get their own Annotate directory instead of changing the user's general Ultralytics profile. Model downloading remains enabled. The pinned library's Sentry initialization is CLI-only and is not used by Annotate.

Real-library subprocess regressions cover fresh, existing and malformed/reset settings, preserve unrelated settings byte-for-byte, force online/non-test analytics conditions and prohibit network connections. Event collection stays disabled, HUB callbacks remain empty and model-download dispatch is still available. A separate real-footage sidecar smoke test detected 17 players, returned 26 streamed tracking keyframes and computed two homography samples from Tottenham v Chelsea with no socket connections. All 102 sidecar tests and 28 desktop tests pass with local-server and macOS video-hardware permissions. Original video/project files were not modified. No installers or release tags were changed; fresh and upgraded packaged-profile verification remains outstanding.

Retake affected: none. This changes backend privacy defaults, not the visible workflow. The original profile's enabled setting established a risk, not evidence that a particular recording session transmitted analytics.

### 13. Localized generated clip names

Fixed on 2026-10-23. Capture now snapshots the displayed tile label when a range starts, instead of taking the English source-board label. The pending timeline marker and saved clip retain that name if the language changes before capture ends. Untagged capture follows the same rule. Re-tagging, including drag-and-drop, supplies the current displayed label to the shared locked repository; only generated names change. Custom names, authored custom-board labels, stable IDs, ranges and modifiers are preserved. Existing saved names are not retroactively translated, and changing facets without changing the primary tag does not rename a clip.

Unit and native repository tests cover all four languages, language changes during capture, exclusive switching and failed-save retry, legacy generated names, repeated re-tagging, untagged labels and custom-name protection. Isolated browser checks passed for capture and untagged naming in all four languages, switching language during capture with modifiers and possession exclusion, re-tagging, drag-and-drop, custom names and persistence after reopening, with no page errors or board-file rewrites. All 443 unit tests, 29 desktop tests, six existing capture-player browser regressions, TypeScript and lint pass. Local scripts and a screenshot are ignored under `output/playwright/capture-locale/`; no user files were changed. Packaged verification remains outstanding; no installers or release tags have changed.

Retake affected: the capture and re-tagging segments of Capture and tagging in French, Spanish and Simplified Chinese. Combine with the #1/#2 retake in all four languages after packaged verification. Published recordings still show the old names.

### 14. Box/Circle drag-preview flash

Fixed on 2026-10-23. The clip editor used click-to-place dimensions in its live drag preview, flashing a centred 120 x 80 box or 100 x 60 ellipse before the pointer moved four source-image pixels. Preview geometry now starts empty and follows the actual drag extent, including small movements. Only mouse-up applies the existing default dimensions for a click/tiny gesture. Image- and pitch-mode previews still use the same conversion path as their committed shapes; other tools and stored geometry are unchanged.

Unit cases cover initial previews, sub-threshold movement, all drag directions, the placement threshold, default click dimensions and pitch conversion. Isolated browser checks over a two-second copy of Tottenham v Chelsea verify canvas pixels before/during drawing in image and pitch modes, preview/commit agreement within rasterization tolerance, click placement, cancellation and undo. The pitch-mode check uses a supplied test homography, not a new CV run. No page errors occurred and original footage/projects were untouched. Scripts and screenshots are ignored under `output/playwright/drawing-input/`. Packaged verification remains outstanding.

Retake affected: the Box/Circle drawing gestures in Clip editing in all four languages wherever the old initial flash is visible. Verify the new packaged build before replacing those segments; the current recordings have not changed.

### 15. Highlight-name text-size entry

Fixed on 2026-10-23 in both clip and pin annotation inspectors. The number field keeps a local text draft instead of clamping each keystroke and saving intermediate values. Enter or blur commits once and clamps to 8-300; empty/invalid input restores the previous size, and Escape cancels the draft without closing the pin tab or clearing object selection. Decimals and native number-input arrow stepping remain available. Selection changes commit to the old object before the next object's field is shown, and undo/external value changes synchronize the field. Font size remains an object-level style, never a geometry keyframe.

Browser checks in both editors cover replacing 25.6 with 18 digit by digit, Enter and blur, single-step undo/redo, decimal values, limits, empty and incomplete-number input, Escape and arrow stepping. Clip checks also verify selection isolation, persistence after reload and unchanged geometry keyframes. All 468 unit tests, nine existing clip/pin browser regressions, TypeScript and lint pass for #14/#15. No installers were rebuilt and nothing was committed or published in this pass.

Retake affected: no mandatory retake for Tracking refinements, which already uses working arrow-key entry rather than the broken typing path. If that segment is re-recorded, direct entry followed by Enter is now available. Existing captures remain an accurate record of the old build, not proof of packaged verification.

## Investigated, not reproduced

### 3. Reported black video after a language change

The original 2026-10-06 recording note reported a black native clip-editor window while Chromium's own screenshot still showed the video. Opening the editor after selecting the language worked around it. Patrick has not experienced this himself. Treat this as an observation with an unconfirmed trigger, not an established language-switch defect.

On 2026-10-13, the same packaged demo executable and a freshly built current desktop renderer were tested with disposable APFS copies of the original Tottenham v Chelsea recording project, using its clip at f548-800 and real match media. Both remained visible through English, French, Spanish and Simplified Chinese changes in the main window and the editor. The paused frame, video element and source URL stayed unchanged, with no media reload/error events; playback continued through language changes. The current build also passed focus/occlusion and minimize/restore checks with the original ScreenCaptureKit recorder running. Native-window screenshots showed the pitch, and a 25-second native recording contained no black interval in the tested central video region. Diagnostic artifacts are local and ignored under `output/playwright/locale/`; original demo projects were not edited.

A main-window locale change currently does not live-update an already-open editor's locale. Changing it in the editor updates that window; newly opened windows read the stored preference. The original note therefore does not establish that an editor locale update caused the blackout. No GPU/compositing or playback workaround was added, and this is not marked fixed. If it recurs, collect native capture and Chromium screenshots at the same moment, exact window/focus actions, video state, and build details before choosing a fix.

`desktop/scripts/smoke-electron.mjs` now checks all four language selections in both open windows: no video-element replacement, source change, seek/load/play/pause/error event, paused-frame change, or clip-file rewrite. This guards application media state; it does not by itself prove native compositor correctness. Native capture was checked separately as described above. No tutorial retake is required for this investigation.

## Intentional behaviour

### 10. Exporting empty annotation sets

Confirmed with Patrick on 2026-10-13: an existing annotation set with no shapes should still export a plain-frame PNG. The selected frame can be useful without drawings, so zero shapes is not a reason to omit it. Keep the existing export behaviour. This does not treat a missing or unreadable annotation document as an empty set; those remain export failures. Pins with no annotation set at all are outside this decision and keep their existing behaviour.

No app-code change or tutorial retake is needed for #10.

## Shipped

None yet.
