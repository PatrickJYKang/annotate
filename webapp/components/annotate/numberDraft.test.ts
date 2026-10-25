import { describe, expect, it } from 'vitest';
import { resolveNumberDraft } from './numberDraft';

describe('committed number drafts', () => {
  it.each(['', ' ', '-', '.', '1e', 'NaN', 'Infinity', '1e999'])('restores the previous value for an empty or invalid draft %j', (draft) => {
    expect(resolveNumberDraft(draft, 25.6, 8, 300)).toBe(25.6);
  });

  it.each([['1', 8], ['18', 18], ['18.5', 18.5], ['0', 8], ['999', 300], [' 32 ', 32]])('normalizes %s to %s at commit', (draft, expected) => {
    expect(resolveNumberDraft(draft, 25.6, 8, 300)).toBe(expected);
  });
});
