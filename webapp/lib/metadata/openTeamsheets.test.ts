import { afterEach, expect, it, vi } from 'vitest';
import { defaultMatchInfo } from '../types/metadata';
import { lookupTeamsheets, withSheet } from './openTeamsheets';
import { parseReportLineups } from './reportLineups';
const fixture = { competition:'Premier League', season:'2015-2016', home:'Chelsea FC', away:'Arsenal FC', date:'2015-09-19' };
it('accepts team-labelled report lines in either order, without making replacements starters', () => {
  const xi = 'One (c), Two, Three (Twelve 76), Four, Five, Six, Seven, Eight, Nine, Ten, Eleven.';
  const pair = parseReportLineups('Chelsea: '+xi+'\nSpurs: '+xi, 'Tottenham Hotspur','Chelsea FC');
  expect(pair?.home).toHaveLength(12);
  expect(pair?.away[0].isCaptain).toBe(true);
  expect(pair?.home.at(-1)).toMatchObject({name:'Twelve',isSubstitute:true});
  expect(parseReportLineups('Other: '+xi+'\nSpurs: '+xi,'Tottenham Hotspur','Chelsea FC')).toBeNull();
});
const season = {competition_id:2,season_name:'2015/2016',season_id:27};
const match = {match_id:3754217, match_date:fixture.date, home_team:{home_team_id:33, home_team_name:'Chelsea'},away_team:{away_team_id:1, away_team_name:'Arsenal'}};
const lineup = Array.from({length:13},(_,i) => ({player_name:'Player ' + i, player_id:i+1,jersey_number:i+2,positions:i < 11 ? [{start_reason:'Starting XI',position:'Position'}] : i === 11 ? [{start_reason:'Substitution - On (Tactical)',position:'Wing'}] : []}));
function serve(...data: unknown[]) {
  const http = vi.fn(async () => Response.json(data.shift())); vi.stubGlobal('fetch', http); return http;
}
afterEach(() => vi.unstubAllGlobals());
it('joins the exact fixture, preserves home/away order and distinguishes bench players',async () => {
  serve([season],[match],[{team_id:1,lineup:[...lineup].reverse()},{team_id:33,lineup}]);
  const sheets = await lookupTeamsheets(fixture);
  expect(sheets?.matchId).toBe(match.match_id);
  expect(sheets?.home.filter(p => !p.isSubstitute)).toHaveLength(11);
  expect(sheets?.away[0].name).not.toBe(sheets?.home[0].name);
  expect(sheets?.home.at(-2)?.isSubstitute).toBe(true);
  const team = defaultMatchInfo().homeTeam;
  const populated = withSheet(team,sheets!.home,sheets!.matchId);
  expect(withSheet(populated,[],99)).toBe(populated);
  expect(populated.statsBombLineupId).toBe(match.match_id);
});
it('does not guess on ambiguous fixtures, absent seasons, or incomplete XIs', async () => {
  const fetcher = serve([]);
  expect(await lookupTeamsheets(fixture)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  serve([season],[match,match]);
  expect(await lookupTeamsheets(fixture)).toBeNull();
  serve([season],[match],[{team_id:1,lineup},{team_id:33,lineup:lineup.slice(1)}]);
  expect(await lookupTeamsheets(fixture)).toBeNull();
});
