# Annotate 0.2.2 User Guide

The canonical guide is available inside Annotate at [`/userguide`](http://localhost:3000/userguide), including a first-project walkthrough, indexed reference, glossary, and placeholders for video demonstrations. This Markdown version remains available as an offline reference.

This guide covers the `project.v2` workflow in Annotate 0.2. Annotate 0.1 projects are not compatible with 0.2; keep using the pinned 0.1 release for those projects.

## 1. Install and start Annotate

Follow the quick-install command in the [README](README.md#install). The installer creates an `Annotate.command` launcher on the macOS Desktop or an `Annotate.desktop` launcher on Linux, then opens Annotate in a supported Chromium browser.

Keep the launcher terminal open while Annotate is running. Closing it, or pressing `Ctrl+C` in it, stops the local web app and Python sidecar. Application logs are written to `<install-folder>/.runtime/app.log`.

Annotate is self-hosted on your computer. Project files and videos stay in the project folder you select; they are not uploaded to an Annotate cloud service. The browser does temporarily send video data to the local sidecar at `127.0.0.1` for import, tracking, and homography.

## 2. Create or open a project

On the opening screen, choose **Create project** or **Open project**. Grant read/write access when the browser asks; Annotate cannot work with a folder whose permission is read-only or denied.

When creating a project, enter its name and any available match details. Choose a parent directory, not a pre-existing project folder. Annotate creates a new folder for the project and refuses to overwrite a non-empty folder.

The project is a normal directory containing `project.json`, source media, clips, presentations, exports, caches, and recoverable trash. Do not rename or move files inside it while the project is open. Backing up the entire folder is sufficient to back up the project.

Annotate remembers the last opened project. Your browser may ask for folder permission again after a restart. Use **Close project** before switching to another project.

## 3. Dashboard and video import

The dashboard contains project controls, imported videos, presentations, export controls, and the project integrity report. **Edit match info** opens the metadata editor for teams, players, match details, teamsheet import, and football-data.org lookup.

Choose **Import video** and select an MP4, MOV, WebM, MKV, or AVI file. Every imported video keeps its own FPS and resolution. Annotate preserves a compatible constant-frame-rate H.264 MP4, remuxes a compatible stream when possible, and transcodes only when browser compatibility or variable frame rate requires it.

Import progress stays visible through upload, analysis, media preparation, frame probing, and download. Long incompatible videos can take significant time to transcode; canceling stops the import and removes its temporary files. The completed video is copied into the project's `media/` folder, so allow storage for both the original file and the project copy.

Select **Open** on a video card, or **Open capture**, to enter the tagging workspace. If the project has several videos, the selected video can also be changed from the workspace toolbar.

## 4. Capture and tag clips

The tagging workspace has a video player, a fixed tag board, and a clip tree. The dividers are draggable and each layout is remembered locally.

Each main board button is a start/stop toggle. Press it once at the first relevant frame to begin a clip; press the same button again at the final relevant frame to finish it. The active state is visible on the board and as an in-progress range on the timeline.

Different tag buttons can remain active at the same time, so clips may overlap. There is no automatic pre-roll or post-roll: the frames at which you press the button are the captured boundaries.

Modifier buttons add facets such as outcome or phase details. Applicable modifiers are captured when a clip begins and may be changed while that capture remains active. The board enforces any requirements defined by the project's `tagging-board.json`.

Use **Untagged clip** in the same start/stop manner when a passage is worth keeping before its classification is known. Untagged clips remain visible in their own clip-tree bucket.

Click a clip on the timeline or in the clip tree to select it and jump to its start. Re-tagging is available only while playback is paused: select a clip, choose **Retag selected**, then choose its new board tag and modifiers. A clip can also be dragged from the tree onto a tag group.

The timeline has one lane per tag-board group and packs overlapping clips into subtracks. Click or drag to seek by frame. Scroll horizontally to move through time; use the timeline's zoom gesture or controls to zoom from a close frame-level view out to the whole match. Manual scrolling disables playhead auto-follow until five seconds after scrolling stops.

Select **Open editor** to open the chosen clip in a new browser tab. Delete moves a clip into recoverable project trash; the immediate **Undo delete** action restores it.

## 5. Clip editor basics

The clip editor has a viewer, an object/pin inspector, and a keyframe timeline. Drag the panel dividers to fit the current task. Playback is restricted to the clip's own frame range.

Click or drag on the timeline to seek. Left and Right step exactly one frame; Space toggles playback. Horizontal scrolling and zoom behave like the tagging timeline, and manual scrolling temporarily suspends playhead auto-follow.

Choose **Trim** to narrow the clip without loading video outside its current bounds. Drag the in/out handles, or focus a handle and use Left or Right, then choose **Apply trim**. **Cancel** leaves the clip untouched. **Undo trim** restores the complete pre-trim range until another clip edit is made.

Choose a drawing tool from the top toolbar, then draw in the video. Available animated objects are box, circle, highlight, cover shadow, arrow, lobbed pass, polygon, and text. Drawing creates the object's first position keyframe at the current frame.

Move or resize an object on a frame where it has no keyframe to create one there. Boxes and circles have resize and rotation handles. Geometry interpolates between keyframes; style properties such as color, width, pattern, opacity, and font size apply to the whole object rather than being animated.

Use the Select tool to click an object, or drag an empty area to box-select. Hold Shift while clicking objects in the viewer or object list to add them to the selection; hold Cmd on macOS or Ctrl on Linux to subtract them. Inspector changes apply to all compatible selected objects.

**Merge objects** is enabled when two or more selected objects have the same type and do not contain overlapping position keyframes. The merged object keeps their combined keyframes as one timeline object.

Highlights can be named without changing their identity. Enable **Display name** to render that name beside the highlight; the label follows the highlight, stays within the frame, and uses the selected text size.

Arrows, lobs, shadows, and polygon vertices can attach to highlights. Attached geometry follows the highlight's tracked or manually animated movement.

## 6. Work with keyframes

Each object has a timeline row. Click its row to select the object even when several objects overlap in the viewer. Position keyframes align to the source-video frame grid, and the red playhead always represents one exact frame.

Press `K` or choose **KF Here** to add or replace the selected object's position keyframe at the current frame. Click a keyframe to select it and seek to its frame. Drag a manual or correction keyframe horizontally to retime it; tracked keyframes are fixed.

Delete or Backspace removes the selected keyframe. Shift+Delete or Shift+Backspace removes the selected object instead. An object must retain at least one position keyframe.

Cmd/Ctrl+Z undoes an editor change. Cmd/Ctrl+Shift+Z, or Ctrl+Y, redoes it.

For polygons, press Enter to finish a closed shape. Shift+Enter finishes an open line. Escape cancels an unfinished drawing or clears the current drawing gesture.

## 7. Track a player

Tracking creates or extends highlight objects. It does not require homography and operates in image coordinates.

1. Seek to a frame where the target player is clearly visible and choose **Track**.
2. Annotate shows a provisional highlight on every detected player. Click the correct player.
3. Choose **Start** to track forward, or **Stop** to keep only the selected frame as a manual highlight.
4. Trusted tracked frames appear live in the viewer and keyframe timeline.
5. If continuity is lost, Annotate hides the highlight at the loss boundary and shows provisional targets again. Play or step to a frame where the player is identifiable, select the correct target, then choose **Continue**.
6. Annotate linearly fills the gap to the human correction and resumes tracking. Repeat until the clip ends or choose **Stop** to keep the work completed so far.

To add another tracked span to an existing highlight, select that highlight on a frame where it has no position keyframe before choosing **Track**. Stopping the new span preserves the hidden gap between it and the earlier span.

To replace an incorrect tracked tail, select the highlight at the last frame you trust and choose **Re-track from here**. Choose the correct provisional player and **Continue** through the normal tracking and reacquisition workflow. Nothing in the replacement is saved until **Done**; **Cancel** restores the original tail.

Tracker IDs are treated as hints rather than permanent player identity. Correcting a loss or identity switch is therefore an expected part of the workflow, especially through overlaps, cuts, or players leaving the frame.

## 8. Homography and pitch drawing

Choose **Compute H** to calculate pitch homography for the clip. A progress indicator remains visible while PnLCalib samples the video, solves sparse frames, and interpolates usable matrices. Results are cached per video and clip range.

When homography is available, the editor automatically switches boxes and circles to **Draw: pitch**. Their positions, size, movement, resize handles, and rotation are stored on the pitch plane and projected through the changing camera view. Highlights, arrows, lobs, shadows, polygons, and text remain in image coordinates.

Use **Show H** to overlay the projected pitch grid for inspection. **Delete H** removes cached homography for the range and returns drawing to image coordinates. **Recompute H** replaces an existing result.

## 9. Add and annotate pins

A pin marks one exact frame inside a clip. Seek to the frame and choose **Add pin**. Annotate creates the pin if needed and opens its frozen-frame editor in a new browser tab; allow pop-ups for the local Annotate address if the tab is blocked.

Each pin can contain multiple independently named annotation sets. The first visit creates a default set. Use **New set** for an alternative explanation, **Delete set** to move a set to trash, and **Undo set delete** to restore it.

The pin editor provides Select, Box, Circle, Highlight, Shadow, Arrow, Lob, Poly, and Text tools with linked stroke/fill colors, stroke pattern and width, opacity, and text controls. Select several objects with Shift-click or box selection to edit compatible properties together. Delete removes selected objects; Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo.

Open **Animations** from the annotation toolbar to reveal the right-side animation panel. The panel can remain open without a selected shape; select one or more shapes and choose **Add** to assign an entrance animation. Each shape can have one entrance animation: **Appear**, **Fade**, **Grow**, or **Wipe**. Steps run in the displayed order and can start **On click**, **With previous**, or **After previous**. Delay and duration are edited in seconds; use the arrow controls to reorder steps or **Remove** to return a shape to ordinary static display.

Choose **Preview** to play the annotation set without leaving the editor. Click the frame or choose **Next** to fire the next on-click step. **Reset** restarts the sequence and **Stop** returns to editing. Shapes without an entrance animation remain visible throughout the preview.

Choose **Calibrate** to run PnLCalib on the pin frame. **Manual H** lets you place a manual perspective quadrilateral. **Show H** inspects the projected grid and **Delete H** removes the current calibration.

Hold Left or Right to preview video at normal speed for up to five seconds before or after the pin. Release the key to stop. Drawings are hidden and editing is locked away from the exact pin frame; Space or **Return to pin** returns to the editable frame.

Pin annotation sets are independent from animated clip objects. Choose **Import into clip** to copy the active set into the clip at the pin frame. Imported objects receive new IDs, and links to imported highlights are preserved. The entrance sequence stays with the pin annotation set and is not converted into clip keyframes.

## 10. Build a presentation

Create a presentation from the dashboard or the Presentations page, then open it. The authoring workspace contains an asset browser, preview canvas, horizontal slide deck, and inspector; its panel sizes are remembered.

Browse assets by tag or chronologically. Click a clip or pin to preview it without changing the deck. Drag a clip or pin into the deck to create a slide, drag deck thumbnails to reorder them, and use **Add title** for title, section, or divider cards.

Clip slides play the original project video with animated clip annotations. Pin slides render the exact frozen frame and selected annotation sets. Use the inspector to choose annotation sets, pin-pause behavior, hold/cue timing, playback rate, title content, speaker notes, and the transition after the selected slide.

When a clip pauses at a pin, or a pin is used directly as a slide, its saved shape animations play on a live overlay. A click, Space, the play control, or **Next** fires a pending on-click step before resuming the clip or advancing the presentation. Presentation annotation cues still control when an entire annotation document enters or exits; the sequence stored inside that document controls how its individual shapes enter.

Clip previews use the same frame-snapped timeline behavior as the clip editor, with only the pin lane shown. When a clip-backed slide is selected, **Edit clip** opens that clip in a new tab; saved changes refresh when you return to the presentation.

**Cut** changes directly to the next slide. **Match video** is available between two forward-ordered pin slides from the same source video and plays the intervening original video as the transition.

Choose **Present** for a panel-free, full-viewport presentation. Right advances, Left goes back, and Escape exits present mode. Clip slides can pause automatically when playback crosses included pins; resume with Space, the play control, or another click as offered by the canvas.

## 11. Export and recover work

Choose **Export report** on the dashboard to write `clips.json`, `clips.csv`, and one native-resolution PNG for every pin annotation set into `<project>/exports/report/`. PNG exports render the completed static annotation state rather than one moment of the entrance sequence. A failed annotation render is listed without discarding successful outputs.

Annotate does not currently expose clip MP4 export in the 0.2 interface. Presentation playback uses original project video directly and does not create prepared presentation media.

Clip, pin, and annotation-set deletion first copies data into `<project>/.trash/`. Use the immediate Undo action when available. **Empty trash** permanently removes retained recovery operations; automatic cleanup also applies age and size limits.

The dashboard integrity section reports missing media, unreadable clips or presentations, invalid annotation documents, and broken presentation references. It is diagnostic and does not silently rewrite the project. Resolve the referenced file or restore/delete the affected item, then reopen the project to refresh the report.

## 12. Keyboard reference

| Context | Shortcut | Action |
|---|---|---|
| Tagging | Project-defined board key | Toggle the corresponding clip range or modifier |
| Tagging | Escape | Cancel retagging or the most recently started active range |
| Tagging | Delete / Backspace | Move the selected clip to trash |
| Tagging | Cmd/Ctrl+Z | Restore the most recently deleted clip when Undo is available |
| Clip editor | Space | Play or pause the clip |
| Clip editor | Left / Right | Step one source frame |
| Clip editor | K | Add a position keyframe for the selected object |
| Clip editor | Delete / Backspace | Delete the selected keyframe |
| Clip editor | Shift+Delete / Shift+Backspace | Delete the selected object |
| Clip editor | Cmd/Ctrl+Z | Undo |
| Clip editor | Cmd/Ctrl+Shift+Z or Ctrl+Y | Redo |
| Clip or pin editor | Enter | Finish a closed polygon |
| Clip or pin editor | Shift+Enter | Finish an open polygon line |
| Clip or pin editor | Escape | Cancel an unfinished drawing or clear selection |
| Pin editor | Hold Left / Right | Preview up to five seconds around the pin |
| Pin editor | Space | Return to the exact pin frame |
| Animation preview | Click / Next | Fire the next on-click shape animation |
| Present mode | Left | Previous scene |
| Present mode | Right | Fire the next animation, or advance when none remain |
| Present mode | Space / click | Fire the next animation or resume a paused clip |
| Present mode | Escape | Exit present mode |

Shortcuts are ignored while typing in an input, text area, or select control.

## 13. Troubleshooting

**The browser cannot create or open a project:** Use Chrome, Edge, Brave, Arc, or Chromium and grant read/write access to the selected folder. Safari and Firefox are not supported for project folders.

**The app opens but the sidecar is offline:** Keep the launcher terminal open and inspect `<install-folder>/.runtime/app.log`. Stop the launcher, rerun it, and confirm that ports 3000 and 8321 are not already occupied.

**PnLCalib is unavailable:** From the install folder, run `./scripts/setup-pnlcalib.sh`, then restart Annotate. The launcher deliberately refuses to continue without the pinned source and verified model weights.

**Tracking cannot load YOLO:** The first tracking action downloads `yolov8n.pt`. Check the internet connection and write access to the install folder, then retry.

**A pin editor does not open:** Allow pop-ups for `http://127.0.0.1:3000` or `http://localhost:3000`, then choose **Add pin** or **Open pin** again.

**A long video import appears slow:** Watch the import phase and percentage. Compatible H.264 MP4 files are normally preserved or remuxed quickly; incompatible or variable-frame-rate files require a full transcode. Canceling is safe and removes temporary import files.

**A project reports missing references:** Expand the dashboard integrity report for the exact path. Restore the missing item from `.trash/` when possible, or remove the broken presentation slide/reference. Annotate keeps broken references visible rather than guessing how to repair authored work.
