import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('renderer service exits when the owning pipe closes', { timeout: 10000 }, async (t) => {
  const child = spawn(process.execPath, ['--require', fileURLToPath(new URL('../core/service-parent.cjs', import.meta.url)), '-e', 'console.log("ready"); setInterval(() => {}, 1000);'], {
    env: { ...process.env, ANNOTATE_PARENT_PIPE: '1' }, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await once(child.stdout, 'data');
  assert.equal(child.exitCode, null);
  const exited = once(child, 'exit');
  child.stdin.end();
  await exited;
});
