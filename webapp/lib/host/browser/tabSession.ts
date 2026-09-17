export const PROJECT_SESSION_PARAM = 'projectSession';
const TAB_SESSION_KEY = 'annotate:project-session';

export function requestedProjectSession(): string | null {
  const url = new URL(window.location.href);
  const explicit = url.searchParams.get(PROJECT_SESSION_PARAM);
  if (explicit !== null) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(explicit)) throw new Error('Invalid project session. Open the project again.');
    return explicit;
  }
  return window.sessionStorage.getItem(TAB_SESSION_KEY);
}

export function bindTabSession(id: string): void {
  window.sessionStorage.setItem(TAB_SESSION_KEY, id);
  // A user may explicitly open a different project while on an editor URL.
  const url = new URL(window.location.href);
  if (url.searchParams.has(PROJECT_SESSION_PARAM)) {
    url.searchParams.set(PROJECT_SESSION_PARAM, id);
    window.history.replaceState(window.history.state, '', url);
  }
}

export function clearTabSession(): void {
  window.sessionStorage.removeItem(TAB_SESSION_KEY);
  const url = new URL(window.location.href);
  if (url.searchParams.has(PROJECT_SESSION_PARAM)) {
    url.searchParams.delete(PROJECT_SESSION_PARAM);
    window.history.replaceState(window.history.state, '', url);
  }
}
