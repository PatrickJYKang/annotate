import { defaultMatchInfo, type MatchInfo, type TeamInfo } from '../types/metadata';
import { teamKey } from './matchName';

export const fixtureLeagues = {
  'en.1': 'Premier League', 'es.1': 'La Liga', 'de.1': 'Bundesliga', 'it.1': 'Serie A', 'fr.1': 'Ligue 1',
} as const;
export type League = keyof typeof fixtureLeagues;
export type Fixture = { home: string; away: string; date: string; time?: string; competition: string; season: string; round?: string; score?: { home: number; away: number } };

export async function loadFixtures(league: League, year: number, signal?: AbortSignal): Promise<Fixture[]> {
  if (!Object.hasOwn(fixtureLeagues, league) || !Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('Invalid season');
  const folder = year + '-' + String(year + 1).slice(-2);
  const res = await fetch('https://raw.githubusercontent.com/openfootball/football.json/master/' + folder + '/' + league + '.json', { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('Fixture source unavailable');
  const data = await res.json();
  if (!Array.isArray(data.matches)) throw new Error('Unexpected fixture data');
  return data.matches.flatMap((m: { team1?: unknown; team2?: unknown; date?: unknown; time?: unknown; round?: unknown; score?: { ft?: unknown } } | null) => {
    if (!m || typeof m.team1 !== 'string' || typeof m.team2 !== 'string' || typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return [];
    const ft = m.score?.ft;
    return [{ home: m.team1, away: m.team2, date: m.date, competition: fixtureLeagues[league], season: year + '-' + (year + 1),
      ...(typeof m.time === 'string' && /^\d\d:\d\d$/.test(m.time) ? { time: m.time } : {}),
      ...(typeof m.round === 'string' ? { round: m.round } : {}),
      ...(Array.isArray(ft) && ft.length === 2 && ft.every(n => Number.isInteger(n) && n >= 0) ? { score: { home: ft[0], away: ft[1] } } : {}),
    }];
  });
}

export function filterFixtures(fixtures: Fixture[], home: string, away: string) {
  return fixtures.filter(f => teamKey(f.home).includes(teamKey(home)) && teamKey(f.away).includes(teamKey(away)));
}

export function fixtureConflicts(f: Fixture, info: MatchInfo): boolean {
  return Boolean((info.homeTeam.name && teamKey(info.homeTeam.name) !== teamKey(f.home)) ||
    (info.awayTeam.name && teamKey(info.awayTeam.name) !== teamKey(f.away)) || (info.date && info.date !== f.date));
}

export function fixturePatch(f: Fixture, info: MatchInfo, overwrite = false): Partial<MatchInfo> | null {
  if (fixtureConflicts(f, info)) {
    if (!overwrite) return null;
    const previous = { home: info.homeTeam, away: info.awayTeam };
    const sides = ['home', 'away'] as const;
    const sourceSide = (side: typeof sides[number]) => sides.find(s =>
      previous[s].name && teamKey(previous[s].name) === teamKey(f[side])) ?? (!previous[side].name ? side : null);
    const source = { home: sourceSide('home'), away: sourceSide('away') };
    const team = (side: typeof sides[number]): TeamInfo => ({
      ...(source[side] ? previous[source[side]] : defaultMatchInfo().homeTeam), name: f[side],
    });
    return {
      homeTeam: team('home'), awayTeam: team('away'), date: f.date,
      season: f.season, competition: f.competition, round: f.round ?? null,
      kickoffTime: f.time ?? null, score: f.score ?? null,
      substitutions: info.substitutions.flatMap(sub => {
        const side = sides.find(s => source[s] === sub.team);
        return side ? [{ ...sub, team: side }] : [];
      }),
    };
  }
  return {
    homeTeam: { ...info.homeTeam, name: info.homeTeam.name || f.home }, awayTeam: { ...info.awayTeam, name: info.awayTeam.name || f.away },
    date: f.date, season: info.season || f.season, competition: info.competition || f.competition,
    round: info.round || f.round || null, kickoffTime: info.kickoffTime || f.time || null,
    score: f.score ? { home: info.score?.home ?? f.score.home, away: info.score?.away ?? f.score.away } : info.score,
  };
}
