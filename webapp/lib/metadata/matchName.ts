import type { MatchInfo } from '../types/metadata';

const aliases: ReadonlyMap<string, string> = new Map([
  ['spurs', 'tottenhamhotspur'], ['manutd', 'manchesterunited'], ['manunited', 'manchesterunited'],
  ['mancity', 'manchestercity'], ['psg', 'parissaintgermain'], ['intermilan', 'internazionale'],
]);
export function teamKey(s: string) {
  const key = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(?:afc|fc|cf|sc)\b/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  return aliases.get(key) ?? key;
}

export function inferMatchInfo(info: MatchInfo, label: string): MatchInfo {
  let name = label.replace(/\.(mp4|mov|mkv|webm|m4v|avi)$/i, '').replace(/\s+Footballia$/i, '').replace(/_/g, ' ').trim();
  let date: string | null = null, season: string | null = null;
  const day = name.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (day) {
    const d = new Date(day[1] + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== day[1]) return info;
    date = day[1];
    name = name.replace(day[0], '');
  }
  const years = name.match(/\b((?:19|20)\d\d)[/-](\d{4}|\d{2})\b/);
  if (years) {
    const end = Number(years[1]) + 1;
    if (!String(end).endsWith(years[2])) return info;
    season = years[1] + '-' + end;
    name = name.replace(years[0], '');
  }
  name = name.replace(/\s+(?:19|20)\d\d$/, '');
  const teams = name.split(/\s+(?:v(?:s)?\.?|versus)\s+/i).map(s => s.replace(/^[\s()[\]-]+|[\s()[\]-]+$/g, '').trim());
  if (teams.length !== 2 || teams.some(s => !/\p{L}/u.test(s) || /[|()[\]]|\d\s*[-:]\s*\d/.test(s))) return info;
  const [home, away] = teams;
  if (teamKey(home) === teamKey(away) || (info.homeTeam.name && teamKey(info.homeTeam.name) !== teamKey(home)) || (info.awayTeam.name && teamKey(info.awayTeam.name) !== teamKey(away))) return info;
  return { ...info, homeTeam: { ...info.homeTeam, name: info.homeTeam.name || home }, awayTeam: { ...info.awayTeam, name: info.awayTeam.name || away }, season: info.season || season, date: info.date || date };
}

type Fixture = { homeTeam: {name: string; shortName?: string | null}; awayTeam: {name: string; shortName?: string | null}; utcDate: string };
export function rankFixtures<T extends Fixture>(fixtures: T[], info?: MatchInfo): T[] {
  if (!info) return fixtures;
  const rank = (m: T) => (['homeTeam', 'awayTeam'] as const).reduce((score, side) => {
    const name = teamKey(info[side].name || '');
    return score + (name && [m[side].name, m[side].shortName].some(s => s && teamKey(s) === name) ? 2 : 0);
  }, Number(Boolean(info.date && m.utcDate.startsWith(info.date))));
  return [...fixtures].sort((a,b) => rank(b) - rank(a));
}
