# Match metadata screen

## Goal

Add a dedicated **metadata screen** (`/metadata`) that sits in the workflow between
project setup (home page) and video tagging (`/player`). This screen captures all
non-tagging information about the match: who played, when, where, and the temporal
structure of the video (half boundaries). The data collected here enriches exports,
enables filtering across projects, and gives the tagging page contextual awareness
(e.g. "which player?" facets can be drawn from the teamsheet).

---

## Workflow position

```
Home (/):                   Metadata (/metadata):          Tagging (/player):
  Create / open project       Enter match info               Tag marks in video
  Import video(s)             Import teamsheets
  Select video ──────────►    Set half boundaries  ────────► Begin tagging
```

The metadata screen is **not blocking** — the user can skip straight to `/player` at
any time and come back to fill in metadata later. However the home page should nudge
the user toward `/metadata` after a video is imported for the first time.

---

## Data model

All metadata lives in the project manifest (`manifest.json`) under a new top-level
key `matchInfo`. This keeps everything in one file and one read/write path, matching
the existing pattern for `videos`, `marks`, `stills`, etc.

### `ProjectManifestV1` extension

```ts
export interface MatchInfo {
  // --- Teams ---
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;

  // --- Match details ---
  date: string | null;               // ISO date (YYYY-MM-DD)
  kickoffTime: string | null;        // ISO time or free-text ("15:00", "TBC")
  competition: string | null;        // e.g. "Premier League", "U18 Cup"
  season: string | null;             // e.g. "2025-26"
  round: string | null;              // e.g. "Matchday 22", "Quarter-final"
  venue: string | null;              // e.g. "Old Trafford"

  // --- Officials ---
  referee: string | null;

  // --- Result ---
  score: { home: number | null; away: number | null } | null;

  // --- Periods / half boundaries ---
  periods: MatchPeriod[];

  // --- Free-form notes ---
  notes: string | null;
}

export interface TeamInfo {
  name: string | null;
  coach: string | null;
  formation: string | null;          // e.g. "4-3-3", free-text
  players: PlayerEntry[];
}

export interface PlayerEntry {
  id: string;                        // UUID — stable reference for facets
  number: number | null;             // shirt number
  name: string;
  position: string | null;           // e.g. "GK", "CB", "LW", free-text
  isCaptain?: boolean;
  isSubstitute?: boolean;
}

export interface MatchPeriod {
  id: string;                        // UUID
  label: string;                     // "1st Half", "2nd Half", "Extra Time 1", etc.
  videoId: string;                   // which video this period belongs to
  startMs: number | null;            // video-relative timestamp
  endMs: number | null;              // video-relative timestamp
}
```

Defaults for a new project:

```ts
const defaultMatchInfo: MatchInfo = {
  homeTeam: { name: null, coach: null, formation: null, players: [] },
  awayTeam: { name: null, coach: null, formation: null, players: [] },
  date: null,
  kickoffTime: null,
  competition: null,
  season: null,
  round: null,
  venue: null,
  referee: null,
  score: null,
  periods: [],
  notes: null,
};
```

### Backwards compatibility

Existing projects will not have `matchInfo` in their manifest. On open, if
`matchInfo` is `undefined`, treat it as `defaultMatchInfo`. No migration prompt
needed — the field is simply absent until the user fills it in.

---

## Teamsheet import

### Supported formats (initial)

1. **CSV / TSV** — one row per player. Expected columns (flexible header matching):
   - `number` / `#` / `shirt`
   - `name` / `player`
   - `position` / `pos`
   - `captain` (optional, boolean-ish: "yes"/"true"/"C")
   - `substitute` / `sub` (optional, boolean-ish)

2. **Plain text (clipboard paste)** — newline-separated, each line in the form:
   `<number> <name>` or `<number>. <name>` (common when copy-pasting from a match
   programme or website). Position/captain inferred if a recognisable pattern is
   present, otherwise left blank for the user to fill in.

### Import flow

1. User clicks **Import teamsheet** on either the Home or Away panel.
2. File picker opens (accept `.csv`, `.tsv`, `.txt`) **or** the user pastes text into
   a textarea.
3. App parses the input and presents a **preview table** showing the detected columns
   mapped to `PlayerEntry` fields. The user can:
   - Re-map columns if auto-detection was wrong.
   - Edit individual cells inline.
   - Toggle captain / substitute flags.
4. On confirm, the parsed players replace (or merge into) the team's `players` array.
   Each player gets a fresh UUID.

### Future formats (out of scope now)

- JSON / XML teamsheet exports from third-party tools.
- Opta / StatsBomb / Wyscout XML feeds.
- Image OCR of printed teamsheets.

---

## Half / period boundaries

Periods let the app know where each half starts and ends within the video timeline.
This is important for:

- Displaying match-relative timestamps (e.g. "34:12" instead of raw video time).
- Splitting exports by half.
- Providing a visual guide on the seek bar.

### Setting boundaries

Two ways to set a period boundary:

1. **From the metadata screen**: A small inline video scrubber (or thumbnail timeline)
   per video. The user seeks to the moment the half starts, clicks **Set start**, then
   seeks to the end and clicks **Set end**. The current video time is captured.

2. **From the tagging page** (future shortcut): A hotkey (e.g. `H`) to stamp the
   current video time as a period boundary. This is a convenience — the canonical UI
   lives on the metadata screen.

### Default periods

When the first video is imported, auto-create two empty periods:

```ts
[
  { id: uuid(), label: "1st Half", videoId, startMs: null, endMs: null },
  { id: uuid(), label: "2nd Half", videoId, startMs: null, endMs: null },
]
```

The user can add more (e.g. extra time) or remove unused ones.

---

## Page layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Back to project                              Save  │ Player → │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ Match Details ────────────────────────────────────────────┐  │
│  │  Date: [________]  Kickoff: [______]  Competition: [_____] │  │
│  │  Season: [______]  Round: [________]  Venue: [___________] │  │
│  │  Referee: [_____]  Score: [__] – [__]                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Home Team ─────────────────┐ ┌─ Away Team ─────────────────┐│
│  │  Name: [________________]   │ │  Name: [________________]   ││
│  │  Coach: [_______________]   │ │  Coach: [_______________]   ││
│  │  Formation: [___________]   │ │  Formation: [___________]   ││
│  │  [Import teamsheet]         │ │  [Import teamsheet]         ││
│  │                             │ │                             ││
│  │  #   Name          Pos  C S │ │  #   Name          Pos  C S ││
│  │  1   A. Goalkeeper  GK      │ │  1   B. Goalkeeper  GK      ││
│  │  2   C. Defender    RB      │ │  3   D. Defender    LB      ││
│  │  …                          │ │  …                          ││
│  │  [+ Add player]             │ │  [+ Add player]             ││
│  └─────────────────────────────┘ └─────────────────────────────┘│
│                                                                  │
│  ┌─ Periods ─────────────────────────────────────────────────┐  │
│  │  Video: match_video.mp4                                    │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │ ▶ mini scrubber / thumbnail strip                    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  1st Half   Start: 0:00.500 [Set]   End: 47:12.300 [Set]  │  │
│  │  2nd Half   Start: ──────── [Set]   End: ────────  [Set]  │  │
│  │  [+ Add period]                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Notes ───────────────────────────────────────────────────┐  │
│  │  [                                                        ]  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component plan

### New components

1. **`webapp/app/metadata/page.tsx`** — The metadata page. Reads `manifest.matchInfo`
   from `ProjectContext`, renders the form sections, saves back to manifest on change.

2. **`webapp/components/metadata/MatchDetailsForm.tsx`** — Controlled form for the
   top-level match fields (date, competition, venue, etc.). Props: `matchInfo`,
   `onChange`.

3. **`webapp/components/metadata/TeamPanel.tsx`** — One panel for a team (home or
   away). Shows team name, coach, formation, player table, import button. Props:
   `team: TeamInfo`, `onChange`, `label: "Home" | "Away"`.

4. **`webapp/components/metadata/TeamsheetImporter.tsx`** — Modal/dialog for importing
   a teamsheet. Handles file parsing, column mapping preview, and confirmation. Props:
   `onImport: (players: PlayerEntry[]) => void`, `onCancel`.

5. **`webapp/components/metadata/PeriodEditor.tsx`** — Period boundary editor with
   mini video scrubber. Props: `periods`, `videos`, `onChange`.

### Reused components

- **`VideoPlayerUnit`** — Potentially a lightweight variant for the mini scrubber in
  the period editor (or a new thin wrapper).

### New types

- **`webapp/lib/types/project.ts`** — Add `MatchInfo`, `TeamInfo`, `PlayerEntry`,
  `MatchPeriod` interfaces and extend `ProjectManifestV1` with optional `matchInfo`.

### New utilities

- **`webapp/lib/metadata/teamsheetParser.ts`** — CSV/TSV/plain-text parsing logic.
  Exports `parseTeamsheetCSV(text: string): PlayerEntry[]` and
  `parseTeamsheetPlainText(text: string): PlayerEntry[]`.

---

## Data flow

```
manifest.matchInfo ──read──► MatchInfo (state in page)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            MatchDetailsForm   TeamPanel ×2   PeriodEditor
                    │               │               │
                onChange         onChange         onChange
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                          mutateManifest (auto-save)
```

Changes are saved to the manifest (and flushed to disk) on every meaningful edit —
same debounced-write pattern as the tagging page. No separate "save" action needed,
though an explicit **Save** button is provided for confidence.

---

## Interaction with the tagging page

### Player facets (future integration)

Once teamsheets are populated, the tagging schema could reference players as a facet
source. For example, a facet group `player` with `source: "teamsheet"` would
dynamically populate its options from `matchInfo.homeTeam.players` and
`matchInfo.awayTeam.players`. This is **not in scope now** but the data model supports
it — each `PlayerEntry` has a stable `id` that can be stored in `TaggingSelection.facets`.

### Period-aware timestamps (future integration)

Once periods are set, the tagging page can display match-relative timestamps instead
of raw video times (e.g. "1H 34:12" instead of "34:12.500"). This is a display-layer
change in `TagFolderTree` and the status bar. **Not in scope now.**

---

## Navigation updates

- Home page (`/`): After a video is imported, show a **"Set up match info →"** link
  that navigates to `/metadata`. If `matchInfo` already has data, show
  **"Edit match info"** instead.
- Metadata page (`/metadata`): **"← Back to project"** returns to `/`. **"Player →"**
  navigates to `/player`.
- Player page (`/player`): Consider adding a **"← Match info"** link in the toolbar
  for quick access back.

---

## Implementation checklist

### 1. Data model
- [ ] Add `MatchInfo`, `TeamInfo`, `PlayerEntry`, `MatchPeriod` interfaces to `webapp/lib/types/project.ts`.
- [ ] Add optional `matchInfo?: MatchInfo` to `ProjectManifestV1`.
- [ ] Add `defaultMatchInfo()` helper.
- [ ] Ensure `readManifest` / `writeManifest` round-trip `matchInfo` correctly (no special handling needed — it's just JSON).

### 2. Teamsheet parser
- [ ] Create `webapp/lib/metadata/teamsheetParser.ts`.
- [ ] Implement `parseTeamsheetCSV(text: string): PlayerEntry[]` with flexible header matching.
- [ ] Implement `parseTeamsheetPlainText(text: string): PlayerEntry[]` for paste-friendly format.
- [ ] Unit tests for both parsers with edge cases (missing columns, extra whitespace, unicode names).

### 3. Metadata page shell
- [ ] Create `webapp/app/metadata/page.tsx`.
- [ ] Read `matchInfo` from manifest via `ProjectContext`.
- [ ] Layout the page sections (match details, teams, periods, notes).
- [ ] Wire save: on change, update manifest in context and flush to disk (debounced).
- [ ] Navigation: back to home, forward to player.

### 4. Match details form
- [ ] Create `webapp/components/metadata/MatchDetailsForm.tsx`.
- [ ] Fields: date, kickoff time, competition, season, round, venue, referee, score.
- [ ] Controlled inputs, `onChange` callback.

### 5. Team panel + teamsheet import
- [ ] Create `webapp/components/metadata/TeamPanel.tsx`.
- [ ] Team name, coach, formation fields.
- [ ] Inline editable player table (number, name, position, captain, substitute).
- [ ] Add / remove player rows.
- [ ] Create `webapp/components/metadata/TeamsheetImporter.tsx`.
- [ ] File picker (CSV/TSV/TXT) and paste-from-clipboard textarea.
- [ ] Preview table with column mapping.
- [ ] Confirm → populate team's player array.

### 6. Period editor
- [ ] Create `webapp/components/metadata/PeriodEditor.tsx`.
- [ ] List periods with start/end time fields.
- [ ] "Set" buttons that capture current scrubber position.
- [ ] Mini video scrubber (lightweight — could reuse `<video>` with custom controls or a thin wrapper around `VideoPlayerUnit`).
- [ ] Add / remove period rows.
- [ ] Auto-create default periods (1st Half, 2nd Half) for new videos.

### 7. Navigation updates
- [ ] Home page: Add "Set up match info →" / "Edit match info" link after video import.
- [ ] Metadata page: navigation toolbar (back, save, forward to player).
- [ ] Player page: optional "← Match info" link.

### 8. Visual polish
- [ ] Consistent dark-theme styling matching the tagging page.
- [ ] Form validation hints (e.g. date format, shirt number uniqueness).
- [ ] Responsive layout (two-column team panels collapse to single column on narrow viewports).
- [ ] Keyboard navigation between form fields.

---

## Out of scope (for now)

- Opta / StatsBomb / Wyscout XML feed import.
- Image OCR for printed teamsheets.
- Player photo / headshot import.
- Substitution tracking (which player replaced whom, at what minute).
- Dynamic facet population from teamsheet (architecture supports it; see above).
- Match-relative timestamp display on the tagging page.
- Multi-video period spanning (one period across two video files).
- Undo/redo on the metadata form (use manifest-level undo if ever needed).
