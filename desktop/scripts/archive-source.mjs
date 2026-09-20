import { execFileSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { desktopPreviewVersion } from '../preview-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, `desktop/artifacts/installers/Annotate-${desktopPreviewVersion}-source.tar.gz`);
const candidates = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [];
for (const file of candidates) {
  if (!/^(webapp\/|sidecar\/|desktop\/|scripts\/|\.github\/|package(-lock)?\.json$|LICENSE$|README\.md$|USER_GUIDE\.md$|THIRD_PARTY_NOTICES\.md$|technical_document\.md$)/.test(file)) continue;
  if (/(^|\/)(\.env[^/]*|node_modules|\.venv|__pycache__|test-results|playwright-report|artifacts|build)(\/|$)/.test(file)) continue;
  try { await access(path.join(root, file)); files.push(file); } catch { /* Exclude tracked deletions. */ }
}
await mkdir(path.dirname(destination), { recursive: true });
execFileSync('tar', ['-czf', destination, '--null', '-T', '-'], { cwd: root, input: files.join('\0') + '\0' });
console.log(`Archived ${files.length} source files: ${destination}`);
