export const PRESENTATION_ASSET_MIME = 'application/x-annotate-presentation-asset-v2';
export const PRESENTATION_SLIDE_MIME = 'application/x-annotate-presentation-slide-v2';

export type PresentationAssetDrag =
  | { kind: 'clip'; clipId: string }
  | { kind: 'pin'; clipId: string; pinId: string };

export function encodePresentationAssetDrag(payload: PresentationAssetDrag): string {
  return JSON.stringify(payload);
}

export function decodePresentationAssetDrag(value: string): PresentationAssetDrag | null {
  try {
    const payload = JSON.parse(value) as Partial<PresentationAssetDrag>;
    if (payload.kind === 'clip' && typeof payload.clipId === 'string') {
      return { kind: 'clip', clipId: payload.clipId };
    }
    if (
      payload.kind === 'pin'
      && typeof payload.clipId === 'string'
      && typeof payload.pinId === 'string'
    ) {
      return { kind: 'pin', clipId: payload.clipId, pinId: payload.pinId };
    }
  } catch {
  }
  return null;
}
