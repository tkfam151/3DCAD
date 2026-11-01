const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  openFile: (opts) => ipcRenderer.invoke('open-file', opts || {}),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
  saveDialog: (opts) => ipcRenderer.invoke('save-dialog', opts || {}),
  writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
  setDirty: (dirty, title) => ipcRenderer.send('set-dirty', dirty, title),
  closeWindow: () => ipcRenderer.send('close-window'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd, arg) => cb(cmd, arg)),
});
