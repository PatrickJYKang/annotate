import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceUrl, isSourceLink } from '../core/legal.mjs';

test('source links use an immutable commit when known', () => {
  const commit = 'a'.repeat(40);
  assert.equal(sourceUrl(commit), `https://github.com/PatrickJYKang/annotate/tree/${commit}`);
  for (const invalid of [undefined, '', 'main', '../settings', 'a'.repeat(39)]) {
    assert.equal(sourceUrl(invalid), 'https://github.com/PatrickJYKang/annotate');
  }
});

test('only the exact source repository and immutable source trees open externally', () => {
  assert.equal(isSourceLink(sourceUrl()), true);
  assert.equal(isSourceLink(sourceUrl('b'.repeat(40))), true);
  for (const invalid of [
    'https://github.com.evil.test/PatrickJYKang/annotate',
    'https://github.com@evil.test/PatrickJYKang/annotate',
    'https://user@github.com/PatrickJYKang/annotate',
    'http://github.com/PatrickJYKang/annotate',
    'https://github.com/PatrickJYKang/annotate/issues',
    'https://github.com/PatrickJYKang/annotate?redirect=https://evil.test',
    'https://github.com/PatrickJYKang/annotate#other',
    'javascript:alert(1)', 'not a URL',
  ]) assert.equal(isSourceLink(invalid), false, invalid);
});
