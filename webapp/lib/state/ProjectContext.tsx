"use client";

import type { ProjectDirectory } from "../host/contracts";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TaggingBoard } from '../tagging/board';
import type { ProjectManifest } from '../types/project';
import { subscribeToProjectChanges } from '../fs/clipEvents';
import { readProjectManifest } from '../fs/projectFolder';
import {
  clearProjectHandle,
  openProjectFromHandle,
  restoreProjectFromHandle,
  saveProjectHandle,
  shareProjectHandle,
  ProjectPermissionRequiredError,
  type RestoredProjectHandle,
} from './handlePersistence';
import {
  checkProjectOnOpen,
  type ProjectIntegrityReport,
} from '../utils/projectIntegrity';

export interface ProjectContextValue {
  projectDir: ProjectDirectory | null;
  manifest: ProjectManifest | null;
  board: TaggingBoard | null;
  selectedVideoId: string | null;
  integrityReport: ProjectIntegrityReport | null;
  isRestoring: boolean;
  restoreError: string | null;
  reconnectProjectName: string | null;
  reconnectProject: () => Promise<void>;
  openProject: (handle: ProjectDirectory, persist?: boolean) => Promise<ProjectIntegrityReport>;
  closeProject: () => Promise<void>;
  setManifest: React.Dispatch<React.SetStateAction<ProjectManifest | null>>;
  setSelectedVideoId: React.Dispatch<React.SetStateAction<string | null>>;
  refreshIntegrity: () => Promise<ProjectIntegrityReport>;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const openingRevision = useRef(0);
  const bookmarkTail = useRef<Promise<unknown>>(Promise.resolve());
  const [projectDir, setProjectDir] = useState<ProjectDirectory | null>(null);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [board, setBoard] = useState<TaggingBoard | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [integrityReport, setIntegrityReport] = useState<ProjectIntegrityReport | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingProject, setPendingProject] = useState<ProjectDirectory | null>(null);

  const applyOpenedProject = useCallback((opened: RestoredProjectHandle) => {
    setPendingProject(null);
    setProjectDir(opened.projectDir);
    setManifest(opened.manifest);
    setBoard(opened.board);
    setIntegrityReport(opened.integrityReport);
    setSelectedVideoId((current) => (
      current && opened.manifest.videos.some((video) => video.id === current)
        ? current
        : opened.manifest.videos[0]?.id ?? null
    ));
    setRestoreError(null);
  }, []);

  const openProject = useCallback(async (
    handle: ProjectDirectory,
    persist = true,
  ): Promise<ProjectIntegrityReport> => {
    const revision = ++openingRevision.current;
    const opened = await openProjectFromHandle(handle);
    let warning: string | null = null;
    if (persist) {
      try {
        const save = bookmarkTail.current.catch(() => undefined).then(() => (
          revision === openingRevision.current ? saveProjectHandle(handle) : handle
        ));
        bookmarkTail.current = save;
        opened.projectDir = await save;
      } catch (error) {
        warning = `Project opened, but automatic restore is unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (revision !== openingRevision.current) return opened.integrityReport;
    applyOpenedProject(opened);
    setRestoreError(warning);
    return opened.integrityReport;
  }, [applyOpenedProject]);

  const closeProject = useCallback(async () => {
    openingRevision.current += 1;
    setProjectDir(null);
    setPendingProject(null);
    setManifest(null);
    setBoard(null);
    setSelectedVideoId(null);
    setIntegrityReport(null);
    setRestoreError(null);
    const clear = bookmarkTail.current.catch(() => undefined).then(() => clearProjectHandle());
    bookmarkTail.current = clear;
    await clear.catch(() => undefined);
  }, []);

  const reconnectProject = useCallback(async () => {
    if (!pendingProject || isRestoring) return;
    const revision = openingRevision.current;
    setIsRestoring(true);
    setRestoreError(null);
    try {
      // Invoke directly from the click, before any storage reads can consume activation.
      const permission = await pendingProject.requestPermission({ mode: 'readwrite' });
      if (revision !== openingRevision.current) return;
      if (permission !== 'granted') throw new ProjectPermissionRequiredError(pendingProject);
      await openProject(pendingProject, false);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRestoring(false);
    }
  }, [isRestoring, openProject, pendingProject]);

  const refreshIntegrity = useCallback(async (): Promise<ProjectIntegrityReport> => {
    if (!projectDir || !manifest) throw new Error('No project is open.');
    const report = await checkProjectOnOpen(projectDir, manifest);
    setIntegrityReport(report);
    return report;
  }, [manifest, projectDir]);

  useEffect(() => {
    if (projectDir) return shareProjectHandle(projectDir);
  }, [projectDir]);

  useEffect(() => {
    if (!projectDir || !manifest) return;
    let active = true;
    let readRevision = 0;
    const opening = openingRevision.current;
    const unsubscribe = subscribeToProjectChanges(projectDir, () => {
      const read = ++readRevision;
      void (async () => {
        const latest = await readProjectManifest(projectDir);
        if (!latest.ok) throw new Error(latest.reason);
        // Native change notifications also include annotation saves. Avoid
        // reloading editors or rescanning the project if its manifest is unchanged.
        if (JSON.stringify(latest.manifest) === JSON.stringify(manifest)) return;
        const report = await checkProjectOnOpen(projectDir, latest.manifest);
        if (!active || read !== readRevision || opening !== openingRevision.current) return;
        setManifest(latest.manifest);
        setIntegrityReport(report);
        setSelectedVideoId((current) => latest.manifest.videos.some((video) => video.id === current)
          ? current : latest.manifest.videos[0]?.id ?? null);
      })().catch((error) => {
        if (active && read === readRevision && opening === openingRevision.current) {
          setRestoreError(error instanceof Error ? error.message : String(error));
        }
      });
    });
    return () => { active = false; unsubscribe(); };
  }, [manifest, projectDir]);

  useEffect(() => {
    let active = true;
    const revision = openingRevision.current;
    void (async () => {
      try {
        const restore = bookmarkTail.current.catch(() => undefined).then(() => (
          revision === openingRevision.current ? restoreProjectFromHandle() : null
        ));
        bookmarkTail.current = restore;
        const opened = await restore;
        if (!opened || !active || revision !== openingRevision.current) return;
        applyOpenedProject(opened);
      } catch (error) {
        if (active && revision === openingRevision.current) {
          if (error instanceof ProjectPermissionRequiredError) {
            setPendingProject(error.projectDir);
            setRestoreError(null);
          } else {
            setRestoreError(error instanceof Error ? error.message : String(error));
          }
        }
      } finally {
        if (active) setIsRestoring(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyOpenedProject]);

  return (
    <ProjectContext.Provider value={{
      projectDir,
      manifest,
      board,
      selectedVideoId,
      integrityReport,
      isRestoring,
      restoreError,
      reconnectProjectName: pendingProject?.name ?? null,
      reconnectProject,
      openProject,
      closeProject,
      setManifest,
      setSelectedVideoId,
      refreshIntegrity,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used within ProjectProvider.');
  return context;
}
