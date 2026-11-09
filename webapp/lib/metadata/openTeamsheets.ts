import type { PlayerEntry, TeamInfo } from '../types/metadata';
import { teamKey } from './matchName';
import type { Fixture } from './openFixtures';

const base = 'https://raw.githubusercontent.com/hudl/open-data/master/data/';
const competitions: Readonly<Record<string, number>> = { 'Premier League': 2, 'La Liga': 11, Bundesliga: 9, 'Serie A': 12, 'Ligue 1': 7 };
type Season = { competition_id: number; season_name: string; season_id: number };
type Match = { match_id: number; match_date: string; home_team: { home_team_id: number; home_team_name: string }; away_team: { away_team_id: number; away_team_name: string } };
type Position = { start_reason: string; position: string };
type Player = { player_id: number; player_name: string; jersey_number?: number; positions?: Position[] };
type Squad = { team_id: number; lineup: Player[] };
export type Sheets = { matchId: number; home: PlayerEntry[]; away: PlayerEntry[] };

async function rows<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(base + path + '.json', { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error('Roster data unavailable');
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Invalid roster data');
  return data;
}

function roster(squad?: Squad): PlayerEntry[] | null {
  if (!Array.isArray(squad?.lineup)) return null;
  const players: PlayerEntry[] = [];
  for (const row of squad.lineup) {
    if (!row?.player_name || !Number.isSafeInteger(row.player_id) || !Array.isArray(row.positions)) return null;
    const start = row.positions.find(p => p.start_reason === 'Starting XI');
    players.push({ id: 'statsbomb-' + row.player_id, name: row.player_name, number: row.jersey_number ?? null,
      position: (start ?? row.positions[0])?.position ?? null, isSubstitute: !start });
  }
  if (players.filter(p => !p.isSubstitute).length !== 11 || new Set(players.map(p => p.id)).size !== players.length) return null;
  return players.sort((a,b) => Number(a.isSubstitute) - Number(b.isSubstitute));
}

export async function lookupTeamsheets(f: Fixture, signal?: AbortSignal): Promise<Sheets | null> {
  const id = competitions[f.competition];
  if (!id) return null;
  const seasons = await rows<Season>('competitions', signal);
  const season = seasons.find(s => s.competition_id === id && s.season_name === f.season.replace('-', '/'));
  if (!season || !Number.isSafeInteger(season.season_id)) return null;
  const matches = (await rows<Match>(`matches/${id}/${season.season_id}`, signal)).filter(m =>
    m.match_date === f.date && teamKey(m.home_team.home_team_name) === teamKey(f.home) && teamKey(m.away_team.away_team_name) === teamKey(f.away));
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].match_id)) return null;
  const match = matches[0];
  const squads = await rows<Squad>('lineups/' + match.match_id, signal);
  const home = roster(squads.find(s => s.team_id === match.home_team.home_team_id));
  const away = roster(squads.find(s => s.team_id === match.away_team.away_team_id));
  return home && away ? {matchId: match.match_id, home, away} : null;
}

export function withSheet(team: TeamInfo, players: PlayerEntry[], matchId: number): TeamInfo {
  return team.players.length ? team : { ...team, players, statsBombLineupId: matchId };
}
