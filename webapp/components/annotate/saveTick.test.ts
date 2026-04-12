import { describe, expect, it } from 'vitest';

import { consumeManualSaveTick } from './saveTick';

describe('consumeManualSaveTick', () => {
  it('ignores a missing save tick', () => {
    expect(consumeManualSaveTick(null, undefined)).toEqual({
      nextSeenTick: null,
      shouldSave: false,
    });
  });

  it('does not treat the initial tick as a manual save', () => {
    expect(consumeManualSaveTick(null, 0)).toEqual({
      nextSeenTick: 0,
      shouldSave: false,
    });
  });

  it('does not save again when the tick is unchanged', () => {
    expect(consumeManualSaveTick(2, 2)).toEqual({
      nextSeenTick: 2,
      shouldSave: false,
    });
  });

  it('fires a manual save only after the tick changes', () => {
    expect(consumeManualSaveTick(2, 3)).toEqual({
      nextSeenTick: 3,
      shouldSave: true,
    });
  });
});
