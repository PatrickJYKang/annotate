"use client";
import type { MatchInfo } from "../../lib/types/metadata";
import { useT } from "../../lib/i18n";

type Props = {
  matchInfo: MatchInfo;
  onChange: (next: MatchInfo) => void;
};

export default function MatchDetailsForm({ matchInfo, onChange }: Props) {
  const t = useT();
  const set = (patch: Partial<MatchInfo>) => onChange({ ...matchInfo, ...patch });

  return (
    <section className="form-section">
      <h3 className="form-heading">{t('metadata.matchDetails')}</h3>
      <div className="field-grid max-w-5xl">
        <label className="field">
          {t('metadata.date')}
          <input
            type="date"
            value={matchInfo.date ?? ""}
            onChange={(e) => set({ date: e.target.value || null })}
            className="w-full"
          />
        </label>

        <label className="field">
          {t('metadata.kickoff')}
          <input
            type="text"
            value={matchInfo.kickoffTime ?? ""}
            onChange={(e) => set({ kickoffTime: e.target.value || null })}
            className="w-full"
          />
        </label>

        <label className="field">
          {t('metadata.competition')}
          <input
            type="text"
            value={matchInfo.competition ?? ""}
            onChange={(e) => set({ competition: e.target.value || null })}
            className="w-full"
          />
        </label>

        <label className="field">
          {t('metadata.season')}
          <input
            type="text"
            value={matchInfo.season ?? ""}
            onChange={(e) => set({ season: e.target.value || null })}
            className="w-full"
          />
        </label>

        <label className="field">
          {t('metadata.round')}
          <input
            type="text"
            value={matchInfo.round ?? ""}
            onChange={(e) => set({ round: e.target.value || null })}
            className="w-full"
          />
        </label>

        <label className="field">
          {t('metadata.venue')}
          <input
            type="text"
            value={matchInfo.venue ?? ""}
            onChange={(e) => set({ venue: e.target.value || null })}
            className="w-full"
          />
        </label>

        <label className="field">
          {t('metadata.referee')}
          <input
            type="text"
            value={matchInfo.referee ?? ""}
            onChange={(e) => set({ referee: e.target.value || null })}
            className="w-full"
          />
        </label>

        <div className="flex max-w-[220px] items-end gap-2">
          <label className="field min-w-0 flex-1">
            {t('metadata.homeScore')}
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
              className="w-full text-center"
            />
          </label>
          <span className="pb-2 text-muted">–</span>
          <label className="field min-w-0 flex-1">
            {t('metadata.awayScore')}
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
              className="w-full text-center"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
