import { describe, expect, it } from 'vitest';
import { ONLINE_GUIDE, onlineGuideUrl } from './onlineGuide';

describe('onlineGuideUrl', () => {
  it('marks English as explicit rather than using the language-detecting homepage', () => {
    expect(onlineGuideUrl('en')).toBe(`${ONLINE_GUIDE}?lang=en`);
  });

  it.each(['fr', 'es', 'zh-CN'] as const)('links directly to the %s guide', (locale) => {
    expect(onlineGuideUrl(locale)).toBe(`${ONLINE_GUIDE}${locale}/`);
  });
});
