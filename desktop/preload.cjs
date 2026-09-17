const { contextBridge, ipcRenderer } = require('electron');
const configuration = ipcRenderer.sendSync('annotate:runtime');
const pending = new Set();
const closeGuards = new Set();
contextBridge.exposeInMainWorld('__ANNOTATE_RUNTIME__', configuration);
contextBridge.exposeInMainWorld('annotateDesktop', {
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
    ipcRenderer.send('annotate:close-ready');
  } catch (error) { ipcRenderer.send('annotate:close-error', String(error.message || error)); }
});
