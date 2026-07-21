"use client";
import { useState } from "react";
import type { TeamInfo, PlayerEntry } from "../../lib/types/metadata";
import TeamsheetImporter from "./TeamsheetImporter";
import { useT } from "../../lib/i18n";

function generateId(): string {
  return (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const cellCls = "bg-transparent text-accent border-0 border-b border-border px-0.5 py-1 text-xs font-sans w-full outline-none";

type Props = {
  label: string;
  team: TeamInfo;
  onChange: (next: TeamInfo) => void;
};

export default function TeamPanel({ label, team, onChange }: Props) {
  const t = useT();
  const [importerOpen, setImporterOpen] = useState(false);

  const setField = (patch: Partial<TeamInfo>) => onChange({ ...team, ...patch });

  const updatePlayer = (idx: number, patch: Partial<PlayerEntry>) => {
    const next = team.players.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    setField({ players: next });
  };

  const addPlayer = () => {
    const entry: PlayerEntry = {
      id: generateId(),
      number: null,
      name: "",
      position: null,
    };
    setField({ players: [...team.players, entry] });
  };

  const removePlayer = (idx: number) => {
    setField({ players: team.players.filter((_, i) => i !== idx) });
  };

  const handleImport = (players: PlayerEntry[]) => {
    setField({ players });
    setImporterOpen(false);
  };

  // Compute duplicate shirt numbers for validation
  const numberCounts = new Map<number, number>();
  for (const p of team.players) {
    if (p.number != null) {
      numberCounts.set(p.number, (numberCounts.get(p.number) ?? 0) + 1);
    }
  }
  const duplicateNumbers = new Set<number>();
  for (const [num, count] of numberCounts) {
    if (count > 1) duplicateNumbers.add(num);
  }

  return (
    <section className="form-section min-w-0">
      <h3 className="form-heading">{t('metadata.teamTitle', { team: label })}</h3>
      <div className="flex flex-col gap-2">
        <label className="field">
          {t('metadata.name')}
          <input
            type="text"
            value={team.name ?? ""}
            onChange={(e) => setField({ name: e.target.value || null })}
            className="w-full"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="field">
            {t('metadata.coach')}
            <input
              type="text"
              value={team.coach ?? ""}
              onChange={(e) => setField({ coach: e.target.value || null })}
              className="w-full"
            />
          </label>
          <label className="field">
            {t('metadata.formation')}
            <input
              type="text"
              value={team.formation ?? ""}
              onChange={(e) => setField({ formation: e.target.value || null })}
              className="w-full"
            />
          </label>
        </div>
      </div>

      {/* Import button */}
      <div className="mt-2.5 mb-1.5">
        <button className="button-quiet text-xs" onClick={() => setImporterOpen(true)}>
          {t('metadata.importTeamsheet')}
        </button>
      </div>

      {/* Player table */}
      {team.players.length > 0 && (
        <table className="w-full border-collapse text-xs mt-1">
          <thead>
            <tr className="text-secondary text-left">
              <th className="w-10 px-0.5 py-1">#</th>
              <th className="px-0.5 py-1">{t('metadata.name')}</th>
              <th className="w-15 px-0.5 py-1">{t('metadata.positionShort')}</th>
              <th className="w-7 px-0.5 py-1 text-center">{t('metadata.captainShort')}</th>
              <th className="w-7 px-0.5 py-1 text-center">{t('metadata.substituteShort')}</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {team.players.map((p, i) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={p.number ?? ""}
                    onChange={(e) =>
                      updatePlayer(i, {
                        number: e.target.value === "" ? null : parseInt(e.target.value, 10),
                      })
                    }
                    className={`${cellCls} w-9 text-center ${
                      p.number != null && duplicateNumbers.has(p.number)
                        ? "border-danger text-danger"
                        : ""
                    }`}
                    title={
                      p.number != null && duplicateNumbers.has(p.number)
                        ? t('metadata.duplicateNumber')
                        : undefined
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updatePlayer(i, { name: e.target.value })}
                    className={cellCls}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={p.position ?? ""}
                    onChange={(e) =>
                      updatePlayer(i, { position: e.target.value || null })
                    }
                    className={`${cellCls} w-13`}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={!!p.isCaptain}
                    onChange={(e) => updatePlayer(i, { isCaptain: e.target.checked || undefined })}
                    title={t('metadata.captain')}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={!!p.isSubstitute}
                    onChange={(e) => updatePlayer(i, { isSubstitute: e.target.checked || undefined })}
                    title={t('metadata.substitute')}
                  />
                </td>
                <td>
                  <button
                    onClick={() => removePlayer(i)}
                    className="bg-transparent border-0 text-danger cursor-pointer text-sm px-1"
                    title={t('metadata.removePlayer')}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        onClick={addPlayer}
        className="button-quiet mt-1.5 text-xs"
      >
        {t('metadata.addPlayer')}
      </button>
      {importerOpen && (
        <TeamsheetImporter
          onImport={handleImport}
          onCancel={() => setImporterOpen(false)}
        />
      )}
    </section>
  );
}
