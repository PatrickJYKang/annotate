import { teamKey } from './matchName';
import { parseTeamsheetPlainText } from './teamsheetParser';
import type { PlayerEntry } from '../types/metadata';

/** Two team-labelled report lines. A parenthesized replacement is a used sub, not a starter. */
export function parseReportLineups(text: string, home: string, away: string) {
  const rosters: Partial<Record<'home' | 'away', PlayerEntry[]>> = {};
  for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const colon = line.indexOf(':');
    if (colon < 1) return null;
    const name = teamKey(line.slice(0, colon));
    const side = name === teamKey(home) ? 'home' : name === teamKey(away) ? 'away' : null;
    if (!side || rosters[side]) return null;
    const subs: PlayerEntry[] = [];
    const starters: PlayerEntry[] = [];
    const entries = line.slice(colon + 1).replace(/\.\s*$/, '').split(/[,;](?![^()]*\))/);
    if (entries.length !== 11) return null;
    for (const entry of entries) {
      const clean = entry.replace(/\(([^()]+?)\s*,?\s+(\d{1,3}(?:\+\d+)?)['’′]?\)/g, (_, replacement: string) => {
        const [player] = parseTeamsheetPlainText(replacement.trim().replace(/,$/, ''));
        if (player) subs.push({...player, isSubstitute:true});
        return '';
      });
      const [player] = parseTeamsheetPlainText(clean);
      if (!player || !/\p{L}/u.test(player.name) || /[():]/.test(player.name)) return null;
      starters.push(player);
    }
    rosters[side] = [...starters, ...subs];
  }
  return rosters.home && rosters.away ? {home:rosters.home, away:rosters.away} : null;
}
