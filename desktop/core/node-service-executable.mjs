import path from 'node:path';

export function nodeServiceExecutable(execPath, platform = process.platform) {
  if (platform !== 'darwin') return execPath;
  // The main .app registers as a second foreground app even in Node mode.
  // Electron's helper has LSUIElement set, keeping services out of the Dock.
  const helper = `${path.posix.basename(execPath)} Helper`;
  return path.posix.join(path.posix.dirname(execPath), '..', 'Frameworks', `${helper}.app`, 'Contents', 'MacOS', helper);
}
