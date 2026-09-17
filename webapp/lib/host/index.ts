import type { AppHost } from './contracts';
import { browserHost } from './browser';
import { desktopHost } from './desktop';

// This is the composition point for a future desktop host. No Electron globals in product code.
export function getAppHost(): AppHost {
  return typeof window !== 'undefined' && window.annotateDesktop ? desktopHost : browserHost;
}
