"use client";

import { useState } from "react";
import {
  defaultMatchInfo,
  getProjectFps,
  getProjectResolution,
  type MatchInfo,
  type ProjectResolution,
} from "../../lib/types/project";
import MatchDetailsForm from "../metadata/MatchDetailsForm";
import TeamPanel from "../metadata/TeamPanel";
import FootballDataImporter from "../metadata/FootballDataImporter";

const inputCls = "bg-raised text-accent border border-border px-2 py-1.5 text-sm font-sans w-full";
const labelCls = "flex flex-col gap-0.5 text-xs text-secondary";

export type ProjectSetupValues = {
  name: string;
  fps: number;
  resolution: ProjectResolution;
  matchInfo: MatchInfo;
};

type Props = {
  fsSupported: boolean;
  busy?: boolean;
  onCreate: (values: ProjectSetupValues) => void | Promise<void>;
  onCancel: () => void;
};

function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

export default function ProjectSetupScreen({ fsSupported, busy = false, onCreate, onCancel }: Props) {
  const defaultResolution = getProjectResolution(null);
  const [name, setName] = useState("MyMatch");
  const [fps, setFps] = useState(getProjectFps(null));
  const [width, setWidth] = useState(defaultResolution.width);
  const [height, setHeight] = useState(defaultResolution.height);
  const [matchInfo, setMatchInfo] = useState<MatchInfo>(defaultMatchInfo());
  const [apiImporterOpen, setApiImporterOpen] = useState(false);

  const canSubmit = fsSupported && name.trim().length > 0 && fps > 0 && width > 0 && height > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    await onCreate({
      name: name.trim(),
      fps: clampPositiveInteger(fps, getProjectFps(null)),
      resolution: {
        width: clampPositiveInteger(width, defaultResolution.width),
        height: clampPositiveInteger(height, defaultResolution.height),
      },
      matchInfo,
    });
  };

  return (
    <div className="fixed inset-0 z-20 bg-canvas overflow-y-auto">
      <div className="min-h-full p-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          <div className="panel">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h2 className="m-0 text-xl font-bold">Project setup</h2>
                <p className="mt-1 text-sm text-muted">
                  Set the project invariants first. Imported videos will be converted to this frame rate and resolution.
                </p>
              </div>
              <button onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm">
                Cancel
              </button>
            </div>

            <div className="mt-4 grid grid-cols-[minmax(280px,1.5fr)_minmax(320px,1fr)] gap-3">
              <label className={labelCls}>
                Project name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputCls}
                  placeholder="e.g. Arsenal vs Chelsea"
                  autoFocus
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className={labelCls}>
                  FPS
                  <input
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={fps}
                    onChange={(event) => setFps(Number(event.target.value) || getProjectFps(null))}
                    className={inputCls}
                  />
                </label>
                <label className={labelCls}>
                  Width
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={width}
                    onChange={(event) => setWidth(Number(event.target.value) || defaultResolution.width)}
                    className={inputCls}
                  />
                </label>
                <label className={labelCls}>
                  Height
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={height}
                    onChange={(event) => setHeight(Number(event.target.value) || defaultResolution.height)}
                    className={inputCls}
                  />
                </label>
              </div>
            </div>

            {!fsSupported && (
              <div className="mt-3 text-sm text-danger">
                Chromium required. Use Chrome, Edge, or Opera.
              </div>
            )}
          </div>

          <div className="flex items-stretch bg-surface border border-border">
            <button onClick={() => setApiImporterOpen(true)} disabled={busy} className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base">
              Import match metadata
            </button>
            <span className="flex-1" />
            <button onClick={submit} disabled={!canSubmit} className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base font-bold">
              {busy ? "Creating..." : "Create project folder..."}
            </button>
          </div>

          <MatchDetailsForm matchInfo={matchInfo} onChange={setMatchInfo} />

          <div className="team-grid">
            <TeamPanel
              label="Home"
              team={matchInfo.homeTeam}
              onChange={(homeTeam) => setMatchInfo({ ...matchInfo, homeTeam })}
            />
            <TeamPanel
              label="Away"
              team={matchInfo.awayTeam}
              onChange={(awayTeam) => setMatchInfo({ ...matchInfo, awayTeam })}
            />
          </div>

          <div className="panel">
            <h3 className="mt-0 text-base font-bold">Notes</h3>
            <textarea
              value={matchInfo.notes ?? ""}
              onChange={(event) => setMatchInfo({ ...matchInfo, notes: event.target.value || null })}
              rows={3}
              className="w-full bg-raised text-accent border border-border p-2 resize-y font-sans text-sm"
              placeholder="Free-form match notes..."
            />
          </div>
        </div>
      </div>

      {apiImporterOpen && (
        <FootballDataImporter
          onImport={(partial) => {
            setMatchInfo({ ...matchInfo, ...partial });
            setApiImporterOpen(false);
          }}
          onCancel={() => setApiImporterOpen(false)}
        />
      )}
    </div>
  );
}
