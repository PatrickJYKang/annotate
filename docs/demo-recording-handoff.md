# Demo Recording Handoff

Updated: 2026-10-06. **Start here** if you are taking over recording of the in-app user-guide tutorials. This page gives the current state, what to do next, how Patrick works, and the practical lessons from the 2026-10-06 sessions. Companions: the [inventory](demo-recording-checklist.md) (deliverables and remaining topics), the [storyboards](demo-storyboards.md) (click sequences), and the [workflow](demo-recording-workflow.md) (visual style, capture method, coordinate transform, verification). Each local session folder also has a `RECORDING-NOTES.txt` with the exact details of that tutorial.

Everything below `$HOME/Documents/Annotate Demos/` is local production material: raw captures, scripts, disposable project clones and exports. None of it is in this repository. Back it up separately.

## Current state

All exports are silent H.264 MP4, 1920 x 1240, 30 fps, `yuv420p`, fast-start, fully decoded after rendering. Paths are relative to `$HOME/Documents/Annotate Demos/`.

| Tutorial | en | fr | es | zh-CN | Session folder / exports |
| --- | --- | --- | --- | --- | --- |
| First project | 112.70 s | 115.53 s | 115.17 s | 114.37 s | `first-project-2026-10-03/`, `first-project-languages-2026-10-03/` (see inventory) |
| Pin annotation | 45.83 s | 46.30 s | 46.40 s | 46.37 s | `pin-annotation-2026-10-04/localized-v3/<locale>/` |
| Basic player tracking | 40.00 s | 39.93 s | 40.00 s | 40.77 s | `basic-tracking-2026-10-06/recordings/take-02/` (en), `take-<locale>/` |
| Tracking correction | 97.37 s | 97.90 s | 98.93 s | 98.97 s | `tracking-correction-2026-10-06/recordings/take-<locale>/` |
| Presentation authoring | 73.80 s | 73.80 s | 76.80 s | 71.80 s | `presentation-authoring-2026-10-06/recordings/take-<locale>/` |
| Clip trimming | 25.80 s | 25.80 s | 25.80 s | 25.80 s | `clip-trimming-2026-10-06/recordings/take-<locale>/` |
| Export and recovery | 47.00 s | 47.07 s | 46.97 s | 46.90 s | `export-recovery-2026-10-06/recordings/take-<locale>/` |
| Capture and tagging | 77.40 s | 77.43 s | 77.43 s | 77.43 s | `capture-tagging-2026-10-07/recordings/take-en/` |
| Clip editing (shapes, keyframes) | 63.23 s | 63.13 s | 63.23 s | 63.23 s | `clip-editing-2026-10-07/recordings/take-<locale>/` |
| Homography | 46.80 s | 47.07 s | 47.03 s | 46.97 s | `homography-2026-10-07/recordings/take-<locale>/` |
| Pin animations | 61.53 s | 61.50 s | 61.27 s | 61.50 s | `pin-animations-2026-10-07/recordings/take-<locale>/` |
| Tracking refinements | 41.90 s | 41.90 s | 42.07 s | 41.97 s | `tracking-refinements-2026-10-07/recordings/take-<locale>/` |

Patrick approved the English take of every tutorial before the other languages were recorded. The French, Spanish and Chinese captions are the assistant's own translations using each catalog's UI labels; none has had native-speaker review. Nothing has been published, embedded in the in-app guide, or cleared for footage rights.

Superseded and rejected takes are kept in `superseded/`, `rejected/`, or under an obviously named take folder (`take-01`, `take-en-v1-two-pins`). The current files are only the ones in the table.

## Next steps

1. **All storyboard topics Patrick wants are recorded** (twelve tutorials, four languages each, as of 2026-10-07). Pin context/annotation sets (8b) and installation (11) were dropped by Patrick. Remaining work: native-speaker caption review, a hosting/commit decision for the guide videos (below), re-recording tutorials affected by fixes to the [issue list](demo-recording-bugs.md).
2. **New topics** only if Patrick asks; copy the closest session's scripts (see the table under Production pipeline).
3. **Repository docs.** Keep this page, the inventory and the storyboard status lines in step with new exports.

## How Patrick works

- English first, delivered for review; record French, Spanish and Simplified Chinese only after he says it is fine. Small fixes are re-rendered or re-recorded and sent again before localizing.
- He chooses football content. Offer to let him pick a passage instead of searching at length; he gave frames 10,579-10,829 for tracking correction and described what should happen.
- Players: by shirt colour in the tracking tutorials; from tracking refinements on (2026-10-07) Patrick named them (blue = Willian, white = Bentaleb) and asked for the Latin-script names in every language.
- **Every shot needs a pointer**, including windows that are not the app (Finder). Use the synthetic pointer and click rings; never move the real mouse.
- Captions name technical features without explaining them ("homography": say it's called that and which button to use).
- Prefers simple, short tutorials ("do clip trimming, it's the simplest"). Captions are short action instructions; add his wording when he asks (for example "Sometimes you may have to do this multiple times.").
- His projects are read-only. "Tottenham v Chelsea - Demo" in `Annotate Demos/` is his; it was only read and APFS-cloned (`cp -cR`). Never launch the demo app on it.

## In-app guide integration (2026-10-07)

`webapp/components/userguide/UserGuide.tsx` shows all twelve tutorials (`TutorialVideo`, plus a "Video tutorials" index) as YouTube embeds (`youtube-nocookie.com`). Per Patrick (2026-10-07), the videos are **not bundled** with the app or committed: they will be uploaded to YouTube. Put each video's ID in `webapp/components/userguide/youtube.ts` (per tutorial, per language). The guide plays the current language's video, falls back to English with an "(English recording.)" note, and shows "Video coming soon." while no ID is set.

The guide text itself is translated: `webapp/components/userguide/content/{en,fr,es,zh-CN}.ts` (inline markup: `**label**`, `` `code` ``, `[text](url)`). Bold labels must match each language's i18n catalog.

Upload sources: the 1920 x 1240 masters listed in the table above (best quality), or 1440 x 930 web encodes in `Annotate Demos/guide-videos-web/` (`SOURCES-en-zh-CN.json` maps them to masters). The combined full-workflow video is in `Annotate Demos/full-workflow/`.

## Production pipeline (2026-10-06 sessions)

Each tutorial has its own session folder with the same structure. To start a new tutorial, copy the scripts from the closest existing session and adapt them:

| Pattern needed | Copy from |
| --- | --- |
| Clip editor, one continuous take | `clip-trimming-2026-10-06` (also has `run-locale.sh`) |
| Clip editor with processing waits shown as labelled speed segments | `tracking-correction-2026-10-06` (`plan.cjs` speed segments with badges) |
| Main window, drags, per-caption placement | `presentation-authoring-2026-10-06` |
| Several windows recorded at once, non-app window with synthetic pointer | `export-recovery-2026-10-06` |

Session folder contents:

| File | Purpose |
| --- | --- |
| `Prep project/` | Disposable starting state (APFS clone, prepared off camera). Never recorded directly. |
| `Preflight project/` | Rehearsal clone. |
| `Take project <locale>/` or `Take <locale>/...` | One fresh clone per take. |
| `app-profile/` | The demo app's own user data. `recent-project.json` points at the clone being used. |
| `record-localized`, `.swift` | ScreenCaptureKit window recorder (see below). |
| `prepare-take.cjs` | Off-camera setup (language switch, open editor, clear selection, seek). |
| `record-take.cjs` | Drives the app over CDP, records, logs pointer/click/mark times to `take.json`. Refuses to overwrite a take. |
| `plan.cjs` | Builds `edit-plan.json`: captions from logged actions/marks, pointer path, clicks, shots split into ~10 s segments. |
| `render.cjs` | FFmpeg render: crop/pad, pointer, click rings, captions, optional badges; writes `edited/verification.json`. |
| `qa.cjs` | `qa/clicks-N.png` (pointer before / ring after each click), `qa/captions.png`, `qa/caption-text.png`. |
| `run-locale.sh` | One take end to end for a locale (where present). |
| `captions.json` | Caption text per locale. |
| `RECORDING-NOTES.txt` | What was recorded, decisions, rejected takes, repeatable steps. |
| `recordings/<take>/` | Raw capture(s), `take.json`, `capture.log`, `edit-plan.json`, `edited/`, `qa/`, final MP4. |

### Launch the isolated demo app

The packaged demo copy is `pin-annotation-2026-10-04/Annotate Demo.app` (Annotate 0.2.2-desktop.2). Launch it per session with its own profile and a loopback-only CDP port:

```bash
S="$HOME/Documents/Annotate Demos/<session>"
APP="$HOME/Documents/Annotate Demos/pin-annotation-2026-10-04/Annotate Demo.app"
printf '{"path":"%s"}' "$S/<clone>" > "$S/app-profile/recent-project.json"
rm -f "$S/app-profile/DevToolsActivePort"
env ANNOTATE_DESKTOP_USER_DATA="$S/app-profile" ANNOTATE_DESKTOP_TEST_PROJECT="$S/<clone>" \
  "$APP/Contents/MacOS/Annotate" --force-renderer-accessibility \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9227
```

Startup takes 20-40 s (sidecar). Wait until `http://127.0.0.1:9227/json/list` shows an `http://127.0.0.1:<port>/` page. Quit with `kill -TERM` on the `Annotate Demo.app/Contents/MacOS/Annotate` process and confirm no `Annotate Demo.app` processes remain (an orphaned sidecar may need its own kill). Only one instance can use port 9227 at a time.

Control is Playwright `chromium.connectOverCDP('http://127.0.0.1:9227')` from this checkout's `webapp/node_modules/playwright`, using real mouse events on located controls. Find windows with `./record-localized --list <pid>`: the main window and each clip editor are 1440 x 949; the newest (highest id) 1440 x 949 window is the most recently opened editor.

### Record, plan, render

- `record-localized <out.mp4> <windowId>` prints `START_WALL <epoch>` and `READY <id> <WxH>`; send a newline on stdin to stop and wait for `FINISHED`. Cursor, audio and microphone are off. Several recorders can run at once (export and recovery records the app and a Finder window together and cuts between them by wall-clock time).
- Log every pointer move as `{action: 'move', time, x, y}`, every click as `{action, click: true, time, x, y}`, drags as down + timed moves + a final move with travel time `m` (rendered linearly) + `<action>Drop`. Use `mark(name)` for state changes and check the UI state after each step instead of trusting fixed waits.
- App coordinates: `rawX = cssX * 1920 / 1440`, `rawY = (cssY + 32) * 1264 / 949`; output crops 42 px and pads 9 px (`outputY = rawY - 33`). Shots from other windows set their own `cropTop`/`padTop`; Finder captures are logged directly in capture pixels.
- Captions: `[start, end, key, zone]` from actions/marks, minimum 1.4 s, white on near-black, 30 px. Place them where they do not cover the action (dashboard lower left; clip editor band under the timeline lanes; player over the empty timeline lanes; Finder between the image and the thumbnail strip).
- Long takes are rendered as consecutive ~10 s segments (nothing skipped) because FFmpeg rejects very long pointer `if()` expressions ("Missing ')' or too many args").
- After rendering: `ffprobe` and a full `ffmpeg -f null` decode, then look at the QA images and a few full frames. Verify the saved project data too (tracks, deck order, restored clip) in the take clone.

## Lessons and gotchas

- **Language switch with a clip editor open** leaves that editor's video black in the native window. Switch the language in the main window first, then open the editor (`prepare-take.cjs` does this).
- **Localized labels and numbers:** look up the exact i18n key in `webapp/lib/i18n/messages/<locale>.json` (for example `presentation.slidePosition`, not an invented key). Numbers are locale-formatted (`10 579` with a narrow no-break space in French, `10.579` in Spanish). Saved data names ("Possession", "Pin f10740") are not translated. Identify items by their own text, not by translated badges (a French take once dragged the wrong slide because of this).
- **Clip editor auto-selects the first annotation** on open. Escape does not clear it; Cmd-click the selected shape toggles it off.
- **Controls at the window edge** (the clip trim end handle at x 1434 of 1440): grab at the left border (`box.x + 2`), not the centre.
- **Frame readout patterns:** match the timeline text including what follows the number (`timeline.frameRange` up to `{start}`); in zh-CN the clip header "第 12,955–13,104 帧" also starts with "第 ".
- **Capture interruptions:** opening a new app window, or listing windows with `record-localized --list`, interrupts running captures (-3805). List windows before recording; record a new window with a separate recorder once it exists, and restart the parent window's recorder after it closes (pin-animations `record-take.cjs`). The recorder's FINISHED duration is whole seconds: probe real durations when trimming at a file's end.
- **Pin reload:** the clip editor reloads pin documents on window focus; after Close pin, focus the editor (pin-animations dispatches a focus event) before playing into the pin.
- **Async UI:** the "Deleted …" message appears before the clip list refreshes; wait for the list itself.
- **Pin editor:** changing a colour recolours the selected shape; opening the Animations panel resizes the canvas, so re-measure before clicking shapes.
- **Finder (export and recovery):** drive it with `osascript` (`tell application "Finder"`); its window `id` equals the ScreenCaptureKit window id. A new window auto-selects the first row, so `select {}`. Hide the sidebar (`sidebar width 0`) and status bar. `qlmanage -p` shows a "[DEBUG]" title and renders CSV blank, so use Finder's gallery view (`flow view`) for images. Never `activate` an app named "Annotate" by name: that can launch Patrick's real install. Make each Finder change at the moment of the logged synthetic click.
- **Recorder success:** `FINISHED` is not enough; confirm with ffprobe and a full decode.
- **QA timing:** `clicks-N.png` grabs 0.06 s after a click and can precede the UI update; check a later frame before calling it a fault.
- **Fresh app profiles** create Ultralytics settings on first launch; the demo profile has `"sync": true` (flagged, not changed).

## App issues found while recording

Tracked in [Issues found while recording](demo-recording-bugs.md) (open list with code pointers). Patrick asked for these to be tracked, not fixed; add new findings there.
