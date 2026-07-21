import type { FrameBoundary } from '../clip/frameMath';
import type { MatchInfo } from './metadata';

export type VideoFrameCountSource = 'normalize' | 'probe';

export interface VideoEntry {
  id: string;
  label: string;
  file: string;
  fps: number;
  frameCount: FrameBoundary;
  frameCountSource: VideoFrameCountSource;
  width: number;
  height: number;
}

export interface ProjectManifest {
  schema: 'project.v2';
  name: string;
  created: string;
  videos: VideoEntry[];
  matchInfo?: MatchInfo;
}
