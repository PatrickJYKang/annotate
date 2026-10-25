// The pipe closes even if the Electron parent is force-killed. No PID polling or
// shared port is needed, and an unrelated process can never inherit ownership.
if (process.env.ANNOTATE_PARENT_PIPE === '1') {
  process.stdin.resume();
  process.stdin.once('end', () => {
    if (process.platform === 'win32') {
      const { spawnSync } = require('node:child_process');
      const path = require('node:path');
      spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-process.pid, 'SIGTERM'); } catch { /* Not a process group leader. */ }
    }
    process.exit(0);
  });
}
