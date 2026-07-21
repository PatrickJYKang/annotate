export interface MatchInfo {
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  date: string | null;
  kickoffTime: string | null;
  competition: string | null;
  season: string | null;
  round: string | null;
  venue: string | null;
  referee: string | null;
  score: { home: number | null; away: number | null } | null;
  substitutions: Substitution[];
  notes: string | null;
}

export interface TeamInfo {
  name: string | null;
  coach: string | null;
  formation: string | null;
  players: PlayerEntry[];
}

export interface PlayerEntry {
  id: string;
  number: number | null;
  name: string;
  position: string | null;
  isCaptain?: boolean;
  isSubstitute?: boolean;
}

export interface Substitution {
  id: string;
  team: 'home' | 'away';
  minute: number | null;
  playerOut: string;
  playerIn: string;
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
