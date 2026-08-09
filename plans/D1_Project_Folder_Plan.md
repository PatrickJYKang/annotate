# D1 – Project Container (Folder) Implementation Plan

> **Historical project.v1 milestone.** See the
> [current technical reference](../technical_document.md) and
> [documentation index](README.md) for Annotate 0.2.

Date: 2025-10-13
Status: Archived (originally In Progress)
Target: Chromium desktop only

## Goals
- Create/Open/Save a project folder using the File System Access API.
- Initialize folder structure: `project.json`, `media/`, `stills/`, `annotations/`, `thumbnails/`, `reports/`, `clips/`.
- Auto-save writes directly into the folder; manual “Save Now” available.
- `project.json` (schema `project.v1`) stores project metadata and lists.

## Acceptance Criteria
- "Create Project Folder…" prompts for parent location and project name.
- "Open Project Folder…" loads an existing folder and reads `project.json`.
- First open initializes structure if missing and saves a valid `project.json`.
- "Save Now" writes `project.json` and shows a non-blocking "Project saved" notification.
- Close project clears in-memory state; re-open restores state from the folder.

## UX Copy (from technical document)
- Buttons: "Create Project Folder…", "Open Project Folder…", "Save Now", "Close Project".
- Dialogs: “Choose a project folder”, “Name your project folder”.
- Notifications: “Project saved”, “Some items are missing” (with Relink), “Unsupported format”.

## Tasks
- [x] App bootstrap (Next.js, TS, PWA shell minimal)
- [x] UI: project toolbar with folder actions
- [x] FS helpers: ensure directories, read/write `project.json`
- [x] State: current project handle + manifest, dirty tracking, save
- [x] Notifications: basic toast for save success/failure
- [x] Validate on open: ensure required subfolders and manifest keys

## Technical Notes
- Use `window.showDirectoryPicker({ mode: 'readwrite' })` for open/create parent selection.
- For creation, prompt for name; create a subdirectory under the chosen parent via `getDirectoryHandle(name, { create: true })`.
- Write files with `createWritable()`; flush on `close()`.
- Store only in-memory handle for D1; recent projects can be added later.

Hydration fix: page defers rendering until `mounted` to avoid SSR/CSR mismatch in Chromium-only FS gating.

## Out of Scope (D1)
- Video import, still capture, annotation UI; those arrive in D2–D6.
- Backup ZIP creation (post‑MVP).

## Rollback Plan
- All changes are local to a new web app directory; if needed, delete the created files and revert.
