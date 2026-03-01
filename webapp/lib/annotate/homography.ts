// ---------------------------------------------------------------------------
// Homography utilities — extracted from Editor.tsx
// Projects plane (u,v) coordinates to image (x,y) via 3×3 homography.
// Used by both the stills Editor and the ClipEditor.
// ---------------------------------------------------------------------------

export function invert3(m: number[]): number[] {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const invDet = 1 / det;
  return [A * invDet, B * invDet, C * invDet, D * invDet, E * invDet, F * invDet, G * invDet, H * invDet, I * invDet];
}

export function computeHomographyFromUnitSquareToQuad(q: { x: number; y: number }[]): { H: number[]; Hinv: number[] } {
  const x0 = q[0].x, y0 = q[0].y;
  const x1 = q[1].x, y1 = q[1].y;
  const x2 = q[2].x, y2 = q[2].y;
  const x3 = q[3].x, y3 = q[3].y;
  const dx1 = x1 - x2;
  const dy1 = y1 - y2;
  const dx2 = x3 - x2;
  const dy2 = y3 - y2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-6 || Math.abs(dy3) > 1e-6) {
    const denom = dx1 * dy2 - dx2 * dy1 || 1e-6;
    g = (dx3 * dy2 - dx2 * dy3) / denom;
    h = (dx1 * dy3 - dx3 * dy1) / denom;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  const H = [a, b, c, d, e, f, g, h, 1];
  const Hinv = invert3(H);
  return { H, Hinv };
}

export function applyHomography(H: number[], u: number, v: number): { x: number; y: number } {
  const x = H[0] * u + H[1] * v + H[2];
  const y = H[3] * u + H[4] * v + H[5];
  const w = H[6] * u + H[7] * v + H[8];
  const iw = 1 / (w || 1e-6);
  return { x: x * iw, y: y * iw };
}

export function applyHomographyInv(Hinv: number[], x: number, y: number): { u: number; v: number } {
  const U = Hinv[0] * x + Hinv[1] * y + Hinv[2];
  const V = Hinv[3] * x + Hinv[4] * y + Hinv[5];
  const W = Hinv[6] * x + Hinv[7] * y + Hinv[8];
  const iW = 1 / (W || 1e-6);
  return { u: U * iW, v: V * iW };
}

export function rectPlaneToImagePoints(H: number[], cx: number, cy: number, w: number, h: number): number[] {
  const pts = [
    { u: cx - w / 2, v: cy - h / 2 },
    { u: cx + w / 2, v: cy - h / 2 },
    { u: cx + w / 2, v: cy + h / 2 },
    { u: cx - w / 2, v: cy + h / 2 },
  ];
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = applyHomography(H, pts[i].u, pts[i].v);
    out.push(p.x, p.y);
  }
  return out;
}

export function ellipsePlaneToImagePoints(H: number[], cx: number, cy: number, rx: number, ry: number, samples: number = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const u = cx + rx * Math.cos(a);
    const v = cy + ry * Math.sin(a);
    const p = applyHomography(H, u, v);
    out.push(p.x, p.y);
  }
  return out;
}

export function circlePlaneToImagePoints(H: number[], cx: number, cy: number, r: number, samples: number = 60): number[] {
  return ellipsePlaneToImagePoints(H, cx, cy, r, r, samples);
}

// Rotation-aware ellipse sampling on the plane before homography
export function ellipsePlaneToImagePointsRot(
  H: number[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  theta: number,
  samples: number = 60,
): number[] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const cu = Math.cos(a);
    const su = Math.sin(a);
    const du = rx * cu;
    const dv = ry * su;
    const u = cx + du * c - dv * s;
    const v = cy + du * s + dv * c;
    const p = applyHomography(H, u, v);
    out.push(p.x, p.y);
  }
  return out;
}

export function normalizeHalfPi(angle: number): number {
  let a = angle;
  const h = Math.PI / 2;
  const p = Math.PI;
  while (a > h) a -= p;
  while (a < -h) a += p;
  return a;
}

export function principalAxisAngle(points: number[]): number {
  if (!points || points.length < 4) return 0;
  let mx = 0, my = 0;
  const n = points.length / 2;
  for (let i = 0; i < points.length; i += 2) { mx += points[i]; my += points[i + 1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - mx;
    const dy = points[i + 1] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  // eigenvector for largest eigenvalue of [[sxx,sxy],[sxy,syy]]
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, tr * tr - 4 * det);
  const l1 = (tr + Math.sqrt(disc)) / 2;
  let vx = sxy;
  let vy = l1 - sxx;
  if (Math.abs(vx) < 1e-6 && Math.abs(vy) < 1e-6) { vx = 1; vy = 0; }
  const len = Math.hypot(vx, vy) || 1;
  vx /= len; vy /= len;
  return Math.atan2(vy, vx);
}

export function findPlaneRotationForHorizontal(H: number[], cx: number, cy: number, rx: number, ry: number): number {
  let bestTheta = 0;
  let bestScore = Infinity;
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const th = (i * Math.PI) / steps;
    const pts = ellipsePlaneToImagePointsRot(H, cx, cy, rx, ry, th, 80);
    const ang = normalizeHalfPi(principalAxisAngle(pts));
    const score = Math.abs(ang);
    if (score < bestScore) { bestScore = score; bestTheta = th; }
  }
  return bestTheta;
}

// Local Jacobian of homography mapping at (u,v)
export function computeLocalJacobian(H: number[], u: number, v: number, eps: number = 1e-4): [[number, number], [number, number]] {
  const p0 = applyHomography(H, u, v);
  const pu = applyHomography(H, u + eps, v);
  const pv = applyHomography(H, u, v + eps);
  const dxdu = (pu.x - p0.x) / eps;
  const dydu = (pu.y - p0.y) / eps;
  const dxdv = (pv.x - p0.x) / eps;
  const dydv = (pv.y - p0.y) / eps;
  return [[dxdu, dxdv], [dydu, dydv]];
}

// Plane angle whose mapped direction is horizontal in image (dy ≈ 0)
export function thetaForHorizontalUsingJacobian(H: number[], u: number, v: number, rx: number, ry: number): number {
  const J = computeLocalJacobian(H, u, v);
  const dydu = J[1][0];
  const dydv = J[1][1];
  if (Math.abs(dydu * rx) + Math.abs(dydv * ry) < 1e-9) return 0;
  // Solve dy = dydu*(rx*cos t) + dydv*(ry*sin t) = 0
  const t = Math.atan2(-dydu * rx, dydv * ry);
  return normalizeHalfPi(t);
}

export function thetaForHorizontal(H: number[], cx: number, cy: number, rx: number, ry: number): number {
  const tJ = thetaForHorizontalUsingJacobian(H, cx, cy, rx, ry);
  const ptsJ = ellipsePlaneToImagePointsRot(H, cx, cy, rx, ry, tJ, 80);
  const sJ = Math.abs(normalizeHalfPi(principalAxisAngle(ptsJ)));
  const tS = findPlaneRotationForHorizontal(H, cx, cy, rx, ry);
  const ptsS = ellipsePlaneToImagePointsRot(H, cx, cy, rx, ry, tS, 80);
  const sS = Math.abs(normalizeHalfPi(principalAxisAngle(ptsS)));
  return sJ <= sS ? tJ : tS;
}
