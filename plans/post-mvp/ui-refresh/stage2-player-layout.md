# Stage 2 — Player Page Layout Redesign

> **Historical project.v1 UI plan.** See the [current capture reference](../../../technical_document.md#9-capture-and-tagging).

> **Goal:** Rework the player page toolbar into the new navbar pattern and tighten the overall layout so the video + timeline get maximum space.

---

## 1  Current state & problems

### What exists today

```
┌──────────────────────────────────────────────────────────────────────┐
│ .fullbleed                                                           │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ .panel  h-screen  flex-col                                       │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ .toolbar  mb-2                                               │ │ │
│ │ │ [Back] [← Match info]           ···          [Delete] [Next] │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────┬───────────────────────────┐ │ │
│ │ │ VideoPlayerUnit  (flex-1)        │ TagFolderTree (300px)     │ │ │
│ │ │                                  │                           │ │ │
│ │ │  ┌────────────────────────────┐  │  Event folder tree with   │ │ │
│ │ │  │       Video area           │  │  marks sorted by tag,     │ │ │
│ │ │  │                            │  │  drag-and-drop,           │ │ │
│ │ │  ├────────────────────────────┤  │  right-click to retag     │ │ │
│ │ │  │  Ruler                     │  │                           │ │ │
│ │ │  │  Track lane                │  │                           │ │ │
│ │ │  │  Transport bar             │  │                           │ │ │
│ │ │  └────────────────────────────┘  │                           │ │ │
│ │ └──────────────────────────────────┴───────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ .status — keyboard shortcut hints                            │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Problems

1. **Toolbar uses old `.toolbar` class** — rounded-corner panel-style row with gap-separated buttons. Doesn't match the new edge-to-edge navbar pattern used on homepage and metadata.
2. **`.panel` wrapper adds padding** — The `.panel` class adds `padding` around everything, eating into the video area unnecessarily.
3. **`mb-2` gap below toolbar** — Wastes vertical space between navbar and content on a page where every pixel of height matters.
4. **Status bar is plain text** — The keyboard hints at the bottom could move into the navbar or be removed (users learn the shortcuts quickly).
5. **`h-screen` on the panel** — Correct intent but the `.panel` padding plus `mb-2` plus status bar means the video is slightly shorter than it could be.

---

## 2  Proposed layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Navbar (border-b, no padding, space-filling buttons)                 │
│ [← Back] [Match info]          ···       [Delete] [Stills →]        │
├──────────────────────────────────┬───────────────────────────────────┤
│ VideoPlayerUnit                  │ TagFolderTree (300px, border-l)   │
│  ┌────────────────────────────┐  │                                   │
│  │       Video (flex-1)       │  │   Collapsible tag folders,        │
│  │                            │  │   mark list with timestamps,      │
│  ├────────────────────────────┤  │   drag-and-drop                   │
│  │  Ruler                     │  │                                   │
│  │  Track lane                │  │                                   │
│  │  Transport bar             │  │                                   │
│  └────────────────────────────┘  │                                   │
└──────────────────────────────────┴───────────────────────────────────┘
```

Key changes:
- **Navbar** replaces `.toolbar` — same pattern as metadata page: `flex items-stretch bg-surface border-b border-border`, buttons with `border-0 border-r border-solid border-border`.
- **No `.panel` wrapper** — content goes directly inside the fullbleed div to eliminate padding.
- **Status bar removed** — shortcut hints are discoverable enough; removing it reclaims ~24px of vertical space.
- **No `mb-2` gap** — navbar sits flush against the content.
- **Height** uses `h-screen` on the outer div directly.

---

## 3  Implementation steps

### 3.1  Replace toolbar with navbar
- [ ] Replace `<div className="toolbar mb-2 shrink-0 flex items-center gap-2">` with `<div className="flex items-stretch bg-surface border-b border-border shrink-0">`
- [ ] Restyle each button: `self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base`
- [ ] Right-side buttons get `border-l` instead of `border-r`
- [ ] Spacer: `<span className="flex-1" />`

### 3.2  Remove .panel wrapper
- [ ] Change `<div className="panel flex flex-col h-screen overflow-hidden">` to `<div className="flex flex-col h-screen overflow-hidden">`
- [ ] This eliminates the padding and rounded corners from `.panel`

### 3.3  Remove status bar
- [ ] Delete the `<div className="status shrink-0 mt-1 text-xs">` block
- [ ] Keyboard shortcuts are still active — just no longer displayed

### 3.4  Tighten the main content area
- [ ] Remove `gap-3` from the main flex row (the border-l on TagFolderTree provides visual separation)
- [ ] Remove `pl-2` from the tag tree pane (it has its own internal padding)

### 3.5  Polish
- [ ] Verify video + timeline fills available height
- [ ] Verify tag tree scrolls independently
- [ ] Verify TaggingMenu popup still positions correctly
- [ ] Build + test pass

---

## 4  Non-goals

- No changes to TagFolderTree component itself.
- No changes to tagging or mark logic.
- No changes to keyboard shortcuts (same keys, same behaviour).
- No changes to VideoPlayerUnit (already redesigned).
- No responsive layout (desktop-first tool).
