# D3 – Playback + Marks Implementation Plan

> **Historical project.v1 milestone.** Marks are not part of project.v2. See
> the [current technical reference](../technical_document.md) and
> [documentation index](README.md).

Date: 2025-10-14
Status: Archived (originally In Progress)
Target: Chromium desktop only

## Goals
- Select and load a project video for playback.
- Custom reusable player component with overlay toolbar and progress bar.
- Display timeline marks on the progress bar.
- Player hotkeys: J/K/L, comma/period, arrow keys, space (play/pause), digits 1–9 (toggle tags), M (add mark).
- Add a mark at current time (M); toggle tags 1–9 for the selected/last mark.
- List marks and navigate by clicking.
- Persist marks to `project.json` and reflect in UI immediately.

## Acceptance Criteria
- Selecting a video shows the player and current metadata.
- The custom player renders as a single entity (video + overlay toolbar) with no native browser controls.
- Timeline marks are visible on the progress bar at the correct positions.
- Hotkeys work:
  - J = step back one frame-ish (1/fps)
  - K or Space = pause/play
  - L = step forward one frame-ish (1/fps)
  - , / . = frame nudges
  - ← / → = short seeks (~0.2s)
  - M = add mark at current time
  - 1–9 = toggle corresponding tag on selected (or last) mark
- Marks appear in a list with `mm:ss.mmm` (or `h:mm:ss.mmm`), and clicking seeks to that time.
- `project.json` updates with `marks[]` and survives close/reopen.

## Tasks
- [x] Video selection UI & object URL load
- [x] Reusable custom player component (`components/player/VideoPlayerUnit.tsx`)
- [x] Overlay toolbar (play/pause, frame step, nudges, time/duration, fullscreen)
- [x] Disable native controls and Chromium media shortcuts
- [x] Timeline marks rendered on progress bar
- [x] Integrate on `/player` and remove global key handlers
- [x] Add mark (M) and persist to `project.json`
- [x] Tag toggle 1–9 for selected/last mark
- [x] Mark list with time display + click to seek (seeks via component API)
- [ ] Visual selected-mark state improvements (optional polish)
- [ ] Error messaging around missing video file references (edge-case)

## Notes
- FPS fallback defaults to 30 when absent.
- Time formatting helper `formatTime()` outputs `mm:ss.mmm` or `h:mm:ss.mmm`.
- Marks filtered per selected video and stored under `marks[]` in manifest.
