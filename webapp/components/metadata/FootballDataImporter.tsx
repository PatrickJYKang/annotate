"use client";
import { useCallback, useEffect, useState } from "react";
import type { MatchInfo } from "../../lib/types/project";
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
  { value: "GROUP_STAGE", label: "Group Stage" },
  { value: "LAST_16", label: "Round of 16" },
  { value: "QUARTER_FINALS", label: "Quarter-finals" },
  { value: "SEMI_FINALS", label: "Semi-finals" },
  { value: "FINAL", label: "Final" },
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

  // --- Search ---
  const doSearch = useCallback(async () => {
    if (!hasKey) return;
    setError(null);
    setLoading(true);
    try {
      let matches: ApiMatchSummary[] = [];
      if (mode === "competition") {
        if (!season) { setError("Enter a season year."); return; }
        const md = matchday ? parseInt(matchday, 10) : null;
        matches = await searchMatchesByCompetition(apiKey.trim(), competition, season, md);
      } else if (mode === "stage") {
        if (!stageSeason || !stage) { setError("Select season and stage."); return; }
        matches = await searchMatchesByStage(apiKey.trim(), stageCompetition, stageSeason, stage);
      } else if (mode === "matchId") {
        const id = parseInt(matchIdInput, 10);
        if (isNaN(id)) { setError("Enter a valid match ID."); return; }
        // Go directly to detail
        const detail = await fetchMatch(apiKey.trim(), id);
        await handleSelectMatch(detail.id, detail);
        return;
      }
      if (matches.length === 0) {
        setError("No matches found for the given criteria.");
        return;
      }
      setResults(matches);
      setStep("results");
    } catch (e: any) {
      setError(e?.message || "Search failed.");
    } finally {
      setLoading(false);
    }
  }, [hasKey, apiKey, mode, competition, season, matchday, stageCompetition, stageSeason, stage, matchIdInput]);

  // --- Select match ---
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
        setLineupsWarning("Lineups are not yet available for this match.");
      }

      setStep("preview");
    } catch (e: any) {
      setError(e?.message || "Failed to load match details.");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

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

  // --- Render helpers ---
  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
  };

  return (
    <div
      className="modal-overlay z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-card w-[680px] max-h-[85vh] overflow-y-auto p-5">
        <h3 className="mt-0 text-base font-bold">Import Match Metadata</h3>

        {/* API key */}
        <div className="mb-3">
          <label className={labelCls}>
            API key
            <div className="flex gap-1.5">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKeyState(e.target.value)}
                placeholder="Your football-data.org API key"
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => { clearApiKey(); setApiKeyState(""); }}
                className="text-xs px-2 py-1"
              >
                Clear
              </button>
            </div>
          </label>
          <div className="text-xs text-muted mt-1">
            Your API key is stored locally in this browser and is never saved to your project files.
            {!hasKey && (
              <>
                {" "}Get a free key at{" "}
                <a
                  href="https://www.football-data.org/client/register"
                  target="_blank"
                  rel="noreferrer"
                  className="text-secondary hover:text-accent underline"
                >
                  football-data.org
                </a>.
              </>
            )}
          </div>
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
                  {m === "competition" ? "By season / matchday" : m === "stage" ? "By stage (cups)" : "By match ID"}
                </button>
              ))}
            </div>

            {mode === "competition" && (
              <div className="flex gap-2 flex-wrap">
                <label className={labelCls}>
                  Competition
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
                  Season (year)
                  <input
                    type="number"
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    placeholder="e.g. 2024"
                    className={`${inputCls} w-[90px]`}
                  />
                </label>
                <label className={labelCls}>
                  Matchday (optional)
                  <input
                    type="number"
                    min={1}
                    value={matchday}
                    onChange={(e) => setMatchday(e.target.value)}
                    placeholder="all"
                    className={`${inputCls} w-[70px]`}
                  />
                </label>
              </div>
            )}

            {mode === "stage" && (
              <div className="flex gap-2 flex-wrap">
                <label className={labelCls}>
                  Competition
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
                  Season (year)
                  <input
                    type="number"
                    value={stageSeason}
                    onChange={(e) => setStageSeason(e.target.value)}
                    placeholder="e.g. 2024"
                    className={`${inputCls} w-[90px]`}
                  />
                </label>
                <label className={labelCls}>
                  Stage
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    className={`${inputCls} w-[160px]`}
                  >
                    {CUP_STAGES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {mode === "matchId" && (
              <label className={labelCls}>
                Match ID
                <input
                  type="number"
                  value={matchIdInput}
                  onChange={(e) => setMatchIdInput(e.target.value)}
                  placeholder="e.g. 416018"
                  className={`${inputCls} w-[180px]`}
                />
              </label>
            )}

            {error && <div className="text-danger text-xs mt-2">{error}</div>}

            <div className="flex gap-2 mt-3.5 justify-end">
              <button onClick={onCancel}>Cancel</button>
              <button onClick={doSearch} disabled={!hasKey || loading} className="bg-accent text-on-accent hover:bg-accent-hover">
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
          </>
        )}

        {/* --- RESULTS STEP --- */}
        {step === "results" && (
          <>
            <div className="text-xs text-secondary mb-1.5">
              {results.length} match(es) found. Select one to preview.
            </div>

            <div className="max-h-80 overflow-y-auto border border-subtle">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-secondary text-left sticky top-0 bg-surface">
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Home</th>
                    <th className="px-2 py-1.5 text-center">Score</th>
                    <th className="px-2 py-1.5">Away</th>
                    <th className="px-2 py-1.5">Competition</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => handleSelectMatch(m.id)}
                      className="cursor-pointer border-t border-subtle hover:bg-hover"
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(m.utcDate)}</td>
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
            {loading && <div className="text-xs text-secondary mt-1.5">Loading match details…</div>}

            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => { setStep("search"); setError(null); }}>← Back</button>
              <button onClick={onCancel}>Cancel</button>
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

            <div className="text-xs text-secondary mb-2.5">
              Review the data below. Toggle sections on/off before confirming.
            </div>

            {/* Section toggles */}
            <div className="flex gap-3 mb-3 text-xs">
              {(Object.keys(toggles) as (keyof SectionToggles)[]).map((k) => (
                <label key={k} className="flex items-center gap-1 text-accent">
                  <input
                    type="checkbox"
                    checked={toggles[k]}
                    onChange={(e) => setToggles((prev) => ({ ...prev, [k]: e.target.checked }))}
                  />
                  {k === "matchDetails" ? "Match details" : k === "homeTeam" ? "Home team" : k === "awayTeam" ? "Away team" : "Substitutions"}
                </label>
              ))}
            </div>

            {/* Match details preview */}
            {toggles.matchDetails && (
              <div className="border border-subtle p-2.5 mb-2 text-xs">
                <strong>Match Details</strong>
                <div className="grid grid-cols-3 gap-1 mt-1.5 text-secondary">
                  <span>Date: {previewInfo.date ?? "–"}</span>
                  <span>Kickoff: {previewInfo.kickoffTime ?? "–"}</span>
                  <span>Competition: {previewInfo.competition ?? "–"}</span>
                  <span>Season: {previewInfo.season ?? "–"}</span>
                  <span>Round: {previewInfo.round ?? "–"}</span>
                  <span>Venue: {previewInfo.venue ?? "–"}</span>
                  <span>Referee: {previewInfo.referee ?? "–"}</span>
                  <span>
                    Score: {previewInfo.score ? `${previewInfo.score.home ?? "?"} – ${previewInfo.score.away ?? "?"}` : "–"}
                  </span>
                </div>
              </div>
            )}

            {/* Team preview helper */}
            {[
              { key: "homeTeam" as const, label: "Home Team", team: previewInfo.homeTeam },
              { key: "awayTeam" as const, label: "Away Team", team: previewInfo.awayTeam },
            ]
              .filter((t) => toggles[t.key])
              .map(({ key, label, team }) => (
                <div key={key} className="border border-subtle p-2.5 mb-2 text-xs">
                  <strong>{label}: {team.name ?? "–"}</strong>
                  <div className="text-secondary mt-0.5">
                    Coach: {team.coach ?? "–"} · Formation: {team.formation ?? "–"}
                  </div>
                  {team.players.length > 0 && (
                    <table className="w-full border-collapse mt-1.5">
                      <thead>
                        <tr className="text-muted text-left">
                          <th className="w-8 px-1 py-0.5">#</th>
                          <th className="px-1 py-0.5">Name</th>
                          <th className="w-10 px-1 py-0.5">Pos</th>
                          <th className="w-8 px-1 py-0.5">Sub</th>
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
                    <div className="text-muted mt-1">No players available.</div>
                  )}
                </div>
              ))}

            {/* Substitutions preview */}
            {toggles.substitutions && previewInfo.substitutions.length > 0 && (
              <div className="border border-subtle p-2.5 mb-2 text-xs">
                <strong>Substitutions ({previewInfo.substitutions.length})</strong>
                <ul className="mt-1.5 mb-0 pl-4 text-secondary">
                  {previewInfo.substitutions.map((s) => {
                    const roster = s.team === "home" ? previewInfo.homeTeam.players : previewInfo.awayTeam.players;
                    const outName = roster.find((p) => p.id === s.playerOut)?.name ?? "?";
                    const inName = roster.find((p) => p.id === s.playerIn)?.name ?? "?";
                    return (
                      <li key={s.id}>
                        {s.minute != null ? `${s.minute}'` : "?"} — {outName} ↔ {inName} ({s.team})
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {error && <div className="text-danger text-xs mt-2">{error}</div>}

            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => { setStep("results"); setError(null); setLineupsWarning(null); }}>← Back</button>
              <button onClick={onCancel}>Cancel</button>
              <button
                onClick={handleConfirm}
                className="bg-accent text-on-accent hover:bg-accent-hover"
              >
                Confirm Import
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
