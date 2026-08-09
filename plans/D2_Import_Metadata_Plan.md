# D2 – Import + Metadata Implementation Plan

> **Historical project.v1 milestone.** See the [current technical reference](../technical_document.md) and [documentation index](README.md) for Annotate 0.2.

Date: 2025-10-13
Status: Archived (originally Completed)
Target: Chromium desktop only

## Goals
- Import video via File Picker (and drag-and-drop).
- Copy selected file(s) into the project folder under `media/` with unique filenames.
- Extract metadata: duration (ms), resolution (width/height), and best‑effort FPS from `<video>`.
- Update `project.json` (`videos[]`) and show imported videos in the UI.
- Persist immediately after import.

## Acceptance Criteria
- "Import Video…" opens a picker limited to video types (MP4/MOV/WebM; others may still be selectable via *All Files*).
- Import copies the file into `media/` with a unique name if a collision exists (e.g., `name (2).mp4`).
- Metadata populated: `durationMs`, `width`, `height` (FPS best‑effort when available).
- `project.json` is updated and written on successful import.
- UI lists imported videos with name and duration; errors show non‑blocking toasts.
- Drag-and-drop onto the project panel also imports videos.

## Tasks
- [x] FS helpers: unique filename and copy into `media/`
- [x] Media: metadata extraction via hidden `<video>` using object URL; best‑effort FPS via `requestVideoFrameCallback`
- [x] UI: Add "Import Video…" button (enabled only when a project is open)
- [x] UI: Show imported videos list with basic details
- [x] UI: Drag-and-drop import onto the project panel
- [x] Autosave manifest immediately after import

## Technical Notes
- Use `showOpenFilePicker({ types: [{ accept: { 'video/*': ['.mp4','.mov','.webm','.mkv','.avi'] } }] })`.
- Copy via `FileSystemFileHandle.createWritable().write(file)`.
- FPS estimation: sample a few frames with `requestVideoFrameCallback` for <= 10 frames or <= 600 ms; compute average delta.
- Handle non‑supported playback gracefully; still record duration/size from metadata when available.

## Out of Scope (D2)
- ffmpeg.wasm probing/fallback for metadata (later milestone if needed).
- Multi‑file progress UI (simple sequential for MVP).
