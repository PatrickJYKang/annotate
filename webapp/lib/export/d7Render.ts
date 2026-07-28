type StrokePattern = 'solid' | 'dashed' | 'dotted' | 'dashdot';

import type { AnnotationDocument, AnnotationPayload } from '../annotate/documentPayload';
import { annotationPayloadFromDocument } from '../annotate/documentPayload';
import { measureHighlightLabelText, placeHighlightLabel } from '../annotate/highlightLabel';
import { contrastStrokeForHex } from '../annotate/shapeRendering';

import {
  buildShadowSectorPoints,
  DEFAULT_SHADOW_RADIUS,
  DEFAULT_SHADOW_SPREAD_DEG,
} from "../annotate/tacticalGeometry";

export type ExportShape = {
  id: string;
  type: 'box' | 'circle' | 'shadow' | 'arrow' | 'lob' | 'text' | 'poly' | 'highlight';
  name?: string;
  displayName?: boolean;
  x: number;
  y: number;
  rotation?: number;
  w?: number;
  h?: number;
  r?: number;
  spreadDeg?: number;
  rx?: number;
  ry?: number;
  points?: number[];
  vertexRefs?: (string | null)[];
  text?: string;
  closed?: boolean;
  plane?: { cx: number; cy: number; w?: number; h?: number; r?: number; rx?: number; ry?: number };
  style?: {
    stroke?: string;
    fill?: string;
    fillOpacity?: number;
    strokeWidth?: number;
    strokePattern?: StrokePattern;
    fontSize?: number;
    fontFamily?: string;
    textHighlight?: boolean;
  };
};

export type AnnotationsV1 = {
  schema: 'annotations.v1';
  annotationId?: string;
  label?: string;
  stillId: string;
  image: { file: string; width: number; height: number };
  shapes: ExportShape[];
  perspective?: { quad: { x: number; y: number }[] };
};

export async function renderAnnotatedPng(args: {
  bmp: ImageBitmap;
  payload: AnnotationPayload;
} | {
  bmp: ImageBitmap;
  /** @deprecated Pass the shared payload after parsing the document. */
  ann: AnnotationDocument;
}): Promise<Blob> {
  const { bmp } = args;
  const payload = 'payload' in args ? args.payload : annotationPayloadFromDocument(args.ann);
  const w = bmp.width;
  const h = bmp.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');

  ctx.drawImage(bmp, 0, 0, w, h);

  const shapes = (payload.shapes || []).filter(s => !(s as any)?._temp && !(typeof (s as any)?.id === 'string' && (s as any).id.startsWith('_temp_')));
  const byId = new Map<string, ExportShape>();
  for (const s of shapes) byId.set(s.id, s);

  const homography = (payload.perspective?.quad && payload.perspective.quad.length === 4)
    ? computeHomographyFromUnitSquareToQuad(payload.perspective.quad)
    : null;

  const other = shapes.filter(s => s.type !== 'highlight' && s.type !== 'arrow' && s.type !== 'lob' && s.type !== 'poly');
  const lines = shapes.filter(s => s.type === 'arrow' || s.type === 'lob' || s.type === 'poly');
  const highlights = shapes.filter(s => s.type === 'highlight');

  for (const s of other) drawOther(ctx, s, homography, byId);

  const lineCanvas = document.createElement('canvas');
  lineCanvas.width = w;
  lineCanvas.height = h;
  const lineCtx = lineCanvas.getContext('2d');
  if (!lineCtx) throw new Error('Canvas 2D not available');

  for (const s of lines) {
    if (s.type === 'poly') {
      const pts = resolvePolyPoints(s, byId, homography);
      drawPoly(lineCtx, s, pts);
    } else if (s.type === 'lob') {
      const p = resolveLobPoints(s, byId, homography);
      drawLob(lineCtx, s, p.start, p.control, p.end);
    } else {
      const p = resolveArrowPoints(s, byId, homography);
      drawArrow(lineCtx, s, p.x1, p.y1, p.x2, p.y2);
    }
  }

  if (highlights.length) {
    lineCtx.save();
    lineCtx.globalCompositeOperation = 'destination-out';
    for (const h0 of highlights) {
      const cen = getHighlightCenter(h0, homography);
      const rx = (h0 as any).rx ?? (h0.rx ?? 40);
      const ry = (h0 as any).ry ?? (h0.ry ?? 10);
      lineCtx.fillStyle = '#000';
      lineCtx.beginPath();
      lineCtx.ellipse(cen.x, cen.y, Math.max(0.5, rx || 40), Math.max(0.5, ry || 10), 0, 0, Math.PI * 2);
      lineCtx.fill();
    }
    lineCtx.restore();
  }

  ctx.drawImage(lineCanvas, 0, 0);

  for (const s of highlights) drawHighlight(ctx, s, homography);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

function hexToRgba(hex: string, alpha: number) {
  if (!hex || hex === 'transparent') return 'transparent';
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
  return hex;
}

function dashFromStrokePattern(pat: StrokePattern | undefined, strokeWidth: number): number[] {
  const sw = Math.max(1, strokeWidth || 1);
  const p = pat || 'solid';
  if (p === 'dashed') return [sw * 4, sw * 2];
  if (p === 'dotted') return [sw, sw * 2];
  if (p === 'dashdot') return [sw * 4, sw * 2, sw, sw * 2];
  return [];
}

function invert3(m: number[]): number[] {
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

function computeHomographyFromUnitSquareToQuad(q: { x: number; y: number }[]) {
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

function applyHomography(H: number[], u: number, v: number) {
  const x = H[0] * u + H[1] * v + H[2];
  const y = H[3] * u + H[4] * v + H[5];
  const w = H[6] * u + H[7] * v + H[8];
  const iw = 1 / (w || 1e-6);
  return { x: x * iw, y: y * iw };
}

function rectPlaneToImagePoints(H: number[], cx: number, cy: number, w: number, h: number) {
  const pts = [
    { u: cx - w / 2, v: cy - h / 2 },
    { u: cx + w / 2, v: cy - h / 2 },
    { u: cx + w / 2, v: cy + h / 2 },
    { u: cx - w / 2, v: cy + h / 2 },
  ];
  const out: number[] = [];
  for (const p0 of pts) {
    const p = applyHomography(H, p0.u, p0.v);
    out.push(p.x, p.y);
  }
  return out;
}

function ellipsePlaneToImagePoints(H: number[], cx: number, cy: number, rx: number, ry: number, samples: number = 60) {
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

function getHighlightCenter(s: ExportShape, homography: null | { H: number[] }) {
  if (homography && s.plane && s.type === 'highlight') return applyHomography(homography.H, s.plane.cx, s.plane.cy);
  return { x: s.x || 0, y: s.y || 0 };
}

function resolveShadowCenter(s: ExportShape, byId: Map<string, ExportShape>, homography: null | { H: number[]; Hinv: number[] }) {
  const refId = Array.isArray(s.vertexRefs) ? s.vertexRefs[0] : null;
  if (refId) {
    const h = byId.get(refId);
    if (h && h.type === 'highlight') {
      return getHighlightCenter(h, homography ? { H: homography.H } : null);
    }
  }
  return { x: s.x || 0, y: s.y || 0 };
}

function strokeAndFillFromStyle(s: ExportShape) {
  const stroke = s.style?.stroke || '#ef4444';
  const strokeWidth = s.style?.strokeWidth ?? (s.type === 'text' ? 1 : 6);
  const fillOpacity = s.style?.fillOpacity ?? 0.3;
  const fillRaw = s.style?.fill;
  const needFill = s.type === 'box' || s.type === 'circle' || s.type === 'shadow';
  const fill = needFill
    ? (fillRaw && fillRaw !== 'transparent' ? hexToRgba(fillRaw, fillOpacity) : hexToRgba(stroke, fillOpacity))
    : (fillRaw && fillRaw !== 'transparent' ? hexToRgba(fillRaw, fillOpacity) : 'transparent');
  return { stroke, strokeWidth, fill };
}

function drawClosedPath(ctx: CanvasRenderingContext2D, pts: number[]) {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

function drawOther(ctx: CanvasRenderingContext2D, s: ExportShape, homography: null | { H: number[]; Hinv: number[] }, byId: Map<string, ExportShape>) {
  if (s.type === 'box') {
    const { stroke, strokeWidth, fill } = strokeAndFillFromStyle(s);
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
    if (homography && s.plane) {
      const pts = rectPlaneToImagePoints(homography.H, s.plane.cx, s.plane.cy, s.plane.w || 0, s.plane.h || 0);
      drawClosedPath(ctx, pts);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.rect(s.x || 0, s.y || 0, Math.max(0.5, s.w || 0), Math.max(0.5, s.h || 0));
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (s.type === 'circle') {
    const { stroke, strokeWidth, fill } = strokeAndFillFromStyle(s);
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
    if (homography && s.plane) {
      const rx = (s.plane.rx ?? s.plane.r ?? 0);
      const ry = (s.plane.ry ?? s.plane.r ?? 0);
      const pts = ellipsePlaneToImagePoints(homography.H, s.plane.cx, s.plane.cy, rx, ry);
      drawClosedPath(ctx, pts);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(s.x || 0, s.y || 0, Math.max(0.5, s.r || 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (s.type === 'shadow') {
    const { stroke, strokeWidth, fill } = strokeAndFillFromStyle(s);
    const radius = Math.max(1, s.r || DEFAULT_SHADOW_RADIUS);
    const spreadDeg = Math.max(1, Math.min(359, s.spreadDeg || DEFAULT_SHADOW_SPREAD_DEG));
    const rotationDeg = s.rotation || 0;
    const center = resolveShadowCenter(s, byId, homography);
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
    const pts = buildShadowSectorPoints(center.x, center.y, radius, rotationDeg, spreadDeg);
    drawClosedPath(ctx, pts);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (s.type === 'text') {
    const color = s.style?.stroke || '#ef4444';
    const fontSize = s.style?.fontSize || 48;
    const fontFamily = s.style?.fontFamily || 'Inter, system-ui, sans-serif';
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text || '', (s.x || 0) + 6, (s.y || 0) + 6);
    ctx.restore();
  }
}

function drawHighlight(ctx: CanvasRenderingContext2D, s: ExportShape, homography: null | { H: number[]; Hinv: number[] }) {
  const stroke = s.style?.stroke || '#ef4444';
  const strokeWidth = s.style?.strokeWidth || 6;
  const fillOpacity = s.style?.fillOpacity ?? 0.3;
  const fillRaw = s.style?.fill;
  const fill = fillRaw && fillRaw !== 'transparent' ? hexToRgba(fillRaw, fillOpacity) : hexToRgba(stroke, fillOpacity);
  const cen = getHighlightCenter(s, homography ? { H: homography.H } : null);
  const rx = (s as any).rx ?? (s.rx ?? 40);
  const ry = (s as any).ry ?? (s.ry ?? 10);

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cen.x, cen.y, Math.max(0.5, rx || 40), Math.max(0.5, ry || 10), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const label = s.displayName ? s.name?.trim() : '';
  if (label) {
    const fontSize = s.style?.fontSize || 48;
    const fontFamily = s.style?.fontFamily || 'Inter, system-ui, sans-serif';
    ctx.font = `${fontSize}px ${fontFamily}`;
    const measuredWidth = typeof ctx.measureText === 'function'
      ? ctx.measureText(label).width
      : measureHighlightLabelText(label, fontSize, fontFamily);
    const placement = placeHighlightLabel({
      centerX: cen.x,
      centerY: cen.y,
      radiusX: Math.max(0.5, rx || 40),
      radiusY: Math.max(0.5, ry || 10),
      textWidth: measuredWidth,
      textHeight: fontSize * 1.2,
      frameWidth: ctx.canvas.width,
      frameHeight: ctx.canvas.height,
    });
    ctx.setLineDash([]);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.strokeStyle = contrastStrokeForHex(stroke);
    ctx.lineWidth = Math.max(1, fontSize * 0.08);
    ctx.strokeText(label, placement.x, placement.y, placement.width);
    ctx.fillStyle = stroke;
    ctx.fillText(label, placement.x, placement.y, placement.width);
  }
  ctx.restore();
}

function resolvePolyPoints(s: ExportShape, byId: Map<string, ExportShape>, homography: null | { H: number[]; Hinv: number[] }) {
  const base = s.points || [];
  const ox = s.x || 0;
  const oy = s.y || 0;
  if (Array.isArray(s.vertexRefs) && s.vertexRefs.length * 2 === base.length) {
    const out = base.slice();
    for (let i = 0; i < s.vertexRefs.length; i++) {
      const refId = s.vertexRefs[i];
      if (!refId) continue;
      const h = byId.get(refId);
      if (!h || h.type !== 'highlight') continue;
      const cen = getHighlightCenter(h, homography ? { H: homography.H } : null);
      out[i * 2] = cen.x - ox;
      out[i * 2 + 1] = cen.y - oy;
    }
    return out;
  }
  return base;
}

function resolveArrowPoints(s: ExportShape, byId: Map<string, ExportShape>, homography: null | { H: number[]; Hinv: number[] }) {
  const pts = s.points || [];
  const ox = s.x || 0;
  const oy = s.y || 0;
  let gx1 = (pts[0] ?? 0) + ox;
  let gy1 = (pts[1] ?? 0) + oy;
  let gx2 = (pts[2] ?? 0) + ox;
  let gy2 = (pts[3] ?? 0) + oy;

  const refs = Array.isArray(s.vertexRefs) ? s.vertexRefs : [];
  let startInfo: null | { cx: number; cy: number; rx: number; ry: number } = null;
  let endInfo: null | { cx: number; cy: number; rx: number; ry: number } = null;

  if (refs[0]) {
    const h = byId.get(refs[0]);
    if (h && h.type === 'highlight') {
      const cen = getHighlightCenter(h, homography ? { H: homography.H } : null);
      const rx = (h as any).rx ?? 40;
      const ry = (h as any).ry ?? 10;
      gx1 = cen.x; gy1 = cen.y;
      startInfo = { cx: cen.x, cy: cen.y, rx, ry };
    }
  }
  if (refs[1]) {
    const h = byId.get(refs[1]);
    if (h && h.type === 'highlight') {
      const cen = getHighlightCenter(h, homography ? { H: homography.H } : null);
      const rx = (h as any).rx ?? 40;
      const ry = (h as any).ry ?? 10;
      gx2 = cen.x; gy2 = cen.y;
      endInfo = { cx: cen.x, cy: cen.y, rx, ry };
    }
  }

  const pushOut = (c: { cx: number; cy: number; rx: number; ry: number }, toward: { x: number; y: number }) => {
    const vx = toward.x - c.cx;
    const vy = toward.y - c.cy;
    const denom = (vx * vx) / ((c.rx * c.rx) || 1e-6) + (vy * vy) / ((c.ry * c.ry) || 1e-6);
    if (denom <= 1e-8) return { x: c.cx, y: c.cy };
    const t = 1 / Math.sqrt(denom);
    const px = c.cx + vx * t;
    const py = c.cy + vy * t;
    const l = Math.hypot(vx, vy) || 1e-6;
    const ux = vx / l;
    const uy = vy / l;
    return { x: px + ux, y: py + uy };
  };

  if (startInfo) {
    const toward = endInfo ? { x: endInfo.cx, y: endInfo.cy } : { x: gx2, y: gy2 };
    const p = pushOut(startInfo, toward);
    gx1 = p.x; gy1 = p.y;
  }
  if (endInfo) {
    const toward = startInfo ? { x: startInfo.cx, y: startInfo.cy } : { x: gx1, y: gy1 };
    const p = pushOut(endInfo, toward);
    gx2 = p.x; gy2 = p.y;
  }

  return { x1: gx1, y1: gy1, x2: gx2, y2: gy2 };
}

function resolveLobPoints(s: ExportShape, byId: Map<string, ExportShape>, homography: null | { H: number[]; Hinv: number[] }) {
  const pts = s.points || [];
  const ox = s.x || 0;
  const oy = s.y || 0;
  let start = { x: (pts[0] ?? 0) + ox, y: (pts[1] ?? 0) + oy };
  const control = { x: (pts[2] ?? 0) + ox, y: (pts[3] ?? 0) + oy };
  let end = { x: (pts[4] ?? 0) + ox, y: (pts[5] ?? 0) + oy };
  const refs = Array.isArray(s.vertexRefs) ? s.vertexRefs : [];

  if (refs[0]) {
    const h = byId.get(refs[0]);
    if (h && h.type === 'highlight') {
      start = getHighlightCenter(h, homography ? { H: homography.H } : null);
    }
  }
  if (refs[1]) {
    const h = byId.get(refs[1]);
    if (h && h.type === 'highlight') {
      end = getHighlightCenter(h, homography ? { H: homography.H } : null);
    }
  }

  return { start, control, end };
}

function drawPoly(ctx: CanvasRenderingContext2D, s: ExportShape, relPts: number[]) {
  if (!relPts || relPts.length < 4) return;
  const stroke = s.style?.stroke || '#ef4444';
  const strokeWidth = s.style?.strokeWidth || 6;
  const ox = s.x || 0;
  const oy = s.y || 0;

  const fillOpacity = s.style?.fillOpacity ?? 0.3;
  const wantFill = !!s.closed && !!(s.style?.fill && s.style.fill !== 'transparent');
  const fill = wantFill ? hexToRgba(s.style!.fill!, fillOpacity) : 'transparent';

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
  ctx.beginPath();
  ctx.moveTo((relPts[0] ?? 0) + ox, (relPts[1] ?? 0) + oy);
  for (let i = 2; i < relPts.length; i += 2) ctx.lineTo((relPts[i] ?? 0) + ox, (relPts[i + 1] ?? 0) + oy);
  if (s.closed) ctx.closePath();
  if (wantFill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, s: ExportShape, x1: number, y1: number, x2: number, y2: number) {
  const stroke = s.style?.stroke || '#ef4444';
  const strokeWidth = s.style?.strokeWidth || 6;
  const headLen = 10;
  const headW = 10;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const ang = Math.atan2(y2 - y1, x2 - x1);
  const bx = x2 - headLen * Math.cos(ang);
  const by = y2 - headLen * Math.sin(ang);
  const px = (headW / 2) * Math.cos(ang + Math.PI / 2);
  const py = (headW / 2) * Math.sin(ang + Math.PI / 2);

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx + px, by + py);
  ctx.lineTo(bx - px, by - py);
  ctx.closePath();
  ctx.fill();
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

function drawLob(
  ctx: CanvasRenderingContext2D,
  s: ExportShape,
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
) {
  const stroke = s.style?.stroke || '#ef4444';
  const strokeWidth = s.style?.strokeWidth || 6;
  const headLen = 10;
  const headW = 10;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashFromStrokePattern(s.style?.strokePattern, strokeWidth));
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.stroke();

  const tangentX = end.x - control.x;
  const tangentY = end.y - control.y;
  const ang = Math.atan2(tangentY, tangentX);
  const bx = end.x - headLen * Math.cos(ang);
  const by = end.y - headLen * Math.sin(ang);
  const px = (headW / 2) * Math.cos(ang + Math.PI / 2);
  const py = (headW / 2) * Math.sin(ang + Math.PI / 2);

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(bx + px, by + py);
  ctx.lineTo(bx - px, by - py);
  ctx.closePath();
  ctx.fill();
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}
