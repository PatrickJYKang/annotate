# Stage 2 — Homepage Layout Redesign

> **Goal:** Redesign the homepage layout so it feels intentional, spacious, and
> professional — not like a debug panel. The page should guide the user through
> a clear workflow: open/create a project → see what's inside → take action.

---

## 1  Current state & problems

### What exists today

```
┌─────────────────────────────────────────────────┐
│ header: "Football Analysis Annotator" [Fullscreen]│
├─────────────────────────────────────────────────┤
│ toolbar: [Create] [Open] [Import] [Save] [Close]│
├─────────────────────────────────────────────────┤
│ panel: "Chromium required" (conditional)         │
│ panel: ".matchproj dev notice" (dev only)        │
├─────────────────────────────────────────────────┤
│ panel: "Current Project"                         │
│   status: Folder name                            │
│   Name / Created / Videos·Marks·Stills           │
│   video buttons (stacked, full width)            │
│   "Set up match info" button                     │
│   progress bar (during upload)                   │
└─────────────────────────────────────────────────┘
```

### Problems

1. **No empty-state hierarchy** — When no project is open, the page shows a
   flat toolbar + "No project open" status. There's no visual invitation to
   act. The Create and Open buttons look identical to Import/Save/Close which
   are disabled.
2. **Toolbar is a flat dump** — All 5 buttons live in one row regardless of
   context. Project actions (Save, Close, Import) sit next to global actions
   (Create, Open) with no grouping.
3. **"Current Project" panel is a wall of text** — Folder name, project name,
   created date, and counts are stacked as plain text with no visual
   structure. Nothing is scannable.
4. **Video list is functional but bland** — Each video is a full-width button
   but there's no visual indication it's a list of selectable items. No
   thumbnails, no hover states beyond the global button hover, no indication
   of which video has marks/stills.
5. **"Set up match info" is buried** — It's a small button at the bottom of
   the video list. Easy to miss.
6. **Upload progress is inline** — The progress bar appears inside the
   project panel, making the panel jump. The portal overlay is fine but the
   inline one is redundant.
7. **Toast is basic** — Small fixed-bottom-right div, no animation.
8. **max-width container (920px)** — The `.container` class constrains content
   to 920px centred. This is fine for forms but makes the homepage feel
   narrow on wide screens. The homepage doesn't need this constraint.
9. **No drag-and-drop affordance** — The panel accepts drag-and-drop for
   video import but there's zero visual indication of this.

---

## 2  Proposed layout

### 2.1  No project open (empty state)

Full-viewport centred card. Two large action buttons. Nothing else.

```
┌─────────────────────────────────────────────────────────┐
│ header                                                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│              ┌─────────────────────────┐                │
│              │                          │                │
│              │   Football Analysis      │                │
│              │   Annotator              │                │
│              │                          │                │
│              │   [Create New Project]   │                │
│              │   [Open Existing]        │                │
│              │                          │                │
│              │   status text (muted)    │                │
│              │                          │                │
│              └─────────────────────────┘                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- Vertically and horizontally centred in the viewport below the header.
- Title repeated larger (`text-xl font-bold`) inside the card so the page
  doesn't feel empty.
- Two stacked buttons, full card width, generous padding (`py-4`).
- Muted status line below for errors / "Chromium required" warning.
- No toolbar, no disabled buttons, no panels.

### 2.2  Project open (dashboard)

Two-column layout: left = project info + actions, right = video list.

```
┌─────────────────────────────────────────────────────────┐
│ header                                        [Fullscreen]│
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── LEFT (fixed ~320px) ──┐  ┌── RIGHT (flex) ────────┐│
│  │                          │  │                         ││
│  │  Project: MyMatch        │  │  Videos (3)             ││
│  │  Created: 26 Feb 2026    │  │  ┌─────────────────────┐││
│  │                          │  │  │ ▶ match_full.mp4    │││
│  │  Videos: 3               │  │  │   1h 32m · 1920×1080│││
│  │  Marks: 47               │  │  ├─────────────────────┤││
│  │  Stills: 12              │  │  │   highlights.mp4    │││
│  │                          │  │  │   4m 12s · 1920×1080│││
│  │  ── actions ──           │  │  ├─────────────────────┤││
│  │  [Match Info →]          │  │  │   warmup.mp4        │││
│  │  [Import Video]          │  │  │   8m 03s · 1280×720 │││
│  │  [Save]                  │  │  └─────────────────────┘││
│  │                          │  │                         ││
│  │  ── project ──           │  │  Drop videos here to    ││
│  │  [Close Project]         │  │  import (dashed border)  ││
│  │                          │  │                         ││
│  └──────────────────────────┘  └─────────────────────────┘│
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- **Left sidebar** (`w-[320px] shrink-0`): project metadata + action buttons.
  - Project name prominent (`text-lg font-bold`).
  - Stats as a compact key-value list.
  - Action buttons stacked, full sidebar width, grouped:
    - Primary group: Match Info, Import Video.
    - Secondary group: Save, Close (separated by a subtle divider).
- **Right area** (`flex-1 min-w-0`): video list + drop zone.
  - Heading with count.
  - Each video is a selectable row with: label, duration, resolution as
    secondary text, and a subtle mark/still count badge.
  - Selected video gets `bg-selected border-l-2 border-accent`.
  - Clicking a video selects it AND navigates to `/player`.
  - Below the list (or when empty): a dashed-border drop zone with
    "Drop videos here to import" text.
- **No toolbar row** — actions are in the sidebar. The header remains global.
- **Remove the 920px container constraint** on this page (use `fullbleed` or
  adjust the layout wrapper).

### 2.3  Upload state

Keep the existing portal overlay. Remove the inline progress bar from the
project panel — it's redundant since the overlay covers the screen.

---

## 3  Component breakdown

| Component | What changes |
|---|---|
| `app/page.tsx` | Complete JSX restructure; split into empty-state vs dashboard renders |
| `app/layout.tsx` | Possibly allow children to opt out of `.container` max-width (or homepage sets `fullbleed`) |
| `app/globals.css` | May need a `.drop-zone` component class for the dashed-border area |

No new component files needed — this is a single-page restructure.

---

## 4  Implementation steps

### 4.1  Empty state
- [ ] Wrap the no-project view in a centred flex container (`flex items-center justify-center min-h-[calc(100vh-60px)]`)
- [ ] Add a panel card with title, two stacked CTA buttons, muted status
- [ ] Remove the toolbar entirely from the empty state
- [ ] Move "Chromium required" warning into the card as muted status text
- [ ] Remove `.matchproj` dev notice (it served its purpose)

### 4.2  Dashboard layout
- [ ] Wrap the project-open view in a two-column flex layout
- [ ] **Left sidebar**: project name, created date, stat counts (key-value grid), action buttons
- [ ] **Right area**: video list heading + selectable video rows + drop zone
- [ ] Each video row: label bold, secondary metadata (duration, resolution, mark/still counts)
- [ ] Selected video: `bg-selected` with left accent border
- [ ] Drop zone: dashed border, centred text, drag-over highlight state

### 4.3  Action button reorganisation
- [ ] Remove the top toolbar entirely
- [ ] Move Import Video, Save, Match Info into the left sidebar
- [ ] Move Close Project to bottom of sidebar with a divider above it
- [ ] Create/Open only appear in empty state; not shown when project is open

### 4.4  Upload overlay cleanup
- [ ] Remove the inline progress bar from the project panel
- [ ] Keep only the portal overlay (already exists)

### 4.5  Drop zone
- [ ] Add a visible drop zone below the video list (or as the empty video-list state)
- [ ] Dashed border (`border-2 border-dashed border-border`), muted text
- [ ] On drag-over: highlight border (`border-accent`), subtle background tint

### 4.6  Polish
- [ ] Verify empty state centres correctly at various viewport heights
- [ ] Verify sidebar doesn't collapse on narrow viewports (min-width or stack)
- [ ] Toast: no changes needed (already works)
- [ ] Build + test pass

---

## 5  Visual reference (token palette)

All colours, fonts, and radii come from the existing Tailwind v4 theme in
`globals.css`. No new tokens needed.

| Element | Classes |
|---|---|
| Empty-state card | `panel max-w-md w-full` |
| CTA button | `w-full py-4 text-base font-bold bg-raised border border-border hover:bg-hover` |
| Sidebar | `w-[320px] shrink-0 flex flex-col gap-4 p-4` |
| Stat label | `text-xs text-muted uppercase tracking-wide` |
| Stat value | `text-sm text-accent` |
| Video row | `w-full text-left px-4 py-3 border-b border-subtle hover:bg-hover` |
| Video row selected | `bg-selected border-l-2 border-accent` |
| Drop zone | `border-2 border-dashed border-border p-8 text-center text-muted` |
| Drop zone active | `border-accent bg-accent/5` |

---

## 6  Non-goals

- No routing changes — still navigates to `/player`, `/metadata`, `/stills`.
- No new data fetching or state management.
- No responsive mobile layout (desktop-first tool).
- No changes to the upload/import logic itself.
