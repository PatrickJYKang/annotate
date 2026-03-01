import { describe, it, expect } from 'vitest';
import {
  bboxToBox,
  bboxToCircle,
  bboxToHighlight,
  bboxToArrow,
  convertTrackingKeyframes,
} from './bboxConvert';
import type { Bbox, RawTrackingKeyframe } from './bboxConvert';
import type { BoxKeyframe, CircleKeyframe, ArrowKeyframe, HighlightKeyframe } from '../types/clip';

const bbox: Bbox = { x: 100, y: 200, w: 60, h: 40 };

describe('bboxToBox', () => {
  it('passes through x, y, w, h', () => {
    expect(bboxToBox(bbox)).toEqual({ x: 100, y: 200, w: 60, h: 40 });
  });
});

describe('bboxToCircle', () => {
  it('computes centre + half dims', () => {
    const r = bboxToCircle(bbox);
    expect(r.cx).toBe(130);   // 100 + 60/2
    expect(r.cy).toBe(220);   // 200 + 40/2
    expect(r.rx).toBe(30);    // 60/2
    expect(r.ry).toBe(20);    // 40/2
  });
});

describe('bboxToHighlight', () => {
  it('computes centre + avg radius', () => {
    const r = bboxToHighlight(bbox);
    expect(r.cx).toBe(130);
    expect(r.cy).toBe(220);
    expect(r.radius).toBe(25); // (30 + 20) / 2
  });
});

describe('bboxToArrow', () => {
  it('arrow from left-centre to right-centre', () => {
    const r = bboxToArrow(bbox);
    expect(r.x1).toBe(100);
    expect(r.y1).toBe(220);   // centre y
    expect(r.x2).toBe(160);   // 100 + 60
    expect(r.y2).toBe(220);
  });
});

describe('convertTrackingKeyframes', () => {
  const clipStartMs = 5000;
  const raw: RawTrackingKeyframe[] = [
    { tMs: 5100, bbox: { x: 10, y: 20, w: 30, h: 40 } },
    { tMs: 5200, bbox: { x: 50, y: 60, w: 70, h: 80 } },
    { tMs: 5050, bbox: { x: 1, y: 2, w: 3, h: 4 } },
  ];

  it('converts to box keyframes and sorts by clip-relative tMs', () => {
    const kfs = convertTrackingKeyframes(raw, 'box', clipStartMs);
    expect(kfs).toHaveLength(3);
    expect(kfs[0].tMs).toBe(50);   // 5050 - 5000
    expect(kfs[1].tMs).toBe(100);  // 5100 - 5000
    expect(kfs[2].tMs).toBe(200);  // 5200 - 5000
    const k1 = kfs[1] as BoxKeyframe;
    expect(k1.x).toBe(10);
    expect(k1.y).toBe(20);
    expect(k1.w).toBe(30);
    expect(k1.h).toBe(40);
  });

  it('converts to circle keyframes', () => {
    const kfs = convertTrackingKeyframes(raw.slice(0, 1), 'circle', clipStartMs);
    const k = kfs[0] as CircleKeyframe;
    expect(k.cx).toBe(25);  // 10 + 30/2
    expect(k.cy).toBe(40);  // 20 + 40/2
    expect(k.rx).toBe(15);
    expect(k.ry).toBe(20);
  });

  it('converts to arrow keyframes', () => {
    const kfs = convertTrackingKeyframes(raw.slice(0, 1), 'arrow', clipStartMs);
    const k = kfs[0] as ArrowKeyframe;
    expect(k.x1).toBe(10);
    expect(k.y1).toBe(40);  // centre y
    expect(k.x2).toBe(40);  // 10 + 30
    expect(k.y2).toBe(40);
  });

  it('converts to highlight keyframes', () => {
    const kfs = convertTrackingKeyframes(raw.slice(0, 1), 'highlight', clipStartMs);
    const k = kfs[0] as HighlightKeyframe;
    expect(k.cx).toBe(25);
    expect(k.cy).toBe(40);
    expect(k.radius).toBe(17.5); // (15 + 20) / 2
  });

  it('converts to poly keyframes (4 corners)', () => {
    const kfs = convertTrackingKeyframes(raw.slice(0, 1), 'poly', clipStartMs);
    expect((kfs[0] as any).points).toEqual([[10, 20], [40, 20], [40, 60], [10, 60]]);
  });

  it('converts to text keyframes (top-left)', () => {
    const kfs = convertTrackingKeyframes(raw.slice(0, 1), 'text', clipStartMs);
    expect((kfs[0] as any).x).toBe(10);
    expect((kfs[0] as any).y).toBe(20);
  });

  it('preserves visible: false', () => {
    const rawInvis: RawTrackingKeyframe[] = [
      { tMs: 5100, bbox: { x: 0, y: 0, w: 10, h: 10 }, visible: false },
    ];
    const kfs = convertTrackingKeyframes(rawInvis, 'box', clipStartMs);
    expect(kfs[0].visible).toBe(false);
  });

  it('does not set visible if not explicitly false', () => {
    const kfs = convertTrackingKeyframes(raw.slice(0, 1), 'box', clipStartMs);
    expect(kfs[0].visible).toBeUndefined();
  });
});
