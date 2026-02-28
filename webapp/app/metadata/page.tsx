"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/state/ProjectContext";
import type { MatchInfo } from "../../lib/types/project";
import { defaultMatchInfo } from "../../lib/types/project";
import { writeManifest } from "../../lib/fs/projectFolder";
import MatchDetailsForm from "../../components/metadata/MatchDetailsForm";
import TeamPanel from "../../components/metadata/TeamPanel";
import FootballDataImporter from "../../components/metadata/FootballDataImporter";
import PeriodEditor from "../../components/metadata/PeriodEditor";

const DEBOUNCE_MS = 800;

export default function MetadataPage() {
  const router = useRouter();
  const { projectDir, manifest, setManifest } = useProject();
  const [info, setInfo] = useState<MatchInfo>(defaultMatchInfo());
  const [apiImporterOpen, setApiImporterOpen] = useState(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoRef = useRef(info);

  // Sync local state from manifest on mount / manifest change
  useEffect(() => {
    if (manifest?.matchInfo) {
      setInfo(manifest.matchInfo);
      infoRef.current = manifest.matchInfo;
    }
  }, [manifest?.matchInfo]);

  // Debounced save
  const persist = useCallback(
    (next: MatchInfo) => {
      infoRef.current = next;
      setInfo(next);
      if (!projectDir || !manifest) return;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(async () => {
        const updated = { ...manifest, matchInfo: infoRef.current };
        setManifest(updated);
        await writeManifest(projectDir, updated);
      }, DEBOUNCE_MS);
    },
    [projectDir, manifest, setManifest],
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        // Synchronous best-effort flush — writeManifest is async but we fire-and-forget
        if (projectDir && manifest) {
          const updated = { ...manifest, matchInfo: infoRef.current };
          writeManifest(projectDir, updated).catch(() => {});
        }
      }
    };
  }, [projectDir, manifest]);

  if (!projectDir || !manifest) {
    return (
      <div>
        <div className="panel">
          <div className="status">No project open. Go back and open a project.</div>
          <div className="toolbar mt-2">
            <button onClick={() => router.push("/")}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fullbleed">
      {/* Nav bar */}
      <div className="flex items-stretch bg-surface border-b border-border">
        <button
          onClick={() => router.push("/")}
          className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base"
        >
          ← Back to project
        </button>
        <button
          onClick={() => setApiImporterOpen(true)}
          className="self-stretch px-4 py-2 border-0 border-r border-solid border-border text-base"
        >
          Import match metadata
        </button>
        <span className="flex-1" />
        <button
          onClick={async () => {
            if (flushTimer.current) clearTimeout(flushTimer.current);
            const updated = { ...manifest, matchInfo: infoRef.current };
            setManifest(updated);
            await writeManifest(projectDir, updated);
          }}
          className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base"
        >
          Save now
        </button>
        <button
          onClick={async () => {
            // Flush immediately before navigating
            if (flushTimer.current) clearTimeout(flushTimer.current);
            const updated = { ...manifest, matchInfo: infoRef.current };
            setManifest(updated);
            await writeManifest(projectDir, updated);
            router.push("/player");
          }}
          className="self-stretch px-4 py-2 border-0 border-l border-solid border-border text-base"
        >
          Player →
        </button>
      </div>

      <div className="px-4 py-3">
      {/* Match Details */}
      <MatchDetailsForm matchInfo={info} onChange={persist} />

      {/* Teams — side by side (responsive via .team-grid) */}
      <div className="team-grid">
        <TeamPanel
          label="Home"
          team={info.homeTeam}
          onChange={(t) => persist({ ...info, homeTeam: t })}
        />
        <TeamPanel
          label="Away"
          team={info.awayTeam}
          onChange={(t) => persist({ ...info, awayTeam: t })}
        />
      </div>

      {/* Periods */}
      <PeriodEditor
        periods={info.periods}
        videos={manifest.videos}
        onChange={(periods) => persist({ ...info, periods })}
        projectDir={projectDir}
      />

      {/* Notes */}
      <div className="panel mt-3">
        <h3 className="mt-0 text-base font-bold">Notes</h3>
        <textarea
          value={info.notes ?? ""}
          onChange={(e) => persist({ ...info, notes: e.target.value || null })}
          rows={3}
          className="w-full bg-raised text-accent border border-border p-2 resize-y font-sans text-sm"
          placeholder="Free-form match notes…"
        />
      </div>
      </div>
      {/* Football-data.org API importer modal */}
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
