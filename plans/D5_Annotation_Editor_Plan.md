# D5: Annotation Editor + Persistence

> **Historical project.v1 milestone.** See the
> [current technical reference](../technical_document.md) and
> [documentation index](README.md) for the frame-native pin/clip model.

## 1) Goals & Non‑Goals

- **Goals**
  - **Open from Stills page**: Add an "Annotate" hover action on each still thumbnail that opens the editor in a new browser tab.
  - **Editor page**: New route at `/annotate/[stillId]` that loads the selected still, shows a canvas stage for annotations, and persists JSON.
  - **Core tools**: Select/Move, Box, Circle, Arrow, Text.
  - **Transforms**: Drag, resize, rotate where applicable.
  - **Pan/Zoom**: Mouse wheel zoom (centered on cursor), space+drag to pan.
  - **Inspector**: Edit color, stroke width, fill, font size for selected item(s).
  - **Undo/Redo**: History stack for create/delete/move/transform/style.
  - **Persistence**: Auto-save JSON to `annotations/<still_id>.json` and index in `project.json` (`manifest.annotations`).
  - **Reopen fidelity**: Reopen the project and display identical rendering.

- **Non‑Goals**
  - Video timeline annotations.
  - Multi-user or presence.
  - Complex text layout or rich text.
  - Export pipeline (covered in D7).

## 2) Data Model & File IO

- **Manifest (existing)**: `annotations: { stillId: string; file: string; lastModified?: string }[]` in `ProjectManifestV1`.
- **Annotation file path**: `annotations/<stillId>.json` (stored under project root).
- **Schema v1 (proposed)**:
```json
{
  "schema": "annotations.v1",
  "stillId": "<uuid>",
  "image": {
    "file": "stills/000123.png",
    "width": 3840,
    "height": 2160
  },
  "shapes": [
    {
      "id": "<uuid>",
      "type": "box" | "circle" | "arrow" | "text",
      "x": 0, "y": 0, "rotation": 0,
      "w": 100, "h": 80,             // for box
      "r": 40,                          // for circle (center at x,y)
      "points": [[x1,y1],[x2,y2],...],  // for arrow/polyline
      "text": "...",                   // for text
      "style": {
        "stroke": "#ef4444",
        "fill": "transparent",
        "strokeWidth": 2,
        "fontSize": 18,
        "fontFamily": "Inter, system-ui, sans-serif"
      }
    }
  ]
}
```

- **IO rules**
  - On first open: if `annotations/<stillId>.json` does not exist, create an empty document with the base `schema` and `image` block.
  - Maintain/insert `manifest.annotations` entry `{ stillId, file: "annotations/<stillId>.json", lastModified }`.
  - Auto-save on change (debounced 500–800ms). Update `lastModified`.

## 3) UX & Controls

- **Entry point (Stills page)**
  - Add an "Annotate" hover button overlay on each still card, near the existing "Delete" button.
  - Clicking opens `window.open(`/annotate/${stillId}`, '_blank')`.

- **Editor layout**
  - Toolbar (top): Undo, Redo, Tool select (Select, Box, Circle, Arrow, Text), Zoom level, Save status.
  - Canvas stage (center): Still image as background layer, annotation layer on top.
  - Inspector (right): Style controls for the active selection (color, stroke width, fill, font size, text content).
  - Status bar (bottom): Coordinates, zoom, hints.

- **Gestures/Shortcuts**
  - Space + drag = pan. Wheel = zoom (Ctrl/Cmd+wheel for fine zoom if needed).
  - Esc = cancel drawing/selection. Delete/Backspace = delete selection.
  - Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z = Undo/Redo.
  - Numbers 1–5 to switch tools (optional).

## 4) Architecture

- **Page**: `webapp/app/annotate/[stillId]/page.tsx`
  - Client component. Retrieves `projectDir`, `manifest` from `useProject()`.
  - Locate still by `stillId` in `manifest.stills` to get file path and dimensions.
  - Create ObjectURL for still PNG via File System Access API.
  - Load or initialize annotation JSON file.
  - Render React-based editor (Konva or equivalent). Consider dynamic import to avoid SSR pitfalls.

- **Editor state**
  - `shapes[]`, `selection[]`, `tool`, `zoom`, `pan`.
  - History with limit (e.g., 100 steps) for memory safety.
  - Debounced save hook to write JSON and update `manifest.annotations`.

- **Dependencies**
  - `react-konva` and `konva` for canvas layers and transforms.
  - Ensure Next.js client-only dynamic import to prevent SSR errors (e.g., `dynamic(() => import('./Editor'), { ssr: false })`).

## 5) Milestones & Tasks

- **M5.0: Planning (this doc)**
  - Agree on scope and schema.

- **M5.1: Route + Boot**
  - Create `/annotate/[stillId]` page.
  - Wire to `useProject` and resolve still path to ObjectURL.
  - Initialize annotation JSON file and ensure `manifest.annotations` entry.

- **M5.2: Stage + Image**
  - Add Konva stage with background image sized to image dims.
  - Implement pan/zoom with wheel and space+drag.

- **M5.3: Tools**
  - Implement Box, Circle, Arrow, Text creation.
  - Selection, drag, resize, rotate (Konva transformers).

- **M5.4: Inspector + Styles**
  - Inspector panel to edit stroke, fill, strokeWidth, font size.
  - Bind changes to selection (multi-select supported as stretch goal).

- **M5.5: Undo/Redo + Persistence**
  - History stack for operations.
  - Debounced auto-save to `annotations/<stillId>.json`.
  - Update `manifest.annotations` and `lastModified`.

- **M5.6: Stills page integration**
  - Add "Annotate" hover button to still cards on `/stills`.
  - Open editor in a new tab.

- **M5.7: QA & Polish**
  - Rehydration fidelity checks.
  - Error toasts for FS access issues.
  - Performance checks on 4K assets.

## 6) Risks & Mitigations

- **Konva + Next SSR**: Use client-only dynamic import; test on browsers.
- **FS Access API limitations**: Ensure user grants permissions; handle read/write failures gracefully; show actionable toasts.
- **Large images performance**: Use Konva caching where beneficial; avoid excessive re-renders; throttle transforms.
- **Undo memory**: Cap history length; snapshot only diffs where possible.

## 7) Acceptance Criteria

- From `/stills`, clicking **Annotate** on a thumbnail opens a new tab to `/annotate/[stillId]`.
- The editor loads the PNG still accurately and allows Box/Circle/Arrow/Text creation and editing.
- Pan/zoom, selection, move, resize, rotate function smoothly.
- Changes auto-save to `annotations/<stillId>.json` and persist in `manifest.annotations`.
- Reopening the project restores the same annotations and visual state.
