import { describe, expect, it } from 'vitest';
import { frameBoundary, videoFrame } from '../clip/frameMath';
import type { ClipPin } from '../types/clip';
import type { VideoEntry } from '../types/project';
import {
  advancePinPauseMachine,
  resumePinPauseMachine,
  seekPinPauseMachine,
  sourceFrameToMediaSeconds,
  startPinPauseMachine,
  toSourceFrame,
  visibleAnnotationIds,
  type PresentationPlaybackAsset,
} from './playback';

const video: VideoEntry = {
  id: 'video', label: 'Video', file: 'media/video.mp4', fps: 25,
  frameCount: frameBoundary(200), frameCountSource: 'normalize', width: 640, height: 360,
};

const original: PresentationPlaybackAsset = {
  id: 'original', kind: 'original', videoId: 'video', url: 'blob:original',
  sourceStartFrame: videoFrame(40), sourceEndFrame: frameBoundary(80),
};

const exact: PresentationPlaybackAsset = {
  ...original, id: 'exact', kind: 'exact_motion', url: 'blob:exact',
};

const pins: ClipPin[] = [
  { id: 'at-start', frame: videoFrame(40), annotations: [] },
  { id: 'middle', frame: videoFrame(50), annotations: [] },
  { id: 'later', frame: videoFrame(65), annotations: [] },
];

describe('v2 presentation playback contracts', () => {
  it('maps original absolute time and exact local time to the same source frame', () => {
    expect(toSourceFrame(original, 2, video)).toBe(50);
    expect(toSourceFrame(exact, 0.4, video)).toBe(50);
    expect(sourceFrameToMediaSeconds(original, videoFrame(50), video)).toBe(2);
    expect(sourceFrameToMediaSeconds(exact, videoFrame(50), video)).toBe(0.4);
  });

  it('uses each slide video timebase independently', () => {
    const secondVideo: VideoEntry = {
      id: 'second', label: 'Second', file: 'media/second.mp4', fps: 30,
      frameCount: frameBoundary(300), frameCountSource: 'probe', width: 1920, height: 1080,
    };
    const secondAsset: PresentationPlaybackAsset = {
      id: 'second-original', kind: 'original', videoId: secondVideo.id, url: 'blob:second',
      sourceStartFrame: videoFrame(90), sourceEndFrame: frameBoundary(150),
    };

    expect(toSourceFrame(original, 2, video)).toBe(50);
    expect(toSourceFrame(secondAsset, 10 / 3, secondVideo)).toBe(100);
    expect(sourceFrameToMediaSeconds(secondAsset, videoFrame(100), secondVideo)).toBeCloseTo(10 / 3);
  });

  it('triggers the start pin and forward crossings once without resume retrigger', () => {
    const started = startPinPauseMachine(videoFrame(40), pins);
    expect(started.triggeredPinId).toBe('at-start');
    const resumed = resumePinPauseMachine(started.state);
    expect(advancePinPauseMachine(resumed, videoFrame(40), pins).triggeredPinId).toBeNull();
    const crossed = advancePinPauseMachine(resumed, videoFrame(52), pins);
    expect(crossed.triggeredPinId).toBe('middle');
    const afterResume = resumePinPauseMachine(crossed.state);
    expect(advancePinPauseMachine(afterResume, videoFrame(54), pins).triggeredPinId).toBeNull();
  });

  it('re-arms only pins ahead of a seek target', () => {
    const started = startPinPauseMachine(videoFrame(40), pins);
    const sought = seekPinPauseMachine(started.state, videoFrame(55), pins);
    expect(Array.from(sought.consumedPinIds).sort()).toEqual(['at-start', 'middle']);
    expect(advancePinPauseMachine(sought, videoFrame(70), pins).triggeredPinId).toBe('later');
    const rewound = seekPinPauseMachine(sought, videoFrame(45), pins);
    expect(advancePinPauseMachine(rewound, videoFrame(55), pins).triggeredPinId).toBe('middle');
  });

  it('applies annotation selection and wall-clock cue windows', () => {
    const cues = [{ annotationId: 'b', enterAtMs: 500, exitAtMs: 1000 }];
    expect(visibleAnnotationIds(['a', 'b'], null, cues, 200)).toEqual(['a']);
    expect(visibleAnnotationIds(['a', 'b'], null, cues, 700)).toEqual(['a', 'b']);
    expect(visibleAnnotationIds(['a', 'b'], ['b'], cues, 1200)).toEqual([]);
  });
});
