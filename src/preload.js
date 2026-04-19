const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkStatus: () => ipcRenderer.invoke('check-status'),
  installAudibleCli: () => ipcRenderer.invoke('install-audible-cli'),
  startLogin: (opts) => ipcRenderer.invoke('start-login', opts),
  exportLibrary: () => ipcRenderer.invoke('export-library'),
  loadLibrary: () => ipcRenderer.invoke('load-library'),
  clearData: () => ipcRenderer.invoke('clear-data'),
  clearAuth: () => ipcRenderer.invoke('clear-auth'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),

  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (_, data) => cb(data)),
  onLoginProgress: (cb) => ipcRenderer.on('login-progress', (_, data) => cb(data)),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (_, data) => cb(data)),
});
