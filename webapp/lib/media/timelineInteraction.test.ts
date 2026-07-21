import { describe, expect, it } from 'vitest';

import {
  createTimelineManualOverride,
  TIMELINE_MANUAL_OVERRIDE_MS,
} from './timelineInteraction';

describe('createTimelineManualOverride', () => {
  it('suppresses automatic following for five seconds after the last manual scroll', () => {
    let now = 1_000;
    const override = createTimelineManualOverride(() => now);

    override.mark();
    now += TIMELINE_MANUAL_OVERRIDE_MS - 1;
    expect(override.isActive()).toBe(true);

    override.mark();
    now += TIMELINE_MANUAL_OVERRIDE_MS - 1;
    expect(override.isActive()).toBe(true);

    now += 1;
    expect(override.isActive()).toBe(false);
  });
});
