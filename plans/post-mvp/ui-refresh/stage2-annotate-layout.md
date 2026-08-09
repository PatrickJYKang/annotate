# Stage 2 — Annotate Page Layout Redesign

> **Historical project.v1 UI plan.** The former still annotator route was
> replaced by clip-local pin annotation. See the
> [current route reference](../../../technical_document.md#8-routes-and-user-visible-behavior).

> **Goal:** Replace the old `.toolbar` / `.panel` wrapper with a centred,
> context-sensitive toolbar and dynamic height sizing. The toolbar should
> show only the properties relevant to the current tool, matching the full
> set of properties available in the inspector.

---

## 1  Current state & problems

### What exists today

```
┌──────────────────────────────────────────────────────────────────────┐
│ .fullbleed                                                           │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ .panel  calc(100vh - headroom - 12px)  flex-col                  │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ .toolbar  flex items-center gap-2                            │ │ │
│ │ │ "Annotate" [Enable autosave?]                                │ │ │
│ │ │ [Select][Box][Circle][Highlight][Arrow][Poly][Text][Calibr.] │ │ │
│ │ │ Stroke [select]  ···  Color [picker]  □Occlusion [select]    │ │ │
│ │ │ [Save]  status  Zoom: 100%                                   │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │ error strip (conditional)                                        │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ Canvas (flex-1 min-h-0)                                      │ │ │
│ │ │ Editor component (Konva stage)                                │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Problems

1. **`.panel` wrapper** — adds padding, wastes canvas space.
2. **`.toolbar` class** — doesn't match the navbar pattern used elsewhere.
3. **`calc(100vh - var(--player-headroom) - 12px)`** — fragile magic offset.
4. **Incomplete defaults** — the toolbar only exposes stroke pattern and a
   single generic colour. But the inspector for a selected box shows: stroke
   colour, stroke width, stroke pattern, fill colour, fill opacity. The
   toolbar should expose the same set of defaults for the current tool so
   you can configure them *before* drawing, not only *after* selecting.
5. **No context-sensitivity** — every tool shows the same controls. Text
   tool should show font size; fill-capable tools (box, circle, highlight)
   should show fill + opacity; arrow/poly only need stroke properties.
6. **"Annotate" title** in the toolbar — wastes horizontal space.
7. **Small, cramped** — buttons and controls are tiny and packed.

### Property matrix

| Tool      | Stroke | Width | Pattern | Fill | FillOpacity | FontSize | Highlight |
|-----------|--------|-------|---------|------|-------------|----------|-----------|
| select    | —      | —     | —       | —    | —           | —        | —         |
| calibrate | —      | —     | —       | —    | —           | —        | —         |
| box       | ✓      | ✓     | ✓       | ✓    | ✓           |          |           |
| circle    | ✓      | ✓     | ✓       | ✓    | ✓           |          |           |
| highlight | ✓      | ✓     | ✓       | ✓    | ✓           |          |           |
| arrow     | ✓      | ✓     | ✓       |      |             |          |           |
| poly      | ✓      | ✓     | ✓       | ✓*   | ✓*          |          |           |
| text      | ✓      |       |         |      |             | ✓        | ✓         |

\* poly gets fill when closed, but we show the controls anyway so the
default is set in advance.

---

## 2  Proposed layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Navbar (top bar)                                                     │
│ [Save] status ··· □ Occlusion [▾] | Zoom: 100%                      │
├──────────────────────────────────────────────────────────────────────┤
│ Tool bar (centred, bigger)                                           │
│    [Select][Box][Circle][Highlight][Arrow][Poly][Text][Cal]          │
│    | Stroke [■] | Width [6] | Style [▾] | Fill [■] | Opacity [▾] | │
├──────────────────────────────────────────────────────────────────────┤
│ warning / error strips (conditional, shrink-0)                       │
├──────────────────────────────────────────────────────────────────────┤
│ Canvas (flex-1 min-h-0)                                              │
│ Editor component                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Key changes

1. **Two rows** — top navbar (save, occlusion, zoom) + centred tool bar
   (tool buttons + context-sensitive property controls).
2. **Centred tool bar** — `justify-center`, larger buttons (`px-4 py-2`,
   `text-base`).
3. **Context-sensitive controls** — property controls appear/hide based on
   the selected tool per the property matrix above.
4. **New default state** in the page: `defaultStrokeWidth`, `defaultFill`,
   `defaultFillOpacity`, `defaultFontSize`, `defaultTextHighlight`.
5. **New Editor props** — pass the new defaults so the Editor uses them
   when creating shapes.
6. **No `.panel` wrapper** — dynamic height via `pageRootRef`.
7. **"Enable autosave" warning** as a strip below the toolbar.

---

## 3  Implementation steps

### 3.1  Add new default state + Editor props
- [ ] In `page.tsx`: add state for `defaultStrokeWidth` (6), `defaultFill`
      (same as stroke), `defaultFillOpacity` (0.3), `defaultFontSize` (48),
      `defaultTextHighlight` (false)
- [ ] In `Editor.tsx`: add props `defaultStrokeWidth`, `defaultFill`,
      `defaultFillOpacity`, `defaultFontSize`, `defaultTextHighlight`
- [ ] In `Editor.tsx`: use these new defaults in all shape-creation code
      (currently hardcoded to 6, defaultAnnColor, 0.3, 48, etc.)

### 3.2  Build context-sensitive toolbar in page.tsx
- [ ] Top navbar row: [Save] + status left, spacer, Occlusion + Zoom right
- [ ] Tool bar row (centred): tool buttons (bigger) + divider + property
      controls that appear/hide based on tool
- [ ] Property controls:
  - Stroke colour: all drawing tools
  - Stroke width: box, circle, highlight, arrow, poly
  - Stroke pattern: box, circle, highlight, arrow, poly
  - Fill colour: box, circle, highlight, poly
  - Fill opacity: box, circle, highlight, poly (range 0–100)
  - Font size: text
  - Text highlight: text

### 3.3  Remove .panel wrapper + dynamic height
- [ ] Add `pageRootRef` + `pageHeightPx` state
- [ ] Replace `.panel` with plain `flex flex-col overflow-hidden` + dynamic
      height
- [ ] Remove `- 12px` magic offset

### 3.4  Move permission warning
- [ ] "Enable autosave" as a thin strip below toolbar (like error strip)

### 3.5  Polish
- [ ] Verify canvas fills available height
- [ ] Verify zoom/pan still works
- [ ] Build + test pass

---

## 4  Non-goals

- No changes to inspector panel behaviour (it still works on selected shapes).
- No changes to save/load or permission handling.
- No changes to pan/zoom behaviour.
- No responsive layout (desktop-first tool).
