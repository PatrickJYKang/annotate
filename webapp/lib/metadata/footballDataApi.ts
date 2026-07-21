import type { MatchInfo, TeamInfo, PlayerEntry, Substitution } from "../types/metadata";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROXY_URL = "/api/football-data";
const LS_KEY = "football_data_api_key";

// ---------------------------------------------------------------------------
// Position normalisation (API long-form → short codes)
// ---------------------------------------------------------------------------

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

export function normalisePosition(apiPosition: string | null): string | null {
  if (!apiPosition) return null;
  return POSITION_SHORT[apiPosition] ?? apiPosition;
}

// ---------------------------------------------------------------------------
// API key helpers
// ---------------------------------------------------------------------------

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LS_KEY) || null;
}

export function setApiKey(key: string): void {
  localStorage.setItem(LS_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(LS_KEY);
}

// ---------------------------------------------------------------------------
// Generic fetch wrapper
// ---------------------------------------------------------------------------

async function apiFetch<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${PROXY_URL}?path=${encodeURIComponent(path)}`, {
    headers: { "X-Auth-Token": apiKey },
  });
  if (res.status === 429) {
    throw new Error("Rate limited — please wait a moment and try again.");
  }
  if (res.status === 403) {
    throw new Error("Invalid or expired API key.");
  }
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API response types (subset of football-data.org v4 shapes)
// ---------------------------------------------------------------------------

export type ApiMatchSummary = {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string | null;
  homeTeam: { id: number; name: string; shortName?: string };
  awayTeam: { id: number; name: string; shortName?: string };
  score: {
    fullTime: { home: number | null; away: number | null };
  };
  competition: { name: string; code: string };
};

export type ApiPlayer = {
  id: number;
  name: string;
  position: string | null;
  shirtNumber: number | null;
};

export type ApiSubstitution = {
  minute: number;
  team: { id: number; name: string };
  playerOut: { id: number; name: string };
  playerIn: { id: number; name: string };
};

export type ApiReferee = {
  id: number;
  name: string;
  type: string;
};

export type ApiMatchDetail = ApiMatchSummary & {
  venue: string | null;
  season: { startDate: string; endDate: string };
  referees: ApiReferee[];
  homeTeam: ApiMatchSummary["homeTeam"] & {
    coach?: { name: string } | null;
    formation?: string | null;
    lineup?: ApiPlayer[];
    bench?: ApiPlayer[];
  };
  awayTeam: ApiMatchSummary["awayTeam"] & {
    coach?: { name: string } | null;
    formation?: string | null;
    lineup?: ApiPlayer[];
    bench?: ApiPlayer[];
  };
  substitutions?: ApiSubstitution[];
};

type MatchesResponse = { matches: ApiMatchSummary[] };

// ---------------------------------------------------------------------------
// Search endpoints
// ---------------------------------------------------------------------------

/**
 * Search by competition + season year + optional matchday.
 * Free-tier compatible: uses `season` and `matchday` filters instead of date ranges.
 */
export async function searchMatchesByCompetition(
  apiKey: string,
  competitionCode: string,
  season: string,
  matchday?: number | null,
): Promise<ApiMatchSummary[]> {
  let path = `/competitions/${competitionCode}/matches?season=${season}`;
  if (matchday != null) path += `&matchday=${matchday}`;
  const data = await apiFetch<MatchesResponse>(apiKey, path);
  return data.matches;
}

/**
 * Search by competition + season + stage (e.g. for cup competitions).
 * Stages: GROUP_STAGE, ROUND_OF_16, QUARTER_FINALS, SEMI_FINALS, FINAL, etc.
 */
export async function searchMatchesByStage(
  apiKey: string,
  competitionCode: string,
  season: string,
  stage: string,
): Promise<ApiMatchSummary[]> {
  const data = await apiFetch<MatchesResponse>(
    apiKey,
    `/competitions/${competitionCode}/matches?season=${season}&stage=${stage}`,
  );
  return data.matches;
}

// ---------------------------------------------------------------------------
// Fetch full match detail
// ---------------------------------------------------------------------------

export async function fetchMatch(
  apiKey: string,
  matchId: number,
): Promise<ApiMatchDetail> {
  return apiFetch<ApiMatchDetail>(apiKey, `/matches/${matchId}`);
}

// ---------------------------------------------------------------------------
// Map API match → MatchInfo
// ---------------------------------------------------------------------------

function generateId(): string {
  return (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapPlayers(
  lineup: ApiPlayer[] | undefined,
  bench: ApiPlayer[] | undefined,
): PlayerEntry[] {
  const entries: PlayerEntry[] = [];
  for (const p of lineup ?? []) {
    entries.push({
      id: generateId(),
      number: p.shirtNumber,
      name: p.name,
      position: normalisePosition(p.position),
    });
  }
  for (const p of bench ?? []) {
    entries.push({
      id: generateId(),
      number: p.shirtNumber,
      name: p.name,
      position: normalisePosition(p.position),
      isSubstitute: true,
    });
  }
  return entries;
}

function mapTeam(
  apiTeam: ApiMatchDetail["homeTeam"],
  players: PlayerEntry[],
): TeamInfo {
  return {
    name: apiTeam.name ?? null,
    coach: apiTeam.coach?.name ?? null,
    formation: apiTeam.formation ?? null,
    players,
  };
}

function mapSubstitutions(
  apiSubs: ApiSubstitution[] | undefined,
  homePlayers: PlayerEntry[],
  awayPlayers: PlayerEntry[],
  homeTeamName: string,
): Substitution[] {
  if (!apiSubs) return [];

  const findPlayer = (name: string, roster: PlayerEntry[]): string => {
    const match = roster.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    return match?.id ?? generateId();
  };

  return apiSubs.map((s) => {
    const isHome = s.team.name === homeTeamName;
    const roster = isHome ? homePlayers : awayPlayers;
    return {
      id: generateId(),
      team: isHome ? ("home" as const) : ("away" as const),
      minute: s.minute ?? null,
      playerOut: findPlayer(s.playerOut.name, roster),
      playerIn: findPlayer(s.playerIn.name, roster),
    };
  });
}

export function mapMatchToMatchInfo(apiMatch: ApiMatchDetail): MatchInfo {
  const utc = new Date(apiMatch.utcDate);
  const date = apiMatch.utcDate.slice(0, 10); // YYYY-MM-DD
  const kickoffTime = `${utc.getUTCHours().toString().padStart(2, "0")}:${utc.getUTCMinutes().toString().padStart(2, "0")}`;

  const homePlayers = mapPlayers(apiMatch.homeTeam.lineup, apiMatch.homeTeam.bench);
  const awayPlayers = mapPlayers(apiMatch.awayTeam.lineup, apiMatch.awayTeam.bench);

  const season =
    apiMatch.season
      ? `${apiMatch.season.startDate.slice(0, 4)}-${apiMatch.season.endDate.slice(2, 4)}`
      : null;

  const round =
    apiMatch.stage && apiMatch.stage !== "REGULAR_SEASON"
      ? apiMatch.stage.replace(/_/g, " ")
      : apiMatch.matchday != null
        ? `Matchday ${apiMatch.matchday}`
        : null;

  const referee =
    apiMatch.referees?.find((r) => r.type === "REFEREE")?.name ?? null;

  const score =
    apiMatch.score?.fullTime?.home != null || apiMatch.score?.fullTime?.away != null
      ? {
          home: apiMatch.score.fullTime.home,
          away: apiMatch.score.fullTime.away,
        }
      : null;

  const substitutions = mapSubstitutions(
    apiMatch.substitutions,
    homePlayers,
    awayPlayers,
    apiMatch.homeTeam.name,
  );

  return {
    homeTeam: mapTeam(apiMatch.homeTeam, homePlayers),
    awayTeam: mapTeam(apiMatch.awayTeam, awayPlayers),
    date,
    kickoffTime,
    competition: apiMatch.competition?.name ?? null,
    season,
    round,
    venue: apiMatch.venue ?? null,
    referee,
    score,
    substitutions,
    notes: null,
  };
}

// ---------------------------------------------------------------------------
// Well-known competition codes (free-tier coverage)
// ---------------------------------------------------------------------------

export const COMPETITIONS = [
  { code: "PL", name: "Premier League" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "PD", name: "La Liga" },
  { code: "FL1", name: "Ligue 1" },
  { code: "ELC", name: "Championship" },
  { code: "DED", name: "Eredivisie" },
  { code: "PPL", name: "Primeira Liga" },
  { code: "CL", name: "Champions League" },
  { code: "EC", name: "European Championship" },
  { code: "WC", name: "World Cup" },
] as const;
