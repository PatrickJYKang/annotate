'use client';

import { useEffect, useRef, useState } from 'react';
import type { VideoNormalizationProgress } from '../../lib/clip/sidecarClient';
import { useLocale } from '../../lib/i18n';
import { ProgressEstimate } from '../../lib/utils/progressEstimate';

export default function VideoImportProgress({ progress, onCancel }: {
  progress: VideoNormalizationProgress;
  onCancel: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const estimate = useRef(new ProgressEstimate());
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    const now = performance.now();
    estimate.current.record(progress.phase, progress.phaseProgress, now);
    setSeconds(estimate.current.secondsRemaining(now));
  }, [progress]);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(estimate.current.secondsRemaining(performance.now())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const time = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <section className="panel fixed bottom-5 right-5 z-50 w-[min(28rem,calc(100vw-2.5rem))]"
      aria-label={t('project.normalizationProgress')} role="status">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{t(`project.normalization.${progress.phase}`)}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-muted">{formatNumber(Math.round(progress.progress * 100))}%</span>
          <button className="px-2 py-1 text-xs" onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </div>
      <progress className="mt-2 w-full" max={1} value={progress.progress} />
      <div className="mt-1 min-h-4 text-xs text-muted" data-testid="import-time-estimate">
        {time ? t('project.normalization.remaining', { time }) : t('project.normalization.estimating')}
      </div>
    </section>
  );
}
