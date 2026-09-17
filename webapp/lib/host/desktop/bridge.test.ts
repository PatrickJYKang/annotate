import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge } from './bridge';
import { nativeDirectory } from './index';
import { createMediaUrl, nativeFileInfo } from '../media';

afterEach(() => vi.unstubAllGlobals());

describe('desktop wire boundary', () => {
  it('reconstructs DOM errors from serializable replies instead of relying on Electron Error cloning', async () => {
    vi.stubGlobal('window', { annotateDesktop: { request: vi.fn().mockResolvedValue({ ok: false, error: { name: 'NotFoundError', message: 'Missing file' } }) } });
    const result = desktopBridge().request('fs.file');
    await expect(result).rejects.toBeInstanceOf(DOMException);
    await expect(result).rejects.toMatchObject({ name: 'NotFoundError', message: 'Missing file' });
  });

  it('passes structured success data and rejects an absent host', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('window', { annotateDesktop: { request: vi.fn().mockResolvedValue({ ok: true, result: bytes }) } });
    expect(await desktopBridge().request('fs.file')).toBe(bytes);
    vi.stubGlobal('window', {});
    expect(() => desktopBridge()).toThrow('unavailable');
  });

  it('media capabilities provide native URLs and refuse accidental whole-file reads', async () => {
    const request = vi.fn(async (operation: string) => ({ ok: true, result: operation === 'fs.file'
      ? { id: 'file-token', name: 'match.mp4', size: 1_000_000_000, modified: 0, url: 'http://127.0.0.1:9000/media/capability' }
      : null }));
    vi.stubGlobal('window', { annotateDesktop: { request } });
    const root = nativeDirectory({ id: 'project-token', name: 'Project', path: '' });
    const file = await (await root.getFileHandle('match.mp4')).getFile();
    expect(file.size).toBe(1_000_000_000);
    expect(createMediaUrl(file)).toBe('http://127.0.0.1:9000/media/capability');
    expect(nativeFileInfo(file)?.id).toBe('file-token');
    await expect(file.arrayBuffer()).rejects.toThrow('native media');
    expect(() => file.slice()).toThrow('native media');
  });
});
