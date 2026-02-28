> **DEPRECATED** — Layout kept as-is. Only the toolbar→navbar rework was
> applied. See `app/metadata/page.tsx` for the actual change.

# Stage 2 — Metadata Page Layout Redesign (DEPRECATED)

> **Goal:** Make the metadata page fill the full viewport width and height
> with **no scrolling**. Replace the ugly toolbar with a clean nav bar.
> Use the new visual style: square, space-filling buttons; dark monochrome
> panels; Tailwind utility classes throughout.
>
> Reference: `plans/post-mvp/metadata/match-metadata-screen.md`

---

## 1  Current state & problems

### What exists today

(See [match-metadata-screen.md §Page layout](../metadata/match-metadata-screen.md#page-layout)
for the original ASCII diagram.)

The page is a single-column scroll of five stacked `.panel` sections inside
a 920px `.container`. A `.toolbar` row sits at the top with two text buttons
separated by a `flex-1` spacer, and a disconnected "Import match metadata"
button floats below it.

### Problems

1. **Doesn't fill the viewport** — 920px max-width leaves wide gutters on
   larger monitors. The page feels narrow and unfinished.
2. **Scrolls heavily** — With two full teamsheets the page is 2000+ px tall.
   The user loses context of sections above/below.
3. **Toolbar is ugly** — Two small text buttons with a giant empty spacer.
   Looks like placeholder UI.
4. **"Import match metadata" floats** — Disconnected from the toolbar and
   from the Match Details form it relates to.
5. **No visual grouping** — Every section has the same `.panel` weight.
   There's no hierarchy between high-use (match details, teams) and
   low-use (notes, periods) sections.

---

## 2  Proposed layout

### 2.1  No project open

Keep existing: centred panel with "No project open" + Back button.
No changes needed.

### 2.2  Project open — full-bleed three-column layout, no scroll

Replace the toolbar with a **nav bar** (full-width, same style as the app
header). The rest of the viewport is divided into three columns. The entire
page uses `overflow: hidden` — no vertical scrolling. Individual columns
scroll internally if their content overflows.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Football Analysis Annotator                                              [Fullscreen]  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ [← Back to project] [Import match metadata]                     [Save now] [Player →]  │
├────────────────────────┬────────────────────────────────────┬────────────────────────────┤
│  LEFT COL (≈320px)     │  CENTRE COL (flex-1)               │  RIGHT COL (≈320px)       │
│  overflow-y: auto      │  overflow-y: auto                  │  overflow-y: auto         │
│                        │                                    │                           │
│  ┌─ Match Details ───┐ │  ┌─ Home Team ──────────────────┐  │  ┌─ Periods ────────────┐ │
│  │                    │ │  │                              │  │  │                      │ │
│  │  Date: [________]  │ │  │  Name: [____________________]│  │  │  Video: [dropdown v] │ │
│  │  Kickoff: [______] │ │  │                              │  │  │                      │ │
│  │  Competition: [___]│ │  │  Coach: [________]           │  │  │  ┌──────────────────┐│ │
│  │                    │ │  │  Formation: [____]           │  │  │  │ ▶ mini video     ││ │
│  │  Season: [________]│ │  │                              │  │  │  │   scrubber       ││ │
│  │  Round: [_________]│ │  │  [Import teamsheet]          │  │  │  └──────────────────┘│ │
│  │  Venue: [_________]│ │  │                              │  │  │                      │ │
│  │                    │ │  │  #  Name         Pos  C  S   │  │  │  Label    Start  End │ │
│  │  Referee: [_______]│ │  │  ── ──────────── ───  ─  ─   │  │  │  ─────── ────── ────│ │
│  │                    │ │  │  1  A. Keeper    GK   □  □  ×│  │  │  1st Half             │
│  │  Score:            │ │  │  2  B. Defender  RB   □  □  ×│  │  │    00:00.500 [Set]   │ │
│  │  [__] – [__]       │ │  │  3  C. Defender  CB   ☑  □  ×│  │  │    47:12.300 [Set]   │ │
│  │                    │ │  │  …                           │  │  │  2nd Half             │
│  └────────────────────┘ │  │  [+ Add player]              │  │  │    ––:––.––– [Set]   │ │
│                        │  │                              │  │  │    ––:––.––– [Set]   │ │
│                        │  └──────────────────────────────┘  │  │                      │ │
│                        │                                    │  │  [+ Add period]       │ │
│                        │  ┌─ Away Team ──────────────────┐  │  │                      │ │
│                        │  │                              │  │  └──────────────────────┘ │
│                        │  │  Name: [____________________]│  │                           │
│                        │  │                              │  │  ┌─ Notes ──────────────┐ │
│                        │  │  Coach: [________]           │  │  │                      │ │
│                        │  │  Formation: [____]           │  │  │  [                   ]│ │
│                        │  │                              │  │  │  [                   ]│ │
│                        │  │  [Import teamsheet]          │  │  │  [                   ]│ │
│                        │  │                              │  │  │  [  free-form match  ]│ │
│                        │  │  #  Name         Pos  C  S   │  │  │  [  notes textarea   ]│ │
│                        │  │  ── ──────────── ───  ─  ─   │  │  │  [                   ]│ │
│                        │  │  1  D. Keeper    GK   □  □  ×│  │  │  [                   ]│ │
│                        │  │  3  E. Defender  LB   □  □  ×│  │  │  [  (fills remaining ]│ │
│                        │  │  …                           │  │  │  [   column space)   ]│ │
│                        │  │  [+ Add player]              │  │  │                      │ │
│                        │  │                              │  │  └──────────────────────┘ │
│                        │  └──────────────────────────────┘  │                           │
│                        │                                    │                           │
└────────────────────────┴────────────────────────────────────┴───────────────────────────┘
```

### Key decisions

- **Full-bleed, no scroll** — The outer wrapper uses `fullbleed` and
  `h-[calc(100vh-<header+navbar>)]` with `overflow-hidden`. Each column gets
  `overflow-y-auto` so only the column that needs it scrolls.
- **Three columns** — Left (match details), Centre (teams, stacked
  vertically), Right (periods + notes). This keeps all sections visible
  or one scroll away within their column.
- **Nav bar replaces toolbar** — Full-width bar styled like the app header
  (`bg-surface border-b border-border`). Buttons are space-filling (square,
  `self-stretch`, no rounded corners). Back and Import on the left, Save
  and Player → on the right.
- **Buttons are space-filling** — Nav bar buttons use `self-stretch px-4
  border-0 border-r border-solid border-border` (same pattern as the
  Fullscreen button in the header). They fill the full height of the bar.
- **Notes moved to right column** — Under Periods. The left column is
  reserved for the compact 3×3 match details form only.
- **Team panels stacked in centre** — Home above Away in a single scrollable
  column. This gives each team the full centre-column width for the player
  table, avoiding the cramped side-by-side layout.

### 2.3  Notes on column sizing

- **Right column scrubber at 320px** — The `PeriodEditor` uses a native
  `<video controls>` element (`max-h-40 w-full`), which scales down to
  narrow widths. 320px is tight but functional. If it proves too cramped
  during implementation, bump the right column to ~380px or swap periods
  into the centre column.
- **Dead space under Match Details** — The left column form is ~300px tall.
  Below it is empty space. This is intentional — the form doesn't need to
  stretch, and the clean gap avoids visual clutter. If desired later, Notes
  could move here instead of the right column to fill the space.

### 2.4  Alternative considered: keep teams side-by-side

The original layout has Home and Away side-by-side. This works at wide
viewports but the player tables are squeezed. Moving to stacked gives each
table ~500px+ of width, which is more comfortable. If the user prefers
side-by-side, the centre column can use a nested `grid grid-cols-2` — but
this is not the default proposal.

---

## 3  Component breakdown

| Component | What changes |
|---|---|
| `app/metadata/page.tsx` | Full JSX restructure: nav bar, fullbleed, three-column layout, no-scroll wrapper |
| `components/metadata/MatchDetailsForm.tsx` | None — adapts to narrower left column |
| `components/metadata/TeamPanel.tsx` | None — receives full centre-column width |
| `components/metadata/PeriodEditor.tsx` | None — sits in right column |
| `components/metadata/FootballDataImporter.tsx` | None (modal) |
| `components/metadata/TeamsheetImporter.tsx` | None (modal) |

Only `page.tsx` needs structural changes.

---

## 4  Implementation steps

### 4.1  Nav bar (replace toolbar)
- [ ] Remove `.toolbar` div
- [ ] Add a full-width nav bar: `flex items-stretch bg-surface border-b
      border-border`
- [ ] Left group: `← Back to project` button, `Import match metadata`
      button
- [ ] Right group: `Save` button (explicit flush), `Player →` button
- [ ] All buttons: `self-stretch px-4 border-0 border-r border-solid
      border-border text-base` (space-filling, square)
- [ ] Last button in each group uses `border-l` instead of `border-r`
      as appropriate

### 4.2  Full-bleed no-scroll wrapper
- [ ] Wrap content in `fullbleed` div
- [ ] Set height to fill remaining viewport:
      `h-[calc(100vh-<header+navbar>)]` or use `flex-1` inside a
      `flex flex-col h-screen` if feasible
- [ ] Set `overflow-hidden` on the wrapper

### 4.3  Three-column layout
- [ ] Outer flex: `flex gap-0` (columns separated by borders, not gaps)
- [ ] Left column: `w-[320px] shrink-0 border-r border-subtle p-4
      overflow-y-auto flex flex-col gap-3`
  - Contains: `<MatchDetailsForm>`
- [ ] Centre column: `flex-1 min-w-0 overflow-y-auto p-4 flex flex-col
      gap-3`
  - Contains: Home `<TeamPanel>`, Away `<TeamPanel>` (stacked)
- [ ] Right column: `w-[320px] shrink-0 border-l border-subtle p-4
      overflow-y-auto flex flex-col gap-3`
  - Contains: `<PeriodEditor>`, Notes panel

### 4.4  Notes relocation
- [ ] Move Notes `<textarea>` from standalone bottom panel into the right
      column, below PeriodEditor
- [ ] Use `flex-1 min-h-[120px]` on the textarea wrapper so it fills
      remaining space in the column

### 4.5  Polish
- [ ] Verify no page-level scroll (`overflow-hidden` on wrapper)
- [ ] Verify each column scrolls independently when content overflows
- [ ] Verify nav bar buttons fill full height
- [ ] Verify MatchDetailsForm 3×3 grid fits in 320px (may need to switch
      to 2-col or 1-col grid in the left column)
- [ ] Build + test pass

---

## 5  Visual reference (token palette)

No new tokens needed. Reuses existing theme.

| Element | Key classes |
|---|---|
| Nav bar | `flex items-stretch bg-surface border-b border-border` |
| Nav button | `self-stretch px-4 border-0 border-r border-solid border-border text-base` |
| Left column | `w-[320px] shrink-0 border-r border-subtle p-4 overflow-y-auto` |
| Centre column | `flex-1 min-w-0 overflow-y-auto p-4` |
| Right column | `w-[320px] shrink-0 border-l border-subtle p-4 overflow-y-auto` |
| Notes textarea | `w-full flex-1 min-h-[120px] bg-raised text-accent border border-border p-2 resize-none` |

---

## 6  Non-goals

- No changes to child component internals (MatchDetailsForm, TeamPanel,
  PeriodEditor, modals).
- No new data fetching or state changes.
- No changes to the debounced auto-save logic.
- No responsive / mobile redesign — desktop-first tool.
