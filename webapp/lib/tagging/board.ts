import type { TaggingSelection } from './selection';

export type BoardCaptureMode = 'instant' | 'range';
export type BoardFacetMode = 'single' | 'multi';

export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  modifierSlots: BoardRect[];
}

export interface BoardDefaults {
  leadSeconds: number;
  lagSeconds: number;
  mode: BoardCaptureMode;
}

export interface BoardButton {
  id: string;
  label: string;
  hotkey?: string;
  rect?: BoardRect;
  leadSeconds?: number;
  lagSeconds?: number;
  mode?: BoardCaptureMode;
  facetGroupIds?: string[];
}

export interface BoardGroup {
  id: string;
  label: string;
  labelRect?: BoardRect;
  buttons: BoardButton[];
}

export interface BoardFacetRequirement {
  facetGroupId: string;
  optionId: string;
}

export interface BoardFacetOption {
  id: string;
  label: string;
  hotkey?: string;
}

export interface BoardFacetGroup {
  id: string;
  label: string;
  mode: BoardFacetMode;
  requiresAny?: BoardFacetRequirement[];
  options: BoardFacetOption[];
}

export interface TaggingBoard {
  schema: 'tagging-board.v1';
  layout?: BoardLayout;
  defaults: BoardDefaults;
  groups: BoardGroup[];
  facets: BoardFacetGroup[];
}

export type BoardIssueSeverity = 'error' | 'warning';

export type BoardIssueCode =
  | 'invalid-document'
  | 'invalid-defaults'
  | 'invalid-id'
  | 'duplicate-id'
  | 'invalid-capture-setting'
  | 'invalid-layout'
  | 'unresolved-facet-reference'
  | 'unresolved-requirement'
  | 'facet-dependency-cycle'
  | 'invalid-hotkey'
  | 'hotkey-collision';

export interface BoardIssue {
  severity: BoardIssueSeverity;
  code: BoardIssueCode;
  path: string;
  message: string;
}

export interface ResolvedButtonCapture {
  button: BoardButton;
  leadSeconds: number;
  lagSeconds: number;
  mode: BoardCaptureMode;
}

export interface BoardTagTreeGroup {
  id: string;
  label: string;
  buttons: { id: string; label: string }[];
}

export const TAGGING_BOARD_FILENAME = 'tagging-board.json';
export const TAGGING_BOARD_DEFAULT_PATH = '/tagging/board.json';

export const DEFAULT_TAGGING_BOARD_LAYOUT: BoardLayout = {
  width: 960,
  height: 900,
  modifierSlots: [
    { x: 24, y: 650, width: 210, height: 226 },
    { x: 258, y: 650, width: 210, height: 226 },
    { x: 492, y: 650, width: 210, height: 226 },
    { x: 726, y: 650, width: 210, height: 226 },
  ],
};

export function resolveTaggingBoardLayout(board: TaggingBoard): BoardLayout {
  return board.layout ?? DEFAULT_TAGGING_BOARD_LAYOUT;
}

export function resolveBoardGroupLabelRect(group: BoardGroup, groupIndex: number): BoardRect {
  if (group.labelRect) return group.labelRect;
  return { x: 24, y: 20 + groupIndex * 150, width: 912, height: 24 };
}

export function resolveBoardButtonRect(
  group: BoardGroup,
  groupIndex: number,
  buttonIndex: number,
): BoardRect {
  const explicit = group.buttons[buttonIndex]?.rect;
  if (explicit) return explicit;
  const labelRect = resolveBoardGroupLabelRect(group, groupIndex);
  const gap = 8;
  const count = Math.max(1, group.buttons.length);
  const width = (labelRect.width - gap * (count - 1)) / count;
  return {
    x: labelRect.x + buttonIndex * (width + gap),
    y: labelRect.y + 32,
    width,
    height: 110,
  };
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isCaptureMode(value: unknown): value is BoardCaptureMode {
  return value === 'instant' || value === 'range';
}

function isFacetMode(value: unknown): value is BoardFacetMode {
  return value === 'single' || value === 'multi';
}

function normalizeHotkey(hotkey: string): string {
  return hotkey.trim().toLocaleLowerCase();
}

function validHotkey(hotkey: unknown): hotkey is string {
  return typeof hotkey === 'string' && Array.from(normalizeHotkey(hotkey)).length === 1;
}

function addIssue(
  issues: BoardIssue[],
  severity: BoardIssueSeverity,
  code: BoardIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

export class TaggingBoardValidationError extends Error {
  readonly issues: BoardIssue[];

  constructor(issues: BoardIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'TaggingBoardValidationError';
    this.issues = issues;
  }
}

export function validateTaggingBoard(value: unknown): BoardIssue[] {
  const issues: BoardIssue[] = [];
  if (!isRecord(value)) {
    addIssue(issues, 'error', 'invalid-document', '', 'Tagging board must be a JSON object.');
    return issues;
  }
  if (value.schema !== 'tagging-board.v1') {
    addIssue(issues, 'error', 'invalid-document', 'schema', 'Tagging board schema must be "tagging-board.v1".');
  }

  const rawLayout = value.layout;
  const layoutWidth = isRecord(rawLayout) && isPositiveFinite(rawLayout.width) ? rawLayout.width : null;
  const layoutHeight = isRecord(rawLayout) && isPositiveFinite(rawLayout.height) ? rawLayout.height : null;
  const validateRect = (rect: unknown, path: string, required = false): void => {
    if (rect === undefined && !required) return;
    if (
      !isRecord(rect)
      || !isNonNegativeFinite(rect.x)
      || !isNonNegativeFinite(rect.y)
      || !isPositiveFinite(rect.width)
      || !isPositiveFinite(rect.height)
    ) {
      addIssue(issues, 'error', 'invalid-layout', path, 'Board rectangles require non-negative x/y and positive width/height.');
      return;
    }
    if (
      layoutWidth !== null
      && layoutHeight !== null
      && (rect.x + rect.width > layoutWidth || rect.y + rect.height > layoutHeight)
    ) {
      addIssue(issues, 'error', 'invalid-layout', path, 'Board rectangle must fit inside the board coordinate space.');
    }
  };
  if (rawLayout !== undefined) {
    if (
      !isRecord(rawLayout)
      || layoutWidth === null
      || layoutHeight === null
      || !Array.isArray(rawLayout.modifierSlots)
      || rawLayout.modifierSlots.length === 0
    ) {
      addIssue(issues, 'error', 'invalid-layout', 'layout', 'Board layout requires positive dimensions and at least one modifier slot.');
    } else {
      rawLayout.modifierSlots.forEach((slot, index) => validateRect(slot, `layout.modifierSlots[${index}]`, true));
    }
  }

  const defaults = value.defaults;
  if (
    !isRecord(defaults)
    || !isNonNegativeFinite(defaults.leadSeconds)
    || !isNonNegativeFinite(defaults.lagSeconds)
    || !isCaptureMode(defaults.mode)
  ) {
    addIssue(
      issues,
      'error',
      'invalid-defaults',
      'defaults',
      'Board defaults require non-negative lead/lag seconds and an instant/range mode.',
    );
  }

  const rawGroups = Array.isArray(value.groups) ? value.groups : [];
  const rawFacets = Array.isArray(value.facets) ? value.facets : [];
  if (!Array.isArray(value.groups)) {
    addIssue(issues, 'error', 'invalid-document', 'groups', 'Tagging board groups must be an array.');
  }
  if (!Array.isArray(value.facets)) {
    addIssue(issues, 'error', 'invalid-document', 'facets', 'Tagging board facets must be an array.');
  }

  const groupIds = new Set<string>();
  const buttonIds = new Set<string>();
  const facetIds = new Set<string>();
  const facetOptions = new Map<string, Set<string>>();
  const facetDependencies = new Map<string, Set<string>>();
  const hotkeys = new Map<string, string[]>();

  const registerId = (id: unknown, path: string, seen: Set<string>, label: string): string | null => {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      addIssue(issues, 'error', 'invalid-id', path, `${label} id must be a safe non-empty identifier.`);
      return null;
    }
    if (seen.has(id)) {
      addIssue(issues, 'error', 'duplicate-id', path, `${label} id "${id}" appears more than once.`);
    }
    seen.add(id);
    return id;
  };

  const registerHotkey = (hotkey: unknown, path: string): void => {
    if (hotkey === undefined) return;
    if (!validHotkey(hotkey)) {
      addIssue(issues, 'error', 'invalid-hotkey', path, 'Hotkeys must contain exactly one character.');
      return;
    }
    const normalized = normalizeHotkey(hotkey);
    hotkeys.set(normalized, [...(hotkeys.get(normalized) ?? []), path]);
  };

  rawFacets.forEach((rawFacet, facetIndex) => {
    const path = `facets[${facetIndex}]`;
    if (!isRecord(rawFacet)) {
      addIssue(issues, 'error', 'invalid-document', path, 'Facet group must be an object.');
      return;
    }
    const facetId = registerId(rawFacet.id, `${path}.id`, facetIds, 'Facet group');
    if (typeof rawFacet.label !== 'string' || !rawFacet.label.trim()) {
      addIssue(issues, 'error', 'invalid-document', `${path}.label`, 'Facet group label is required.');
    }
    if (!isFacetMode(rawFacet.mode)) {
      addIssue(issues, 'error', 'invalid-document', `${path}.mode`, 'Facet mode must be single or multi.');
    }
    if (!Array.isArray(rawFacet.options)) {
      addIssue(issues, 'error', 'invalid-document', `${path}.options`, 'Facet options must be an array.');
      return;
    }
    const optionIds = new Set<string>();
    rawFacet.options.forEach((rawOption, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      if (!isRecord(rawOption)) {
        addIssue(issues, 'error', 'invalid-document', optionPath, 'Facet option must be an object.');
        return;
      }
      registerId(rawOption.id, `${optionPath}.id`, optionIds, 'Facet option');
      if (typeof rawOption.label !== 'string' || !rawOption.label.trim()) {
        addIssue(issues, 'error', 'invalid-document', `${optionPath}.label`, 'Facet option label is required.');
      }
      registerHotkey(rawOption.hotkey, `${optionPath}.hotkey`);
    });
    if (facetId) {
      facetOptions.set(facetId, optionIds);
      facetDependencies.set(facetId, new Set());
    }
  });

  rawGroups.forEach((rawGroup, groupIndex) => {
    const path = `groups[${groupIndex}]`;
    if (!isRecord(rawGroup)) {
      addIssue(issues, 'error', 'invalid-document', path, 'Board group must be an object.');
      return;
    }
    registerId(rawGroup.id, `${path}.id`, groupIds, 'Board group');
    if (typeof rawGroup.label !== 'string' || !rawGroup.label.trim()) {
      addIssue(issues, 'error', 'invalid-document', `${path}.label`, 'Board group label is required.');
    }
    validateRect(rawGroup.labelRect, `${path}.labelRect`);
    if (!Array.isArray(rawGroup.buttons)) {
      addIssue(issues, 'error', 'invalid-document', `${path}.buttons`, 'Board buttons must be an array.');
      return;
    }
    rawGroup.buttons.forEach((rawButton, buttonIndex) => {
      const buttonPath = `${path}.buttons[${buttonIndex}]`;
      if (!isRecord(rawButton)) {
        addIssue(issues, 'error', 'invalid-document', buttonPath, 'Board button must be an object.');
        return;
      }
      registerId(rawButton.id, `${buttonPath}.id`, buttonIds, 'Board button');
      if (typeof rawButton.label !== 'string' || !rawButton.label.trim()) {
        addIssue(issues, 'error', 'invalid-document', `${buttonPath}.label`, 'Board button label is required.');
      }
      validateRect(rawButton.rect, `${buttonPath}.rect`);
      for (const [field, setting] of [
        ['leadSeconds', rawButton.leadSeconds],
        ['lagSeconds', rawButton.lagSeconds],
      ] as const) {
        if (setting !== undefined && !isNonNegativeFinite(setting)) {
          addIssue(
            issues,
            'error',
            'invalid-capture-setting',
            `${buttonPath}.${field}`,
            `${field} must be a non-negative number.`,
          );
        }
      }
      if (rawButton.mode !== undefined && !isCaptureMode(rawButton.mode)) {
        addIssue(
          issues,
          'error',
          'invalid-capture-setting',
          `${buttonPath}.mode`,
          'Button mode must be instant or range.',
        );
      }
      registerHotkey(rawButton.hotkey, `${buttonPath}.hotkey`);
      if (rawButton.facetGroupIds !== undefined && !Array.isArray(rawButton.facetGroupIds)) {
        addIssue(
          issues,
          'error',
          'invalid-document',
          `${buttonPath}.facetGroupIds`,
          'facetGroupIds must be an array.',
        );
      }
    });
  });

  rawGroups.forEach((rawGroup, groupIndex) => {
    if (!isRecord(rawGroup) || !Array.isArray(rawGroup.buttons)) return;
    rawGroup.buttons.forEach((rawButton, buttonIndex) => {
      if (!isRecord(rawButton) || !Array.isArray(rawButton.facetGroupIds)) return;
      rawButton.facetGroupIds.forEach((facetId, facetIndex) => {
        if (typeof facetId !== 'string' || !facetIds.has(facetId)) {
          addIssue(
            issues,
            'error',
            'unresolved-facet-reference',
            `groups[${groupIndex}].buttons[${buttonIndex}].facetGroupIds[${facetIndex}]`,
            `Facet group "${String(facetId)}" does not exist.`,
          );
        }
      });
    });
  });

  rawFacets.forEach((rawFacet, facetIndex) => {
    if (!isRecord(rawFacet) || typeof rawFacet.id !== 'string') return;
    const facetId = rawFacet.id;
    if (rawFacet.requiresAny !== undefined && !Array.isArray(rawFacet.requiresAny)) {
      addIssue(
        issues,
        'error',
        'invalid-document',
        `facets[${facetIndex}].requiresAny`,
        'requiresAny must be an array.',
      );
      return;
    }
    if (!Array.isArray(rawFacet.requiresAny)) return;
    rawFacet.requiresAny.forEach((rawRequirement, requirementIndex) => {
      const path = `facets[${facetIndex}].requiresAny[${requirementIndex}]`;
      if (!isRecord(rawRequirement)) {
        addIssue(issues, 'error', 'unresolved-requirement', path, 'Facet requirement must be an object.');
        return;
      }
      const dependencyId = rawRequirement.facetGroupId;
      const optionId = rawRequirement.optionId;
      if (
        typeof dependencyId !== 'string'
        || typeof optionId !== 'string'
        || !facetOptions.get(dependencyId)?.has(optionId)
      ) {
        addIssue(
          issues,
          'error',
          'unresolved-requirement',
          path,
          `Requirement ${String(dependencyId)}=${String(optionId)} does not resolve.`,
        );
        return;
      }
      facetDependencies.get(facetId)?.add(dependencyId);
    });
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleMembers = new Set<string>();
  const visit = (facetId: string): boolean => {
    if (visiting.has(facetId)) {
      cycleMembers.add(facetId);
      return true;
    }
    if (visited.has(facetId)) return false;
    visiting.add(facetId);
    let foundCycle = false;
    for (const dependency of facetDependencies.get(facetId) ?? []) {
      if (visit(dependency)) {
        cycleMembers.add(facetId);
        foundCycle = true;
      }
    }
    visiting.delete(facetId);
    visited.add(facetId);
    return foundCycle;
  };
  facetIds.forEach((facetId) => visit(facetId));
  cycleMembers.forEach((facetId) => {
    addIssue(
      issues,
      'error',
      'facet-dependency-cycle',
      `facets.${facetId}`,
      `Facet dependency cycle includes "${facetId}".`,
    );
  });

  hotkeys.forEach((paths, hotkey) => {
    if (paths.length <= 1) return;
    paths.forEach((path) => {
      addIssue(
        issues,
        'warning',
        'hotkey-collision',
        path,
        `Hotkey "${hotkey}" is assigned more than once and is disabled.`,
      );
    });
  });

  return issues;
}

export function parseTaggingBoard(source: string | unknown): TaggingBoard {
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new TaggingBoardValidationError([
        {
          severity: 'error',
          code: 'invalid-document',
          path: '',
          message: `Tagging board is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }
  if (isRecord(value) && isRecord(value.defaults)) {
    const migrated = structuredClone(value);
    const defaults = migrated.defaults as Record<string, unknown>;
    if (defaults.leadSeconds === undefined && isNonNegativeFinite(defaults.leadFrames)) {
      defaults.leadSeconds = defaults.leadFrames / 30;
    }
    if (defaults.lagSeconds === undefined && isNonNegativeFinite(defaults.lagFrames)) {
      defaults.lagSeconds = defaults.lagFrames / 30;
    }
    delete defaults.leadFrames;
    delete defaults.lagFrames;
    if (Array.isArray(migrated.groups)) {
      migrated.groups.forEach((group) => {
        if (!isRecord(group) || !Array.isArray(group.buttons)) return;
        group.buttons.forEach((button) => {
          if (!isRecord(button)) return;
          if (button.leadSeconds === undefined && isNonNegativeFinite(button.leadFrames)) {
            button.leadSeconds = button.leadFrames / 30;
          }
          if (button.lagSeconds === undefined && isNonNegativeFinite(button.lagFrames)) {
            button.lagSeconds = button.lagFrames / 30;
          }
          delete button.leadFrames;
          delete button.lagFrames;
        });
      });
    }
    value = migrated;
  }
  const issues = validateTaggingBoard(value);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new TaggingBoardValidationError(issues);
  }
  return value as TaggingBoard;
}

export function findBoardButton(board: TaggingBoard, buttonId: string): BoardButton | null {
  for (const group of board.groups) {
    const button = group.buttons.find((candidate) => candidate.id === buttonId);
    if (button) return button;
  }
  return null;
}

export function resolveButtonCapture(board: TaggingBoard, buttonId: string): ResolvedButtonCapture {
  const button = findBoardButton(board, buttonId);
  if (!button) throw new Error(`Unknown tagging-board button: ${buttonId}`);
  return {
    button,
    leadSeconds: 0,
    lagSeconds: 0,
    mode: 'range',
  };
}

export function boardTagTree(board: TaggingBoard): BoardTagTreeGroup[] {
  return board.groups.map((group) => ({
    id: group.id,
    label: group.label,
    buttons: group.buttons.map((button) => ({ id: button.id, label: button.label })),
  }));
}

export function applicableFacetGroups(board: TaggingBoard, buttonId: string): BoardFacetGroup[] {
  const button = findBoardButton(board, buttonId);
  if (!button) return [];
  const applicable = new Set(button.facetGroupIds ?? []);
  return board.facets.filter((facet) => applicable.has(facet.id));
}

function selectionIncludes(selection: TaggingSelection, groupId: string, optionId: string): boolean {
  const selected = selection.facets[groupId];
  return Array.isArray(selected) ? selected.includes(optionId) : selected === optionId;
}

export function facetRequirementsSatisfied(
  facet: BoardFacetGroup,
  selection: TaggingSelection,
): boolean {
  if (!facet.requiresAny || facet.requiresAny.length === 0) return true;
  return facet.requiresAny.some((requirement) => (
    selectionIncludes(selection, requirement.facetGroupId, requirement.optionId)
  ));
}

export function pruneInapplicableFacets(
  board: TaggingBoard,
  buttonId: string,
  selection: TaggingSelection,
): TaggingSelection {
  const facets = applicableFacetGroups(board, buttonId);
  const next: TaggingSelection = { primary: buttonId, facets: {} };

  for (const facet of facets) {
    const selected = selection.facets[facet.id];
    const validOptions = new Set(facet.options.map((option) => option.id));
    if (facet.mode === 'multi') {
      const values = (Array.isArray(selected) ? selected : selected ? [selected] : [])
        .filter((value) => validOptions.has(value));
      if (values.length > 0) next.facets[facet.id] = values;
    } else {
      const value = Array.isArray(selected) ? selected[0] : selected;
      if (value && validOptions.has(value)) next.facets[facet.id] = value;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const facet of facets) {
      if (!(facet.id in next.facets)) continue;
      if (!facetRequirementsSatisfied(facet, next)) {
        delete next.facets[facet.id];
        changed = true;
      }
    }
  }
  return next;
}

export function conflictedBoardHotkeys(board: TaggingBoard): Set<string> {
  const counts = new Map<string, number>();
  for (const group of board.groups) {
    for (const button of group.buttons) {
      if (!button.hotkey || !validHotkey(button.hotkey)) continue;
      const key = normalizeHotkey(button.hotkey);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const facet of board.facets) {
    for (const option of facet.options) {
      if (!option.hotkey || !validHotkey(option.hotkey)) continue;
      const key = normalizeHotkey(option.hotkey);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

export async function readTaggingBoard(
  dir: FileSystemDirectoryHandle,
): Promise<TaggingBoard | null> {
  try {
    const handle = await dir.getFileHandle(TAGGING_BOARD_FILENAME, { create: false });
    return parseTaggingBoard(await (await handle.getFile()).text());
  } catch (error: unknown) {
    const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
    if (name === 'NotFoundError' || name === 'TypeMismatchError') return null;
    throw error;
  }
}

export async function fetchDefaultTaggingBoard(): Promise<string> {
  const response = await fetch(TAGGING_BOARD_DEFAULT_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load default tagging board (${response.status})`);
  }
  return response.text();
}

export async function writeDefaultTaggingBoard(
  dir: FileSystemDirectoryHandle,
): Promise<TaggingBoard> {
  const source = await fetchDefaultTaggingBoard();
  const board = parseTaggingBoard(source);
  const handle = await dir.getFileHandle(TAGGING_BOARD_FILENAME, { create: true });
  const writable = await handle.createWritable();
  await writable.write(source);
  await writable.close();
  return board;
}
