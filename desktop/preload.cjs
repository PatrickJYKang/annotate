const { contextBridge, ipcRenderer } = require('electron');
const configuration = ipcRenderer.sendSync('annotate:runtime');
const preferences = ipcRenderer.sendSync('annotate:preferences') || {};
const pending = new Set();
const closeGuards = new Set();
const preferenceListeners = new Set();
ipcRenderer.on('annotate:preference-changed', (_event, key, value) => {
  if (value === null) delete preferences[key]; else preferences[key] = value;
  for (const listener of preferenceListeners) listener(key, value);
});
contextBridge.exposeInMainWorld('__ANNOTATE_RUNTIME__', configuration);
contextBridge.exposeInMainWorld('annotateDesktop', {
  preferences: {
    getItem: (key) => preferences[key] ?? null,
    async setItem(key, value) {
      preferences[key] = value;
      const request = ipcRenderer.invoke('annotate:request', 'preferences.set', { key, value });
      pending.add(request);
      try {
        const reply = await request;
        if (!reply.ok) throw new Error(reply.error.message);
      } finally { pending.delete(request); }
    },
    onChange(listener) { preferenceListeners.add(listener); return () => preferenceListeners.delete(listener); },
  },
  async request(operation, input) {
    const request = ipcRenderer.invoke('annotate:request', operation, input);
    pending.add(request);
    try {
      // Electron does not preserve custom Error names across contextBridge.
      // Return a plain envelope; the renderer adapter reconstructs DOM errors.
      return await request;
    } finally { pending.delete(request); }
  },
  onChange(listener) {
    const receive = (_event, id) => listener(id);
    ipcRenderer.on('annotate:changed', receive);
    return () => ipcRenderer.removeListener('annotate:changed', receive);
  },
  onProgress(listener) {
    const receive = (_event, progress) => listener(progress);
    ipcRenderer.on('annotate:progress', receive);
    return () => ipcRenderer.removeListener('annotate:progress', receive);
  },
  beforeClose(callback) { closeGuards.add(callback); return () => closeGuards.delete(callback); },
});
ipcRenderer.on('annotate:prepare-close', async () => {
  try {
    for (const guard of closeGuards) await guard();
    while (pending.size) await Promise.all([...pending]);
    const flushed = await ipcRenderer.invoke('annotate:request', 'state.flush');
    if (!flushed.ok) throw new Error(flushed.error.message);
    ipcRenderer.send('annotate:close-ready');
  } catch (error) { ipcRenderer.send('annotate:close-error', String(error.message || error)); }
});
