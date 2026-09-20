import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'brand/wordmark/a-icon.svg');
const output = path.join(root, 'desktop/icons');
if (process.platform !== 'darwin') throw new Error('Regenerating ICNS requires macOS iconutil; other builds use the committed icons.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotate-icons-'));
try {
  await mkdir(output, { recursive: true });
  const iconset = path.join(temporary, 'annotate.iconset');
  await mkdir(iconset);
  const png = path.join(output, 'annotate.png');
  execFileSync('magick', ['-background', 'none', '-density', '384', source, '-resize', '1024x1024', `PNG32:${png}`]);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      execFileSync('magick', [png, '-resize', `${size * scale}x${size * scale}`, `PNG32:${path.join(iconset, name)}`]);
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(output, 'annotate.icns')]);
  execFileSync('magick', [png, '-define', 'icon:auto-resize=256,128,64,48,32,16', path.join(output, 'annotate.ico')]);
  console.log('Generated desktop PNG, ICNS and ICO from brand/wordmark/a-icon.svg.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
