import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const webappRoot = fileURLToPath(new URL('../../', import.meta.url));

function productFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'host' || entry.name === 'test') return [];
      return productFiles(file);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [file] : [];
  });
}

it('keeps native project handles, file pickers, and editor windows inside the host adapter', () => {
  const nativeAPI = /\bFileSystem(?:DirectoryHandle|FileHandle|WritableFileStream)\b|\bshow(?:Directory|OpenFile|SaveFile)Picker\b|window\.(?:open|close)\s*\(|navigator\.storage|from ['"][^'"]*host\/browser/;
  const violations = ['app', 'components', 'lib']
    .flatMap((directory) => productFiles(path.join(webappRoot, directory)))
    .filter((file) => nativeAPI.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(webappRoot, file));
  expect(violations).toEqual([]);
});
