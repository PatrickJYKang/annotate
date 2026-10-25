# Demo Storyboards

Updated: 2026-10-23. Companions: [recording inventory](demo-recording-checklist.md), [handoff](demo-recording-handoff.md), and [capture/editing workflow](demo-recording-workflow.md). All twelve requested tutorials are recorded and published in four languages. The sequences below describe the actual exports, replacing the broader original proposals. Pin context/sets and installation were dropped. Session `RECORDING-NOTES.txt` files preserve detailed take information; current publication status is in the handoff. No capture or input logging is enabled by this document.

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

The source is `$HOME/Downloads/Tottenham Hotspur vs. Chelsea FC 2014-2015 Footballia.mp4`. The basic pin is at source frame 750, with blue highlights on the Chelsea carrier and near-side outlet. Basic tracking uses f548-800. Correction and refinements use Patrick's f10579-10829 passage; the named players in refinements are Willian (blue) and Bentaleb (white), with Latin-script names in every language. Capture/tagging follows Patrick's f11910-13105 passage. Clip editing and homography use f12955-13104. These are source-frame references, not tracker IDs.

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

Status: recorded and published in four languages, about 113-116 seconds. Guide ID: `first-project`. The export ends at the blank pin editor, not a finished presentation.

| Shot | Recorded sequence | Visible result |
| --- | --- | --- |
| Setup | Click **Create New Project**, fill the setup fields, and confirm the destination folder. | The project opens. |
| Import | Click **Import video...**, use the agreed source, and retain the whole import interval. | Processing and completion, with the waiting section labelled 20x. |
| Capture | Open the capture player, click **Possession**, start playback, and select a modifier. | The active tag and live clip range. |
| Finish capture | Continue the passage, click **Possession** again, and pause playback. | A saved clip. The middle passage is labelled 3x; football time is not cut out. |
| Open editor | Select the captured clip and click **Open editor**. | The native clip editor window. |
| Add pin | At the demonstration frame, click **Add pin**. | The separate pin editor, ready to annotate. |

Project/video chooser paths are preselected for the demo workflow; do not present it as a tutorial on navigating arbitrary filesystem locations. Drawing and presentation are covered by separate published tutorials.

## 2a. Basic player tracking

Status: recorded in four languages, about 40 seconds. Clip f548-800, Chelsea #2, Stop near f777, then normal-speed playback. No timelapse was needed. The starting state is an untracked disposable clip.

| Shot | Click/action sequence | Result to hold on screen |
| --- | --- | --- |
| Find candidates | Click **Track**. | Provisional player highlights are visible. |
| Choose player | Click A's provisional highlight. | One target is selected, before tracking begins. |
| Start | Click **Start**. | The other provisional candidates disappear; video and tracked timeline frames advance with the actual tracker. |
| Follow | Let the tracker run through a short readable movement. | The chosen player remains identifiable. Label any accelerated processing, without skipping its interval. |
| Finish | Click **Stop**. | Tracking finishes and the playhead returns to where this track started. |
| Inspect | Play the result at normal speed, with the pointer parked away from the player. | The viewer can judge that the highlight follows the intended player. |

The captions give operating instructions. Homography, naming, linked shapes, and correction are not part of this basic video.

## 2b. Correct a track

Status: recorded in four languages, about 97-99 seconds. Guide ID: `tracking-correction`. On Patrick's f10579-10829 passage, tracking the white player jumps to the blue player at f10687. Captions identify the players by shirt color. The Cancel branch was not recorded.

1. Show the genuine wrong-player result, then step back to the last correct frame, f10686.
2. Select the highlight and click **Re-track from here**. The following track is provisionally replaced.
3. Choose the correct provisional candidate and continue. After the next loss, step forward one frame, choose the player again, and click **Continue**.
4. Finish with **Done** and play the repaired passage at normal speed. The caption acknowledges that correction may need repeating.

The loss and reacquisition are real, not staged by damaging data. For a retake after tracking changes, preflight the passage again: an old error is not guaranteed to recur in a new build.

## 3. Build and play a presentation

Status: recorded in four languages, about 72-77 seconds. Guide ID: `presentation-authoring`. The starting state has one clip, two prepared annotated pins, and an empty presentation. Patrick's final deck is title, clip with a pause at P1, and a direct P2 pin slide. P2 has a blue box and dashed white lob.

1. From the dashboard, create and open a presentation. Give it a short descriptive title.
2. Click the clip in the asset browser to preview it; hold on the still-empty deck so the preview/add distinction is clear.
3. Drag the clip into the deck, then add P2 after it. P1 is a pause inside the clip, not an additional direct pin slide.
4. Click **Add title**, enter a short title, and drag that card to the front. Skip alternative templates in the main take.
5. Select the clip slide. Leave P1 included as a pause point and use a manual-resume pause for this example, rather than an auto-resume timeout.
6. Click **Present**, advance from the title to the clip, and let it play into P1. Show clip objects yielding to the pin annotation.
7. Click once for the prepared on-click annotation entrance; wait for it to finish. Click again to resume the clip after the pending sequence has completed.
8. Advance to P2 and exit Present. Match video transitions and reordering beyond moving the title were not recorded.

Proof: the same deck plays without authoring panels, the pin sequence responds to clicks, and playback resumes rather than getting stuck at the pin.

## 4. Capture, overlap, and re-tag

Status: recorded in four languages, about 77 seconds, as one continuous normal-speed take. The starting state is a disposable clone with an empty clip list. The passage reproduces Patrick's tagging at f11910-13105; Tottenham is the project's offensive team.

1. Start playback just before the passage and start/stop the possession tiles at Patrick's frame boundaries. Add **Middle third** to the early possession captures.
2. Show overlapping Offensive and Defensive Possession ranges, followed later by Defensive Transition and Defensive Possession. No Pass capture was used in the final take.
3. Pause after the passage, then click the fourth clip on the timeline.
4. Click **Re-tag selected**, choose Offensive set piece > **Throw in** with Outcome **Turnover**, and confirm.
5. Scroll the list to the Throw in grouping and drag timeline zoom to approximately x4.

The recorded build keeps the old clip name after re-tagging, permits the overlapping captures, and saves English clip names even in localized takes. These are observations #1, #2, and #13, not behavior corrected for the video. The working tree now addresses all three, pending packaged verification: generated names follow re-tagging, the default possession buttons switch exclusively while unrelated captures can overlap, and new captures use the displayed label at capture start. Retake the affected segments after verification, using a Pass within a Possession to demonstrate intentional overlap and showing localized generated names in the non-English takes. There is no on-camera language switch.

## 5. Edit and trim a clip

Status: recorded as two tutorials in four languages. Clip editing is about 63 seconds on f12955-13104, with box keyframes at f12955/f13079. Clip trimming is a separate 25.8-second take. Both use disposable clips; the editing tutorial uses image-space geometry.

1. At F1 choose **Box**, drag a small rectangle over the agreed area, and show its first position keyframe in the timeline.
2. Step forward with Right, then scrub to a visibly later frame. Move the box to the second agreed position. Show the new keyframe and a short playback between the two positions.
3. Pause, select the box, drag a resize handle and then its rotation handle. Show that these are geometry edits at the current frame.
4. Add a circle and select it with the box using Shift-click. Change shared **Fill Opacity** and **Width**. Color-picker interaction was not recorded because the native panel could not be captured reliably.
5. Click **Trim** and drag each boundary inward by a modest amount. Show the impact summary before choosing **Apply trim**.
6. Click **Undo trim** immediately and show the original bounds returning. Cancel and outward extension are not demonstrated.

Proof: frame-snapped geometry changes and a reversible inward trim. Avoid cutting away during the important handle gesture.

The source fix for #14 removes the initial default-size Box/Circle flash without changing click placement or final drag geometry. After packaged verification, retake only drawing gestures where that old flash is visible. The published clips have not been replaced.

## 6. Name highlights and attach tactical shapes

Status: recorded in four languages, about 42 seconds, with Patrick's corrected tracks on f10579-10829. The two players are Willian and Bentaleb, named in Latin script in every language. Patrick requested all four versions together, without a separate English approval step.

1. At f10739 select Willian's blue highlight, enter **Willian**, enable **Display name**, and set **Text size** to 20 using the arrow keys.
2. Repeat for Bentaleb's white highlight with the name **Bentaleb** and size 20.
3. Choose **Arrow**, click Willian's highlight, then Bentaleb's. Return to Select and clear the selection.
4. Skip back to f10689 and play to f10790. The names and attached arrow follow the players.

The recorded build uses text-size arrow keys to work around issue #15; direct typing is not demonstrated. The source fix now allows typing the complete number and committing with Enter or blur, in both editors. That fix alone does not require replacing these takes, but use direct entry plus Enter if re-recording them. There is no poly, third player, extra tracked span, or merge in this video.

## 7. Calibrate and draw on the pitch

Status: recorded in four languages, about 47 seconds, on f12955-13104 with no cached homography in the disposable starting copy. Captions name the homography and controls without a technical explanation, as requested by Patrick.

1. Click **Compute H** and show the computation with a 2x speed badge.
2. Once complete, click **Show H**. Show the grid aligned with visible pitch markings; reject a poor result rather than presenting it as correct.
3. With **Draw: pitch**, draw a box and resize it using a corner handle.
4. Turn off the grid and play through camera motion. Pause on the projected box staying on the pitch plane.
5. Pause at f13056. Delete H, rotation, and an image-space comparison were not recorded.

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

Status: recorded in four languages, about 61 seconds. The starting state reuses the presentation tutorial's P1 with its old animation removed: a blue highlight, white highlight, and attached blue arrow. No poly is involved.

1. Open the pin, then **Animations**.
2. Select the blue highlight and **Add** the default **Fade / On click** entrance.
3. Select the arrow and **Add**, then change Effect to **Wipe** and Trigger to **After previous**.
4. Select the white highlight and **Add** the default **Fade / On click** entrance.
5. Click **Preview**, then **Next** for the blue highlight and following arrow. Click **Next** again for the white highlight.
6. Stop preview, **Save**, and **Close pin**. Return focus to the clip editor, skip back, and play into the pin pause.
7. Use Play for the first cue, click the video for the second cue, then click again to resume the clip. Pause before P2.

This demonstrates cue groups and shared playback behavior. Explicit duration/delay editing, Grow, Reset, and a With previous comparison were not recorded.

## 10. Export and recover

Status: recorded in four languages, about 47 seconds; Finder remains in the system language. App and Finder windows are recorded together, with Finder driven by AppleScript and a synthetic pointer. The take uses a disposable project and ends on the folder containing it.

1. Return to the dashboard and click **Export report...**. Show real progress and the completion message.
2. In Finder open the demo project and `exports/report/`. Show the CSV/JSON files and annotated PNGs in list and gallery views. This is an OS action, not an app Reveal exports button.
3. Hold on the annotation preview so the saved result is readable.
4. Return to the capture player, delete clip f9438-9940, then immediately **Undo delete**. Show the clip returning.
5. End on the project folder with the reminder to back up the whole folder. Video deletion and an integrity-report demonstration were not recorded.

Proof: actual files created on disk, a readable annotation export, and the correct limits of deletion recovery. Do not imply MP4 clip export exists in the current UI.

## 11. Install and launch

Dropped: Patrick decided on 2026-10-07 that installation does not need recording.

## Next action

See the [handoff](demo-recording-handoff.md). All requested topics are recorded; pin context/sets and installation were dropped. Review the 15 app observations individually next. For any resulting retake, verify the new behavior first and record English for approval before localization unless Patrick requests otherwise.

Later, a 30-45 second outreach montage for `@annotate_app` can reuse tutorial footage without another end-to-end session, following the footage plan in the handoff. The online guide is already published; an outreach post is a separate task.
