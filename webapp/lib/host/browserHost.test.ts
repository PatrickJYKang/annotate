import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppHost } from './index';
import { browserHost } from './browser';
import { wrapBrowserDirectory, unwrapBrowserDirectory } from './browser/fileSystem';
import { MockFileSystem } from '../fs/test/mockFileSystem';
import { inventoryDirectory, readTextFile, writeTextFile } from '../fs/fsAccess';
import { openProjectFromHandle, ProjectPermissionRequiredError, restoreProjectFromHandle } from '../state/handlePersistence';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser project filesystem', () => {
  it('wraps handles once and unwraps only directories owned by this host', () => {
    const fs = new MockFileSystem();
    expect(wrapBrowserDirectory(fs.nativeRoot)).toBe(fs.root);
    expect(fs.root).not.toBe(fs.nativeRoot);
    expect(unwrapBrowserDirectory(fs.root)).toBe(fs.nativeRoot);
    expect(() => unwrapBrowserDirectory({ ...fs.root })).toThrow('does not belong');
  });

  it('reads, lists, creates, replaces, and removes through opaque directory capabilities', async () => {
    const fs = new MockFileSystem({ 'old.txt': 'original', 'existing/note.txt': 'note' });
    expect(await readTextFile(fs.root, ['old.txt'])).toBe('original');
    await writeTextFile(fs.root, ['new folder', 'résumé.txt'], 'replacement');
    await writeTextFile(fs.root, ['old.txt'], 'new');
    expect(await fs.readText('old.txt')).toBe('new');
    expect(await inventoryDirectory(fs.root)).toEqual([
      { path: 'existing/note.txt', size: 4 },
      { path: 'new folder/résumé.txt', size: 11 },
      { path: 'old.txt', size: 3 },
    ]);
    await expect(fs.root.removeEntry('existing')).rejects.toMatchObject({ name: 'InvalidModificationError' });
    await fs.root.removeEntry('existing', { recursive: true });
    expect(fs.exists('existing')).toBe(false);
  });

  it('preserves native missing-file and permission errors without creating files on read', async () => {
    const fs = new MockFileSystem();
    await expect(fs.root.getFileHandle('missing')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(fs.root.getDirectoryHandle('missing')).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(fs.list()).toEqual([]);
    const denied = new DOMException('Access denied', 'NotAllowedError');
    vi.spyOn(fs.nativeRoot, 'getFileHandle').mockRejectedValue(denied);
    await expect(fs.root.getFileHandle('secret')).rejects.toBe(denied);
  });

  it.each(['', '.', '..', '../escape', '/absolute', 'C:\\escape', 'nested/file', 'a\0b'])(
    'rejects unsafe child names before calling native operations: %j', async (name) => {
      const fs = new MockFileSystem();
      const nativeCalls = [
        vi.spyOn(fs.nativeRoot, 'getFileHandle'),
        vi.spyOn(fs.nativeRoot, 'getDirectoryHandle'),
        vi.spyOn(fs.nativeRoot, 'removeEntry'),
      ];
      await expect(fs.root.getFileHandle(name, { create: true })).rejects.toThrow('Unsafe');
      await expect(fs.root.getDirectoryHandle(name, { create: true })).rejects.toThrow('Unsafe');
      await expect(fs.root.removeEntry(name, { recursive: true })).rejects.toThrow('Unsafe');
      for (const call of nativeCalls) expect(call).not.toHaveBeenCalled();
    },
  );

  it('stages binary writes until close, without exposing a native writable stream', async () => {
    const fs = new MockFileSystem({ 'frame.png': 'old' });
    const file = await fs.root.getFileHandle('frame.png');
    const writer = await file.createWritable();
    const bytes = new Uint8Array([0, 2, 255, 5]);
    await writer.write(new Blob([bytes]));
    expect(await fs.readText('frame.png')).toBe('old');
    await writer.close();
    expect(new Uint8Array(await (await file.getFile()).arrayBuffer())).toEqual(bytes);
    expect(Object.keys(writer).sort()).toEqual(['close', 'write']);
  });

  it('forwards read/write permission checks and refuses a denied project before validation', async () => {
    const fs = new MockFileSystem();
    const query = vi.spyOn(fs.nativeRoot, 'queryPermission').mockResolvedValue('prompt');
    const request = vi.spyOn(fs.nativeRoot, 'requestPermission').mockResolvedValue('denied');
    const read = vi.spyOn(fs.nativeRoot, 'getFileHandle');
    await expect(openProjectFromHandle(fs.root)).rejects.toThrow('permission is unavailable');
    expect(query).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(request).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects saving a foreign directory before opening the browser bookmark database', async () => {
    const fs = new MockFileSystem();
    await expect(browserHost.projects.remember({ ...fs.root })).rejects.toThrow('does not belong');
  });

  it.each(['prompt', 'denied'] as const)('retains a stored project needing %s permission without prompting on load', async (permission) => {
    const fs = new MockFileSystem();
    vi.spyOn(browserHost.projects, 'restore').mockResolvedValue(fs.root);
    const forget = vi.spyOn(browserHost.projects, 'forget');
    vi.spyOn(fs.nativeRoot, 'queryPermission').mockResolvedValue(permission);
    const request = vi.spyOn(fs.nativeRoot, 'requestPermission');
    const read = vi.spyOn(fs.nativeRoot, 'getFileHandle');

    const result = restoreProjectFromHandle();
    await expect(result).rejects.toBeInstanceOf(ProjectPermissionRequiredError);
    await expect(result).rejects.toMatchObject({ projectDir: fs.root });
    expect(request).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });
});

describe('browser host capabilities', () => {
  it('can be imported during server rendering without accessing browser globals', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(getAppHost()).toBe(browserHost);
    expect(browserHost.files.canPickDirectory).toBe(false);
    expect(browserHost.files.canPickVideo).toBe(false);
    expect(browserHost.files.canUseScratchStorage).toBe(false);
  });

  it('wraps picked folders and retains the native picker receiver and readwrite mode', async () => {
    const fs = new MockFileSystem();
    const browser = {
      showDirectoryPicker: vi.fn(async function (this: unknown) {
        expect(this).toBe(browser);
        return fs.nativeRoot;
      }),
    };
    vi.stubGlobal('window', browser);
    expect(browserHost.files.canPickDirectory).toBe(true);
    expect(await browserHost.files.pickDirectory()).toBe(fs.root);
    expect(browser.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('keeps cancellation as AbortError for the existing UI cancellation path', async () => {
    const cancelled = new DOMException('Cancelled', 'AbortError');
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn().mockRejectedValue(cancelled) });
    await expect(browserHost.files.pickDirectory()).rejects.toBe(cancelled);
  });

  it('uses the same video filters and returns the file without reading its bytes', async () => {
    const file = new File(['video'], 'match.mp4');
    const read = vi.spyOn(file, 'arrayBuffer');
    const picker = vi.fn().mockResolvedValue([{ getFile: async () => file }]);
    vi.stubGlobal('window', { showOpenFilePicker: picker });
    expect(await browserHost.files.pickVideo('Video')).toBe(file);
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.avi'] } }],
    });
    expect(read).not.toHaveBeenCalled();
    picker.mockResolvedValue([]);
    expect(await browserHost.files.pickVideo('Video')).toBeNull();
  });

  it('wraps scratch storage through the same filesystem adapter', async () => {
    const fs = new MockFileSystem();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => fs.nativeRoot } });
    expect(browserHost.files.canUseScratchStorage).toBe(true);
    const directory = await browserHost.files.getScratchDirectory('quick-annotate');
    await writeTextFile(directory, ['annotation.json'], '{}');
    expect(await fs.readText('quick-annotate/annotation.json')).toBe('{}');
  });
});

describe('browser editor windows', () => {
  it('opens a clip with encoded ids and without an opener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const project = new MockFileSystem().root;
    browserHost.editors.open(project, { clipId: 'clip /?#' });
    expect(open).toHaveBeenCalledWith(`/clip/clip%20%2F%3F%23?projectSession=${project.scopeId}`, '_blank', 'noopener,noreferrer');
  });

  it('reserves synchronously, then navigates to a pin after persistence has finished', async () => {
    const popup = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('window', { open, location: { href: 'http://localhost:3000/player' } });
    const editor = browserHost.editors.reserve(new MockFileSystem().root);
    expect(editor).not.toBeNull();
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(popup.location.replace).not.toHaveBeenCalled();
    await Promise.resolve();
    editor!.navigate({ clipId: 'clip/a', pinId: 'pin +&' });
    const url = new URL(popup.location.replace.mock.calls[0][0]);
    expect(url.origin).toBe('http://localhost:3000');
    expect(url.pathname).toBe('/clip/clip%2Fa');
    expect(url.searchParams.get('pinId')).toBe('pin +&');
    editor!.close();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it('reports blocked popups and closes only the current window when requested', () => {
    const close = vi.fn();
    vi.stubGlobal('window', { open: vi.fn(() => null), close });
    expect(browserHost.editors.reserve(new MockFileSystem().root)).toBeNull();
    expect(close).not.toHaveBeenCalled();
    browserHost.editors.closeCurrent();
    expect(close).toHaveBeenCalledOnce();
  });
});
