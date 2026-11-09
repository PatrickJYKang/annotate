import { afterEach, expect, it, vi } from 'vitest';
import { defaultMatchInfo } from '../types/metadata';
import { inferMatchInfo, rankFixtures } from './matchName';
import { loadFixtures, fixturePatch, filterFixtures } from './openFixtures';

const fixture = { home: 'Tottenham Hotspur', away: 'Chelsea FC', season: '2014-2015', competition: 'Premier League', date: '2015-01-01', round: 'Matchday 20', time: '17:30', score: {home: 5, away: 3} };
afterEach(() => vi.unstubAllGlobals());

it('uses names as editable search hints, not source data', () => {
  const info = defaultMatchInfo();
  expect(inferMatchInfo(info, 'Tottenham Hotspur vs. Chelsea FC 2014-2015 Footballia.mp4')).toMatchObject({homeTeam: {name: 'Tottenham Hotspur'}, awayTeam: {name: 'Chelsea FC'}, season: '2014-2015', date: null});
  expect(inferMatchInfo(info, '2015-01-01 Spurs v Chelsea.mov').date).toBe('2015-01-01');
  expect(inferMatchInfo(info, 'Friendly highlights.mp4')).toBe(info);
  expect(inferMatchInfo(info, 'Spurs vs Chelsea 2015-02-31')).toBe(info);
  expect(info.homeTeam.name).toBeNull();
});
it('reads only a league-season file and filters names locally', async () => {
  const fetcher = vi.fn(async () => Response.json({ matches: [null,{team1:fixture.home,team2:fixture.away,date:fixture.date,time:fixture.time,round:fixture.round,score:{ft:[5,3]}}] }));
  vi.stubGlobal('fetch', fetcher);
  const list = await loadFixtures('en.1',2014);
  expect(list).toEqual([fixture]);
  expect(filterFixtures(list, 'Spurs', 'Chelsea')).toEqual(list);
  expect(filterFixtures(list, 'Chelsea', 'Spurs')).toEqual([]);
  expect(fetcher).toHaveBeenCalledWith('https://raw.githubusercontent.com/openfootball/football.json/master/2014-15/en.1.json',expect.objectContaining({credentials:'omit'}));
});
it('preserves an existing coach, squad, and partial score and rejects mismatched fixtures', () => {
  const info = defaultMatchInfo();
  info.homeTeam.coach = 'Pochettino'; info.homeTeam.name = 'Spurs';
  info.homeTeam.players.push({id:'1', name:'Kane', number:18, position:'FW'});
  info.score = {home:0,away:null};
  expect(fixturePatch(fixture,info)).toMatchObject({homeTeam:info.homeTeam,score:{home:0,away:3}});
  expect(fixturePatch({...fixture, home:'Chelsea'},info)).toBeNull();
  expect(fixturePatch(fixture,{...info,date:'2015-03-01'})).toBeNull();
  expect(fixturePatch({...fixture, score:undefined}, defaultMatchInfo())?.score).toBeNull();
});
it('overwrites conflicting details only on confirmation and keeps the surviving club on its new side', () => {
  const info = defaultMatchInfo();
  info.homeTeam = {...info.homeTeam, name:'Chelsea', coach:'Mourinho', players:[{id:'h',name:'Hazard',number:10,position:null}]};
  info.awayTeam = {...info.awayTeam, name:'Arsenal', coach:'Wenger', statsBombLineupId:1};
  info.date = '2015-03-01';
  info.score = {home:2,away:0};
  info.substitutions = (['home','away'] as const).map(team => ({id:team,team,minute:70,playerIn:'In',playerOut:'Out'}));
  expect(fixturePatch(fixture,info)).toBeNull();
  const patch = fixturePatch({...fixture, score:undefined},info,true);
  expect(patch).toMatchObject({
    date:fixture.date, round:fixture.round, competition:fixture.competition, score:null,
    homeTeam:{...defaultMatchInfo().homeTeam,name:fixture.home},
    awayTeam:{...info.homeTeam,name:fixture.away}, substitutions:[{...info.substitutions[0],team:'away'}],
  });
  expect(patch?.homeTeam).not.toHaveProperty('statsBombLineupId');
  expect(info.date).toBe('2015-03-01');
  expect(info.awayTeam.coach).toBe('Wenger');
});
it('distinguishes an unpublished season from a network failure', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(new Response(null,{status:503})));
  expect(await loadFixtures('en.1',1990)).toEqual([]);
  await expect(loadFixtures('en.1',2014)).rejects.toThrow();
});
it('ranks fixture candidates without discarding alternatives or swapping the home side', () => {
  const info = inferMatchInfo(defaultMatchInfo(),'Spurs vs Chelsea 2014-15');
  const home = {name:fixture.home}, away = {name:fixture.away};
  const right = {utcDate:fixture.date,homeTeam:home,awayTeam:away}, reverse = {...right,homeTeam:away,awayTeam:home};
  expect(rankFixtures([reverse,right],info)).toEqual([right,reverse]);
});
