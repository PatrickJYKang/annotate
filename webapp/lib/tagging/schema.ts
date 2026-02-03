import { parse } from "yaml";

export type FacetRequirement = {
  facet_group_id: string;
  option_id: string;
};

export type FacetOption = {
  id: string;
  label: string;
};

export type TaggingFacetGroup = {
  id: string;
  label: string;
  mode: "single" | "multi";
  options: FacetOption[];
  requires_any?: FacetRequirement[];
};

export type TaggingNode = {
  id: string;
  label: string;
  facet_group_ids?: string[];
  children?: TaggingNode[];
};

export type TaggingSchema = {
  version: number;
  facet_groups: TaggingFacetGroup[];
  primary_tree: TaggingNode[];
};

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

export const TAGGING_SCHEMA_PATH = "/tagging/schema.yaml";

export const parseTaggingSchema = (source: string): TaggingSchema => {
  return parse(source) as TaggingSchema;
};

export const fetchTaggingSchema = async (): Promise<TaggingSchema> => {
  const response = await fetch(TAGGING_SCHEMA_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load tagging schema (${response.status})`);
  }
  const text = await response.text();
  return parseTaggingSchema(text);
};
