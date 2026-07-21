"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { TaggingBoard } from '../tagging/board';
import type { ProjectManifest } from '../types/project';
import {
  clearProjectHandle,
  openProjectFromHandle,
  restoreProjectFromHandle,
  saveProjectHandle,
  type RestoredProjectHandle,
} from './handlePersistence';
import {
  checkProjectOnOpen,
  type ProjectIntegrityReport,
} from '../utils/projectIntegrity';

export interface ProjectContextValue {
  projectDir: FileSystemDirectoryHandle | null;
  manifest: ProjectManifest | null;
  board: TaggingBoard | null;
  selectedVideoId: string | null;
  integrityReport: ProjectIntegrityReport | null;
  isRestoring: boolean;
  restoreError: string | null;
  openProject: (handle: FileSystemDirectoryHandle, persist?: boolean) => Promise<ProjectIntegrityReport>;
  closeProject: () => Promise<void>;
  setManifest: React.Dispatch<React.SetStateAction<ProjectManifest | null>>;
  setSelectedVideoId: React.Dispatch<React.SetStateAction<string | null>>;
  refreshIntegrity: () => Promise<ProjectIntegrityReport>;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectDir, setProjectDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [board, setBoard] = useState<TaggingBoard | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [integrityReport, setIntegrityReport] = useState<ProjectIntegrityReport | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const applyOpenedProject = useCallback((opened: RestoredProjectHandle) => {
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
    handle: FileSystemDirectoryHandle,
    persist = true,
  ): Promise<ProjectIntegrityReport> => {
    const opened = await openProjectFromHandle(handle);
    applyOpenedProject(opened);
    if (persist) {
      await saveProjectHandle(handle).catch((error) => {
        setRestoreError(
          `Project opened, but automatic restore is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    return opened.integrityReport;
  }, [applyOpenedProject]);

  const closeProject = useCallback(async () => {
    setProjectDir(null);
    setManifest(null);
    setBoard(null);
    setSelectedVideoId(null);
    setIntegrityReport(null);
    setRestoreError(null);
    await clearProjectHandle().catch(() => undefined);
  }, []);

  const refreshIntegrity = useCallback(async (): Promise<ProjectIntegrityReport> => {
    if (!projectDir || !manifest) throw new Error('No project is open.');
    const report = await checkProjectOnOpen(projectDir, manifest);
    setIntegrityReport(report);
    return report;
  }, [manifest, projectDir]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const opened = await restoreProjectFromHandle();
        if (!opened || !active) return;
        applyOpenedProject(opened);
      } catch (error) {
        if (active) {
          setRestoreError(error instanceof Error ? error.message : String(error));
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
