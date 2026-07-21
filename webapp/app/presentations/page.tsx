"use client";

import { useRouter } from 'next/navigation';
import PresentationLibrary from '../../components/presentation/PresentationLibrary';
import { useProject } from '../../lib/state/ProjectContext';
import { useT } from '../../lib/i18n';

export default function PresentationsPage() {
  const router = useRouter();
  const t = useT();
  const { projectDir, manifest, isRestoring, refreshIntegrity } = useProject();

  if (isRestoring) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted">{t('project.restore')}</div>;
  }
  if (!projectDir || !manifest) {
    return (
      <div className="panel">
        <p>{t('project.noOpen')}</p>
        <button onClick={() => router.push('/')}>{t('player.backProject')}</button>
      </div>
    );
  }

  return (
    <main className="fullbleed flex min-h-full flex-1 flex-col bg-canvas p-5 lg:p-7" data-testid="presentations-list">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="m-0 text-xl font-semibold">{t('project.presentations')}</h2>
            <p className="mb-0 mt-1 text-xs text-muted">{manifest.name}</p>
          </div>
          <button className="button-quiet" onClick={() => router.push('/')}>{t('player.project')}</button>
        </header>
        <section className="panel mt-5 p-4">
          <PresentationLibrary
            projectDir={projectDir}
            onOpen={(presentationId) => router.push(`/presentation/${presentationId}`)}
            onChanged={refreshIntegrity}
          />
        </section>
      </div>
    </main>
  );
}
