import { spawn } from 'node:child_process';
import { access, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const webapp = path.join(root, 'webapp');
const dist = path.join(webapp, '.next-desktop');
const child = spawn(process.execPath, [path.join(webapp, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: webapp,
  env: { ...process.env, ANNOTATE_STANDALONE: '1', NEXT_DIST_DIR: '.next-desktop' },
  stdio: 'inherit', shell: false,
});
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});
if (code !== 0) process.exit(code);
const output = path.join(dist, 'standalone');
await access(path.join(output, 'server.js'));
await cp(path.join(webapp, 'public'), path.join(output, 'public'), { recursive: true });
await cp(path.join(dist, 'static'), path.join(output, '.next-desktop/static'), { recursive: true });
console.log(`Standalone renderer ready: ${output}`);
