# Demo Recording Workflow

Updated: 2026-10-06. This records the method used for the first-project and pin-annotation tutorials, including revisions requested during review. The later 2026-10-06 tutorials (tracking, correction, presentation, trimming, export/recovery) use the same visual treatment with a shared per-session script set; the [handoff](demo-recording-handoff.md) describes that pipeline, current status, and lessons, and is the place to start. This page is not a request to start recording. See the [inventory](demo-recording-checklist.md) for current deliverables and the [storyboards](demo-storyboards.md) for completed and proposed click sequences.

## Working arrangement

Patrick chooses or approves the football passage and the analysis. The assistant can inspect the footage, suggest player placements, operate the app, and produce a first English take. Review that take before repeating it in French, Spanish, and Simplified Chinese. For ambiguous players, a marked screenshot with foot points and a second frame after an overlap is more reliable than tracker IDs. A rough spoken walkthrough is also sufficient; no polished reference video is needed.

Automation is most useful for repeated UI sequences, localization, and editing revisions. Patrick may be faster at intricate drawing or a difficult correction than explaining every gesture. Those takes should use the same framing and final cursor/caption treatment. Do not build a global keylogger to reproduce them: log only the explicit demonstration actions and their timing. A sequence of keystrokes does not describe which player was intended or whether the UI was ready.

Basic tracking, tracking correction, presentation authoring, and clip trimming have since been recorded in four languages, and export and recovery, all in four languages; see the [inventory](demo-recording-checklist.md). Do not treat the remaining storyboards as recordings already made or as standing permission to capture the desktop.

## Established visual and editing style

| Element | Current treatment |
| --- | --- |
| App | Actual packaged Electron app and native editor windows, not the development browser preview. |
| Footage | Real football footage, actual annotations, and real tracking/homography whenever those features are demonstrated. No mocked CV results or fabricated app UI. |
| Export | Silent H.264 MP4, 1920 x 1240, 30 fps, `yuv420p`, fast-start metadata. This accepted framing is not 16:9. |
| Window chrome | Crop the macOS title bar. Keep the usable app area and window framing consistent across takes and languages. |
| Cursor | Exclude the physical cursor from capture. Overlay a 32 x 43 px white pointer with a dark outline; its tip is at pixel (4, 3) within the graphic. Every shot has a pointer, including non-app windows such as Finder (Patrick's request, 2026-10-06); those are driven by script and get a logged synthetic pointer, never the real mouse. |
| Clicks | Three expanding blue/light-blue rings with dark contrast, radii 12/20/27 px, roughly 0.3 seconds total, aligned with the actual action. |
| Captions | White text on a near-black, almost opaque panel near the lower left. Pin-demo settings: 30 px type, 10 px corner radius, gray border, usually x=32/y=1080. Move it if it obscures the subject or UI. |
| Wording | Short action instructions: choose a tool, click a target, change Style, Save, Close pin. No promotional copy, unnecessary football interpretation, or excuses about controls. |
| Timing | Arrive at a control before activating it, pause long enough to identify it, then hold on the result. Park the cursor outside the action during playback. |
| Waiting | Retain the complete import and playback intervals. Accelerate with a visible speed badge rather than cutting forward over them. Show final tracking playback at normal speed. |
| Cuts | Remove idle setup and join native windows where appropriate, without concealing processing, mistakes, or changes in football time. Retain the raw takes. |
| Sound | No app audio or microphone narration in the current exports. Do not enable microphone capture unless requested. |

The first-project revision uses 20x import timelapse and 3x for the middle of the continuous playback/capture section. These are editing choices, not measured speed claims. Preserve action/cursor/caption timing through the same speed transformation. Captions appear briefly and disappear; they are not a permanent strip of narration.

The original pin pilot's yellow shapes and explanation that the arrow represented a possible pass were removed. The current example highlights Chelsea in blue (`#3b82f6`) and demonstrates an actual **Style -> Dotted** change. Blue is prepared before the drawing take; the tutorial does not claim to demonstrate a color-picker interaction that was not recorded. The final requested step is **Close pin**, visibly returning to the clip editor.

## Source and isolated starting states

Source video: `$HOME/Downloads/Tottenham Hotspur vs. Chelsea FC 2014-2015 Footballia.mp4`. The imported demo media is 1024 x 576 at approximately 25 fps. The basic pin tutorial uses source frame 750, about 30 seconds in, with a Chelsea ball carrier on the left and a near-side outlet lower in the frame. It draws two foot highlights and an arrow attached to those highlights, not a free arrow placed approximately over them.

Production artifacts live under `$HOME/Documents/Annotate Demos/`. The October 4 pin session contains an `Annotate Demo.app` copy, `app-profile/`, and `Demo project/`. They are separate from the normal installed app, the development checkout, and Patrick's working projects. Tutorial raw media and production scripts are local artifacts, not repository files or release assets; back them up separately.

Use fresh disposable starting-state copies for new topics or retakes. The localization script deletes and recreates the demonstration pin, so its project is not an immutable master. Do not reuse pin/object IDs or assume a project still contains its original blank state. Never aim that script at a real project. Prepared genuine annotations are acceptable starting states for advanced tutorials, but introduce them honestly instead of implying they were just created on camera.

Record the packaged build/version, source clip and pin frames, UI language, window dimensions, and project copy with each new take. Current session scripts encode paths and assumptions rather than providing a portable recording tool. The visual match between the recorded build and a later release must be checked before reuse; an unchanged workflow can reuse footage without another recording.

## Capture and app control

Native window recording uses a small Swift program built around ScreenCaptureKit `SCStream` and `SCRecordingOutput`. It captures the selected app window at a target 30 fps with `showsCursor`, `capturesAudio`, and `captureMicrophone` disabled. It is a macOS recording setup, not a verified Windows recorder. It does not add recording controls to the app.

For the first-project localization session, the successful recorder is `native-record` in `first-project-languages-2026-10-03/`; the older `record-window` is retained for reference only. For pin localization, use `record-localized` and its Swift source in `pin-annotation-2026-10-04/`. That recorder can list windows by process ID with `--list PID`; actual capture takes an output path and window ID. Discover both IDs for each session and again when a new pin window opens.

The recorder reports `START_WALL` with the recording-start epoch and `READY` with the selected window and dimensions. Start the action sequence only after those signals. A newline on its stdin requests stop; wait for finalization and inspect the resulting file. Stop recording processes after each take rather than leaving an ambient desktop recorder running.

Native automation could read the app's accessibility tree and screenshots but repeatedly rejected mouse actions with `noWindowsAvailable`. Some accessibility actions appeared to change an accessibility value without producing the expected React behavior. Patrick explicitly approved using Playwright to control the isolated Electron demo app instead. The saved footage still comes from the native app window, not Playwright's browser-video capture.

The working controller attaches with Playwright `chromium.connectOverCDP` to a loopback-only remote-debugging port. It uses actual renderer controls and mouse events, checking current button bounds and visible results. The pin session used port 9226; the 2026-10-06 sessions use 9227 with a per-session profile (see the handoff). Do not assume either is still available or that the app is still running. A safe launch pattern for a new isolated session is:

```bash
DEMO="$HOME/Documents/Annotate Demos/pin-annotation-2026-10-04"
env \
  ANNOTATE_DESKTOP_USER_DATA="$DEMO/app-profile" \
  ANNOTATE_DESKTOP_TEST_PROJECT="$DEMO/Demo project" \
  "$DEMO/Annotate Demo.app/Contents/MacOS/Annotate" \
  --force-renderer-accessibility \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9226
```

This launches the mutable demo environment, not a pristine starting state. Do not run it merely to edit captions or documentation. Use a dedicated profile, never expose debugging to the network, and do not enable it on the everyday app. The PID, window IDs, app HTTP port, page URLs, and selected project must be rediscovered; the values embedded in `record-languages.cjs` were specific to the October 4 session.

The demo bundle was renamed and ad-hoc re-signed during native-control troubleshooting. This affected only the demo copy and did not reliably fix native clicks. Its display name remained Annotate because helper lookup depended on it. This is historical context, not a required packaging change or a reason to modify the installed app for recording.

## Cursor and timing alignment

Log semantic actions such as `play`, `modifier`, `arrowEnd`, and `closePin`, together with their dispatch epoch and current viewport coordinates. Validate against the visible state change; the timestamp of starting a script or finding a locator is not the click time. The earlier first-project review specifically found pointer timing confusing at play/pause and the Possession tile. Check those transitions frame by frame after edits.

For the recorded pin layout, the native window was 1440 x 949 logical pixels, including a 32 px title bar; the renderer viewport was 1440 x 917. Capture produced 1920 x 1264 pixels. Its transform was:

```text
rawX = cssX * 1920 / 1440
rawY = (cssY + 32) * 1264 / 949
outputX = rawX
outputY = rawY - 42 + 9
pointerGraphicTopLeft = (outputX - 4, outputY - 3)

sourceTime = actionEpoch - captureStartEpoch
shotTime = (sourceTime - sourceTrimStart) / playbackSpeed
outputTime = durationOfEarlierShots + shotTime
```

The 42 px crop removes title chrome; the 9 px top pad restores the final 1240 px height. Click rings use the same coordinate transform as the pointer tip. Do not apply these constants blindly to a different window, display scaling, or editor layout. First-project plans have their own source geometry (1920 x 1280) and transformation settings. Button widths can change by language; locate them afresh instead of reusing English screen coordinates.

The pin edit uses approximately 0.16 seconds of pointer travel and 0.25 seconds of dwell before an ordinary click, with a longer dwell at the Style control. These are pacing choices, not substitutes for real readiness checks. For drag demonstrations, log the actual down/move/up path so the overlay remains synchronized throughout the gesture.

Native color and select popups were unreliable through automated keyboard/mouse interaction. The successful take prepared blue using the real color inputs and changed the real Style select using Playwright `selectOption('dotted')`. This changes the app, not a painted mock interface. Do not fake a popup or a color-picker tutorial; show the result that actually occurred. Verify saved annotation properties and arrow anchor references as well as appearance.

## Native window transitions

Adding a pin opens a native child window. Closing it destroys that window rather than navigating the captured page back to the clip. Record the parent clip window as well, starting shortly before Close pin, then align the two captures using the logged close event. The ending must visibly show the correct parent clip editor, not simply stop on the pin.

Closing a captured window can report `SCStreamErrorDomain -3805` or `RPRecordingErrorDomain -5814` after an MP4 has finalized. A `FINISHED` message alone is not sufficient proof of success: inspect duration with ffprobe and decode the whole file. A capture without a valid finalized file is a failed take. A brief hold of the identical paused final frame was used where necessary at the window-close seam; it must not manufacture football playback or hide tracking behavior.

An English return take showed a stale yellow annotation in the parent clip window after the blue pin had been saved. That ending was rejected and replaced. Check the returned clip visually and confirm it reflects the saved project, especially after modifying a pin in another window. Do not assume a successful Close pin click proves the complete transition is correct.

## Using the machine during production

During offline rendering, caption work, or QA, Patrick can use other applications normally. During a live UI take, avoid interacting with the demo app, changing its layout, moving/resizing its windows, or sending shortcuts to it. Keep the machine awake and unlocked. Focus changes or physical input can still disrupt the sequence even though the physical cursor is excluded from capture.

Single-window capture reduces unrelated desktop exposure but is not a guarantee that every native dialog, focus change, or window transition is background-safe. Agree on a short capture interval rather than promising unrestricted simultaneous use. If an accidental action changes the take, stop, restore the disposable starting state, and retake it. Do not disable security protections or record unrelated keyboard input.

## Local files and editing entry points

All paths in this section are relative to `$HOME/Documents/Annotate Demos/`. Keep the exact raw files named by the edit plan; do not choose whichever MP4 is newest.

| Folder | Files and purpose |
| --- | --- |
| `first-project-2026-10-03/` | Current English `first-project-pilot-v2.mp4`; `recordings/01-project-import-raw.mp4`, `02-capture-raw.mp4`, `03-clip-raw.mp4`, and `04-pin-raw.mp4`; `recordings/edit-demo.cjs`, `edit-list.json`, `check-clicks.cjs`, and `edited/verification.json`. |
| `first-project-languages-2026-10-03/` | `captions.json`, `build-plan.cjs`, `render.cjs`, `check-timings.cjs`, successful `native-record` recorder, and `RECORDING-NOTES.txt`. Each locale has `takes.json`, raw captures, `recordings/edit-list.json`, and `recordings/edited/verification.json`. |
| `pin-annotation-2026-10-04/` | `record-blue.cjs`, `blue-actions.json`, `record-languages.cjs`, `record-localized.swift`/binary, `localized-captions.json`, `plan-localized.cjs`, `render.cjs`, and `check-localized.cjs`. `record-dotted.cjs` is a rehearsal, not the canonical take. |
| `pin-annotation-2026-10-04/localized-v3/{locale}/` | Current final MP4, `take.json`, `edit-plan.json`, `edited/verification.json`, native capture logs, `drawing.mp4`, `return.mp4`, and an `intro.mp4` for the non-English locales. English reuses the approved earlier drawing footage and adds a new closing segment. QA includes `contact-check.png` and supporting screenshots. |

The first-project rendering records check continuous source coverage through import and playback. The pin verification records store shot boundaries and output action times. The English pin plan also depends on `recordings/edited-v2/verification.json`, the original clean blue take, and `blue-actions.json`; do not overwrite those source artifacts while re-recording another language.

The following are not current deliverables: the September first-project pilot, the original yellow `pin-annotation-pilot-en.mp4`, the English `pin-annotation-pilot-en-v2.mp4` without Close pin, and `localized-v3/en-first-take/` / `en-stale-return/`. Preserve them as history if useful, but publish only the explicitly listed exports in the inventory.

### Re-render without recording

Edit the caption data or edit plan, not the app, when only text, pacing, or pointer alignment needs changing. Copy/version the current outputs and plans before rerendering: the scripts overwrite edited files. These commands operate on existing captures and do not start recording:

```bash
DEMO="$HOME/Documents/Annotate Demos/pin-annotation-2026-10-04"
for locale in en fr es zh-CN; do
  node "$DEMO/plan-localized.cjs" "$locale"
  node "$DEMO/render.cjs" "$DEMO/localized-v3/$locale/edit-plan.json"
done
node "$DEMO/check-localized.cjs"
```

Always pass the explicit current plan to the pin renderer. With no plan argument it builds the superseded English v2 output. Also note that the English introduction/drawing captions are inherited from the earlier verification plan; editing `localized-captions.json` alone does not update all of that reused English text. Update the relevant source plan deliberately and check the generated plan before rendering.

These are local session scripts, not supported repository commands. They currently resolve Playwright/sharp from this checkout's `webapp/node_modules`, contain absolute paths, and use installed ffmpeg/ffprobe. The pin renderer uses macOS `h264_videotoolbox`; relocating the folder or rendering on Windows requires adapting those assumptions. The recording script additionally hardcodes session-specific app/window IDs and mutates demo pins: inspect and adapt it before any new recording, rather than running it unchanged.

## Localization

Use locale codes `en`, `fr`, `es`, and `zh-CN`. Change the actual app language and repeat the UI sequence, then apply translated captions with the same meaning and timing. Do not put French captions over an English UI and call it a localized take. Keep the same football frame, blue shapes, Dotted style, and closing action across languages.

Saved data names are distinct from interface labels. Names such as Possession or Default annotations may remain as the app originally created them; do not claim every authored label is automatically translated. Use each locale's actual control bounds and verify captions for accents, CJK glyphs, line breaks, and clipping. The pin renderer uses Helvetica with PingFang SC fallback for Chinese.

## Verification and delivery

1. Confirm the intended packaged app, disposable project, source frame, and UI language before capture. Verify saved annotation state after actions, not just accessibility values or button appearances.
2. Review pointer placement and click timing, especially play/pause, tag-board toggles, Style, Add pin, and Close pin. Check pointer and rings share the same crop/scale transform.
3. Check player foot placement, blue color, Dotted arrow style, and actual highlight attachments. Check the saved/returned clip is not showing stale annotations.
4. Confirm there is no physical duplicate cursor, native title bar, unrelated desktop content, private path, microphone track, or notification in the deliverable.
5. Review caption contrast, readability, translation, and timing. Remove unnecessary tactical commentary. Let viewers see the result without a caption permanently covering it.
6. Verify complete import/playback coverage in the edit plan and source footage. Label speed changes; do not present accelerated playback as the result at normal speed or hide a failed tracking section.
7. Check all final files with ffprobe and full FFmpeg decoding. The existing pin checker also verifies resolution, frame rate, lack of audio, duration against the plan, and creates contact sheets around Dotted, Close pin, and the return to the clip.
8. Visually inspect contact sheets and play the edited video, including native-window seams. A decodable file and valid JSON do not establish that the tutorial is understandable or the UI sequence is correct.
9. Retain raw media, action timestamps, capture logs, captions, edit plans, script versions, QA images, and an explicit current-output manifest. Keep rejected takes separate from deliverables.
10. Obtain content approval and confirm footage publication rights before embedding or posting. The eight current files are local exports; the in-app guide placeholders have not been replaced by this documentation work.

When videos are eventually embedded, align the surrounding guide description with what the video actually covers. The current first-project export stops at a blank pin editor; it does not fulfill the existing placeholder's broader promise of a complete workflow through presentation. The separate pin tutorial and later presentation tutorial should make that division explicit.
