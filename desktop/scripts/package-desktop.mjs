import { build, Platform, Arch } from 'electron-builder';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';
import { desktopPreviewVersion } from '../preview-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = process.argv[2];
if (!['darwin-arm64', 'win32-x64'].includes(target)) throw new Error('Choose darwin-arm64 or win32-x64.');
execFileSync(process.execPath, [path.join(root, 'desktop/scripts/verify-runtime-files.mjs'), path.join(root, 'desktop/build', target, 'runtime')], { stdio: 'inherit' });
const app = path.join(root, 'desktop/build', target, 'app');
await mkdir(app, { recursive: true });
for (const name of ['main.mjs', 'preload.cjs', 'startup.html', 'core', 'dist', 'icons']) {
  await cp(path.join(root, 'desktop', name), path.join(app, name), { recursive: true });
}
await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'annotate-desktop', version: desktopPreviewVersion,
  description: 'Football video annotation and analysis', author: 'Patrick Kang', license: 'GPL-3.0-only', main: 'main.mjs' }));
const electronVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).devDependencies.electron;
await build({ projectDir: app, targets: target === 'darwin-arm64' ? Platform.MAC.createTarget(process.argv.includes('--dir') ? 'dir' : 'dmg', Arch.arm64) : Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish: 'never', config: {
    appId: 'com.patrickjykang.annotate', productName: 'Annotate', electronVersion,
    directories: { output: path.join(root, 'desktop/artifacts/installers') },
    files: ['**/*', '!**/*.test.mjs', '!core/domain-service.ts'], asar: true, npmRebuild: false,
    extraResources: [{ from: path.join(root, 'desktop/build', target, 'runtime'), to: 'runtime', filter: ['**/*'] }],
    artifactName: 'Annotate-${version}-${os}-${arch}.${ext}',
    mac: { icon: path.join(root, 'desktop/icons/annotate.icns'), category: 'public.app-category.sports', identity: '-', hardenedRuntime: false, notarize: false, minimumSystemVersion: '14.0' },
    afterSign: async ({ appOutDir, electronPlatformName }) => {
      if (electronPlatformName !== 'darwin') return;
      const bundle = path.join(appOutDir, 'Annotate.app');
      const runtime = path.join(bundle, 'Contents/Resources/runtime');
      const manifestPath = path.join(runtime, 'runtime-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      // Signing Mach-O executables changes their bytes. Seal their final hashes,
      // then re-sign only the outer bundle so nested signatures stay unchanged.
      for (const resource of Object.values(manifest.resources)) if (resource.kind === 'file') resource.sha256 = await sha256File(path.join(runtime, resource.path));
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      execFileSync('codesign', ['--force', '--sign', '-', bundle], { stdio: 'inherit' });
    },
    dmg: { sign: false, contents: [{ x: 140, y: 160 }, { x: 400, y: 160, type: 'link', path: '/Applications' }] },
    win: { icon: path.join(root, 'desktop/icons/annotate.ico'), signExecutable: false },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, runAfterFinish: true, deleteAppDataOnUninstall: false },
  } });
