# Stage 2 — Stills Page Layout Redesign

> **Goal:** Replace the old `.toolbar` / `.panel` wrapper with the navbar
> pattern and dynamic height sizing used on the player page. Tighten the
> two-pane layout so the video + stills grid fill available space.

---

## 1  Current state & problems

### What exists today

```
┌──────────────────────────────────────────────────────────────────────┐
│ .fullbleed                                                           │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ .panel  calc(100vh - headroom + 8px)  flex-col                   │ │
│ │ ┌──────────────────────────────────────────────────────────────┐ │ │
│ │ │ .toolbar  "Stills + Thumbnails"  [Generate] [Export] [Back]  │ │ │
│ │ └──────────────────────────────────────────────────────────────┘ │ │
│ │ toast / error / export-progress status rows (conditional)        │ │
│ │ ┌────────────────────────────┬─────────────────────────────────┐ │ │
│ │ │ VideoPlayerUnit (50%)      │ Stills grid (50%, scroll-y)    │ │ │
│ │ │ h-full, videoHeight=100%   │ thumbnails with hover buttons  │ │ │
│ │ └────────────────────────────┴─────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Problems

1. **`.panel` wrapper** — adds padding and rounded corners, wasting space.
2. **`.toolbar` class** — doesn't match the navbar pattern used elsewhere.
3. **`calc(100vh - var(--player-headroom) + 8px)`** — fragile magic offset;
   the player page now measures real available height dynamically.
4. **`mt-3` + `gap-4`** — wastes vertical and horizontal space.
5. **`h-full` + `videoHeight="100%"`** on VideoPlayerUnit — now that the
   component uses `flex-1 min-h-0` internally, these are unnecessary and
   may conflict.
6. **`items-start`** on the main flex row — prevents children from
   stretching to full height.

---

## 2  Proposed layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Navbar (border-b, space-filling buttons)                             │
│ [← Player]                ···    [Generate still] [Export All]       │
├──────────────────────────────┬───────────────────────────────────────┤
│ VideoPlayerUnit (50%)        │ Stills grid (50%, overflow-y-auto)    │
│  video + timeline            │  thumbnail cards with hover buttons   │
│                              │                                       │
│  (toast/error/progress       │                                       │
│   shown inline below video)  │                                       │
└──────────────────────────────┴───────────────────────────────────────┘
```

Key changes:
- **Navbar** replaces `.toolbar` — same pattern as player/metadata pages.
- **No `.panel` wrapper** — dynamic height measured from element top.
- **Toast/error/progress** moves into the navbar or a thin strip below it.
- **No `mt-3`, `gap-4`, or `items-start`** — flush layout.
- **VideoPlayerUnit** sized via flex, no explicit `h-full`/`videoHeight`.

---

## 3  Implementation steps

### 3.1  Replace toolbar with navbar
- [ ] Replace `.toolbar` with navbar: `flex items-stretch bg-surface border-b border-border shrink-0`
- [ ] Left: "← Player" button with `border-r`
- [ ] Spacer: `<span className="flex-1" />`
- [ ] Right: "Generate still here", "Export All" with `border-l`

### 3.2  Remove .panel wrapper + dynamic height
- [ ] Add `pageRootRef` + `pageHeightPx` state (same pattern as player page)
- [ ] Replace `.panel` div with plain `flex flex-col overflow-hidden` + dynamic height
- [ ] Remove the `+ 8px` magic offset

### 3.3  Move status messages
- [ ] Keep toast/error/progress as thin `shrink-0` strips between navbar and content
- [ ] They stack conditionally; no margin needed

### 3.4  Tighten main content area
- [ ] Remove `mt-3`, `gap-4`, `items-start`
- [ ] Change to `flex flex-1 min-h-0`
- [ ] Video pane: `flex-[1_1_50%] max-w-[50%] min-w-[360px] min-h-0 flex flex-col`
- [ ] Remove `h-full`, `style={{ height: '100%' }}`, `videoHeight="100%"` from VideoPlayerUnit
- [ ] Stills pane: `flex-[1_1_50%] min-w-[320px] min-h-0 overflow-y-auto border-l border-subtle p-3`

### 3.5  Polish
- [ ] Verify video + timeline fits without scroll
- [ ] Verify stills grid scrolls independently
- [ ] Build + test pass

---

## 4  Non-goals

- No changes to still capture, export, or delete logic.
- No changes to VideoPlayerUnit component.
- No changes to thumbnail card layout (hover buttons etc.).
- No responsive layout (desktop-first tool).
