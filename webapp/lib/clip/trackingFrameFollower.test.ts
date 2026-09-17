import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrackingFrameFollower } from './trackingFrameFollower';

class Video extends EventTarget {
  time = 0;
  seeking = false;
  seeks: number[] = [];
  pause = vi.fn();
  get currentTime() { return this.time; }
  set currentTime(value: number) { this.time = value; this.seeking = true; this.seeks.push(value); }
  finishSeek() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
}

afterEach(() => vi.useRealTimers());

describe('live tracking video follower', () => {
  it('keeps one seek in flight and displays the latest frame after a burst', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const video = new Video();
    const shown = vi.fn();
    const follower = createTrackingFrameFollower(video, 30, shown);
    follower.follow(30);
    for (let frame = 31; frame <= 300; frame++) follower.follow(frame);
    expect(video.seeks).toEqual([30.5 / 30]);
    expect(shown).not.toHaveBeenCalled();
    video.finishSeek();
    expect(shown).toHaveBeenLastCalledWith(30);
    vi.advanceTimersByTime(101);
    expect(video.seeks).toEqual([30.5 / 30, 300.5 / 30]);
    video.finishSeek();
    expect(shown).toHaveBeenLastCalledWith(300);
    follower.dispose();
  });

  it('limits seeks even when decoding is instantaneous', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const video = new Video();
    const follower = createTrackingFrameFollower(video, 30, vi.fn());
    for (let frame = 1; frame <= 1000; frame++) {
      follower.follow(frame);
      video.finishSeek();
      vi.advanceTimersByTime(1);
    }
    expect(video.seeks.length).toBeLessThanOrEqual(11);
    follower.dispose();
  });

  it('cannot move the playhead after Stop or cancellation', () => {
    vi.useFakeTimers();
    const video = new Video();
    const shown = vi.fn();
    const follower = createTrackingFrameFollower(video, 25, shown);
    follower.follow(10);
    follower.follow(50);
    follower.dispose();
    video.finishSeek();
    vi.runAllTimers();
    follower.follow(100);
    expect(shown).not.toHaveBeenCalled();
    expect(video.seeks).toHaveLength(1);
  });

  it('does not report a tracked frame over a superseding manual seek', () => {
    const video = new Video();
    const shown = vi.fn();
    const follower = createTrackingFrameFollower(video, 30, shown);
    follower.follow(30);
    video.currentTime = 5;
    video.finishSeek();
    expect(shown).not.toHaveBeenCalled();
    follower.dispose();
  });
});
