// Мост окна входа поверх сайта (login-overlay.html) с main.js: кнопки входа, выбор браузера и два сообщения.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  login: (site) => ipcRenderer.invoke('overlay-login', site),
  browsers: () => ipcRenderer.invoke('browsers'),
  browserSet: (exe) => ipcRenderer.invoke('browser-set', exe),
  browserPick: () => ipcRenderer.invoke('browser-pick'),
  onShow: (cb) => ipcRenderer.on('overlay-show', (_e, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on('overlay-status', (_e, t) => cb(t)),
});
