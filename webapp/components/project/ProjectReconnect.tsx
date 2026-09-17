"use client";

import { useT } from '../../lib/i18n';
import { useProject } from '../../lib/state/ProjectContext';

export default function ProjectReconnect() {
  const t = useT();
  const { reconnectProjectName, reconnectProject, isRestoring } = useProject();
  if (!reconnectProjectName) return null;
  return (
    <div className="flex flex-col items-start gap-3 p-4" data-testid="project-reconnect">
      <p className="m-0 text-sm text-secondary" role="status">
        {t('project.permissionRequired', { name: reconnectProjectName })}
      </p>
      <button className="button-primary" disabled={isRestoring} onClick={() => void reconnectProject()}>
        {t('project.reconnect')}
      </button>
    </div>
  );
}
