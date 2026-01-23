"use client";
import React, { createContext, useContext, useState } from 'react';
import type { ProjectManifestV1 } from '../types/project';

export type ProjectContextType = {
  projectDir: FileSystemDirectoryHandle | null;
  setProjectDir: (d: FileSystemDirectoryHandle | null) => void;
  manifest: ProjectManifestV1 | null;
  setManifest: (m: ProjectManifestV1 | null) => void;
  selectedVideoId: string | null;
  setSelectedVideoId: (id: string | null) => void;
};

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectDir, setProjectDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [manifest, setManifest] = useState<ProjectManifestV1 | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  return (
    <ProjectContext.Provider value={{ projectDir, setProjectDir, manifest, setManifest, selectedVideoId, setSelectedVideoId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
