"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  deletePresentation,
  duplicatePresentation,
  listPresentations,
  renamePresentation,
  writePresentation,
} from '../../lib/fs/presentationStorage';
import { createDefaultPresentation, type Presentation } from '../../lib/types/presentation';
import { useLocale } from '../../lib/i18n';

interface PresentationLibraryProps {
  projectDir: FileSystemDirectoryHandle;
  onOpen: (presentationId: string) => void;
  onChanged?: () => unknown | Promise<unknown>;
  compact?: boolean;
}

function presentationId(): string {
  return `presentation-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

export default function PresentationLibrary({
  projectDir,
  onOpen,
  onChanged,
  compact = false,
}: PresentationLibraryProps) {
  const { t, formatDate, formatNumber } = useLocale();
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [name, setName] = useState(() => t('presentation.defaultName'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listPresentations(projectDir);
    setPresentations(result.presentations);
    setMessage(result.errors.length ? result.errors.map((entry) => entry.error.message).join(' ') : null);
  }, [projectDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(async (id: string, operation: () => Promise<void>) => {
    setBusyId(id);
    setMessage(null);
    try {
      await operation();
      await refresh();
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }, [onChanged, refresh]);

  const create = useCallback(async () => {
    const id = presentationId();
    await mutate(id, async () => {
      await writePresentation(
        projectDir,
        createDefaultPresentation(name.trim() || t('presentation.untitled'), id),
      );
      setName(t('presentation.defaultName'));
    });
  }, [mutate, name, projectDir, t]);

  const startRename = (presentation: Presentation) => {
    setEditingId(presentation.id);
    setEditingName(presentation.name);
    setDeletePendingId(null);
  };

  return (
    <div className="flex min-h-0 flex-col" data-testid="presentation-library">
      <div className="flex gap-2">
        <input
          aria-label={t('presentation.nameInput')}
          className="min-w-0 flex-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create();
          }}
        />
        <button className="button-primary" onClick={() => void create()} disabled={busyId !== null}>{t('common.create')}</button>
      </div>

      <div className={`mt-3 min-h-0 border-t border-border ${compact ? 'max-h-[52vh] overflow-y-auto' : ''}`}>
        {presentations.map((presentation) => (
          <article
            key={presentation.id}
            className="border-b border-border py-2"
            data-testid={`presentation-card-${presentation.id}`}
          >
            {editingId === presentation.id ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  aria-label={t('presentation.renameAria', { name: presentation.name })}
                  className="min-w-0 flex-1"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setEditingId(null);
                    if (event.key === 'Enter') {
                      void mutate(presentation.id, async () => {
                        await renamePresentation(projectDir, presentation.id, editingName);
                        setEditingId(null);
                      });
                    }
                  }}
                />
                <button
                  onClick={() => void mutate(presentation.id, async () => {
                    await renamePresentation(projectDir, presentation.id, editingName);
                    setEditingId(null);
                  })}
                  disabled={busyId !== null}
                >
                  {t('common.save')}
                </button>
                <button onClick={() => setEditingId(null)} disabled={busyId !== null}>{t('common.cancel')}</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate">{presentation.name}</strong>
                  <p className="mb-0 mt-1 text-xs text-muted">
                    {t('presentation.summary', {
                      count: formatNumber(presentation.slides.length),
                      date: formatDate(presentation.updatedAt, { dateStyle: 'short', timeStyle: 'short' }),
                    })}
                  </p>
                </div>
                <button className="button-primary" onClick={() => onOpen(presentation.id)}>{t('common.open')}</button>
                <button className="button-quiet" onClick={() => startRename(presentation)} disabled={busyId !== null}>{t('common.rename')}</button>
                <button
                  className="button-quiet"
                  onClick={() => void mutate(presentation.id, async () => {
                    await duplicatePresentation(projectDir, presentation.id, { id: presentationId() });
                  })}
                  disabled={busyId !== null}
                >
                  {t('common.duplicate')}
                </button>
                {deletePendingId === presentation.id ? (
                  <>
                    <button
                      className="button-danger"
                      onClick={() => void mutate(presentation.id, async () => {
                        await deletePresentation(projectDir, presentation.id);
                        setDeletePendingId(null);
                      })}
                      disabled={busyId !== null}
                    >
                      {t('presentation.confirmDelete')}
                    </button>
                    <button onClick={() => setDeletePendingId(null)} disabled={busyId !== null}>{t('common.cancel')}</button>
                  </>
                ) : (
                  <button
                    className="button-quiet text-danger"
                    onClick={() => {
                      setDeletePendingId(presentation.id);
                      setEditingId(null);
                    }}
                    disabled={busyId !== null}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {presentations.length === 0 && (
          <div className="empty-state border-0" aria-hidden="true" />
        )}
      </div>
      {message && <p role="status" className="mb-0 mt-3 text-sm text-warning">{message}</p>}
    </div>
  );
}
