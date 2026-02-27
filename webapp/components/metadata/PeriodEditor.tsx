"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchPeriod } from "../../lib/types/project";

function generateId(): string {
  return (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `per_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return "––:––.–––";
  const clamped = Math.max(0, Math.floor(ms));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000);
  const mmm = r % 1000;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return hh > 0
    ? `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}`
    : `${mm}:${pad2(ss)}.${pad3(mmm)}`;
}

const inputCls = "bg-raised text-accent border border-border px-2 py-1.5 text-sm font-sans";

type VideoOption = {
  id: string;
  label: string;
  file: string;
  durationMs?: number;
};

type Props = {
  periods: MatchPeriod[];
  videos: VideoOption[];
  onChange: (periods: MatchPeriod[]) => void;
  projectDir: FileSystemDirectoryHandle;
};

export default function PeriodEditor({ periods, videos, onChange, projectDir }: Props) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(
    videos.length > 0 ? videos[0].id : null,
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Load video URL when activeVideoId changes
  useEffect(() => {
    let revoked: string | null = null;
    (async () => {
      if (!activeVideoId || !projectDir) return;
      const video = videos.find((v) => v.id === activeVideoId);
      if (!video) return;
      try {
        const parts = video.file.split("/").filter(Boolean);
        let cur: FileSystemDirectoryHandle = projectDir;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i], { create: false });
        }
        const fh = await cur.getFileHandle(parts[parts.length - 1], { create: false });
        const file = await fh.getFile();
        const url = URL.createObjectURL(file);
        revoked = url;
        setVideoUrl(url);
      } catch {
        setVideoUrl(null);
      }
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [activeVideoId, projectDir, videos]);

  // Auto-create default periods if none exist and there is a video
  useEffect(() => {
    if (periods.length === 0 && videos.length > 0) {
      const vid = videos[0].id;
      onChange([
        { id: generateId(), label: "1st Half", videoId: vid, startMs: null, endMs: null },
        { id: generateId(), label: "2nd Half", videoId: vid, startMs: null, endMs: null },
      ]);
    }
  }, []); // only on mount

  const getCurrentTimeMs = useCallback((): number | null => {
    if (!videoRef.current) return null;
    return Math.round(videoRef.current.currentTime * 1000);
  }, []);

  const updatePeriod = (idx: number, patch: Partial<MatchPeriod>) => {
    const next = periods.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onChange(next);
  };

  const addPeriod = () => {
    const vid = activeVideoId ?? (videos.length > 0 ? videos[0].id : "");
    onChange([
      ...periods,
      { id: generateId(), label: `Period ${periods.length + 1}`, videoId: vid, startMs: null, endMs: null },
    ]);
  };

  const removePeriod = (idx: number) => {
    onChange(periods.filter((_, i) => i !== idx));
  };

  const periodsForVideo = activeVideoId
    ? periods.map((p, i) => ({ period: p, idx: i })).filter((x) => x.period.videoId === activeVideoId)
    : [];

  return (
    <div className="panel mt-3">
      <h3 className="mt-0 text-base font-bold">Periods</h3>

      {/* Video selector */}
      {videos.length > 1 && (
        <div className="mb-2">
          <label className="text-xs text-secondary">
            Video:{" "}
            <select
              value={activeVideoId ?? ""}
              onChange={(e) => setActiveVideoId(e.target.value)}
              className={`${inputCls} w-auto`}
            >
              {videos.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {videos.length === 1 && (
        <div className="text-xs text-secondary mb-2">
          Video: {videos[0].label}
        </div>
      )}

      {/* Mini video scrubber */}
      {videoUrl && (
        <div className="mb-2.5">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="w-full max-h-40 bg-black"
          />
        </div>
      )}

      {videos.length === 0 && (
        <div className="status">No videos imported. Import a video first to set period boundaries.</div>
      )}

      {/* Period rows */}
      {periodsForVideo.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-secondary text-left">
              <th className="px-1.5 py-1">Label</th>
              <th className="px-1.5 py-1">Start</th>
              <th className="px-1.5 py-1 w-10" />
              <th className="px-1.5 py-1">End</th>
              <th className="px-1.5 py-1 w-10" />
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {periodsForVideo.map(({ period, idx }) => (
              <tr key={period.id} className="border-t border-subtle">
                <td className="px-1.5 py-1">
                  <input
                    type="text"
                    value={period.label}
                    onChange={(e) => updatePeriod(idx, { label: e.target.value })}
                    className="bg-transparent text-accent border-0 border-b border-border px-0.5 py-1 text-xs w-25 outline-none"
                  />
                </td>
                <td className="px-1.5 py-1 font-mono text-xs">
                  {formatMs(period.startMs)}
                </td>
                <td className="px-1.5 py-1">
                  <button
                    onClick={() => {
                      const t = getCurrentTimeMs();
                      if (t != null) updatePeriod(idx, { startMs: t });
                    }}
                    className="text-xs px-1.5 py-0.5"
                    title="Set start to current video time"
                  >
                    Set
                  </button>
                </td>
                <td className="px-1.5 py-1 font-mono text-xs">
                  {formatMs(period.endMs)}
                </td>
                <td className="px-1.5 py-1">
                  <button
                    onClick={() => {
                      const t = getCurrentTimeMs();
                      if (t != null) updatePeriod(idx, { endMs: t });
                    }}
                    className="text-xs px-1.5 py-0.5"
                    title="Set end to current video time"
                  >
                    Set
                  </button>
                </td>
                <td>
                  <button
                    onClick={() => removePeriod(idx)}
                    className="bg-transparent border-0 text-danger cursor-pointer text-sm px-1"
                    title="Remove period"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex gap-2 mt-2 items-center">
        <button onClick={addPeriod} className="text-xs px-2.5 py-1">
          + Add period
        </button>
        <span className="text-xs text-muted">
          Period-aware timestamps only appear when boundaries are set.
        </span>
      </div>
    </div>
  );
}
