import type { AppHost, EditorTarget } from '../contracts';
import { browserProjectBookmarks } from './bookmarks';
import { wrapBrowserDirectory } from './fileSystem';
import { PROJECT_SESSION_PARAM } from './tabSession';

type PickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};

function pickerWindow(): PickerWindow | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function editorPath(scopeId: string, target: EditorTarget): string {
  const path = `/clip/${encodeURIComponent(target.clipId)}`;
  const query = new URLSearchParams({ [PROJECT_SESSION_PARAM]: scopeId });
  if (target.pinId !== undefined) query.set('pinId', target.pinId);
  return `${path}?${query}`;
}

export const browserHost: AppHost = {
  kind: 'browser',
  files: {
    get canPickDirectory() { return typeof pickerWindow()?.showDirectoryPicker === 'function'; },
    get canPickVideo() { return typeof pickerWindow()?.showOpenFilePicker === 'function'; },
    get canUseScratchStorage() {
      return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
    },
    async pickDirectory() {
      const browser = pickerWindow();
      if (!browser?.showDirectoryPicker) throw new Error('Project folder selection is unavailable in this browser.');
      return wrapBrowserDirectory(await browser.showDirectoryPicker({ mode: 'readwrite' }));
    },
    async pickVideo(description) {
      const browser = pickerWindow();
      if (!browser?.showOpenFilePicker) throw new Error('Video file selection is unavailable in this browser.');
      const handles = await browser.showOpenFilePicker({
        multiple: false,
        types: [{ description, accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.avi'] } }],
      });
      return handles[0] ? handles[0].getFile() : null;
    },
    async getScratchDirectory(name) {
      const root = wrapBrowserDirectory(await navigator.storage.getDirectory(), 'scratch');
      return root.getDirectoryHandle(name, { create: true });
    },
  },
  projects: browserProjectBookmarks,
  editors: {
    open(project, target) {
      window.open(editorPath(project.scopeId, target), '_blank', 'noopener,noreferrer');
    },
    reserve(project) {
      const popup = window.open('about:blank', '_blank');
      if (!popup) return null;
      popup.opener = null;
      return {
        navigate: (target) => popup.location.replace(new URL(editorPath(project.scopeId, target), window.location.href).toString()),
        close: () => popup.close(),
      };
    },
    closeCurrent: () => window.close(),
  },
};
