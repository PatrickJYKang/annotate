import { afterEach, expect, it, vi } from 'vitest';
import { MockFileSystem, createSerialLockManager } from '../fs/test/mockFileSystem';
import { projectResourceKey } from './projectScope';
import { withClipExclusive } from '../fs/clipRepository';
import { broadcastClipChanged, subscribeToClipChanges } from '../fs/clipEvents';

afterEach(() => vi.unstubAllGlobals());

it('scopes descendants and same-id clip locks to their project', async () => {
  const a = new MockFileSystem().root;
  const b = new MockFileSystem().root;
  const child = await a.getDirectoryHandle('analysis', { create: true });
  expect(child.scopeId).toBe(a.scopeId);
  expect(projectResourceKey(a, 'clip:one')).not.toBe(projectResourceKey(b, 'clip:one'));
  vi.stubGlobal('navigator', { locks: createSerialLockManager() });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const running = withClipExclusive(a, 'one', () => held);
  await withClipExclusive(b, 'one', async () => {});
  release();
  await running;
});

it('does not deliver clip changes to another project', async () => {
  const a = new MockFileSystem().root;
  const b = new MockFileSystem().root;
  const changed = vi.fn();
  const other = vi.fn();
  const stopA = subscribeToClipChanges(a, changed);
  const stopB = subscribeToClipChanges(b, other);
  try {
    broadcastClipChanged(a, 'shared-id');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith('shared-id'));
    expect(other).not.toHaveBeenCalled();
  } finally { stopA(); stopB(); }
});
