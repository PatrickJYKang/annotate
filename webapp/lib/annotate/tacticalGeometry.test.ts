import { describe, expect, it } from 'vitest';

import {
  buildShadowGeometryHandles,
  hitShadowGeometryHandle,
  transformShadowGeometry,
} from './tacticalGeometry';

describe('shadow geometry handles', () => {
  it('places direction and spread handles around the shadow center', () => {
    const handles = buildShadowGeometryHandles(100, 80, 40, 0, 60);

    expect(handles.direction).toEqual({ x: 140, y: 80 });
    expect(handles.spreadStart.x).toBeCloseTo(134.64, 2);
    expect(handles.spreadStart.y).toBeCloseTo(60, 2);
    expect(handles.spreadEnd.x).toBeCloseTo(134.64, 2);
    expect(handles.spreadEnd.y).toBeCloseTo(100, 2);
  });

  it('changes radius and direction from the center-line handle', () => {
    const transformed = transformShadowGeometry({
      centerX: 10,
      centerY: 20,
      radius: 40,
      rotationDeg: 0,
      spreadDeg: 50,
    }, 'direction', { x: 10, y: 100 });

    expect(transformed).toEqual({ radius: 80, rotationDeg: 90, spreadDeg: 50 });
  });

  it('changes spread symmetrically from either edge handle', () => {
    const transformed = transformShadowGeometry({
      centerX: 0,
      centerY: 0,
      radius: 100,
      rotationDeg: 20,
      spreadDeg: 40,
    }, 'spread-end', { x: 0, y: 100 });

    expect(transformed.radius).toBe(100);
    expect(transformed.rotationDeg).toBe(20);
    expect(transformed.spreadDeg).toBe(140);
  });

  it('hit-tests all three handles', () => {
    const handles = buildShadowGeometryHandles(0, 0, 100, 0, 60);

    expect(hitShadowGeometryHandle(handles, { x: 100, y: 1 }, 4)).toBe('direction');
    expect(hitShadowGeometryHandle(handles, handles.spreadStart, 4)).toBe('spread-start');
    expect(hitShadowGeometryHandle(handles, { x: 0, y: 0 }, 4)).toBeNull();
  });
});
