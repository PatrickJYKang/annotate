"use client";
import { useState } from "react";
import type { TeamInfo, PlayerEntry } from "../../lib/types/project";
import TeamsheetImporter from "./TeamsheetImporter";

function generateId(): string {
  return (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls = "bg-raised text-accent border border-border px-2 py-1.5 text-sm font-sans w-full";
const labelCls = "flex flex-col gap-0.5 text-xs text-secondary";
const cellCls = "bg-transparent text-accent border-0 border-b border-border px-0.5 py-1 text-xs font-sans w-full outline-none";

type Props = {
  label: "Home" | "Away";
  team: TeamInfo;
  onChange: (next: TeamInfo) => void;
};

export default function TeamPanel({ label, team, onChange }: Props) {
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
    <div className="panel">
      <h3 className="mt-0 text-base font-bold">{label} Team</h3>

      <div className="flex flex-col gap-2">
        <label className={labelCls}>
          Name
          <input
            type="text"
            value={team.name ?? ""}
            onChange={(e) => setField({ name: e.target.value || null })}
            placeholder={`${label} team name`}
            className={inputCls}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            Coach
            <input
              type="text"
              value={team.coach ?? ""}
              onChange={(e) => setField({ coach: e.target.value || null })}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Formation
            <input
              type="text"
              value={team.formation ?? ""}
              onChange={(e) => setField({ formation: e.target.value || null })}
              placeholder="e.g. 4-3-3"
              className={inputCls}
            />
          </label>
        </div>
      </div>

      {/* Import button */}
      <div className="mt-2.5 mb-1.5">
        <button onClick={() => setImporterOpen(true)} className="text-xs px-2.5 py-1">
          Import teamsheet
        </button>
      </div>

      {/* Player table */}
      {team.players.length > 0 && (
        <table className="w-full border-collapse text-xs mt-1">
          <thead>
            <tr className="text-secondary text-left">
              <th className="w-10 px-0.5 py-1">#</th>
              <th className="px-0.5 py-1">Name</th>
              <th className="w-15 px-0.5 py-1">Pos</th>
              <th className="w-7 px-0.5 py-1 text-center">C</th>
              <th className="w-7 px-0.5 py-1 text-center">S</th>
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
                        ? "Duplicate shirt number"
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
                    title="Captain"
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={!!p.isSubstitute}
                    onChange={(e) => updatePlayer(i, { isSubstitute: e.target.checked || undefined })}
                    title="Substitute"
                  />
                </td>
                <td>
                  <button
                    onClick={() => removePlayer(i)}
                    className="bg-transparent border-0 text-danger cursor-pointer text-sm px-1"
                    title="Remove player"
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
        className="mt-1.5 text-xs px-2.5 py-1"
      >
        + Add player
      </button>

      {/* Teamsheet importer modal */}
      {importerOpen && (
        <TeamsheetImporter
          onImport={handleImport}
          onCancel={() => setImporterOpen(false)}
        />
      )}
    </div>
  );
}
