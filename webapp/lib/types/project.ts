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
  fps?: number;
  resolution?: ProjectResolution;
  videos: { id: string; label: string; file: string; durationMs?: number; width?: number; height?: number; fps?: number }[];
  marks: { id: string; videoId: string; t_ms: number; tags?: TaggingSelection | string[] }[];
  stills: { id: string; videoId: string; t_ms: number; file: string; width?: number; height?: number; sourceMarkId?: string | null }[];
  annotations: ProjectAnnotationIndexEntry[];
  reports: string[];
  thumbnails: string[];
  matchInfo?: MatchInfo;
}

export type ProjectResolution = {
  width: number;
  height: number;
};

export const PROJECT_DEFAULT_FPS = 30;
export const PROJECT_DEFAULT_RESOLUTION: ProjectResolution = { width: 1920, height: 1080 };

export function getProjectFps(manifest?: Pick<ProjectManifestV1, 'fps'> | null): number {
  const fps = manifest?.fps;
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : PROJECT_DEFAULT_FPS;
}

export function getProjectResolution(manifest?: Pick<ProjectManifestV1, 'resolution'> | null): ProjectResolution {
  const width = manifest?.resolution?.width;
  const height = manifest?.resolution?.height;
  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? Math.round(width) : PROJECT_DEFAULT_RESOLUTION.width,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? Math.round(height) : PROJECT_DEFAULT_RESOLUTION.height,
  };
}

export function ensureProjectMediaSettings(manifest: ProjectManifestV1): ProjectManifestV1 {
  const fps = getProjectFps(manifest);
  const resolution = getProjectResolution(manifest);
  let changed = manifest.fps !== fps
    || manifest.resolution?.width !== resolution.width
    || manifest.resolution?.height !== resolution.height;
  const videos = manifest.videos.map((video) => {
    if (video.fps === fps && video.width === resolution.width && video.height === resolution.height) return video;
    changed = true;
    return { ...video, fps, width: resolution.width, height: resolution.height };
  });
  return changed ? { ...manifest, fps, resolution, videos } : manifest;
}

export const ensureProjectFps = ensureProjectMediaSettings;

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
    notes: null,
  };
}

export function defaultProjectManifest(name: string): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name,
    created: new Date().toISOString(),
    fps: PROJECT_DEFAULT_FPS,
    resolution: PROJECT_DEFAULT_RESOLUTION,
    videos: [],
    marks: [],
    stills: [],
    annotations: [],
    reports: [],
    thumbnails: [],
  };
}
