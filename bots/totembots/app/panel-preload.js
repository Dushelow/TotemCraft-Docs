const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('totem', {
  qwenReload: () => ipcRenderer.invoke('qwen-reload'),
  qwenState: () => ipcRenderer.invoke('qwen-state'),
  qwenLoginChrome: () => ipcRenderer.invoke('qwen-login-chrome'),
  onLoginStatus: (cb) => ipcRenderer.on('qwen-login-status', (_e, t) => cb(t)),
  onQwenUrl: (cb) => ipcRenderer.on('qwen-url', (_e, url) => cb(url)),
});
