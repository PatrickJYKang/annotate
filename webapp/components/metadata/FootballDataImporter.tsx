"use client";
import { useCallback, useEffect, useState } from "react";
import type { MatchInfo } from "../../lib/types/metadata";
import {
  type ApiMatchSummary,
  type ApiMatchDetail,
  COMPETITIONS,
  getApiKey,
  setApiKey as persistApiKey,
  clearApiKey,
  searchMatchesByCompetition,
  searchMatchesByStage,
  fetchMatch,
  mapMatchToMatchInfo,
} from "../../lib/metadata/footballDataApi";
import { useLocale } from "../../lib/i18n";

// ---------------------------------------------------------------------------
// Shared Tailwind class strings
// ---------------------------------------------------------------------------

const inputCls = "bg-raised text-accent border border-border px-2 py-1.5 text-sm font-sans";
const labelCls = "flex flex-col gap-0.5 text-xs text-secondary";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SearchMode = "competition" | "stage" | "matchId";

const CUP_STAGES = [
  { value: "GROUP_STAGE", labelKey: "metadata.stage.group" },
  { value: "LAST_16", labelKey: "metadata.stage.last16" },
  { value: "QUARTER_FINALS", labelKey: "metadata.stage.quarter" },
  { value: "SEMI_FINALS", labelKey: "metadata.stage.semi" },
  { value: "FINAL", labelKey: "metadata.stage.final" },
];
type Step = "search" | "results" | "preview";

type SectionToggles = {
  matchDetails: boolean;
  homeTeam: boolean;
  awayTeam: boolean;
  substitutions: boolean;
};

type Props = {
  onImport: (partial: Partial<MatchInfo>) => void;
  onCancel: () => void;
};

export default function FootballDataImporter({ onImport, onCancel }: Props) {
  const { t, formatDate, formatNumber } = useLocale();
  // API key
  const [apiKey, setApiKeyState] = useState(getApiKey() ?? "");
  const hasKey = apiKey.trim().length > 0;

  // Search state
  const [mode, setMode] = useState<SearchMode>("competition");
  const [competition, setCompetition] = useState("PL");
  const [season, setSeason] = useState(new Date().getFullYear().toString());
  const [matchday, setMatchday] = useState("");
  const [stageCompetition, setStageCompetition] = useState("CL");
  const [stageSeason, setStageSeason] = useState(new Date().getFullYear().toString());
  const [stage, setStage] = useState("GROUP_STAGE");
  const [matchIdInput, setMatchIdInput] = useState("");

  // Results
  const [step, setStep] = useState<Step>("search");
  const [results, setResults] = useState<ApiMatchSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<ApiMatchDetail | null>(null);
  const [previewInfo, setPreviewInfo] = useState<MatchInfo | null>(null);

  // Section toggles
  const [toggles, setToggles] = useState<SectionToggles>({
    matchDetails: true,
    homeTeam: true,
    awayTeam: true,
    substitutions: true,
  });

  // Loading / error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineupsWarning, setLineupsWarning] = useState<string | null>(null);

  // Persist key on change
  useEffect(() => {
    if (apiKey.trim()) persistApiKey(apiKey.trim());
  }, [apiKey]);

  const handleSelectMatch = useCallback(async (matchId: number, prefetched?: ApiMatchDetail) => {
    setError(null);
    setLineupsWarning(null);
    setLoading(true);
    try {
      const detail = prefetched ?? await fetchMatch(apiKey.trim(), matchId);
      setSelectedDetail(detail);
      const info = mapMatchToMatchInfo(detail);
      setPreviewInfo(info);

      if (detail.status === "SCHEDULED" || detail.status === "TIMED") {
        setLineupsWarning(t('metadata.lineupsUnavailable'));
      }

      setStep("preview");
    } catch (e: any) {
      setError(e?.message || t('metadata.failedDetails'));
    } finally {
      setLoading(false);
    }
  }, [apiKey, t]);

  // --- Search ---
  const doSearch = useCallback(async () => {
    if (!hasKey) return;
    setError(null);
    setLoading(true);
    try {
      let matches: ApiMatchSummary[] = [];
      if (mode === "competition") {
        if (!season) { setError(t('metadata.enterSeason')); return; }
        const md = matchday ? parseInt(matchday, 10) : null;
        matches = await searchMatchesByCompetition(apiKey.trim(), competition, season, md);
      } else if (mode === "stage") {
        if (!stageSeason || !stage) { setError(t('metadata.selectSeasonStage')); return; }
        matches = await searchMatchesByStage(apiKey.trim(), stageCompetition, stageSeason, stage);
      } else if (mode === "matchId") {
        const id = parseInt(matchIdInput, 10);
        if (isNaN(id)) { setError(t('metadata.enterMatchId')); return; }
        // Go directly to detail
        const detail = await fetchMatch(apiKey.trim(), id);
        await handleSelectMatch(detail.id, detail);
        return;
      }
      if (matches.length === 0) {
        setError(t('metadata.noMatches'));
        return;
      }
      setResults(matches);
      setStep("results");
    } catch (e: any) {
      setError(e?.message || t('metadata.searchFailed'));
    } finally {
      setLoading(false);
    }
  }, [hasKey, apiKey, mode, competition, season, matchday, stageCompetition, stageSeason, stage, matchIdInput, handleSelectMatch, t]);

  // --- Confirm ---
  const handleConfirm = useCallback(() => {
    if (!previewInfo) return;
    const partial: Partial<MatchInfo> = {};
    if (toggles.matchDetails) {
      partial.date = previewInfo.date;
      partial.kickoffTime = previewInfo.kickoffTime;
      partial.competition = previewInfo.competition;
      partial.season = previewInfo.season;
      partial.round = previewInfo.round;
      partial.venue = previewInfo.venue;
      partial.referee = previewInfo.referee;
      partial.score = previewInfo.score;
    }
    if (toggles.homeTeam) partial.homeTeam = previewInfo.homeTeam;
    if (toggles.awayTeam) partial.awayTeam = previewInfo.awayTeam;
    if (toggles.substitutions) partial.substitutions = previewInfo.substitutions;
    onImport(partial);
  }, [previewInfo, toggles, onImport]);

  return (
    <div
      className="modal-overlay z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-card max-h-[85vh] w-[min(680px,calc(100vw-2rem))] overflow-y-auto p-5">
        <h3 className="mt-0 text-base font-bold">{t('metadata.importMatch')}</h3>

        {/* API key */}
        <div className="mb-3">
          <label className={labelCls}>
            {t('metadata.apiKey')}
            <div className="flex gap-1.5">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKeyState(e.target.value)}
                placeholder={t('metadata.apiKeyPlaceholder')}
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => { clearApiKey(); setApiKeyState(""); }}
                className="text-xs px-2 py-1"
              >
                {t('metadata.apiClear')}
              </button>
            </div>
          </label>
          {!hasKey && (
            <a
              href="https://www.football-data.org/client/register"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-secondary underline hover:text-accent"
            >
              football-data.org
            </a>
          )}
        </div>

        {/* --- SEARCH STEP --- */}
        {step === "search" && (
          <>
            {/* Mode tabs */}
            <div className="flex gap-0 mb-2.5">
              {(["competition", "stage", "matchId"] as SearchMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-2.5 py-1 ${
                    mode === m
                      ? "bg-accent text-on-accent border-accent"
                      : ""
                  }`}
                >
                  {t(m === "competition" ? 'metadata.modeCompetition' : m === "stage" ? 'metadata.modeStage' : 'metadata.modeMatchId')}
                </button>
              ))}
            </div>

            {mode === "competition" && (
              <div className="flex gap-2 flex-wrap">
                <label className={labelCls}>
                  {t('metadata.competition')}
                  <select
                    value={competition}
                    onChange={(e) => setCompetition(e.target.value)}
                    className={`${inputCls} w-[180px]`}
                  >
                    {COMPETITIONS.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  {t('metadata.seasonYear')}
                  <input
                    type="number"
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    placeholder={t('metadata.seasonYearPlaceholder')}
                    className={`${inputCls} w-[90px]`}
                  />
                </label>
                <label className={labelCls}>
                  {t('metadata.matchday')}
                  <input
                    type="number"
                    min={1}
                    value={matchday}
                    onChange={(e) => setMatchday(e.target.value)}
                    placeholder={t('metadata.matchdayPlaceholder')}
                    className={`${inputCls} w-[70px]`}
                  />
                </label>
              </div>
            )}

            {mode === "stage" && (
              <div className="flex gap-2 flex-wrap">
                <label className={labelCls}>
                  {t('metadata.competition')}
                  <select
                    value={stageCompetition}
                    onChange={(e) => setStageCompetition(e.target.value)}
                    className={`${inputCls} w-[180px]`}
                  >
                    {COMPETITIONS.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  {t('metadata.seasonYear')}
                  <input
                    type="number"
                    value={stageSeason}
                    onChange={(e) => setStageSeason(e.target.value)}
                    placeholder={t('metadata.seasonYearPlaceholder')}
                    className={`${inputCls} w-[90px]`}
                  />
                </label>
                <label className={labelCls}>
                  {t('metadata.stage')}
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    className={`${inputCls} w-[160px]`}
                  >
                    {CUP_STAGES.map((s) => (
                      <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {mode === "matchId" && (
              <label className={labelCls}>
                {t('metadata.matchId')}
                <input
                  type="number"
                  value={matchIdInput}
                  onChange={(e) => setMatchIdInput(e.target.value)}
                  placeholder="416018"
                  className={`${inputCls} w-[180px]`}
                />
              </label>
            )}

            {error && <div className="text-danger text-xs mt-2">{error}</div>}

            <div className="flex gap-2 mt-3.5 justify-end">
              <button onClick={onCancel}>{t('common.cancel')}</button>
              <button onClick={doSearch} disabled={!hasKey || loading} className="button-primary">
                {loading ? t('metadata.searching') : t('metadata.search')}
              </button>
            </div>
          </>
        )}

        {/* --- RESULTS STEP --- */}
        {step === "results" && (
          <>
            <div className="max-h-80 overflow-y-auto border border-subtle">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-secondary text-left sticky top-0 bg-surface">
                    <th className="px-2 py-1.5">{t('metadata.date')}</th>
                    <th className="px-2 py-1.5">{t('metadata.home')}</th>
                    <th className="px-2 py-1.5 text-center">{t('metadata.score')}</th>
                    <th className="px-2 py-1.5">{t('metadata.away')}</th>
                    <th className="px-2 py-1.5">{t('metadata.competition')}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => handleSelectMatch(m.id)}
                      className="cursor-pointer border-t border-subtle hover:bg-hover"
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(m.utcDate, { dateStyle: 'short' })}</td>
                      <td className="px-2 py-1.5">{m.homeTeam.shortName ?? m.homeTeam.name}</td>
                      <td className="px-2 py-1.5 text-center">
                        {m.score.fullTime.home != null ? `${m.score.fullTime.home} – ${m.score.fullTime.away}` : "–"}
                      </td>
                      <td className="px-2 py-1.5">{m.awayTeam.shortName ?? m.awayTeam.name}</td>
                      <td className="px-2 py-1.5 text-muted">{m.competition.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <div className="text-danger text-xs mt-2">{error}</div>}
            {loading && <div className="text-xs text-secondary mt-1.5">{t('metadata.loadingDetails')}</div>}

            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => { setStep("search"); setError(null); }}>{t('metadata.back')}</button>
              <button onClick={onCancel}>{t('common.cancel')}</button>
            </div>
          </>
        )}

        {/* --- PREVIEW STEP --- */}
        {step === "preview" && previewInfo && (
          <>
            {lineupsWarning && (
              <div className="bg-[#422006] border border-[#854d0e] p-2 text-xs text-warning mb-2.5">
                {lineupsWarning}
              </div>
            )}

            {/* Section toggles */}
            <div className="flex gap-3 mb-3 text-xs">
              {(Object.keys(toggles) as (keyof SectionToggles)[]).map((k) => (
                <label key={k} className="flex items-center gap-1 text-accent">
                  <input
                    type="checkbox"
                    checked={toggles[k]}
                    onChange={(e) => setToggles((prev) => ({ ...prev, [k]: e.target.checked }))}
                  />
                  {t(k === "matchDetails" ? 'metadata.matchDetails' : k === "homeTeam" ? 'metadata.home' : k === "awayTeam" ? 'metadata.away' : 'metadata.substitutions')}
                </label>
              ))}
            </div>

            {/* Match details preview */}
            {toggles.matchDetails && (
              <div className="border border-subtle p-2.5 mb-2 text-xs">
                <strong>{t('metadata.matchDetails')}</strong>
                <div className="grid grid-cols-3 gap-1 mt-1.5 text-secondary">
                  <span>{t('metadata.previewDate', { value: previewInfo.date ?? "–" })}</span>
                  <span>{t('metadata.kickoffPreview', { value: previewInfo.kickoffTime ?? "–" })}</span>
                  <span>{t('metadata.previewCompetition', { value: previewInfo.competition ?? "–" })}</span>
                  <span>{t('metadata.previewSeason', { value: previewInfo.season ?? "–" })}</span>
                  <span>{t('metadata.previewRound', { value: previewInfo.round ?? "–" })}</span>
                  <span>{t('metadata.previewVenue', { value: previewInfo.venue ?? "–" })}</span>
                  <span>{t('metadata.previewReferee', { value: previewInfo.referee ?? "–" })}</span>
                  <span>
                    {t('metadata.previewScore', { value: previewInfo.score ? `${previewInfo.score.home ?? "?"} – ${previewInfo.score.away ?? "?"}` : "–" })}
                  </span>
                </div>
              </div>
            )}

            {/* Team preview helper */}
            {[
              { key: "homeTeam" as const, label: t('metadata.home'), team: previewInfo.homeTeam },
              { key: "awayTeam" as const, label: t('metadata.away'), team: previewInfo.awayTeam },
            ]
              .filter((entry) => toggles[entry.key])
              .map(({ key, label, team }) => (
                <div key={key} className="border border-subtle p-2.5 mb-2 text-xs">
                  <strong>{t('metadata.teamTitle', { team: label })}: {team.name ?? "–"}</strong>
                  <div className="text-secondary mt-0.5">
                    {t('metadata.previewCoach', { value: team.coach ?? "–" })} · {t('metadata.previewFormation', { value: team.formation ?? "–" })}
                  </div>
                  {team.players.length > 0 && (
                    <table className="w-full border-collapse mt-1.5">
                      <thead>
                        <tr className="text-muted text-left">
                          <th className="w-8 px-1 py-0.5">#</th>
                          <th className="px-1 py-0.5">{t('metadata.name')}</th>
                          <th className="w-10 px-1 py-0.5">{t('metadata.positionShort')}</th>
                          <th className="w-8 px-1 py-0.5">{t('metadata.substituteShort')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.players.map((p) => (
                          <tr key={p.id} className="border-t border-subtle">
                            <td className="px-1 py-0.5">{p.number ?? ""}</td>
                            <td className="px-1 py-0.5">{p.name}</td>
                            <td className="px-1 py-0.5 text-muted">{p.position ?? ""}</td>
                            <td className="px-1 py-0.5 text-muted">{p.isSubstitute ? "✓" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {team.players.length === 0 && (
                    <div className="text-muted mt-1">{t('metadata.noPlayers')}</div>
                  )}
                </div>
              ))}

            {/* Substitutions preview */}
            {toggles.substitutions && previewInfo.substitutions.length > 0 && (
              <div className="border border-subtle p-2.5 mb-2 text-xs">
                <strong>{t('metadata.substitutionsCount', { count: formatNumber(previewInfo.substitutions.length) })}</strong>
                <ul className="mt-1.5 mb-0 pl-4 text-secondary">
                  {previewInfo.substitutions.map((s) => {
                    const roster = s.team === "home" ? previewInfo.homeTeam.players : previewInfo.awayTeam.players;
                    const outName = roster.find((p) => p.id === s.playerOut)?.name ?? "?";
                    const inName = roster.find((p) => p.id === s.playerIn)?.name ?? "?";
                    return (
                      <li key={s.id}>
                        {s.minute != null ? `${formatNumber(s.minute)}'` : "?"} — {outName} ↔ {inName} ({t(s.team === 'home' ? 'metadata.home' : 'metadata.away')})
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {error && <div className="text-danger text-xs mt-2">{error}</div>}

            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => { setStep("results"); setError(null); setLineupsWarning(null); }}>{t('metadata.back')}</button>
              <button onClick={onCancel}>{t('common.cancel')}</button>
              <button
                onClick={handleConfirm}
                className="button-primary"
              >
                {t('metadata.confirmImport')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
