"use client";
import type { MatchInfo } from "../../lib/types/project";

const inputCls = "bg-raised text-accent border border-border px-2 py-1.5 text-sm font-sans w-full";
const labelCls = "flex flex-col gap-0.5 text-xs text-secondary";

type Props = {
  matchInfo: MatchInfo;
  onChange: (next: MatchInfo) => void;
};

export default function MatchDetailsForm({ matchInfo, onChange }: Props) {
  const set = (patch: Partial<MatchInfo>) => onChange({ ...matchInfo, ...patch });

  return (
    <div className="panel">
      <h3 className="mt-0 text-base font-bold">Match Details</h3>

      <div className="grid grid-cols-3 gap-3">
        {/* Row 1 */}
        <label className={labelCls}>
          Date
          <input
            type="date"
            value={matchInfo.date ?? ""}
            onChange={(e) => set({ date: e.target.value || null })}
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Kickoff time
          <input
            type="text"
            value={matchInfo.kickoffTime ?? ""}
            onChange={(e) => set({ kickoffTime: e.target.value || null })}
            placeholder="e.g. 15:00"
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Competition
          <input
            type="text"
            value={matchInfo.competition ?? ""}
            onChange={(e) => set({ competition: e.target.value || null })}
            placeholder="e.g. Premier League"
            className={inputCls}
          />
        </label>

        {/* Row 2 */}
        <label className={labelCls}>
          Season
          <input
            type="text"
            value={matchInfo.season ?? ""}
            onChange={(e) => set({ season: e.target.value || null })}
            placeholder="e.g. 2025-26"
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Round
          <input
            type="text"
            value={matchInfo.round ?? ""}
            onChange={(e) => set({ round: e.target.value || null })}
            placeholder="e.g. Matchday 22"
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Venue
          <input
            type="text"
            value={matchInfo.venue ?? ""}
            onChange={(e) => set({ venue: e.target.value || null })}
            placeholder="e.g. Old Trafford"
            className={inputCls}
          />
        </label>

        {/* Row 3 */}
        <label className={labelCls}>
          Referee
          <input
            type="text"
            value={matchInfo.referee ?? ""}
            onChange={(e) => set({ referee: e.target.value || null })}
            className={inputCls}
          />
        </label>

        <div className="flex gap-2 items-end">
          <label className={`${labelCls} flex-1`}>
            Score (H)
            <input
              type="number"
              min={0}
              value={matchInfo.score?.home ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                const cur = matchInfo.score ?? { home: null, away: null };
                const next = { ...cur, home: v };
                set({ score: next.home === null && next.away === null ? null : next });
              }}
              className={`${inputCls} text-center`}
            />
          </label>
          <span className="pb-2 text-muted">–</span>
          <label className={`${labelCls} flex-1`}>
            Score (A)
            <input
              type="number"
              min={0}
              value={matchInfo.score?.away ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                const cur = matchInfo.score ?? { home: null, away: null };
                const next = { ...cur, away: v };
                set({ score: next.home === null && next.away === null ? null : next });
              }}
              className={`${inputCls} text-center`}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
