import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestLiveProject, shareLiveProject } from './liveProjects';

const origin = 'http://localhost:3100';

class TestChannel {
  static channels = new Set<TestChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { TestChannel.channels.add(this); }
  postMessage(data: unknown) {
    for (const peer of TestChannel.channels) {
      if (peer !== this && peer.name === this.name) {
        queueMicrotask(() => {
          if (TestChannel.channels.has(peer)) peer.onmessage?.(new MessageEvent('message', { data, origin }));
        });
      }
    }
  }
  close() { TestChannel.channels.delete(this); }
}

function directory(identity: string, permission: PermissionState = 'granted') {
  return {
    kind: 'directory', name: identity,
    queryPermission: vi.fn().mockResolvedValue(permission),
    requestPermission: vi.fn(),
    isSameEntry: vi.fn(async (other: FileSystemHandle) => other.name === identity),
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { location: { origin } });
  vi.stubGlobal('BroadcastChannel', TestChannel);
  vi.stubGlobal('crypto', { randomUUID: () => 'request-123' });
});
afterEach(() => {
  TestChannel.channels.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live project handoff', () => {
  it('reuses an authorized handle without requesting permission and releases channels', async () => {
    const saved = directory('project', 'prompt');
    const live = directory('project');
    const stop = shareLiveProject('session', live);
    const result = requestLiveProject('session', saved);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toBe(live);
    expect(saved.isSameEntry).toHaveBeenCalledWith(live);
    expect(live.requestPermission).not.toHaveBeenCalled();
    expect(saved.requestPermission).not.toHaveBeenCalled();
    expect(TestChannel.channels.size).toBe(1);
    stop();
    expect(TestChannel.channels.size).toBe(0);
  });

  it.each(['different session', 'different folder', 'revoked permission'])(
    'refuses %s without prompting', async (scenario) => {
      const live = directory(scenario === 'different folder' ? 'other' : 'project', scenario === 'revoked permission' ? 'denied' : 'granted');
      const stop = shareLiveProject(scenario === 'different session' ? 'other-session' : 'session', live);
      const result = requestLiveProject('session', directory('project', 'prompt'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toBeNull();
      expect(live.requestPermission).not.toHaveBeenCalled();
      stop();
      expect(TestChannel.channels.size).toBe(0);
    },
  );

  it.each(['nonce', 'origin', 'revoked handle'])('ignores an invalid response: %s', async (invalid) => {
    const result = requestLiveProject('session', directory('project', 'prompt'));
    const channel = [...TestChannel.channels][0];
    channel.onmessage?.(new MessageEvent('message', {
      origin: invalid === 'origin' ? 'http://unrelated.test' : origin,
      data: {
        type: 'handle', requestId: invalid === 'nonce' ? 'not-the-request' : 'request-123',
        handle: directory('project', invalid === 'revoked handle' ? 'denied' : 'granted'),
      },
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBeNull();
    expect(TestChannel.channels.size).toBe(0);
  });

  it('stops sharing immediately even when a permission query is in flight', async () => {
    let grant!: (permission: PermissionState) => void;
    const live = directory('project');
    vi.mocked(live.queryPermission).mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const stop = shareLiveProject('session', live);
    const result = requestLiveProject('session', directory('project', 'prompt'));
    await vi.advanceTimersByTimeAsync(0);
    stop();
    grant('granted');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBeNull();
    expect(TestChannel.channels.size).toBe(0);
  });

  it('falls back safely when the browser does not permit BroadcastChannel', async () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('unavailable'); } });
    expect(() => shareLiveProject('session', directory('project'))()).not.toThrow();
    expect(await requestLiveProject('session', directory('project'))).toBeNull();
  });
});
