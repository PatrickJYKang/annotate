"use client";

import { useState } from "react";
import {
  defaultMatchInfo,
  type MatchInfo,
} from "../../lib/types/metadata";
import MatchDetailsForm from "../metadata/MatchDetailsForm";
import TeamPanel from "../metadata/TeamPanel";
import FootballDataImporter from "../metadata/FootballDataImporter";
import { useT } from "../../lib/i18n";

export type ProjectSetupValues = {
  name: string;
  matchInfo: MatchInfo;
};

type Props = {
  fsSupported: boolean;
  busy?: boolean;
  onCreate: (values: ProjectSetupValues) => void | Promise<void>;
  onCancel: () => void;
};

export default function ProjectSetupScreen({ fsSupported, busy = false, onCreate, onCancel }: Props) {
  const t = useT();
  const [name, setName] = useState("MyMatch");
  const [matchInfo, setMatchInfo] = useState<MatchInfo>(defaultMatchInfo());
  const [apiImporterOpen, setApiImporterOpen] = useState(false);

  const canSubmit = fsSupported && name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    await onCreate({
      name: name.trim(),
      matchInfo,
    });
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-canvas">
      <header className="workspace-bar sticky top-0 z-10">
        <button className="button-quiet border-r border-border px-4" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        <h2 className="m-0 flex items-center px-4 text-sm font-semibold">{t('project.setupTitle')}</h2>
        <span className="flex-1" />
        <button className="button-quiet border-l border-border px-4" onClick={() => setApiImporterOpen(true)} disabled={busy}>
          {t('project.setupImportMetadata')}
        </button>
        <button className="button-primary border-y-0 border-r-0 px-5" onClick={submit} disabled={!canSubmit}>
          {busy ? t('project.creating') : t('project.createFolder')}
        </button>
      </header>

      <div className="min-h-full px-5 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <section className="form-section">
            <label className="field-inline">
              <span>{t('project.setupName')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>

            {!fsSupported && (
              <div className="mt-3 text-sm text-danger">
                {t('project.setupBrowser')}
              </div>
            )}
          </section>

          <MatchDetailsForm matchInfo={matchInfo} onChange={setMatchInfo} />

          <div className="team-grid">
            <TeamPanel
              label={t('metadata.home')}
              team={matchInfo.homeTeam}
              onChange={(homeTeam) => setMatchInfo({ ...matchInfo, homeTeam })}
            />
            <TeamPanel
              label={t('metadata.away')}
              team={matchInfo.awayTeam}
              onChange={(awayTeam) => setMatchInfo({ ...matchInfo, awayTeam })}
            />
          </div>

          <section className="form-section">
            <h3 className="form-heading">{t('project.setupNotes')}</h3>
            <textarea
              value={matchInfo.notes ?? ""}
              onChange={(event) => setMatchInfo({ ...matchInfo, notes: event.target.value || null })}
              rows={3}
              className="w-full max-w-3xl resize-y"
            />
          </section>
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
