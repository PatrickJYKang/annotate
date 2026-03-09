import { describe, expect, it } from 'vitest';
import {
  canShowTrackButton,
  getSidecarVideoLocator,
  hasSidecarVideoSource,
  isTrackableAnnotationType,
  toAbsoluteVideoPath,
} from './videoLocator';

describe('videoLocator helpers', () => {
  it('keeps absolute unix paths and rejects relative paths', () => {
    expect(toAbsoluteVideoPath('/tmp/demo.mp4')).toBe('/tmp/demo.mp4');
    expect(toAbsoluteVideoPath('videos/demo.mp4')).toBeUndefined();
  });

  it('keeps absolute windows paths', () => {
    expect(toAbsoluteVideoPath('C:/videos/demo.mp4')).toBe('C:/videos/demo.mp4');
  });

  it('prefers videoRef and absolute fallback path in locator', () => {
    const locator = getSidecarVideoLocator('abc123', '/tmp/demo.mp4');
    expect(locator).toEqual({ videoRef: 'abc123', videoPath: '/tmp/demo.mp4' });
  });

  it('drops relative fallback path in locator', () => {
    const locator = getSidecarVideoLocator(undefined, 'videos/demo.mp4');
    expect(locator).toEqual({});
    expect(hasSidecarVideoSource(locator)).toBe(false);
  });

  it('recognizes trackable annotation types', () => {
    expect(isTrackableAnnotationType('box')).toBe(true);
    expect(isTrackableAnnotationType('circle')).toBe(true);
    expect(isTrackableAnnotationType('highlight')).toBe(true);
    expect(isTrackableAnnotationType('text')).toBe(false);
  });

  it('shows track button only when sidecar+capability+source+type are valid', () => {
    const locator = getSidecarVideoLocator('abc123', undefined);
    expect(
      canShowTrackButton({
        sidecarConnected: true,
        capabilities: ['tracking'],
        locator,
        selectedType: 'box',
      }),
    ).toBe(true);

    expect(
      canShowTrackButton({
        sidecarConnected: false,
        capabilities: ['tracking'],
        locator,
        selectedType: 'box',
      }),
    ).toBe(false);

    expect(
      canShowTrackButton({
        sidecarConnected: true,
        capabilities: [],
        locator,
        selectedType: 'box',
      }),
    ).toBe(false);

    expect(
      canShowTrackButton({
        sidecarConnected: true,
        capabilities: ['tracking'],
        locator: {},
        selectedType: 'box',
      }),
    ).toBe(false);

    expect(
      canShowTrackButton({
        sidecarConnected: true,
        capabilities: ['tracking'],
        locator,
        selectedType: 'text',
      }),
    ).toBe(false);
  });
});
