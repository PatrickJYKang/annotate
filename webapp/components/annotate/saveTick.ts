export function consumeManualSaveTick(lastSeenTick: number | null, saveTick?: number): {
  nextSeenTick: number | null;
  shouldSave: boolean;
} {
  if (typeof saveTick !== 'number') {
    return { nextSeenTick: lastSeenTick, shouldSave: false };
  }
  if (lastSeenTick === null) {
    return { nextSeenTick: saveTick, shouldSave: false };
  }
  return {
    nextSeenTick: saveTick,
    shouldSave: saveTick !== lastSeenTick,
  };
}
