import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './sidecarClient';

describe('extractErrorMessage', () => {
  it('uses string detail when available', () => {
    expect(extractErrorMessage({ detail: 'Video file not found' }, 'fallback')).toBe('Video file not found');
  });

  it('uses nested detail.message when detail is an object', () => {
    expect(extractErrorMessage({ detail: { message: 'Tracking failed' } }, 'fallback')).toBe('Tracking failed');
  });

  it('falls back to message when detail is absent', () => {
    expect(extractErrorMessage({ message: 'Something went wrong' }, 'fallback')).toBe('Something went wrong');
  });

  it('returns fallback when no known error shape exists', () => {
    expect(extractErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
