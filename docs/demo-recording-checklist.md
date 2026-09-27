# Demo Recording Checklist

Target: Annotate 0.2.2 Desktop Preview 2, refreshed 2026-09-27. Record the installed app, not the browser development preview. These are instructional demonstrations of the current product, not promises of unfinished desktop features.

## Prepare once

Use one disposable project and a short football passage with footage you have permission to publish. Choose a passage containing several players, a camera movement, and an overlap where tracking needs correction. Keep a clean project copy so each take can start from a known state. Use readable player/object names and remove personal paths, credentials, or unrelated windows from the recording.

Record at a consistent 16:9 resolution with the pointer visible and text readable at 1080p. Arrange editor windows before each take. Keep an uncut master; cut or speed up imports, model loading, and computation in the edited tutorial, with a visible "processing shortened" caption. Do not make processing appear instantaneous or present a warm-cache run as a first launch. Show one action and its result at a time. Narration or concise captions should explain the action, not promote the product.

## Main guide videos

These three recordings fill the existing in-app placeholders. The IDs below are the current `DemoPlaceholder` IDs in `webapp/components/userguide/UserGuide.tsx`; leave placeholders intact until recordings are ready.

| Priority | Guide slot | Target length | Record |
| --- | --- | --- | --- |
| 1 | `first-project` | 60-90 seconds | Create a project, add basic match details, import a short compatible video, start/stop a tagged clip, open its editor window, add a pin and a simple annotation, then show it in a presentation. This is the overview, not an exhaustive explanation of every control. |
| 2 | `tracking-correction` | 45-60 seconds | Choose Track, select a provisional player, Start, show live tracked frames, encounter a loss, find the player and Continue, then Stop. Demonstrate Re-track from here on an incorrect tail and show Done versus Cancel. Choose a reproducible passage rather than implying all overlaps are corrected automatically. |
| 3 | `presentation-authoring` | 45-60 seconds | Preview an asset, drag clips and pins into the deck, reorder, add a title, set a pin pause, then enter Present. Show a click-triggered annotation and resume playback. Include a Match video transition between forward-ordered pins from the same video if it fits; otherwise put it in a focused follow-up. |

## Focused reference videos

Record these as separate takes after the three main videos. They can be added beside the corresponding guide sections later; these are not additional implemented placeholders.

| Topic | Target length | Record |
| --- | --- | --- |
| Capture and tagging | 60-90 seconds | Start/stop a board tile, change applicable modifiers, create overlapping clips, select a timeline range and see its clip in the list, re-tag while paused, and zoom/scroll the timeline. Briefly switch UI language to show the built-in board following it; custom boards are not automatically translated. |
| Clip editing and trimming | 60-90 seconds | Frame-step and scrub, add/move a shape to create position keyframes, select several objects, edit shared stroke/fill, resize/rotate a box or circle, and trim inward with Apply, Cancel, and immediate Undo. Do not demonstrate outward extension beyond the original clip range. |
| Tracking refinements | 45-60 seconds | Name a highlight, enable Display name and change label size, attach a poly/arrow to highlights, and show the links following motion. Extend a selected highlight with another tracked span; optionally merge compatible non-overlapping objects. This supplements, rather than repeats, the correction video. |
| Homography | 45-60 seconds | Compute H with visible progress, show the pitch grid, draw a pitch-space box/circle and manipulate its handles, then play through camera movement. Contrast image-space highlights with pitch-space geometry. Show Delete H or recomputation on a spare take. Tracking does not require homography. |
| Pins and annotation sets | 60-90 seconds | Add a pin, show its separate editor window, draw and style linked tactical shapes, create an alternative set, hold Left/Right for context, and return with Space. Import one set into the clip and show that the original pin remains independent. |
| Pin animations | 60-90 seconds | Open the independent Animations panel, assign two or three contrasting entrance effects, adjust duration/delay, demonstrate On click versus With/After previous, reorder, preview, and trigger the sequence from a pin pause in clip playback. Effects belong to the annotation set, not clip position keyframes. |
| Export and recovery | 45-60 seconds | Export report, open the resulting CSV/JSON and annotated PNGs, delete a clip and use immediate Undo, and show the integrity report or whole-folder backup. Use only the disposable project for destructive demonstrations. Video deletion permanently removes its project copy and dependent clips/pins; it is not the same recoverable operation as deleting a clip. |

## Installation clips

Record one short installation/startup clip on each actual platform, ideally 30-45 seconds edited: download from the release, install, launch, show startup progress, and reach the project screen. Mac: DMG to Applications. Windows: EXE and desktop shortcut. Show any unsigned-publisher warning honestly without instructing viewers to disable security tools. A Mac recording cannot establish Windows behavior; capture Windows on a real Windows machine.

Keep first-launch and second-launch timing distinct. The packages are large and first launch can be slow; these videos must not suggest that the current refresh fixes that. Hide personal usernames and paths in file dialogs and logs.

## Recording order and reuse

Record the main overview, tracking correction, and presentation first. Then capture tagging, clip editing, linked highlights, homography, pins, animations, and exports while the same project is open. Installation footage can be collected separately on each platform. A later 30-45 second outreach video for `@annotate_app` can be cut from the same material: capture a passage, track a player, annotate a pin, then present the result. It does not require another product walkthrough.

Deliver a clean master and an edited clip for each topic, plus captions/transcript where possible. Review the visible labels against the installed build before inserting videos into the guide. Do not claim MP4 clip export, automatic updates, arbitrary panel pop-outs, or full Windows certification: those are not current product capabilities.
