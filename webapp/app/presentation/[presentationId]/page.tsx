"use client";

import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readPresentation } from '../../../lib/fs/presentationStorage';
import { useProject } from '../../../lib/state/ProjectContext';
import type { Presentation } from '../../../lib/types/presentation';
import { useT } from '../../../lib/i18n';

const PresentationAuthoringEditor = dynamic(
  () => import('../../../components/presentation/PresentationAuthoringEditor'),
  { ssr: false },
);

export default function PresentationPage() {
  const router = useRouter();
  const params = useParams<{ presentationId: string }>();
  const presentationId = params?.presentationId ?? '';
  const t = useT();
  const { projectDir, manifest, board, isRestoring } = useProject();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir) return;
    let active = true;
    if (!presentationId) return;
    void readPresentation(projectDir, presentationId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setPresentation(result.presentation);
        setError(null);
      } else {
        setPresentation(null);
        setError(result.error.message);
      }
    });
    return () => { active = false; };
  }, [presentationId, projectDir]);

  if (isRestoring) return <div className="flex flex-1 items-center justify-center text-sm text-muted">{t('project.restore')}</div>;
  if (!projectDir || !manifest || !board) return <div className="panel"><p>{t('project.noOpen')}</p><button onClick={() => router.push('/')}>{t('player.backProject')}</button></div>;
  if (error) return <div className="panel"><p className="text-danger">{error}</p><button onClick={() => router.push('/')}>{t('player.backProject')}</button></div>;
  if (!presentation) return <div className="flex flex-1 items-center justify-center text-sm text-muted">{t('presentation.loading')}</div>;

  return (
    <PresentationAuthoringEditor
      key={presentation.id}
      projectDir={projectDir}
      manifest={manifest}
      board={board}
      presentation={presentation}
      onBack={() => router.push('/')}
    />
  );
}
