"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/state/ProjectContext";
import type { MatchInfo } from "../../lib/types/metadata";
import { defaultMatchInfo } from "../../lib/types/metadata";
import { mutateProjectManifestExclusive } from "../../lib/fs/projectManifestRepository";
import MatchDetailsForm from "../../components/metadata/MatchDetailsForm";
import TeamPanel from "../../components/metadata/TeamPanel";
import FootballDataImporter from "../../components/metadata/FootballDataImporter";
import { useT } from "../../lib/i18n";

const DEBOUNCE_MS = 800;

export default function MetadataPage() {
  const router = useRouter();
  const t = useT();
  const { projectDir, manifest, setManifest } = useProject();
  const [info, setInfo] = useState<MatchInfo>(defaultMatchInfo());
  const [apiImporterOpen, setApiImporterOpen] = useState(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoRef = useRef(info);
  const initializedProjectRef = useRef<FileSystemDirectoryHandle | null>(null);

  const saveMatchInfo = useCallback(async (next: MatchInfo) => {
    if (!projectDir) return;
    const updated = await mutateProjectManifestExclusive(projectDir, (latest) => ({
      ...latest,
      matchInfo: next,
    }));
    setManifest(updated);
  }, [projectDir, setManifest]);

  // Initialize once per project. Completed saves also update the shared manifest,
  // but must not overwrite newer text that is still being edited locally.
  useEffect(() => {
    if (!projectDir || !manifest || initializedProjectRef.current === projectDir) return;
    const nextInfo = manifest.matchInfo ?? defaultMatchInfo();
    initializedProjectRef.current = projectDir;
    setInfo(nextInfo);
    infoRef.current = nextInfo;
  }, [manifest, projectDir]);

  // Debounced save
  const persist = useCallback(
    (next: MatchInfo) => {
      infoRef.current = next;
      setInfo(next);
      if (!projectDir || !manifest) return;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(async () => {
        await saveMatchInfo(infoRef.current);
      }, DEBOUNCE_MS);
    },
    [projectDir, manifest, saveMatchInfo],
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        // Synchronous best-effort flush — writeManifest is async but we fire-and-forget
        if (projectDir && manifest) {
          saveMatchInfo(infoRef.current).catch(() => {});
        }
      }
    };
  }, [projectDir, manifest, saveMatchInfo]);

  if (!projectDir || !manifest) {
    return (
      <div>
        <div className="panel">
          <div className="status">{t('metadata.noProject')}</div>
          <div className="toolbar mt-2">
            <button onClick={() => router.push("/")}>{t('metadata.backHome')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullbleed flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="workspace-bar">
        <button
          onClick={() => router.push("/")}
          className="button-quiet border-r border-border px-4"
        >
          ← {t('player.backProject')}
        </button>
        <h1 className="m-0 flex items-center px-4 text-sm font-semibold">{t('project.matchInfo')}</h1>
        <span className="flex-1" />
        <button
          onClick={() => setApiImporterOpen(true)}
          className="button-quiet border-l border-border px-4"
        >
          {t('project.setupImportMetadata')}
        </button>
        <button
          onClick={async () => {
            if (flushTimer.current) clearTimeout(flushTimer.current);
            await saveMatchInfo(infoRef.current);
          }}
          className="button-primary border-y-0 border-r-0 px-5"
        >
          {t('project.saveNow')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 lg:px-8">
      <div className="mx-auto max-w-6xl">
      <MatchDetailsForm matchInfo={info} onChange={persist} />

      {/* Teams — side by side (responsive via .team-grid) */}
      <div className="team-grid">
        <TeamPanel
          label={t('metadata.home')}
          team={info.homeTeam}
          onChange={(t) => persist({ ...info, homeTeam: t })}
        />
        <TeamPanel
          label={t('metadata.away')}
          team={info.awayTeam}
          onChange={(t) => persist({ ...info, awayTeam: t })}
        />
      </div>

      {/* Notes */}
      <section className="form-section">
        <h3 className="form-heading">{t('metadata.notes')}</h3>
        <textarea
          value={info.notes ?? ""}
          onChange={(e) => persist({ ...info, notes: e.target.value || null })}
          rows={3}
          className="w-full max-w-3xl resize-y"
        />
      </section>
      </div>
      </div>
      {apiImporterOpen && (
        <FootballDataImporter
          onImport={(partial) => {
            const merged = { ...info, ...partial };
            persist(merged);
            setApiImporterOpen(false);
          }}
          onCancel={() => setApiImporterOpen(false)}
        />
      )}
    </div>
  );
}
