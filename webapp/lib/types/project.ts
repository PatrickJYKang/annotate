export interface ProjectManifestV1 {
  schema: 'project.v1';
  name: string;
  created: string; // ISO date
  videos: { id: string; label: string; file: string; durationMs?: number; width?: number; height?: number; fps?: number }[];
  marks: { id: string; videoId: string; t_ms: number; tags: string[] }[];
  stills: { id: string; videoId: string; t_ms: number; file: string; width?: number; height?: number }[];
  annotations: { stillId: string; file: string; lastModified?: string }[];
  reports: string[];
  thumbnails: string[];
}

export function defaultProjectManifest(name: string): ProjectManifestV1 {
  return {
    schema: 'project.v1',
    name,
    created: new Date().toISOString(),
    videos: [],
    marks: [],
    stills: [],
    annotations: [],
    reports: [],
    thumbnails: [],
  };
}
