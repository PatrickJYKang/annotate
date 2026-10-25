export function resolveNumberDraft(draft: string, current: number, min: number, max: number): number {
  if (!draft.trim()) return current;
  const value = Number(draft);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : current;
}
