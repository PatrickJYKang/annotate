'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import type { ProjectDirectory } from '../../lib/host/contracts';
import type { Clip } from '../../lib/types/clip';
import type { ClickTiming } from '../../lib/types/recording';
import type { DeckTake, Presentation } from '../../lib/types/presentation';
import type { ProjectManifest } from '../../lib/types/project';
import { recordingSegments } from '../../lib/export/recording';
import { exportRecording } from '../../lib/export/recordingMp4';
import PresentationCanvas, {
  type PresentationCanvasHandle,
  type PresentationScene,
  type PresentationVideoResource,
} from './PresentationCanvas';

interface Props {
  dir: ProjectDirectory;
  manifest: ProjectManifest;
  clips: readonly Clip[];
  source: Presentation;
  clip?: Clip;
  resources: ReadonlyMap<string, PresentationVideoResource>;
  takes: DeckTake[];
  onSave: (take: DeckTake) => Promise<void>;
  onClose: () => void;
}

const setupScene: PresentationScene = { kind: 'slide', index: 0 };
const doNothing = () => {};

export default function RecordingStudio({
  dir,
  manifest,
  clips,
  source,
  clip,
  resources,
  takes,
  onSave,
  onClose,
}: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null),
    player = useRef<PresentationCanvasHandle>(null);
  const draft = useRef<DeckTake | null>(null),
    exportController = useRef<AbortController | null>(null);
  const [run, setRun] = useState<{ deck: Presentation; record: boolean } | null>(null);
  const [scene, setScene] = useState<PresentationScene>({ kind: 'slide', index: 0 });
  const [name, setName] = useState(t('record.take', { n: takes.length + 1 }));
  const [start, setStart] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null),
    [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [unsaved, setUnsaved] = useState<DeckTake | null>(null);
  const validRange =
    !clip ||
    (start !== null && last !== null && start >= clip.startFrame && last < clip.endFrame && start <= last);
  const busy = saving || progress !== null;
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      exportController.current?.abort();
    };
  }, []);

  function begin(take?: DeckTake) {
    let slides = structuredClone(take?.slides ?? source.slides);
    if (!take && clip) {
      if (!validRange || start === null || last === null) return;
      slides = slides.map((s) =>
        s.kind === 'clip' ? { ...s, range: { startFrame: start, endFrame: last + 1 } } : s,
      );
    }
    if (!take) {
      // Rehearse the static slides afresh. Keep imported clip cues on their own clock.
      for (const slide of slides) {
        if (slide.kind !== 'clip') {
          delete slide.holdMs;
          if (slide.kind === 'pin') delete slide.clickTimesMs;
        } else for (const cue of slide.pauseCues ?? []) if (!cue.clickTimesMs) delete cue.holdMs;
      }
    }
    const deck = { ...source, slides, transitions: structuredClone(take?.transitions ?? source.transitions) };
    try {
      const parts = recordingSegments(deck, clips, manifest);
      if (parts.some((p) => p.kind !== 'title' && !resources.has(p.video.id)))
        throw new Error(t('record.mediaUnavailable'));
    } catch (error) {
      setMessage(String(error));
      return;
    }
    setMessage('');
    setUnsaved(null);
    draft.current = take
      ? null
      : {
          id: crypto.randomUUID(),
          name: name.trim(),
          slides: structuredClone(slides),
          transitions: deck.transitions,
        };
    setScene({ kind: 'slide', index: 0 });
    setRun({ deck, record: !take });
  }
  const save = useCallback(
    async (take: DeckTake) => {
      setSaving(true);
      setUnsaved(take);
      try {
        await onSave(take);
        setUnsaved(null);
        setStart(null);
        setLast(null);
        setName(t('record.take', { n: takes.length + 2 }));
        setMessage(t('record.saved'));
      } catch (error) {
        setMessage(String(error));
      } finally {
        setSaving(false);
      }
    },
    [onSave, t, takes.length],
  );
  const finishing = useRef(false);
  useEffect(() => {
    finishing.current = false;
  }, [run, scene]);
  const complete = useCallback(() => {
    if (!run || finishing.current) return;
    finishing.current = true;
    if (scene.kind === 'slide' && run.deck.transitions[scene.index]?.mode === 'match_video') {
      setScene({ kind: 'transition', index: scene.index });
      return;
    }
    if (scene.index + 1 < run.deck.slides.length) {
      setScene({ kind: 'slide', index: scene.index + 1 });
      return;
    }
    const take = draft.current;
    draft.current = null;
    setRun(null);
    if (take) {
      for (const s of take.slides)
        if (s.kind === 'clip') {
          // Freeze which pins participated so adding a new pin won't interrupt this take.
          s.pausePins = (s.pauseCues ?? []).map((c) => c.pinId);
        }
      void save(take);
    }
  }, [run, save, scene]);
  const capture = useCallback(
    (pinId: string | null, timing: ClickTiming) => {
      const slide = draft.current?.slides[scene.index];
      if (!slide || scene.kind !== 'slide') return;
      if (slide.kind === 'clip' && pinId !== null) {
        const previous = slide.pauseCues?.find((c) => c.pinId === pinId);
        slide.pauseCues = [
          ...(slide.pauseCues ?? []).filter((c) => c.pinId !== pinId),
          { ...previous, pinId, ...timing },
        ];
      } else if (slide.kind === 'pin') Object.assign(slide, timing);
      else if (slide.kind === 'title') slide.holdMs = timing.holdMs;
    },
    [scene],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!dialog.current?.open) return;
      // Background editor shortcuts must not handle any recording-window keystroke.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!busy) {
          if (run) {
            draft.current = null;
            setRun(null);
          } else onClose();
        }
      } else if (run && (e.code === 'Space' || e.key === 'ArrowRight')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && run.record) player.current?.advance();
      } else if (run && !['Tab', 'Enter', ' '].includes(e.key) && !(e.target instanceof HTMLInputElement))
        e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [busy, onClose, run]);
  async function write(take: DeckTake) {
    if (exportController.current) return;
    const controller = new AbortController();
    exportController.current = controller;
    setProgress(0);
    setMessage('');
    try {
      const path = await exportRecording(
        dir,
        take.name,
        take.id,
        recordingSegments(take, clips, manifest),
        resources,
        setProgress,
        controller.signal,
      );
      setMessage(path);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(String(error));
    } finally {
      exportController.current = null;
      setProgress(null);
    }
  }
  const title = clip ? t('record.clips') : t('record.deck');
  const canvas = useMemo(
    () =>
      run && (
        <PresentationCanvas
          ref={player}
          key={scene.kind + scene.index}
          projectDir={dir}
          manifest={manifest}
          clips={clips}
          presentation={run.deck}
          scene={scene}
          videoResources={resources}
          studio
          isPresenting
          onHold={run.record ? capture : undefined}
          onComplete={complete}
        />
      ),
    [run, scene, dir, manifest, clips, resources, capture, complete],
  );
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(e) => e.preventDefault()}
      onKeyDown={(e) => e.stopPropagation()}
      className="m-auto max-h-[92vh] w-[min(92vw,58rem)] overflow-auto border border-border bg-surface p-4 text-primary backdrop:bg-black/75"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2>{title}</h2>
        <button
          disabled={busy}
          onClick={() => {
            if (run) {
              draft.current = null;
              setRun(null);
            } else onClose();
          }}
        >
          {t(run ? 'common.cancel' : 'record.close')}
        </button>
      </div>
      {run ? (
        <>
          <div className="h-[min(58vh,36rem)] bg-black" inert={!run.record}>
            {canvas}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <b>{run.record ? t('record.recording') : t('record.replay')}</b>
            {run.record && (
              <button onClick={() => player.current?.advance()}>{t('presentation.next')}</button>
            )}
          </div>
        </>
      ) : (
        <>
          {clip && (resources.has(clip.videoId) ? (
            <div className="mb-3 h-[min(54vh,32rem)] min-h-60 bg-black">
              <PresentationCanvas
                projectDir={dir}
                manifest={manifest}
                clips={clips}
                presentation={source}
                scene={setupScene}
                videoResources={resources}
                isPresenting={false}
                onComplete={doNothing}
                recordingRange={{
                  first: start, last, setFirst: setStart, setLast,
                  useFullClip: () => { setStart(clip.startFrame); setLast(clip.endFrame - 1); },
                }}
              />
            </div>
          ) : <p role="status">{t('record.mediaUnavailable')}</p>)}
          <form
            className="flex flex-wrap items-end gap-2 border-b border-border pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (validRange && name.trim() && !busy) begin();
            }}
          >
            <label className="grid gap-1">
              {t('record.name')}
              <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              type="submit"
              className="button-primary"
              disabled={!validRange || !name.trim() || busy || !source.slides.length}
            >
              {t('record.start')}
            </button>
          </form>
          <ul className="max-h-[42vh] overflow-auto">
            {takes.map((take) => (
              <li key={take.id} className="flex items-center gap-2 border-b border-border py-2">
                <b className="mr-auto">{take.name}</b>
                <button disabled={busy} onClick={() => begin(take)}>
                  {t('record.replay')}
                </button>
                <button disabled={busy} onClick={() => void write(take)}>
                  {t('record.mp4')}
                </button>
              </li>
            ))}
          </ul>
          {progress !== null && (
            <div className="mt-2 flex items-center gap-2">
              <progress max={100} value={progress} />
              {progress}%{' '}
              <button disabled={progress >= 95} onClick={() => exportController.current?.abort()}>
                {t('common.cancel')}
              </button>
            </div>
          )}
          {unsaved && !saving && <button onClick={() => void save(unsaved)}>{t('common.save')}</button>}
          {message && (
            <p role="status" className="mt-2 break-all text-sm">
              {message}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
