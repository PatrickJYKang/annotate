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

export const TAGGING_SCHEMA_FILENAME = "tagging-schema.yaml";

export const TAGGING_SCHEMA_DEFAULT_PATH = "/tagging/schema.yaml";

export const parseTaggingSchema = (source: string): TaggingSchema => {
  return parse(source) as TaggingSchema;
};

/** Read the tagging schema from a project directory. Returns null if not found. */
export const readTaggingSchema = async (
  dir: FileSystemDirectoryHandle,
): Promise<TaggingSchema | null> => {
  try {
    const fh = await dir.getFileHandle(TAGGING_SCHEMA_FILENAME, { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    return parseTaggingSchema(text);
  } catch (e: any) {
    if (e?.name === "NotFoundError" || e?.name === "TypeMismatchError") {
      return null;
    }
    throw e;
  }
};

/** Fetch the default template schema bundled with the app. */
export const fetchDefaultTaggingSchema = async (): Promise<string> => {
  const response = await fetch(TAGGING_SCHEMA_DEFAULT_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load default tagging schema (${response.status})`);
  }
  return response.text();
};

/** Write the default tagging schema template into a project directory. */
export const writeDefaultTaggingSchema = async (
  dir: FileSystemDirectoryHandle,
): Promise<TaggingSchema> => {
  const source = await fetchDefaultTaggingSchema();
  const fh = await dir.getFileHandle(TAGGING_SCHEMA_FILENAME, { create: true });
  const ws = await fh.createWritable();
  await ws.write(source);
  await ws.close();
  return parseTaggingSchema(source);
};

/** @deprecated Use readTaggingSchema(dir) for per-project schema loading. */
export const fetchTaggingSchema = async (): Promise<TaggingSchema> => {
  const text = await fetchDefaultTaggingSchema();
  return parseTaggingSchema(text);
};
