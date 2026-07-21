import { describe, expect, it } from 'vitest';

import type { ClipAnnotation } from '../types/clip';
import { frameBoundary, videoFrame } from './frameMath';
import {
  frameTemporalAdapter,
  paintClipDrawablesToCanvas,
  resolveClipDrawables,
  type ClipDrawable,
} from './renderClipAnnotations';

function annotations(): ClipAnnotation[] {
  return [
    {
      id: 'player_one',
      type: 'highlight',
      coordMode: 'image',
      source: 'auto',
      style: { stroke: '#ffffff', fill: '#ffffff', fillOpacity: 0.2 },
      keyframes: [{ frame: videoFrame(0), cx: 100, cy: 100, radius: 20 }],
    },
    {
      id: 'pass',
      type: 'arrow',
      coordMode: 'image',
      source: 'manual',
      vertexRefs: ['player_one', null],
      style: { stroke: '#ff0000', strokeWidth: 4 },
      keyframes: [{ frame: videoFrame(0), x1: 100, y1: 100, x2: 200, y2: 100 }],
    },
  ];
}

function recordingContext(): { context: CanvasRenderingContext2D; commands: unknown[][] } {
  const commands: unknown[][] = [];
  const method = (name: string) => (...args: unknown[]) => commands.push([name, ...args]);
  const context = {
    save: method('save'),
    restore: method('restore'),
    scale: method('scale'),
    setLineDash: method('setLineDash'),
    fillRect: method('fillRect'),
    strokeRect: method('strokeRect'),
    beginPath: method('beginPath'),
    ellipse: method('ellipse'),
    fill: method('fill'),
    stroke: method('stroke'),
    moveTo: method('moveTo'),
    lineTo: method('lineTo'),
    closePath: method('closePath'),
    quadraticCurveTo: method('quadraticCurveTo'),
    strokeText: method('strokeText'),
    fillText: method('fillText'),
  } as unknown as CanvasRenderingContext2D;
  return { context, commands };
}

describe('renderClipAnnotations', () => {
  it('resolves linked highlights before dependent arrows', () => {
    const drawables = resolveClipDrawables(
      annotations(),
      0,
      frameTemporalAdapter(frameBoundary(10)),
    );
    const arrow = drawables.find((drawable) => drawable.id === 'pass');

    expect(drawables.map((drawable) => drawable.id)).toEqual(['pass', 'player_one']);
    expect(arrow).toMatchObject({ kind: 'arrow', y1: 100, x2: 200, y2: 100 });
    expect(arrow && arrow.kind === 'arrow' ? arrow.x1 : 0).toBeGreaterThan(120);
  });

  it('drops lost linked vertices and converts a formerly closed polygon to a line below three points', () => {
    const source = annotations();
    source.push({
      id: 'player_three',
      type: 'highlight',
      coordMode: 'image',
      source: 'auto',
      style: {},
      keyframes: [{ frame: videoFrame(0), cx: 300, cy: 100, radius: 20 }],
    });
    source.push({
      id: 'unit',
      type: 'poly',
      coordMode: 'image',
      source: 'manual',
      closed: true,
      vertexRefs: ['player_one', 'lost_player', 'player_three'],
      style: { fill: '#00ff00', fillOpacity: 0.2 },
      keyframes: [{ frame: videoFrame(0), points: [[100, 100], [200, 100], [300, 100]] }],
    });

    const poly = resolveClipDrawables(source, 0, frameTemporalAdapter(frameBoundary(10)))
      .find((drawable) => drawable.id === 'unit');
    expect(poly).toMatchObject({ kind: 'polygon', closed: false, points: [[100, 100], [300, 100]] });
  });

  it('projects pitch-coordinate geometry through the supplied frame homography', () => {
    const source: ClipAnnotation[] = [{
      id: 'pitch_box',
      type: 'box',
      coordMode: 'pitch',
      source: 'manual',
      style: {},
      keyframes: [{ frame: videoFrame(0), x: 10, y: 20, w: 5, h: 8 }],
    }];
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    const drawable = resolveClipDrawables(
      source,
      0,
      frameTemporalAdapter(frameBoundary(10)),
      () => identity,
    )[0];
    expect(drawable).toMatchObject({
      kind: 'polygon',
      closed: true,
      points: [[10, 20], [15, 20], [15, 28], [10, 28]],
    });
  });

  it('emits deterministic Canvas 2D commands for a known drawable', () => {
    const { context, commands } = recordingContext();
    const drawable: ClipDrawable = {
      id: 'box',
      kind: 'box',
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      order: 1,
      style: {
        stroke: '#ffffff',
        strokeWidth: 6,
        fill: 'rgba(255, 255, 255, 0.3)',
        dash: [24, 12],
        fontSize: 48,
        fontFamily: 'sans-serif',
        textHighlight: false,
      },
    };

    paintClipDrawablesToCanvas(context, [drawable], {
      width: 960,
      height: 540,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    expect(commands).toEqual([
      ['save'],
      ['scale', 0.5, 0.5],
      ['save'],
      ['setLineDash', [24, 12]],
      ['fillRect', 10, 20, 30, 40],
      ['strokeRect', 10, 20, 30, 40],
      ['restore'],
      ['restore'],
    ]);
  });
});
