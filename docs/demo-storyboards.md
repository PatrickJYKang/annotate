# Demo Storyboards

Updated: 2026-10-06. Companions: [recording inventory](demo-recording-checklist.md) and [capture/editing workflow](demo-recording-workflow.md). First project, basic pin annotation, basic tracking, tracking correction, presentation authoring, and clip trimming, and export and recovery are recorded in four languages. Status lines below say what was actually recorded where it differs from the plan; the session `RECORDING-NOTES.txt` files and the [handoff](demo-recording-handoff.md) are authoritative for recorded takes. Other sections are proposed shooting instructions, not completed recordings. No capture process or input logging is enabled by this document.

## Recommended division of work

Patrick directs the football analysis: select the passage, identify the players, specify the tactical point, and approve the result. The assistant prepares disposable project copies, records repeatable UI sequences, and handles consistent captions, cuts, and exports. Patrick can perform an intricate drawing or correction directly when explaining it would take longer than doing it. Those takes should use the same capture setup and be edited with the rest, rather than forcing every gesture through automation.

For a single fluent take, Patrick will often be faster than setting up an automated replay. Automation becomes useful for repeated takes, UI-only demonstrations, revisions after the interface changes, and reducing the amount of Patrick's time spent on production. The first-project and pin pilots have now established that approach; do not build a global input recorder or script the entire series before checking the next English take.

Preflight a real passage, propose the target, and record English for review before localization. See the [handoff](demo-recording-handoff.md) for current status and next steps.

## Direction sheet

One message with a marked screenshot is enough for a simple shot. The assistant can read FPS, dimensions, and clip bounds from the project; Patrick does not need to calculate them.

```text
Project/video: [folder or file]
Passage: [clip name, source frame range, or time range]
Pin: [frame or an unambiguous screenshot from that frame]
Players: 1 = player at the marked foot point; 2 = ...; 3 = ...
Drawing: highlight 1 and 2; arrow 1 -> 2; open poly 1 -> 3 -> 2
Labels: 1 = "Ball carrier"; 2 = "Passing option"
Style: [only specify if different from our agreed defaults]
Point: [one sentence explaining what the viewer should notice]
Tracking: follow 1 from [frame] to [frame]
Correction: at [frame], player 1 is now the player marked in screenshot B
```

Mark foot locations for highlights, not the middle of the player's body. State whether a poly is open or closed and whether its points attach to highlights. For a box/shadow, mark its area or direction as well as its starting point. A second reference frame after an overlap is much more useful than a vague description of which detected player to choose. Reference coordinates belong to the visible video image, not the surrounding inspector or black bars.

A rough screen recording with spoken instructions is an alternative for complicated gestures. It can be a single unpolished pass; pauses, mistakes, and explanations are useful reference material. Do not spend time polishing a demonstration whose only purpose is to tell the assistant what to reproduce.

## Capture contract

Use the actual packaged app, real football footage, and disposable project copies. The established exports are silent 1920 x 1240 H.264 at 30 fps, with the macOS title bar removed, a small synthetic pointer and click rings, and high-contrast white-on-near-black captions. ScreenCaptureKit records native windows; Playwright controls the isolated Electron app with Patrick's approval. The physical cursor is excluded, but physical input can still interfere with a take.

Wait for actual readiness, resolve canvas coordinates against the visible video, and verify results and saved state. Preserve complete import and playback intervals; timelapse with an explicit speed badge instead of skipping them. Show finished tracking at normal speed. Idle setup cuts and native-window joins must not disguise incorrect results. Captions teach the action, not promotional claims or unnecessary explanations of the football tactic.

The [workflow](demo-recording-workflow.md) is the source for capture setup, timing transforms, localization, safety, and QA. No global keylogging, mocked CV, fake UI, or production-app changes are part of this recording process.

## Shared footage map

The source is `$HOME/Downloads/Tottenham Hotspur vs. Chelsea FC 2014-2015 Footballia.mp4`. The recorded pin is at source frame 750 (about 30 seconds), with blue highlights on the Chelsea carrier and the near-side outlet. The first-project and pin tutorials reuse that material. The later tracking passage and correction frames have not been selected; do not assume that the existing pin passage contains a suitable tracking error.

For future tutorials, fill this direction map after inspecting the footage. These symbols are placeholders, not verified frame selections or tracker IDs.

| Reference | Meaning |
| --- | --- |
| F0 | Start of the selected passage, with player A clearly visible. |
| F1 | Pin before a pass or movement; enough space to draw without obscuring the action. |
| F2 | A later pin showing the outcome. |
| F3 | Last relevant frame of the passage. |
| FL / FR | A genuine tracking loss/error and the next clearly identifiable frame, if this passage contains one. Use another passage if it does not. |
| A / B / C | Players marked by Patrick in reference screenshots; not tracker IDs or automatically inferred identities. |
| P1 / P2 | Pins at F1/F2, labeled "Before the pass" / "After the pass" only if those descriptions fit the actual footage. |

An overview may reuse finished footage from the detailed tutorials. It does not need to be performed as one uninterrupted perfect session.

## 1. First project

Status: recorded in English, French, Spanish, and Simplified Chinese, about 113-116 seconds. Intended guide slot: `first-project`, with the surrounding description adjusted to match this narrower scope when embedded. The current export ends at the blank pin editor, not a finished presentation.

| Shot | Recorded sequence | Visible result |
| --- | --- | --- |
| Setup | Click **Create New Project**, fill the setup fields, and confirm the destination folder. | The project opens. |
| Import | Click **Import video...**, use the agreed source, and retain the whole import interval. | Processing and completion, with the waiting section labelled 20x. |
| Capture | Open the capture player, click **Possession**, start playback, and select a modifier. | The active tag and live clip range. |
| Finish capture | Continue the passage, click **Possession** again, and pause playback. | A saved clip. The middle passage is labelled 3x; football time is not cut out. |
| Open editor | Select the captured clip and click **Open editor**. | The native clip editor window. |
| Add pin | At the demonstration frame, click **Add pin**. | The separate pin editor, ready to annotate. |

Project/video chooser paths are preselected for the demo workflow; do not present it as a tutorial on navigating arbitrary filesystem locations. Drawing is covered in section 8a. Presentation construction and playback remain separate, unrecorded tutorials.

## 2a. Basic player tracking

Status: recorded in four languages (about 40 s): clip f548-800, Chelsea #2, Stop near f777, normal-speed playback; no timelapse was needed. Target: 45-60 seconds. Start in an untracked disposable clip with one clearly identifiable Chelsea player at F0. Inspect the passage and confirm that target before filming; do not require a loss or overlap in this basic demonstration.

| Shot | Click/action sequence | Result to hold on screen |
| --- | --- | --- |
| Find candidates | Click **Track**. | Provisional player highlights are visible. |
| Choose player | Click A's provisional highlight. | One target is selected, before tracking begins. |
| Start | Click **Start**. | The other provisional candidates disappear; video and tracked timeline frames advance with the actual tracker. |
| Follow | Let the tracker run through a short readable movement. | The chosen player remains identifiable. Label any accelerated processing, without skipping its interval. |
| Finish | Click **Stop**. | Tracking finishes and the playhead returns to where this track started. |
| Inspect | Play the result at normal speed, with the pointer parked away from the player. | The viewer can judge that the highlight follows the intended player. |

Keep captions to operating instructions. No homography, naming, linked shapes, or staged failure is needed here. Produce English for review before repeating the same sequence in the other three languages.

## 2b. Correct a track

Status: recorded in four languages (about 97-99 s) on Patrick's passage f10579-10829: tracking the white player jumps to the blue player at f10687; fixed by stepping back to f10686, **Re-track from here**, a one-frame **Step forward** after the next loss, **Continue**, **Done**, and normal-speed playback. Captions name players by shirt colour. The Cancel branch was not recorded. Intended guide slot: `tracking-correction`. Target: 60-90 seconds if both branches below fit clearly; otherwise use separate short takes. Preflight a real wrong-player result or genuine loss and identify A on both sides of the problem. Recheck the installed build's labels and state before filming rather than executing this sequence blindly.

1. Play an existing incorrect track briefly, then pause at the last correct frame. Show the problem instead of narrating an invisible hypothetical error.
2. Select the highlight and click **Re-track from here**. Show that the following track is provisionally being replaced.
3. Choose the correct provisional candidate, then **Continue**. Show real tracking replacing the incorrect section.
4. Finish the replacement and use **Done** to keep it. Play the repaired passage at normal speed.
5. In a short separate branch, demonstrate **Cancel** restoring the old track if explaining both outcomes would obscure the main repair.

For recovery from a genuine tracking loss rather than a wrong-player tail, show the tracker stopping and candidates returning, scrub or step to FR, choose the same player, and click **Continue**. Show the interpolated gap and continued motion. Do not deliberately damage data or fabricate a loss to get that shot; choose a passage that actually demonstrates it. Patrick can identify the player after an ambiguous overlap or perform that short take directly.

## 3. Build and play a presentation

Status: recorded in four languages (about 72-77 s). Patrick's revision: the deck is title, clip (pausing at P1) and only the P2 pin slide; P2 is a blue box plus a dashed white lob. No slide reorder beyond moving the title, no Match video. Guide slot: `presentation-authoring`. Edited target: 60-90 seconds. Operator: assistant. Start with one clip, two annotated pins, and an empty presentation; the pin animations can already be prepared in tutorial 9.

1. From the dashboard, create and open a presentation. Give it a short descriptive title.
2. Click the clip in the asset browser to preview it; hold on the still-empty deck so the preview/add distinction is clear.
3. Drag the clip into the deck. Drag P1 and P2 after it. Briefly reorder a slide by dragging its thumbnail.
4. Click **Add title**, enter a short title, and drag that card to the front. Skip alternative templates in the main take.
5. Select the clip slide. Leave P1 included as a pause point and use a manual-resume pause for this example, rather than an auto-resume timeout.
6. Click **Present**, advance from the title to the clip, and let it play into P1. Show clip objects yielding to the pin annotation.
7. Click once for the prepared on-click annotation entrance; wait for it to finish. Click again to resume the clip after the pending sequence has completed.
8. Optional follow-up take: select P1's direct pin slide, choose **Match video** under **Transition after slide**, and play into the later P2 slide. Both pins must be forward-ordered and belong to the same source video. Do not force this into the main cut if it obscures the basic workflow.

Proof: the same deck plays without authoring panels, the pin sequence responds to clicks, and playback resumes rather than getting stuck at the pin.

## 4. Capture, overlap, and re-tag

Edited target: 60-90 seconds. Operator: assistant. Start in the tagging workspace with no active captures and an empty or clearly identifiable demo clip list.

1. Seek to F0 and click **Possession** under **Offensive - open play**, if that fits the passage. Pause briefly on the tile's active indicator and live timeline range.
2. While that capture is active, select an applicable modifier such as **Middle third**. Move across another primary tile on the way to show that the active capture's modifiers remain available.
3. Near the actual pass, click **Pass** to start a second capture. Choose applicable pass modifiers, then click **Pass** again at its end. Finish **Possession** later by clicking its tile again.
4. Show the overlapping saved ranges. Click one in the timeline and let its row become visible in the clip list.
5. Pause playback, select the demo clip, click **Re-tag selected**, then choose the appropriate replacement classification and modifiers. Show the updated list entry.
6. Scroll away from the playhead, then zoom in and out using the timeline gesture/controls. Keep this brief; the clip remains selected.
7. Optional five-second insert: switch English to Spanish, show **Possession** becoming **Posesión**, then return to English. Do not imply that authored custom boards or saved clip names are translated.

Proof: viewers see both the start/stop toggle and the distinction between active modifiers and editing an already saved clip.

## 5. Edit and trim a clip

Status: recorded as two tutorials in four languages. Clip editing (about 63 s, clip f12955-13104): box with keyframes at f12955/f13079, playback, resize and rotate at keyframe 2, a circle, Shift-click multi-select, shared Fill Opacity and Width (not colour: the native colour panel cannot be recorded). Clip trimming (25.8 s): steps 5-6 without Cancel. Edited target: 60-90 seconds. Operator: assistant. Start in a clip copy with clear empty space and at least a few seconds available at each end; use a simple image-space shape so this is not also a calibration tutorial.

1. At F1 choose **Box**, drag a small rectangle over the agreed area, and show its first position keyframe in the timeline.
2. Step forward with Right, then scrub to a visibly later frame. Move the box to the second agreed position. Show the new keyframe and a short playback between the two positions.
3. Pause, select the box, drag a resize handle and then its rotation handle. Show that these are geometry edits at the current frame.
4. Select a second object with Shift-click. Change a shared stroke/fill color in the inspector; show both updating. This is an object-wide style change, not a color animation.
5. Click **Trim** and drag each boundary inward by a modest amount. Show the impact summary before choosing **Apply trim**.
6. Click **Undo trim** and show the original bounds returning. Optionally show **Cancel** on a separate trim preview; do not make another clip edit before demonstrating immediate Undo.

Proof: frame-snapped geometry changes and a reversible inward trim. Avoid cutting away during the important handle gesture.

## 6. Name highlights and attach tactical shapes

Status: recorded in four languages (about 42 s) with Patrick's two tracked players on clip f10579-10829: highlights named Willian and Bentaleb (Latin script in every language), Display name, Text size 20, an arrow attached Willian -> Bentaleb, playback f10689-10790. No poly, no third player, no extend/merge. Edited target: 45-75 seconds. Operator: assistant with a marked A/B/C reference; Patrick can perform a complex poly take. Start with genuinely tracked A/B/C highlights already present at the same frame. Caption this starting state rather than pretending three targets were tracked at once.

1. Select A's highlight. Enter **Ball carrier** in **Name** if accurate, enable **Display name**, and set a readable label size.
2. Choose **Arrow**; click A's highlight, then B's highlight. Pause on the snapped preview before the second click so the attachment is visible.
3. Choose **Poly**; click the agreed highlights in order. Use **Shift+Enter** for an open unit line, or **Enter** for a closed area with at least three points. Use the shape that matches Patrick's tactical explanation.
4. Play several seconds and show the endpoints/vertices following their highlights. Keep the cursor away from the action.
5. Optional additional take: demonstrate same-type object merging with two deliberately prepared non-overlapping spans. Do not add this to the main tutorial unless the split-span workflow is being explained.

Proof: the label follows its player and the linked geometry moves with its anchors; it is not redrawn frame by frame.

## 7. Calibrate and draw on the pitch

Status: recorded in four languages (about 47 s) on clip f12955-13104: Compute H (2x badge), Show H, pitch box with a corner resize, Hide H, playback through the pan to f13056. Captions name the homography without explaining it (Patrick). Delete H and an image-space comparison shape were not recorded. Edited target: 45-60 seconds. Operator: assistant; Patrick approves the highlighted pitch area. Start with a wide-angle clip containing a modest camera pan and no cached homography in this disposable copy.

1. Click **Compute H**. Hold on preparation/loading, then the sample-count progress bar. Retain the wait as a visibly labelled timelapse if necessary.
2. Once complete, click **Show H**. Show the grid aligned with visible pitch markings; reject a poor result rather than presenting it as correct.
3. Show **Draw: pitch**. Choose **Box** and drag over the agreed pitch area; select it and adjust a size/rotation handle.
4. Turn off the grid and play through camera motion. Pause on the projected box staying on the pitch plane.
5. Optional comparison: show an image-space highlight following a player, with a caption explaining that tracking does not require H. Demonstrate **Delete H** only in a separate copy/take, not before capturing the finished playback.

Proof: actual camera-dependent projection, not just a grid over a still frame. No need to record every sampled frame of computation at normal speed.

## 8a. Basic pin annotation

Status: recorded in all four languages, about 46 seconds. Use the current `localized-v3` exports. The earlier English v2 does not include the requested Close pin ending.

1. In the clip editor at frame 750, click **Add pin**. Show the separate pin window on that exact frame.
2. Choose **Highlight**, then click at the Chelsea carrier's feet. Click again at the near-side outlet's feet. Blue is already configured; do not caption this as a color-change demonstration.
3. Choose **Arrow**. Click the first highlight, then the second, so the arrow is attached to both.
4. In the inspector, change **Style** to **Dotted**. Let the viewer see the actual changed line.
5. Return to **Select**, click empty space to clear selection, and click **Save**.
6. Click **Close pin**. Show the native child window closing and the clip editor again for a few seconds.

The captions name the actions only. Do not add an explanation that the arrow represents a possible pass. Verify both attachments, foot placement, Dotted style, and the returned clip's saved state. No shadow, context preview, alternative set, import, animation, or tracking is part of this basic export.

## 8b. Pin context and annotation sets

Dropped: Patrick does not use annotation sets (2026-10-07).

## 9. Animate a pin annotation

Status: recorded in four languages (about 61.5 s). Per Patrick, uses the presentation tutorial's P1 (blue highlight, white highlight, attached blue arrow; no poly) made static: blue Fade/On click, arrow Wipe/After previous, white Fade/On click; Preview with Next; Save, Close pin; then the cues from the pin pause in clip playback. No Reset/With previous comparison. Edited target: 60-90 seconds. Operator: assistant after the final drawing and reveal order are approved. Start with a static pin set containing a highlight, an arrow, and a poly.

1. Click **Animations** with no object selected to show that the panel opens independently.
2. Select the highlight, click **Add**, choose **Fade**, **On click**, duration **0.3 s**, and delay **0 s**.
3. Select the arrow, click **Add**, choose **Wipe**, **After previous**, duration **0.5 s**, and delay **0.2 s**.
4. Select the poly, click **Add**, choose **Grow**, **On click**, duration **0.4 s**, and delay **0 s**. These timings are proposed tutorial settings, not defaults required by the app.
5. Click **Preview**. Click the frame or **Next** once: the highlight enters and the arrow follows. Click again: the poly enters. Leave time to see the finished state.
6. Use **Reset** and change the arrow to **With previous**, delay **0 s**, to show the distinction in a short second preview. Restore the agreed final sequence before saving the take's project.
7. Stop preview, return to the clip, and play into the pin. Demonstrate that the same click sequence works at the pause, then resume playback after the final pending step.

Proof: click groups, duration/delay, and shared playback behavior. It is more useful to teach these three shapes clearly than cycle through all four effects without context.

## 10. Export and recover

Status: recorded in four languages (about 47 s; Finder stays in the system language). App main window and a Finder window are recorded together; Finder is driven by AppleScript with a synthetic pointer. Report shown in Finder list and gallery views; clip f9,438-9,940 deleted and restored in the capture player; ends on the folder containing the project. The video-deletion safety segment was not recorded. Edited target: 45-60 seconds. Operator: assistant. Start with the completed demo project, at least one annotated pin, and no unrelated Finder/File Explorer windows visible.

1. Return to the dashboard and click **Export report...**. Show real progress and the completion message.
2. In Finder/File Explorer, open the known demo project folder and `exports/report/`. Show `clips.csv`, `clips.json`, and the `annotated` folder. This is an OS action, not an unimplemented "Reveal exports" button.
3. Open one annotated PNG and pause so the native-resolution result is readable. Briefly show a report row if a suitable viewer is already available; do not require a spreadsheet app just to make the recording.
4. Return to a disposable clip, delete it, then immediately click **Undo delete**. Show the clip returning.
5. End with a caption: "Back up the whole project folder." If video deletion is explained, use a separate safety segment: its cascade permanently deletes the project video copy and dependent clips/pins, unlike clip-trash Undo. Do not demonstrate it on the master demo project.

Proof: actual files created on disk, a readable annotation export, and the correct limits of deletion recovery. Do not imply MP4 clip export exists in the current UI.

## 11. Install and launch

Dropped: Patrick decided on 2026-10-07 that installation does not need recording.

## Next action

See the [handoff](demo-recording-handoff.md). In short: all requested topics are recorded; pin sets and installation were dropped. Record English first for review each time.

Later, a 30-45 second outreach montage for `@annotate_app` can reuse approved tutorial footage without another end-to-end recording session. Publication and guide integration remain separate from local recording and editing.
