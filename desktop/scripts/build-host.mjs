import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await build({
  absWorkingDir: root, entryPoints: ['desktop/core/domain-service.ts'],
  outfile: 'desktop/dist/domain-service.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs',
});
