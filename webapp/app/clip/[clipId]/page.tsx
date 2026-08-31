"use client";

import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClipEditorSaveStatus } from '../../../components/clip/ClipEditor';
import { registerVideoFile, unregisterVideoRef } from '../../../lib/clip/sidecarClient';
import {
  mutateClipExclusive,
  replaceClipAnnotationsExclusive,
} from '../../../lib/fs/clipRepository';
import { readClip } from '../../../lib/fs/clipStorage';
import { getFilePath, splitSafeRelativePath } from '../../../lib/fs/fsAccess';
import { SidecarProvider } from '../../../lib/state/SidecarContext';
import { useProject } from '../../../lib/state/ProjectContext';
import type { ClipAnnotation, Clip } from '../../../lib/types/clip';
import { useLocale } from '../../../lib/i18n';

const ClipEditor = dynamic(() => import('../../../components/clip/ClipEditor'), { ssr: false });

export default function ClipPage() {
  const router = useRouter();
  const params = useParams<{ clipId: string }>();
  const searchParams = useSearchParams();
  const { t, formatNumber } = useLocale();
  const clipId = params?.clipId ?? '';
  const {
    projectDir,
    manifest,
    isRestoring,
    refreshIntegrity,
    setSelectedVideoId,
  } = useProject();
  const [clip, setClip] = useState<Clip | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoRef, setVideoRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ClipEditorSaveStatus>('idle');
  const activeVideoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectDir || !manifest) return;
    let active = true;
    void (async () => {
      const result = await readClip(projectDir, clipId);
      if (!active) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setClip(result.clip);
      setError(null);
    })();
    return () => {
      active = false;
    };
  }, [clipId, manifest, projectDir]);

  const video = useMemo(
    () => manifest?.videos.find((candidate) => candidate.id === clip?.videoId) ?? null,
    [clip?.videoId, manifest],
  );

  useEffect(() => {
    if (clip?.videoId) setSelectedVideoId(clip.videoId);
  }, [clip?.videoId, setSelectedVideoId]);

  useEffect(() => {
    if (!projectDir || !video) {
      setVideoUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const handle = await getFilePath(projectDir, splitSafeRelativePath(video.file), false);
        const file = await handle.getFile();
        if (!active) return;
        objectUrl = URL.createObjectURL(file);
        setVideoUrl(objectUrl);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectDir, video]);

  useEffect(() => {
    if (!projectDir || !video) return;
    let active = true;
    void (async () => {
      try {
        const handle = await getFilePath(projectDir, splitSafeRelativePath(video.file), false);
        const file = await handle.getFile();
        const registered = await registerVideoFile(file);
        if (!active) {
          await unregisterVideoRef(registered.videoRef);
          return;
        }
        const previous = activeVideoRef.current;
        activeVideoRef.current = registered.videoRef;
        setVideoRef(registered.videoRef);
        if (previous && previous !== registered.videoRef) await unregisterVideoRef(previous);
      } catch {
        if (active) setVideoRef(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectDir, video]);

  useEffect(() => () => {
    const ref = activeVideoRef.current;
    if (ref) void unregisterVideoRef(ref);
    activeVideoRef.current = null;
  }, []);

  const persistAnnotations = useCallback(async (annotations: ClipAnnotation[]) => {
    if (!projectDir) throw new Error(t('clip.projectSaveUnavailable'));
    setSaveStatus('saving');
    try {
      const saved = await replaceClipAnnotationsExclusive(projectDir, clipId, annotations);
      setClip(saved);
      setSaveStatus('saved');
      void refreshIntegrity();
      return saved;
    } catch (cause) {
      setSaveStatus('error');
      throw cause;
    }
  }, [clipId, projectDir, refreshIntegrity, t]);

  const persistClip = useCallback(async (nextClip: Clip) => {
    if (!projectDir) throw new Error(t('clip.projectSaveUnavailable'));
    setSaveStatus('saving');
    try {
      const saved = await mutateClipExclusive(projectDir, clipId, (latest) => ({
        ...latest,
        startFrame: nextClip.startFrame,
        endFrame: nextClip.endFrame,
        pins: structuredClone(nextClip.pins),
        annotations: structuredClone(nextClip.annotations),
      }));
      setClip(saved);
      setSaveStatus('saved');
      void refreshIntegrity();
      return saved;
    } catch (cause) {
      setSaveStatus('error');
      throw cause;
    }
  }, [clipId, projectDir, refreshIntegrity, t]);

  if (isRestoring) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted">{t('project.restore')}</div>;
  }
  if (!projectDir || !manifest) {
    return (
      <div className="panel">
        <p className="status">{t('project.noOpen')}</p>
        <button onClick={() => router.push('/')}>{t('player.backProject')}</button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel">
        <p className="status text-danger">{error}</p>
        <button onClick={() => router.push('/player')}>{t('player.backCapture')}</button>
      </div>
    );
  }
  if (!clip || !video || !videoUrl) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted">{t('clip.loading')}</div>;
  }

  return (
    <SidecarProvider>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="workspace-bar items-center text-sm">
          <button className="button-quiet self-stretch border-r border-border px-4" onClick={() => router.push('/')}>
            {t('player.project')}
          </button>
          <button className="button-quiet self-stretch border-r border-border px-4" onClick={() => router.push('/player')}>
            {t('player.player')}
          </button>
          <div className="min-w-0 px-3">
            <strong>{clip.label || clip.id}</strong>
            <span className="ml-2 font-mono text-[10px] text-muted">{t('clip.frameHeader', {
              start: formatNumber(clip.startFrame),
              end: formatNumber(clip.endFrame - 1),
              fps: formatNumber(video.fps),
            })}</span>
          </div>
          <span className="flex-1" />
          <span className="px-3 text-xs text-muted">{saveStatus === 'saving' ? t('clip.saving') : saveStatus === 'error' ? t('clip.saveFailed') : ''}</span>
        </header>
        <ClipEditor
          key={clip.id}
          clip={clip}
          video={video}
          videoUrl={videoUrl}
          videoRef={videoRef ?? undefined}
          projectDir={projectDir}
          persistAnnotations={persistAnnotations}
          persistClip={persistClip}
          onClipUpdate={setClip}
          initialPinId={searchParams?.get('pinId') ?? null}
        />
      </div>
    </SidecarProvider>
  );
}
