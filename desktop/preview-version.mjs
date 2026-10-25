import { readFileSync } from 'node:fs';

// One release version for the shared app and both platform packages.
export const desktopPreviewVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
