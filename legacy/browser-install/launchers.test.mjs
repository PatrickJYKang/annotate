import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = fileURLToPath(new URL('./', import.meta.url));

for (const nested of [false, true]) {
  test(`generated shortcuts support ${nested ? 'archived' : 'old release'} launcher paths`, async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'annotate-legacy-'));
    try {
      const root = path.join(temp, 'App with spaces');
      const directory = nested ? path.join(root, 'legacy/browser-install') : root;
      await mkdir(directory, { recursive: true });
      const launcher = path.join(directory, 'start-annotate.sh');
      await writeFile(launcher, '#!/usr/bin/env bash\nprintf "%s" "$ANNOTATE_APP_DIR"\n', { mode: 0o755 });
      execFileSync('bash', ['-c', `
        export ANNOTATE_INSTALL_NO_MAIN=1
        source "$1"
        INSTALL_DIR="$2"
        write_shell_launcher "$3/shell.sh"
        write_macos_command_launcher "$3/Annotate.command"
        write_linux_desktop_launcher "$3/Annotate.desktop"
      `, '_', path.join(source, 'install.sh'), root, temp]);
      for (const name of ['shell.sh', 'Annotate.command']) {
        assert.equal(execFileSync('bash', [path.join(temp, name)], { encoding: 'utf8' }), root);
      }
      assert.ok((await readFile(path.join(temp, 'Annotate.desktop'), 'utf8')).includes(`exec "${launcher}"`));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}

test('archived command defaults to the repository root and respects an override', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'annotate-command-'));
  try {
    const directory = path.join(temp, 'legacy/browser-install');
    await mkdir(directory, { recursive: true });
    await cp(path.join(source, 'Annotate.command'), path.join(directory, 'Annotate.command'));
    await writeFile(path.join(directory, 'start-annotate.sh'), '#!/usr/bin/env bash\nprintf "%s" "$ANNOTATE_APP_DIR"\n', { mode: 0o755 });
    const env = { ...process.env };
    delete env.ANNOTATE_APP_DIR;
    assert.equal(execFileSync('bash', [path.join(directory, 'Annotate.command')], { env, encoding: 'utf8' }), temp);
    env.ANNOTATE_APP_DIR = path.join(temp, 'Other app');
    assert.equal(execFileSync('bash', [path.join(directory, 'Annotate.command')], { env, encoding: 'utf8' }), env.ANNOTATE_APP_DIR);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('archived service launcher resolves the repository root before prerequisite checks', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'annotate-start-'));
  try {
    const directory = path.join(temp, 'legacy/browser-install');
    await mkdir(directory, { recursive: true });
    await cp(path.join(source, 'start-annotate.sh'), path.join(directory, 'start-annotate.sh'));
    await writeFile(path.join(directory, 'install.sh'), '');
    await writeFile(path.join(temp, 'package.json'), '{}');
    const env = { ...process.env };
    delete env.ANNOTATE_APP_DIR;
    const result = spawnSync('bash', [path.join(directory, 'start-annotate.sh')], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    const missing = output.match(/Web dependencies are missing\. Run (.*)\./);
    assert.ok(missing, output);
    assert.equal(await realpath(missing[1]), await realpath(path.join(directory, 'install.sh')));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
