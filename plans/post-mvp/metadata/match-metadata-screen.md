# Match metadata screen

## Goal

Add a dedicated **metadata screen** (`/metadata`) that sits in the workflow between
project setup (home page) and video tagging (`/player`). This screen captures all
non-tagging information about the match: who played, when, where, and the temporal
structure of the video (half boundaries). The data collected here enriches exports,
enables filtering across projects, and gives the tagging page contextual awareness
(e.g. "which player?" facets can be drawn from the teamsheet).

Substitution tracking is explicitly optional and must not block normal analysis
workflows.

---

## Workflow position

```
Home (/):                   Metadata (/metadata):          Tagging (/player):
  Create / open project       Enter match info               Tag marks in video
  Import video(s)             Import match metadata
  Select video ──────────►    Set half boundaries  ────────► Begin tagging
```

The metadata screen is **not blocking** — the user can skip straight to `/player` at
any time and come back to fill in metadata later. However the home page should nudge
the user toward `/metadata` after a video is imported for the first time.

Delivery rule: substitution recording is optional and can be deferred without blocking
the metadata/timestamp rollout.

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

  // --- Substitutions (optional) ---
  substitutions: Substitution[];

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

export interface Substitution {
  id: string;                        // UUID
  team: "home" | "away";
  minute: number | null;             // match minute (not video time)
  playerOut: string;                 // PlayerEntry.id
  playerIn: string;                  // PlayerEntry.id
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
  substitutions: [],
  periods: [],
  notes: null,
};
```

### Backwards compatibility

Existing projects will not have `matchInfo` in their manifest. On open, if
`matchInfo` is `undefined`, treat it as `defaultMatchInfo`. No migration prompt
needed — the field is simply absent until the user fills it in.

---

## Import match metadata (football-data.org)

For professional matches the **primary import path** is the
[football-data.org v4 API](https://docs.football-data.org/general/v4/match.html).
A single `GET /v4/matches/{id}` call returns everything needed to populate the entire
metadata form — teams, coaches, formations, full lineups & bench, date, competition,
venue, referee, score, and substitutions — in one shot. This is exposed as a top-level
**"Import match metadata"** button on the metadata page, not buried inside a
per-team teamsheet panel.

#### API overview

- **Base URL**: `https://api.football-data.org/v4`
- **Auth**: `X-Auth-Token` header (free tier available with rate limits).
- **Key endpoints**:
  - `GET /v4/matches/{id}` — full match detail.
  - `GET /v4/competitions/{code}/matches?dateFrom=&dateTo=` — list matches in a
    competition within a date range.
  - `GET /v4/teams/{id}/matches?dateFrom=&dateTo=` — list matches for a team.
  - `GET /v4/matches?date=YYYY-MM-DD` — all matches on a given date.
- **Coverage**: Major European leagues (Premier League, La Liga, Bundesliga, Serie A,
  Ligue 1, Eredivisie, Primeira Liga, Championship) plus Champions League, EC, World
  Cup, etc. Exact coverage depends on the subscription tier.

#### Field mapping — API → MatchInfo

| API field                           | → MatchInfo field              |
|-------------------------------------|--------------------------------|
| `homeTeam.name`                     | `homeTeam.name`                |
| `homeTeam.coach.name`               | `homeTeam.coach`               |
| `homeTeam.formation`                | `homeTeam.formation`           |
| `homeTeam.lineup[]`                 | `homeTeam.players` (starting)  |
| `homeTeam.bench[]`                  | `homeTeam.players` (subs)      |
| *(same for `awayTeam`)*             |                                |
| `utcDate`                           | `date` + `kickoffTime`         |
| `competition.name`                  | `competition`                  |
| `season.startDate` / `endDate`      | `season`                       |
| `matchday` / `stage`                | `round`                        |
| `venue`                             | `venue`                        |
| `referees[]` (type = `REFEREE`)     | `referee`                      |
| `score.fullTime.home` / `.away`     | `score`                        |
| `substitutions[]`                   | `substitutions`                |

The API substitution objects `{ minute, team, playerOut, playerIn }` map to our
`Substitution` type. Player references are resolved by matching the API player name
back to the imported `PlayerEntry` by name (since we don't persist external IDs).

Each player in `lineup` / `bench` has `{ id, name, position, shirtNumber }`. These
map directly to `PlayerEntry`:

| API player field | → PlayerEntry field  | Notes                                  |
|------------------|----------------------|----------------------------------------|
| `id`             | *(not stored)*       | External ID; we mint our own UUIDs     |
| `name`           | `name`               |                                        |
| `shirtNumber`    | `number`             |                                        |
| `position`       | `position`           | API uses long form ("Centre-Back"); normalise to short codes ("CB") for consistency |
| *(derived)*      | `isSubstitute`       | `true` if player came from `bench[]`   |
| *(not provided)* | `isCaptain`          | API doesn't flag captain; leave `false`|

#### Position normalisation map

```ts
const POSITION_SHORT: Record<string, string> = {
  "Goalkeeper": "GK",
  "Centre-Back": "CB",
  "Left-Back": "LB",
  "Right-Back": "RB",
  "Defensive Midfield": "DM",
  "Central Midfield": "CM",
  "Attacking Midfield": "AM",
  "Left Winger": "LW",
  "Right Winger": "RW",
  "Centre-Forward": "CF",
  "Left Midfield": "LM",
  "Right Midfield": "RM",
};
```

#### User flow — search, select, preview, confirm

1. User clicks **"Import match metadata"** at the top of the metadata page.
2. A modal (`FootballDataImporter`) opens with:
   - **API key field** (persisted in `localStorage` so it only needs to be entered
     once; never written to the project manifest or disk).
   - **Search controls**:
     - **By competition + date range**: dropdowns for known competition codes
       (PL, BL1, SA, PD, FL1, etc.) + date pickers.
     - **By team + date range**: text search for team name, then date pickers.
     - **By match ID**: direct numeric input if the user already knows the ID.
3. App calls the appropriate list endpoint and displays results in a scrollable table
   showing: date, home team vs away team, score, competition.
4. User selects a match → app calls `GET /v4/matches/{id}` for full detail.
5. A **preview panel** shows all the data that will be imported, grouped into:
   - Match details (date, competition, venue, referee, score)
   - Home team (coach, formation, lineup, bench)
   - Away team (same)
6. User can **deselect** individual sections (e.g. keep existing teamsheets but import
   match details only).
7. On **Confirm**, the selected data merges into `matchInfo`:
   - Imported fields overwrite existing values.
   - Players get fresh UUIDs (external API IDs are not persisted).
   - Any existing manually-entered data in deselected sections is preserved.

#### API key management

- Stored in `localStorage` under key `football_data_api_key`.
- **Never** written to the project directory, manifest, or any file on disk.
- The modal shows a small note: *"Your API key is stored locally in this browser and
  is never saved to your project files."*
- A "Clear key" button lets the user remove it.
- If no key is set, the import button in the modal is disabled with a prompt to get a
  free key at https://www.football-data.org/client/register.

#### Rate limiting & error handling

- Free tier: 10 requests/minute. The UI should debounce search requests and show a
  clear message if rate-limited (HTTP 429).
- Network errors / invalid key (HTTP 403) → show inline error, don't close the modal.
- If a match has `status: SCHEDULED` or `TIMED`, lineup data may be unavailable.
  Warn the user: *"Lineups are not yet available for this match."*

#### New component

- **`webapp/components/metadata/FootballDataImporter.tsx`** — Modal with search,
  results list, match preview, section toggles, and confirm/cancel. Receives
  `onImport: (partial: Partial<MatchInfo>) => void` and `onCancel`.

#### New utility

- **`webapp/lib/metadata/footballDataApi.ts`** — Thin API client:
  - `searchMatchesByCompetition(apiKey, competitionCode, dateFrom, dateTo)`
  - `searchMatchesByTeam(apiKey, teamId, dateFrom, dateTo)`
  - `searchMatchesByDate(apiKey, date)`
  - `fetchMatch(apiKey, matchId)` → returns raw API JSON.
  - `mapMatchToMatchInfo(apiMatch)` → transforms API response to `Partial<MatchInfo>`.
  - `normalisePosition(apiPosition: string | null): string | null`

---

## Manual teamsheet import

For non-professional matches or leagues not covered by the API, teamsheets can be
imported manually per team.

### Supported formats

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

1. User clicks **"Import teamsheet"** on the Home or Away team panel.
2. File picker opens (accept `.csv`, `.tsv`, `.txt`) **or** the user pastes text into
   a textarea.
3. App parses the input and presents a **preview table** showing the detected columns
   mapped to `PlayerEntry` fields. The user can:
   - Re-map columns if auto-detection was wrong.
   - Edit individual cells inline.
   - Toggle captain / substitute flags.
4. On confirm, the parsed players replace (or merge into) the team's `players` array.
   Each player gets a fresh UUID.

### Image OCR import (future)

For printed or photographed teamsheets (match programmes, whiteboards, handwritten
sheets), an OCR pipeline could extract player names and numbers from an image.

- User uploads or photographs a teamsheet image.
- App runs OCR (likely via a cloud API such as Google Cloud Vision or Tesseract.js
  for offline) and attempts to extract rows of `<number> <name>`.
- Parsed output is fed into the same preview table as CSV/plain-text import for the
  user to correct before confirming.
- This is a stretch feature — prioritise after the API and CSV paths are solid.

### Other future formats (out of scope now)

- Opta / StatsBomb / Wyscout XML feeds.

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
│  [Import match metadata]                                         │
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
  `Substitution`, `MatchPeriod` interfaces and extend `ProjectManifestV1` with
  optional `matchInfo`.

### New utilities

- **`webapp/lib/metadata/teamsheetParser.ts`** — CSV/TSV/plain-text parsing logic.
  Exports `parseTeamsheetCSV(text: string): PlayerEntry[]` and
  `parseTeamsheetPlainText(text: string): PlayerEntry[]`.
- **`webapp/lib/metadata/footballDataApi.ts`** — football-data.org client +
  response mapping utilities.
- **`webapp/lib/metadata/teamsheetOcr.ts`** — OCR extraction helpers for
  image-based teamsheet import.
- **`webapp/lib/metadata/timeDisplay.ts`** — Visual-only match-relative timestamp
  formatting with raw-time fallback when period boundaries are missing.

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

### Substitution recording on the tagging page (optional)

Substitutions are **not** regular tagging events — they are a separate first-class
concept. On the tagging page, a dedicated **"Record substitution"** action (hotkey or
button) lets the user stamp a sub at the current video time:

1. User triggers **Record substitution** (e.g. hotkey `S` or a toolbar button).
2. A lightweight picker appears showing the players for each team (drawn from
   `matchInfo.homeTeam.players` / `matchInfo.awayTeam.players`).
3. User selects **team**, **player out**, and **player in**.
4. The current video time is converted to match-minute (using period boundaries).
   If boundaries are missing, the user can enter the minute manually. The
   `Substitution` entry is appended to `matchInfo.substitutions`.
5. The sub is displayed in a small **"Substitutions"** sidebar section (separate from
   the tag folder tree), ordered by minute.

Substitutions imported from football-data.org are pre-populated and shown the same
way. Manually-recorded subs and API-imported subs coexist in the same array.

This is **entirely optional** — the user can ignore substitutions completely and still
complete analysis. The
teamsheet player table has an `isSubstitute` flag for bench players, but that is
independent of actual in-match substitution events.

### Period-aware timestamps (in scope, visual-only)

Once periods are set, the tagging page can display match-relative timestamps instead
of raw video times (e.g. "1H 34:12" instead of "34:12.500"). This is a display-layer
change in `TagFolderTree` and the status bar only.

If period boundaries are not tagged, the UI should gracefully fall back to the
existing raw video timestamp display. No tag data model change is required.

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

Delivery gating:
- **Required for rollout:** Sections 1-5b, 6, 7, 9, and 10.
- **Optional / can defer:** Section 5c (image OCR) and Section 8
  (substitution recording).

### 1. Data model
- [x] Add `MatchInfo`, `TeamInfo`, `PlayerEntry`, `Substitution`, `MatchPeriod` interfaces to `webapp/lib/types/project.ts`.
- [x] Add optional `matchInfo?: MatchInfo` to `ProjectManifestV1`.
- [x] Add `defaultMatchInfo()` helper.
- [x] Ensure `readManifest` / `writeManifest` round-trip `matchInfo` correctly (no special handling needed — it's just JSON).

### 2. Teamsheet parser
- [x] Create `webapp/lib/metadata/teamsheetParser.ts`.
- [x] Implement `parseTeamsheetCSV(text: string): PlayerEntry[]` with flexible header matching.
- [x] Implement `parseTeamsheetPlainText(text: string): PlayerEntry[]` for paste-friendly format.
- [x] Unit tests for both parsers with edge cases (missing columns, extra whitespace, unicode names).

### 3. Metadata page shell
- [x] Create `webapp/app/metadata/page.tsx`.
- [x] Read `matchInfo` from manifest via `ProjectContext`.
- [x] Layout the page sections (match details, teams, periods, notes).
- [x] Wire save: on change, update manifest in context and flush to disk (debounced).
- [x] Navigation: back to home, forward to player.

### 4. Match details form
- [x] Create `webapp/components/metadata/MatchDetailsForm.tsx`.
- [x] Fields: date, kickoff time, competition, season, round, venue, referee, score.
- [x] Controlled inputs, `onChange` callback.

### 5. Team panel + teamsheet import
- [x] Create `webapp/components/metadata/TeamPanel.tsx`.
- [x] Team name, coach, formation fields.
- [x] Inline editable player table (number, name, position, captain, substitute).
- [x] Add / remove player rows.
- [x] Create `webapp/components/metadata/TeamsheetImporter.tsx`.
- [x] File picker (CSV/TSV/TXT) and paste-from-clipboard textarea.
- [x] Preview table with column mapping.
- [x] Confirm → populate team's player array.

### 5b. football-data.org API import
- [x] Create `webapp/lib/metadata/footballDataApi.ts` (API client + response mapper).
- [x] Implement `searchMatchesByCompetition`, `searchMatchesByTeam`, `searchMatchesByDate`, `fetchMatch`.
- [x] Implement `mapMatchToMatchInfo` with position normalisation and substitution mapping.
- [x] Create `webapp/components/metadata/FootballDataImporter.tsx` (search modal).
- [x] API key input with `localStorage` persistence.
- [x] Search by competition + date range, team + date range, or direct match ID.
- [x] Results table → select match → preview panel.
- [x] Section toggles (match details / home team / away team / substitutions) before confirm.
- [x] Rate-limit handling (429) and error display.
- [x] Wire "Import match metadata" button on metadata page.

### 5c. Image OCR teamsheet import
- [ ] Evaluate OCR approach (Tesseract.js for offline vs cloud API).
- [ ] Create `webapp/lib/metadata/teamsheetOcr.ts` (image → text extraction).
- [ ] Feed OCR output into existing preview table flow.
- [ ] Handle camera capture / image file upload in `TeamsheetImporter`.

### 6. Period editor
- [x] Create `webapp/components/metadata/PeriodEditor.tsx`.
- [x] List periods with start/end time fields.
- [x] "Set" buttons that capture current scrubber position.
- [x] Mini video scrubber (lightweight — could reuse `<video>` with custom controls or a thin wrapper around `VideoPlayerUnit`).
- [x] Add / remove period rows.
- [x] Auto-create default periods (1st Half, 2nd Half) for new videos.
- [x] Show helper copy that period-aware timestamps only appear when boundaries are set.

### 7. Navigation updates
- [x] Home page: Add "Set up match info →" / "Edit match info" link after video import.
- [x] Metadata page: navigation toolbar (back, save, forward to player).
- [x] Player page: optional "← Match info" link.

### 8. Optional substitution recording (tagging page, non-blocking)
- [ ] Add "Record substitution" action to tagging page (hotkey + toolbar button).
- [ ] Player picker UI: team selector, player-out dropdown, player-in dropdown (filtered to bench/available).
- [ ] Convert current video time to match-minute using period boundaries.
- [ ] If period boundaries are missing, allow manual minute entry fallback for substitution capture.
- [ ] Append `Substitution` to `matchInfo.substitutions` via manifest mutation.
- [ ] Display substitutions in a dedicated sidebar section on the tagging page.
- [ ] Show both API-imported and manually-recorded subs in the same list.

### 9. Period-aware timestamps (visual-only)
- [x] Add visual timestamp formatter using period boundaries (`1H 34:12`, `2H 07:40`, etc.).
- [x] Update tagging page displays (tree labels + status bar) to use match-relative timestamps when available.
- [x] Fallback to raw video timestamps when boundaries are unset or incomplete.
- [x] Keep this display-only: no change to mark storage format.
- [x] Add unit tests for formatter fallback behavior (complete boundaries vs missing boundaries).

### 10. Visual polish
- [x] Consistent dark-theme styling matching the tagging page.
- [x] Form validation hints (e.g. date format, shirt number uniqueness).
- [x] Responsive layout (two-column team panels collapse to single column on narrow viewports).
- [x] Keyboard navigation between form fields.

---

## Out of scope (for now)

- Opta / StatsBomb / Wyscout XML feed import.
- Player photo / headshot import.
- Dynamic facet population from teamsheet (architecture supports it; see above).
- Multi-video period spanning (one period across two video files).
- Undo/redo on the metadata form (use manifest-level undo if ever needed).
- Persisting football-data.org external player/team IDs (we mint our own UUIDs).
- Tracking which players are "currently on pitch" at a given video timestamp (subs
  are recorded but we don't compute a live roster state).
