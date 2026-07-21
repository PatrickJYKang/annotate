export type TaggingSelection = {
  primary: string | null;
  facets: Record<string, string | string[]>;
};
export const createEmptyTaggingSelection = (): TaggingSelection => ({
  primary: null,
  facets: {},
});

export const ensureTaggingSelection = (
  input?: TaggingSelection | string[] | null,
): TaggingSelection => {
  if (!input || Array.isArray(input)) {
    return createEmptyTaggingSelection();
  }
  return {
    primary: input.primary ?? null,
    facets: input.facets ?? {},
  };
};

export const selectionToTagList = (
  input?: TaggingSelection | string[] | null,
): string[] => {
  if (!input) return [];
  if (Array.isArray(input)) return input.slice();
  const tags: string[] = [];
  if (input.primary) {
    tags.push(input.primary);
  }
  Object.entries(input.facets ?? {}).forEach(([groupId, value]) => {
    if (Array.isArray(value)) {
      value.forEach((optionId) => {
        if (optionId) tags.push(`${groupId}=${optionId}`);
      });
    } else if (value) {
      tags.push(`${groupId}=${value}`);
    }
  });
  return tags;
};
