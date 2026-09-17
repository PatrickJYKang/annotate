import type { ProjectDirectory } from '../host/contracts';
import { desktopBridge } from '../host/desktop/bridge';
import { projectResourceKey } from '../host/projectScope';

interface ClipChangedEvent {
  type: 'clip-changed';
  clipId: string;
}

export function broadcastProjectChanged(projectDir: ProjectDirectory): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(projectResourceKey(projectDir, 'events'));
    channel.postMessage({ type: 'project-changed' });
    channel.close();
  } catch {
  }
}

export function subscribeToProjectChanges(projectDir: ProjectDirectory, onChange: () => void): () => void {
  if (projectDir.command) return desktopBridge().onChange((id) => { if (id === projectDir.scopeId) onChange(); });
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(projectResourceKey(projectDir, 'events'));
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'project-changed') onChange();
  });
  return () => channel.close();
}

export function broadcastClipChanged(projectDir: ProjectDirectory, clipId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(projectResourceKey(projectDir, 'events'));
    channel.postMessage({ type: 'clip-changed', clipId } satisfies ClipChangedEvent);
    channel.close();
  } catch {
  }
}

export function subscribeToClipChanges(projectDir: ProjectDirectory, onChange: (clipId: string) => void): () => void {
  if (projectDir.command) return desktopBridge().onChange((id) => { if (id === projectDir.scopeId) onChange('*'); });
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(projectResourceKey(projectDir, 'events'));
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      typeof message === 'object'
      && message !== null
      && 'type' in message
      && message.type === 'clip-changed'
      && 'clipId' in message
      && typeof message.clipId === 'string'
    ) {
      onChange(message.clipId);
    }
  });
  return () => channel.close();
}
