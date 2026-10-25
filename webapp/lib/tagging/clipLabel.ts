import type { Clip } from '../types/clip';
import { findBoardButton, type TaggingBoard } from './board';
import type { TaggingSelection } from './selection';

export const UNTAGGED_CLIP_LABEL = 'Untagged clip';

export function retagClip(
  clip: Clip,
  tags: TaggingSelection,
  board: TaggingBoard | null,
  displayedLabel?: string,
): Clip {
  const next = { ...clip, tags: structuredClone(tags) };
  if (clip.tags.primary === tags.primary) return next;

  const previousDefault = clip.tags.primary && board
    ? findBoardButton(board, clip.tags.primary)?.label
    : clip.tags.primary === null ? UNTAGGED_CLIP_LABEL : undefined;
  const generated = clip.generatedLabel === undefined
    ? !clip.label || clip.label === previousDefault
    : clip.generatedLabel !== null && clip.label === clip.generatedLabel;
  // Remember custom names even if they happen to match a later tag's label.
  if (!generated) return { ...next, generatedLabel: null };

  const defaultLabel = tags.primary && board
    ? findBoardButton(board, tags.primary)?.label
    : tags.primary === null ? UNTAGGED_CLIP_LABEL : undefined;
  if (defaultLabel === undefined) return next;
  const label = displayedLabel?.trim() || defaultLabel;
  return { ...next, label, generatedLabel: label };
}
