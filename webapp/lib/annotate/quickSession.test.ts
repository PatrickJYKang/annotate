import { describe, expect, it } from 'vitest';

import {
  quickExportFileName,
  quickStillIdForFile,
  stashQuickAnnotateFile,
  takeQuickAnnotateFile,
} from './quickSession';

function makeFile(name: string, content = 'x', lastModified = 1700000000000): File {
  return new File([content], name, { type: 'image/png', lastModified });
}

describe('stashQuickAnnotateFile / takeQuickAnnotateFile', () => {
  it('hands off a stashed file exactly once', () => {
    const file = makeFile('frame.png');
    stashQuickAnnotateFile(file);
    expect(takeQuickAnnotateFile()).toBe(file);
    expect(takeQuickAnnotateFile()).toBeNull();
  });

  it('returns null when nothing is stashed', () => {
    expect(takeQuickAnnotateFile()).toBeNull();
  });

  it('replaces a previously stashed file', () => {
    const first = makeFile('first.png');
    const second = makeFile('second.png');
    stashQuickAnnotateFile(first);
    stashQuickAnnotateFile(second);
    expect(takeQuickAnnotateFile()).toBe(second);
    expect(takeQuickAnnotateFile()).toBeNull();
  });
});

describe('quickStillIdForFile', () => {
  it('is deterministic for the same file identity', () => {
    const a = makeFile('frame.png', 'same-bytes');
    const b = makeFile('frame.png', 'same-bytes');
    expect(quickStillIdForFile(a)).toBe(quickStillIdForFile(b));
  });

  it('differs when name, size, or mtime differ', () => {
    const base = makeFile('frame.png', 'aa');
    expect(quickStillIdForFile(makeFile('other.png', 'aa'))).not.toBe(quickStillIdForFile(base));
    expect(quickStillIdForFile(makeFile('frame.png', 'aaa'))).not.toBe(quickStillIdForFile(base));
    expect(quickStillIdForFile(makeFile('frame.png', 'aa', 1700000000001))).not.toBe(quickStillIdForFile(base));
  });

  it('produces a quick_-prefixed id safe for annotation paths', () => {
    const id = quickStillIdForFile(makeFile('weird name (1) #2.png'));
    expect(id).toMatch(/^quick_[0-9a-f]+$/);
  });
});

describe('quickExportFileName', () => {
  it('replaces the extension with -annotated.png', () => {
    expect(quickExportFileName(makeFile('frame.png'))).toBe('frame-annotated.png');
    expect(quickExportFileName(makeFile('match.day.jpeg'))).toBe('match.day-annotated.png');
  });

  it('handles extensionless and dotfile names', () => {
    expect(quickExportFileName(makeFile('frame'))).toBe('frame-annotated.png');
    expect(quickExportFileName(makeFile('.hidden'))).toBe('.hidden-annotated.png');
  });
});
