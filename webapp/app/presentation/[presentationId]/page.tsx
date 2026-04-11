"use client";

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProject } from '../../../lib/state/ProjectContext';
import { validateProjectFolderStructure } from '../../../lib/fs/projectFolder';
import { readPresentation } from '../../../lib/fs/presentationStorage';
import type { Presentation } from '../../../lib/types/presentation';
import { readTaggingSchema } from '../../../lib/tagging/schema';
import PresentationAuthoringEditor from '../../../components/presentation/PresentationAuthoringEditor';

export default function PresentationPage({ params }: { params: { presentationId: string } }) {
  const router = useRouter();
  const { presentationId } = params;
  const { projectDir, setProjectDir, manifest, setManifest, taggingSchema, setTaggingSchema } = useProject();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openDB = useCallback((): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('annotate-db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }, []);

  const saveProjectHandle = useCallback(async (handle: FileSystemDirectoryHandle) => {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle as any, 'project');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
      });
    } catch {
    }
  }, [openDB]);

  const loadProjectHandle = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const db = await openDB();
      const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('project');
        req.onsuccess = () => { const value = req.result as FileSystemDirectoryHandle | undefined; db.close(); resolve(value || null); };
        req.onerror = () => { const err = req.error; db.close(); reject(err); };
      });
      return handle;
    } catch {
      return null;
    }
  }, [openDB]);

  useEffect(() => {
    (async () => {
      if (projectDir || manifest) return;
      try {
        const handle = await loadProjectHandle();
        if (!handle) return;
        const anyHandle: any = handle as any;
        const permission = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
        if (permission !== 'granted') return;
        const validated = await validateProjectFolderStructure(handle);
        if (!validated.ok) throw new Error(`Not a valid project folder: ${validated.reason}`);
        setProjectDir(handle);
        setManifest(validated.manifest);
        if (!taggingSchema) {
          const schema = await readTaggingSchema(handle);
          setTaggingSchema(schema);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [projectDir, manifest, loadProjectHandle, setProjectDir, setManifest, taggingSchema, setTaggingSchema]);

  useEffect(() => {
    const onMsg = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as any;
      if (data && data.type === 'project-handle' && data.handle) {
        try {
          const handle: FileSystemDirectoryHandle = data.handle as FileSystemDirectoryHandle;
          await saveProjectHandle(handle);
          const anyHandle: any = handle as any;
          const permission = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'read' }) : 'granted');
          if (permission !== 'granted') return;
          const validated = await validateProjectFolderStructure(handle);
          if (!validated.ok) throw new Error(`Not a valid project folder: ${validated.reason}`);
          setProjectDir(handle);
          setManifest(validated.manifest);
          const schema = await readTaggingSchema(handle);
          setTaggingSchema(schema);
        } catch {
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [saveProjectHandle, setProjectDir, setManifest, setTaggingSchema]);

  useEffect(() => {
    let cancelled = false;
    setPresentation(null);
    setError(null);
    (async () => {
      if (!projectDir) return;
      try {
        const loaded = await readPresentation(projectDir, presentationId);
        if (cancelled) return;
        if (!loaded) {
          setError(`Presentation not found: ${presentationId}`);
          setPresentation(null);
          return;
        }
        setPresentation(loaded);
        if (!taggingSchema) {
          const schema = await readTaggingSchema(projectDir);
          if (cancelled) return;
          setTaggingSchema(schema);
        }
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectDir, presentationId, taggingSchema, setTaggingSchema]);

  const openProject = useCallback(async () => {
    try {
      const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker();
      const anyHandle: any = dir as any;
      const permission = await (anyHandle?.queryPermission ? anyHandle.queryPermission({ mode: 'readwrite' }) : 'granted');
      if (permission !== 'granted' && anyHandle?.requestPermission) {
        const requested = await anyHandle.requestPermission({ mode: 'readwrite' });
        if (requested !== 'granted') throw new Error('Write permission not granted');
      }
      await saveProjectHandle(dir);
      const validated = await validateProjectFolderStructure(dir);
      if (!validated.ok) throw new Error(`Not a valid project folder: ${validated.reason}`);
      setProjectDir(dir);
      setManifest(validated.manifest);
      const schema = await readTaggingSchema(dir);
      setTaggingSchema(schema);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [saveProjectHandle, setManifest, setProjectDir, setTaggingSchema]);

  if (!projectDir) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">No project open. Open your project folder to continue.</div>
          <div className="toolbar mt-2">
            <button onClick={openProject}>Open Project Folder</button>
            <button onClick={() => router.push('/presentations')}>Back to Presentations</button>
          </div>
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Loading project...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status text-danger">{error}</div>
          <div className="toolbar mt-2">
            <button onClick={() => router.push('/presentations')}>Back to Presentations</button>
            <button onClick={openProject}>Open Project Folder</button>
          </div>
        </div>
      </div>
    );
  }

  if (!presentation) {
    return (
      <div className="fullbleed">
        <div className="panel">
          <div className="status">Loading presentation...</div>
        </div>
      </div>
    );
  }

  return (
    <PresentationAuthoringEditor
      key={presentation.id}
      projectDir={projectDir}
      manifest={manifest}
      presentation={presentation}
      taggingSchema={taggingSchema}
      onBack={() => router.push('/presentations')}
    />
  );
}
