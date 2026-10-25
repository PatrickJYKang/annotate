import { desktopBridge } from './desktop/bridge';

/** Synchronous reads for panel layout; desktop writes are drained before closing. */
export const preferenceStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    if (window.annotateDesktop) return desktopBridge().preferences.getItem(key);
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    if (window.annotateDesktop) {
      void desktopBridge().preferences.setItem(key, value).catch((error) => console.error('Could not save preference', error));
    } else window.localStorage.setItem(key, value);
  },
};

export function onPreferenceChange(listener: (key: string, value: string | null) => void): () => void {
  if (window.annotateDesktop) return desktopBridge().preferences.onChange(listener);
  const receive = (event: StorageEvent) => { if (event.key) listener(event.key, event.newValue); };
  window.addEventListener('storage', receive);
  return () => window.removeEventListener('storage', receive);
}
