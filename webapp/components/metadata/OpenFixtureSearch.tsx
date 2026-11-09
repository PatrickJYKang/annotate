"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { fixtureConflicts, fixtureLeagues, fixturePatch, filterFixtures, loadFixtures, type Fixture, type League } from '../../lib/metadata/openFixtures';
import type { MatchInfo } from '../../lib/types/metadata';
import { lookupTeamsheets, withSheet, type Sheets } from '../../lib/metadata/openTeamsheets';
import { parseReportLineups } from '../../lib/metadata/reportLineups';

export default function OpenFixtureSearch({ info, hints, onImport, onCancel }: {
  info: MatchInfo; hints: MatchInfo; onImport: (patch: Partial<MatchInfo>) => void; onCancel: () => void;
}) {
  const t = useT();
  const [season, setSeason] = useState(() => {
    const day = hints.date ? new Date(hints.date + 'T12:00:00Z') : new Date();
    return hints.season?.match(/^\d{4}/)?.[0] ?? String(day.getUTCFullYear() - Number(day.getUTCMonth() < 6));
  });
  const [league, setLeague] = useState<League | ''>('');
  const [home, setHome] = useState(hints.homeTeam.name ?? '');
  const [away, setAway] = useState(hints.awayTeam.name ?? '');
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [selected, setSelected] = useState<Fixture | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function reset() {
    request.current?.abort(); setFixtures(null); setSelected(null); setBusy(false); setFailed(false);
  }
  async function search() {
    reset();
    const controller = new AbortController();
    request.current = controller; setBusy(true);
    const leagues = league ? [league] : Object.keys(fixtureLeagues) as League[];
    const result = await Promise.allSettled(leagues.map(l => loadFixtures(l, Number(season), controller.signal)));
    if (controller.signal.aborted) return;
    setFixtures(result.flatMap(r => r.status === 'fulfilled' ? r.value : []).sort((a,b) => a.date.localeCompare(b.date)));
    setFailed(result.some(r => r.status === 'rejected')); setBusy(false);
  }
  const matches = filterFixtures(fixtures ?? [], home, away);
  const overwrite = !!selected && fixtureConflicts(selected, info);
  const patch = selected && fixturePatch(selected, info, overwrite);
  const [lookup, setLookup] = useState<{ fixture: Fixture; sheets: Sheets | null; failed: boolean } | null>(null);
  const [include, setInclude] = useState(true);
  const [report, setReport] = useState('');
  const pasted = useMemo(() => selected && report ? parseReportLineups(report, selected.home, selected.away) : null, [report, selected]);
  const needSheets = !patch?.homeTeam?.players.length || !patch?.awayTeam?.players.length;
  const compatible = !!patch;
  useEffect(() => {
    setInclude(true);
    setReport('');
    setLookup(null);
    if (!selected || !compatible || !needSheets) return;
    const controller = new AbortController();
    void lookupTeamsheets(selected, controller.signal).then(sheets => {
      if (!controller.signal.aborted) setLookup({fixture:selected, sheets, failed:false});
    }, () => {
      if (!controller.signal.aborted) setLookup({fixture:selected, sheets:null, failed:true});
    });
    return () => controller.abort();
  }, [selected, compatible, needSheets]);
  const resolved = lookup?.fixture === selected ? lookup : null;
  const sheets = resolved?.sheets;
  return <>
    <form onSubmit={e => { e.preventDefault(); void search(); }} className="grid grid-cols-2 gap-2">
      <label className="grid gap-1">{t('metadata.competition')}<select value={league} onChange={e => { reset(); setLeague(e.target.value as League | ''); }}>
        <option value="">{t('fixture.all')}</option>
        {Object.entries(fixtureLeagues).map(([id,name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label className="grid gap-1">{t('metadata.season')}<input type="number" required min="1900" max="2100" value={season} onChange={e => { reset(); setSeason(e.target.value); }} /></label>
      <label className="grid gap-1">{t('metadata.home')}<input value={home} onChange={e => { setHome(e.target.value); setSelected(null); }}/></label>
      <label className="grid gap-1">{t('metadata.away')}<input value={away} onChange={e => { setAway(e.target.value); setSelected(null); }}/></label>
      <button disabled={busy || (!league && !home.trim() && !away.trim())}>{t(busy ? 'metadata.searching' : 'metadata.search')}</button>
    </form>
    {failed && <p role="alert">{t('fixture.unavailable')}</p>}
    {fixtures && !failed && !matches.length && <p role="status">{t('metadata.noMatches')}</p>}
    <div className="mt-3 max-h-56 overflow-y-auto">{matches.map(f => <button type="button" key={[f.competition,f.date,f.home,f.away].join('/')} aria-pressed={selected === f} className={'block w-full border-b px-2 py-1 text-left ' + (selected === f ? 'bg-raised font-bold' : '')} onClick={() => setSelected(f)}>
      {f.date} · {f.home} {f.score ? f.score.home + ':' + f.score.away : 'v'} {f.away} · {f.competition}
    </button>)}</div>
    {overwrite && <p role="status">{t('fixture.conflict')}</p>}
    {patch && needSheets && <div className="mt-3 text-xs" aria-live="polite">
      {sheets ? <>
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)}/>{t('fixture.includeSheets')}</label>
        {' · '}<a className="underline" href="https://github.com/hudl/open-data#terms--conditions" target="_blank" rel="noreferrer">StatsBomb Open Data</a>
        <details><summary>{t('fixture.previewSheets')}</summary>{(['home','away'] as const).map(side => <p key={side}><b>{selected?.[side]}: </b>{sheets[side].map(p => p.isSubstitute ? '(' + p.name + ')' : p.name).join(', ')}</p>)}</details>
      </> : <>{t(!resolved ? 'fixture.loadingSheets' : resolved.failed ? 'fixture.failedSheets' : 'fixture.noSheets')}
        {resolved && selected && <details><summary>{t('fixture.paste')}</summary>
          <textarea className="mt-1 w-full" rows={3} aria-label={t('fixture.paste')} value={report} onChange={e => setReport(e.target.value)}
            placeholder={selected.home + ': 1, 2, …, 11\n' + selected.away + ': 1, 2, …, 11'} />
          {report && (pasted ? <p>{pasted.home[0].name} … {pasted.home[10].name} · {pasted.away[0].name} … {pasted.away[10].name}</p> : <p>{t('fixture.reportFormat')}</p>)}
        </details>}</>}
    </div>}
    <div className="mt-3 flex justify-end gap-2"><button onClick={onCancel}>{t('common.cancel')}</button><button className="button-primary" disabled={!patch || (!!report && !pasted)} onClick={() => {
      if (!patch) return;
      if (pasted && !sheets && patch.homeTeam && patch.awayTeam) return onImport({...patch,
        homeTeam: patch.homeTeam.players.length ? patch.homeTeam : {...patch.homeTeam, players:pasted.home},
        awayTeam: patch.awayTeam.players.length ? patch.awayTeam : {...patch.awayTeam, players:pasted.away}});
      if (!include || !sheets || !patch.homeTeam || !patch.awayTeam) return onImport(patch);
      onImport({...patch, homeTeam: withSheet(patch.homeTeam, sheets.home, sheets.matchId), awayTeam: withSheet(patch.awayTeam, sheets.away, sheets.matchId)});
    }}>{t(overwrite ? 'fixture.overwrite' : patch && needSheets && !resolved ? 'fixture.only' : 'metadata.confirmImport')}</button></div>
  </>;
}
