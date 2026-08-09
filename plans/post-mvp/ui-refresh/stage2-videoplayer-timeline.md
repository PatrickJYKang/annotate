# Stage 2 — VideoPlayerUnit Redesign: Editor-Style Timeline

> **Historical UI plan.** See the [current capture reference](../../../technical_document.md#9-capture-and-tagging) for implemented timeline behavior.

> **Goal:** Redesign the VideoPlayerUnit controls to feel like a video **editor** timeline (Premiere Pro / DaVinci Resolve) rather than a YouTube-style media player. The video content itself doesn't change — the interaction model around scrubbing, marks, and zoom does.

---

## 1  Current state & problems

### What exists today

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│                        <video>                               │
│                     (fills pane)                              │
│                                                              │
│                                                              │
│  ┌─ gradient overlay ──────────────────────────────────────┐ │
│  │                                                          │ │
│  │  [=============================-------] seek bar (thin) │ │
│  │   │  │    │  │     ← mark pips (tiny yellow/orange)     │ │
│  │                                                          │ │
│  │  [⏪] [◀] [▶/⏸] [▶] [⏩]      00:34 / 1:30:00  [🔖][⛶]│ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Problems

1. **YouTube-style seek bar** — Thin rounded progress bar with a small pill-shaped handle. Fine for passive viewing, wrong for frame-accurate annotation work. Too small to click precisely.
2. **No zoom** — The entire video duration is always mapped 1:1 to the bar width. For a 90-minute match this means each pixel represents ~5–10 seconds, making it impossible to scrub to a precise moment.
3. **Controls overlay the video** — The gradient overlay hides video content at the bottom. In an editor, controls live *below* the video, not on top.
4. **Mark pips are tiny** — 3px-wide coloured lines on a 12px-tall bar. Hard to see, hard to click, no labels.
5. **No timecode ruler** — No visual reference for absolute time. The only readout is the `00:34 / 1:30:00` text at the bottom right.
6. **Transport buttons look like a media player** — Generic play/pause and skip icons. No visual connection to the editing workflow (mark, tag, scrub).
7. **No waveform or visual density** — The seek bar is a flat solid colour. No hint of where interesting content might be (marks cluster, etc.).

---

## 2  Proposed design

### 2.1  Layout: controls below the video, not overlaid

Separate the video viewport from the timeline. The video sits above; the timeline panel sits below as a distinct region with its own background.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│                        <video>                               │
│                     (fills pane)                              │
│                                                              │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  TIMELINE PANEL (bg-surface, border-t border-border)         │
│                                                              │
│  ┌─ Timecode ruler ────────────────────────────────────────┐ │
│  │ 0:00    5:00    10:00   15:00   20:00   25:00   30:00   │ │
│  │ ┊       ┊       ┊       ┊       ┊       ┊       ┊       │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌─ Track lane ────────────────────────────────────────────┐ │
│  │ ▮ ▮    ▮  ▮▮▮    ▮         ▮  ▮    ▮▮   ▮   ← marks   │ │
│  │ ▎                            ← playhead (red line)      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Transport ─────────────────────────────────────────────┐ │
│  │ [⏪] [◀] [▶/⏸] [▶] [⏩]  00:34:12.500  [+Mark] [Zoom] │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2  Timeline anatomy (detailed)

```
Timecode ruler
┌────────────────────────────────────────────────────────────────────┐
│ |         |         |         |         |         |         |      │
│ 0:00     5:00     10:00    15:00    20:00    25:00    30:00  35:00│
│ ┊    ┊    ┊    ┊    ┊    ┊    ┊    ┊    ┊    ┊    ┊    ┊    ┊     │
│ (minor ticks every 1 min, major ticks every 5 min — adapts to    │
│  zoom level: at high zoom, ticks become 1s / 10s / 1min etc.)    │
└────────────────────────────────────────────────────────────────────┘

Track lane
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│  ▮   ▮▮  ▮    ▮▮▮▮▮   ▮      ▮▮   ▮      ▮  ▮▮     ▮  ← marks  │
│     ┃                                                              │
│     ┃ ← playhead (2px wide, red/accent, full height of lane)      │
│                                                                    │
│  (each mark is a vertical pip, 4-6px wide, full lane height)      │
│  (yellow = untagged, orange = selected, accent = tagged)           │
│  (hover: tooltip with timestamp + label)                           │
│  (click: select mark + seek to it)                                 │
│  (click empty space: seek to that time)                            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

Transport bar
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│  [⏪] [◀] [▶⏸] [▶] [⏩]  │  00:34:12.500 / 1:30:00.000  │  [🔖+] │
│   │    │    │    │    │   │         timecode readout       │  add   │
│   │    │    │    │    │   │  (click to type a timecode     │  mark  │
│   skip frame play frame skip │   and jump to it)           │        │
│   back back      fwd  fwd│                                │        │
│                           │                                │        │
│  ─────────────────────────┼────────────────────────────────┤        │
│                                                                    │
│  Zoom: [─────●──────] 1x ─ 100x   (or Ctrl+Scroll on timeline)   │
│  (slider controls pixels-per-second, timeline scrolls horizontally)│
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.3  Key design decisions

- **Controls below, not overlaid** — The timeline panel is a permanent region below the video. No gradient overlay, no disappearing-on-idle. The video `<video>` element shrinks slightly to make room. Height of the timeline panel is fixed (~120–140px).
- **Timecode ruler** — A horizontal ruler with tick marks and time labels. Ticks adapt to zoom level (at 1× zoom on a 90-min video: major ticks every 5 min, minor every 1 min; at 20× zoom: major every 30s, minor every 5s; etc.).
- **Track lane** — A horizontal strip below the ruler. Marks are rendered as vertical pips (4–6px wide, full lane height ~24px). The playhead is a thin red/accent vertical line spanning the full lane height.
- **Zoomable timeline** — A zoom slider (or Ctrl+Scroll on the timeline) controls the horizontal scale. At 1× the full duration fits in the viewport. At higher zoom, only a portion is visible and the timeline scrolls horizontally. The playhead stays centred (or the view follows the playhead during playback).
- **Horizontal scroll** — When zoomed in, the timeline is wider than the viewport. Scroll via mouse wheel (horizontal), trackpad swipe, or drag-scroll on the ruler/lane. The visible window is a sliding viewport over the full duration.
- **Mark pips are prominent** — Full lane height, 4–6px wide, colour-coded. Clickable (selects the mark and seeks to it). Tooltip on hover shows timestamp and label/tags.
- **Transport bar** — Buttons are square, space-filling (matching the navbar style). Timecode readout uses monospace font. Add-mark button is prominent.
- **No waveform for now** — Generating a waveform from video audio is possible but complex. Deferred. The track lane just shows marks on a flat bg-raised background. Can be added later.

---

## 3  Zoom behaviour

### 3.1  Zoom model

The timeline has a **pixels-per-second** (pps) value that determines the horizontal scale.

- **Minimum zoom (1×)**: The full video duration fits exactly in the timeline width. `pps = timelineWidth / durationSeconds`.
- **Maximum zoom (100×)**: Each second occupies `100 × minPps` pixels. For a 90-min video at 1200px width, 1× ≈ 0.22 px/s → 100× ≈ 22 px/s (about 54 seconds visible at a time).
- **Zoom control**: A horizontal slider in the transport bar, plus Ctrl+Scroll (or pinch on trackpad) on the timeline area.
- **Zoom anchor**: Zoom centres on the playhead position (or on the mouse cursor if triggered by scroll-wheel).

### 3.2  Scroll model

- **scrollLeft** of the timeline container tracks the visible window.
- During playback, the view auto-scrolls to keep the playhead visible (centred or at ~33% from the left edge).
- When paused, the user scrolls freely. Resuming playback snaps the view back to the playhead.
- Mouse wheel (vertical) on the timeline = horizontal scroll (standard NLE convention). Ctrl+wheel = zoom.

### 3.3  Tick calculation

Ticks adapt to zoom so labels don't overlap:

| Visible duration | Major tick | Minor tick | Label format |
|---|---|---|---|
| > 30 min | 5 min | 1 min | `H:MM` or `M:SS` |
| 5–30 min | 1 min | 15 s | `M:SS` |
| 1–5 min | 15 s | 5 s | `M:SS` |
| 15s–1 min | 5 s | 1 s | `M:SS.s` |
| < 15 s | 1 s | 0.25 s | `M:SS.mmm` |

---

## 4  Component breakdown

### 4.1  New internal components (inside VideoPlayerUnit)

These are not separate files — they're extracted render functions or small subcomponents within `VideoPlayerUnit.tsx` to keep the file manageable.

| Component | Description |
|---|---|
| **TimecodeRuler** | Canvas or div-based ruler. Renders tick marks and time labels based on zoom level, scroll offset, and duration. |
| **TrackLane** | The mark pip area. Renders mark pips, playhead line, handles click-to-seek and click-to-select-mark. |
| **ZoomSlider** | Horizontal range input for zoom level. Displays current zoom multiplier. |
| **TransportBar** | Buttons row: skip/step/play/step/skip, timecode readout, add-mark, zoom slider. |

### 4.2  Changes to VideoPlayerUnit.tsx

| Area | What changes |
|---|---|
| **Layout** | Remove gradient overlay. Video and timeline panel are siblings in a flex column. |
| **Seek bar** | Replaced entirely by TimecodeRuler + TrackLane. |
| **Mark rendering** | Move from tiny pips on the seek bar to full-height pips in the track lane. |
| **State** | Add `zoom` (number, 1–100), `scrollOffset` (px), derived `pps` (pixels-per-second). |
| **Interactions** | Add Ctrl+Scroll for zoom, horizontal scroll for pan, click on ruler/lane for seek. |
| **Transport buttons** | Same icons, restyle to square space-filling buttons (matching navbar pattern). |
| **Timecode readout** | Monospace, larger, clickable-to-type (stretch goal). |
| **Props** | No new props needed — zoom is internal state. |

### 4.3  Files changed

| File | Change |
|---|---|
| `components/player/VideoPlayerUnit.tsx` | Major rewrite of the controls section |
| `app/player/page.tsx` | Minor — may need to adjust `videoHeight` or remove `--player-headroom` calc |
| `app/globals.css` | Possibly add timeline-specific utility classes if needed |

---

## 5  Implementation steps

### 5.1  Separate video from controls
- [ ] Remove the gradient overlay div (the `absolute left-0 right-0 bottom-0` div with `linear-gradient` background)
- [ ] Restructure layout: `flex flex-col` → `<video>` fills available space, timeline panel has fixed height below it
- [ ] Timeline panel: `shrink-0 h-[130px] bg-surface border-t border-border`

### 5.2  Timecode ruler
- [ ] Render a horizontal ruler div with tick marks
- [ ] Calculate tick intervals based on zoom level and visible duration (see §3.3 tick table)
- [ ] Major ticks: tall lines + text labels. Minor ticks: short lines only
- [ ] Ruler scrolls horizontally with the timeline

### 5.3  Track lane
- [ ] Render a horizontal strip (`h-6 bg-raised relative`)
- [ ] Render marks as vertical pips (4–6px wide, full lane height)
  - Yellow (`#fbbf24`) = untagged
  - Accent/blue = tagged
  - Orange (`#f97316`) = selected
- [ ] Render playhead as a 2px red/accent vertical line at current time
- [ ] Click on lane = seek to that time (same maths as current seek bar)
- [ ] Click on a mark pip = select mark + seek

### 5.4  Zoom
- [ ] Add `zoom` state (default 1, range 1–100)
- [ ] Compute `pps = (timelineWidth / durationSeconds) * zoom`
- [ ] Compute `totalTimelineWidth = durationSeconds * pps`
- [ ] Timeline container: `overflow-x: auto` (or manual scroll tracking)
- [ ] Ctrl+Scroll on timeline = adjust zoom (anchor at cursor position)
- [ ] ZoomSlider in transport bar for mouse-based zoom control
- [ ] During playback: auto-scroll to keep playhead visible

### 5.5  Transport bar
- [ ] Restyle buttons: square, `self-stretch`, border separators (matching navbar pattern)
- [ ] Timecode readout: `font-mono text-sm`, shows `HH:MM:SS.mmm` or `MM:SS.mmm`
- [ ] Add-mark button: prominent, same style as transport buttons
- [ ] Fullscreen button: keep existing, same restyle
- [ ] Zoom slider: inline at the right end of the transport bar

### 5.6  Horizontal scroll
- [ ] Mouse wheel on timeline area = horizontal scroll
- [ ] Ctrl+wheel = zoom (not scroll)
- [ ] Trackpad horizontal swipe = scroll
- [ ] During playback, auto-scroll so playhead stays at ~33% from left
- [ ] When paused, free scroll. On play resume, snap back to playhead

### 5.7  Mark tooltips
- [ ] On hover over a mark pip, show a small tooltip with:
  - Timestamp (`MM:SS.mmm`)
  - Tag label (if tagged)
- [ ] Use absolute-positioned div, not browser `title` attr

### 5.8  Polish & edge cases
- [ ] Verify timeline works with very short videos (<10s)
- [ ] Verify timeline works with very long videos (>2h)
- [ ] Verify keyboard hotkeys still work (no regressions)
- [ ] Verify marks update correctly when added/deleted
- [ ] Verify selected mark highlights correctly in track lane
- [ ] Build + test pass

---

## 6  Visual reference

```
Video viewport (flex-1, min-h-0)
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                      <video element>                         │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ bg-surface, border-t border-border, h-[130px], shrink-0     │
│                                                              │
│  0:00   5:00   10:00  15:00  20:00  25:00  30:00  35:00     │ ← ruler
│  ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   ┊   │    (h-5, text-xs text-muted)
│ ┌────────────────────────────────────────────────────────┐   │
│ │▮  ▮▮ ▮   ▮▮▮▮ ▮     ┃▮▮  ▮    ▮▮  ▮    ▮ ▮▮    ▮    │   │ ← track lane
│ │                      ┃ ← playhead (2px, text-danger)  │   │    (h-6, bg-raised)
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ [⏪][◀][▶⏸][▶][⏩] │ 00:34:12.500 / 1:30:00.000 │ [🔖+] │──│ ← transport
│                      │  font-mono text-sm         │       │  │    (h-9, flex, items-stretch)
│                      │                            │       │  │
│  Zoom: [─────●──────────] ×4.2                           │  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Token palette — no new tokens needed:

| Element | Key classes |
|---|---|
| Timeline panel | `shrink-0 h-[130px] bg-surface border-t border-border flex flex-col` |
| Ruler | `h-5 relative overflow-hidden text-xs text-muted` |
| Track lane | `h-6 bg-raised relative cursor-crosshair` |
| Mark pip | `absolute top-0 bottom-0 w-1 bg-[#fbbf24]` (or `bg-[#f97316]` selected, `bg-accent` tagged) |
| Playhead | `absolute top-0 bottom-0 w-[2px] bg-danger z-[2]` |
| Transport bar | `flex items-stretch` |
| Transport button | `self-stretch px-3 border-0 border-r border-solid border-border` |
| Timecode | `font-mono text-sm text-accent px-3 self-center` |
| Zoom slider | `w-32 accent-accent self-center` |

---

## 7  Non-goals

- No audio waveform rendering (can be added later).
- No multi-track lanes (only one mark track).
- No drag-to-reorder marks on the timeline.
- No timeline thumbnails / filmstrip preview.
- No changes to the mark data model.
- No changes to hotkey bindings (same keys, same behaviour).
- No changes to the TagFolderTree or tagging workflow.
