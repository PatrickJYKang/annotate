const ANNOTATE_EVENTS_CHANNEL = 'annotate-events';

interface ClipChangedEvent {
  type: 'clip-changed';
  clipId: string;
}

export function broadcastClipChanged(clipId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(ANNOTATE_EVENTS_CHANNEL);
    channel.postMessage({ type: 'clip-changed', clipId } satisfies ClipChangedEvent);
    channel.close();
  } catch {
  }
}

export function subscribeToClipChanges(onChange: (clipId: string) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(ANNOTATE_EVENTS_CHANNEL);
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
