export const PRESENTATION_ASSET_DRAG_MIME = 'application/x-presentation-asset';

export type PresentationAssetDragPayload =
  | { kind: 'still'; stillId: string }
  | { kind: 'clip'; clipId: string }
  | { kind: 'mark'; markId: string };

export function encodePresentationAssetDragPayload(payload: PresentationAssetDragPayload): string {
  return JSON.stringify(payload);
}

export function decodePresentationAssetDragPayload(raw: string): PresentationAssetDragPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<PresentationAssetDragPayload>;
    if (value.kind === 'still' && typeof value.stillId === 'string') return { kind: 'still', stillId: value.stillId };
    if (value.kind === 'clip' && typeof value.clipId === 'string') return { kind: 'clip', clipId: value.clipId };
    if (value.kind === 'mark' && typeof value.markId === 'string') return { kind: 'mark', markId: value.markId };
    return null;
  } catch {
    return null;
  }
}
