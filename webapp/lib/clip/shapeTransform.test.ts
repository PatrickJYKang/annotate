import { describe, expect, it } from 'vitest';

import {
  buildShapeTransformOverlay,
  clipGeometryFromOrientedShape,
  hitShapeTransformHandle,
  orientedClipShapeFromGeometry,
  rotationPointerOffset,
  transformOrientedClipShape,
} from './shapeTransform';

describe('clip shape transforms', () => {
  it('resizes a box while preserving the opposite corner', () => {
    const shape = orientedClipShapeFromGeometry('box', {
      x: 10,
      y: 20,
      w: 100,
      h: 40,
    });
    if (!shape) throw new Error('Expected box geometry.');

    const resized = transformOrientedClipShape(shape, 'se', { x: 130, y: 80 });
    expect(clipGeometryFromOrientedShape(resized)).toEqual({
      x: 10,
      y: 20,
      w: 120,
      h: 60,
      rotation: 0,
    });
  });

  it('resizes in the rotated local axes', () => {
    const shape = orientedClipShapeFromGeometry('box', {
      x: -50,
      y: -20,
      w: 100,
      h: 40,
      rotation: 90,
    });
    if (!shape) throw new Error('Expected box geometry.');

    const resized = transformOrientedClipShape(shape, 'e', { x: 0, y: 80 });
    expect(resized.cx).toBeCloseTo(0);
    expect(resized.cy).toBeCloseTo(15);
    expect(resized.width).toBeCloseTo(130);
    expect(resized.height).toBeCloseTo(40);
  });

  it('rotates without jumping when the pointer starts on the rotation handle', () => {
    const shape = orientedClipShapeFromGeometry('circle', {
      cx: 50,
      cy: 60,
      rx: 20,
      ry: 10,
      rotation: 25,
    });
    if (!shape) throw new Error('Expected circle geometry.');
    const start = { x: 50 + Math.sin(25 * Math.PI / 180) * 30, y: 60 - Math.cos(25 * Math.PI / 180) * 30 };
    const offset = rotationPointerOffset(shape, start);
    const unchanged = transformOrientedClipShape(shape, 'rotate', start, { rotationOffset: offset });
    const turned = transformOrientedClipShape(shape, 'rotate', { x: 80, y: 60 }, { rotationOffset: offset });

    expect(unchanged.rotation).toBeCloseTo(25);
    expect(turned.rotation).toBeCloseTo(90);
  });

  it('projects handles independently from the stored coordinate space', () => {
    const shape = orientedClipShapeFromGeometry('box', {
      x: 2,
      y: 3,
      w: 4,
      h: 2,
    });
    if (!shape) throw new Error('Expected box geometry.');
    const overlay = buildShapeTransformOverlay(
      shape,
      (point) => ({ x: point.x * 10, y: point.y * 20 }),
      12,
    );
    if (!overlay) throw new Error('Expected projected overlay.');
    const southeast = overlay.resizeHandles.find((handle) => handle.id === 'se');
    expect(southeast).toMatchObject({ x: 60, y: 100 });
    expect(hitShapeTransformHandle(overlay, { x: 61, y: 99 }, 5)?.id).toBe('se');
  });
});
