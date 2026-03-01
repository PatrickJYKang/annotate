// ---------------------------------------------------------------------------
// Shared shape-rendering utilities — extracted from Editor.tsx
// Used by both the stills Editor and the ClipEditor.
// ---------------------------------------------------------------------------

export type StrokePattern = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export const makeId = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export function hexToRgba(hex: string, alpha: number): string {
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

export function contrastStrokeForHex(hex: string | undefined): string {
  if (!hex) return 'rgba(0,0,0,0.9)';
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return 'rgba(0,0,0,0.9)';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.92)';
}

export function dashFromStrokePattern(pat: StrokePattern | undefined, strokeWidth: number): number[] | undefined {
  const sw = Math.max(1, strokeWidth || 1);
  const p = pat || 'solid';
  if (p === 'dashed') return [sw * 4, sw * 2];
  if (p === 'dotted') return [sw, sw * 2];
  if (p === 'dashdot') return [sw * 4, sw * 2, sw, sw * 2];
  return undefined;
}
