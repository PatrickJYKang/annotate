import type { TaggingSelection } from "../tagging/schema";

export interface ProjectAnnotationIndexEntry {
  stillId: string;
  file: string;
  id?: string;
  label?: string;
  role?: 'default' | 'alternate';
  lastModified?: string;
}

export interface ProjectManifestV1 {
  schema: 'project.v1';
  name: string;
  created: string; // ISO date
  videos: { id: string; label: string; file: string; durationMs?: number; width?: number; height?: number; fps?: number }[];
  marks: { id: string; videoId: string; t_ms: number; tags?: TaggingSelection | string[] }[];
  stills: { id: string; videoId: string; t_ms: number; file: string; width?: number; height?: number; sourceMarkId?: string | null }[];
  annotations: ProjectAnnotationIndexEntry[];
  reports: string[];
  thumbnails: string[];
  matchInfo?: MatchInfo;
}

// --- Match metadata types ---

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

export function defaultMatchInfo(): MatchInfo {
  return {
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
}

export function defaultProjectManifest(name: string): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name,
    created: new Date().toISOString(),
    videos: [],
    marks: [],
    stills: [],
    annotations: [],
    reports: [],
    thumbnails: [],
  };
}
