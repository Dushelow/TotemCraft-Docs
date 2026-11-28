// Мост окна входа поверх сайта (login-overlay.html) с main.js: кнопки входа, выбор браузера и два сообщения.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  login: (site) => ipcRenderer.invoke('overlay-login', site),
  browsers: () => ipcRenderer.invoke('browsers'),
  browserSet: (exe) => ipcRenderer.invoke('browser-set', exe),
  browserPick: () => ipcRenderer.invoke('browser-pick'),
  onBrowserChanged: (cb) => ipcRenderer.on('browser-changed', (_e, r) => cb(r)),
  onShow: (cb) => ipcRenderer.on('overlay-show', (_e, d) => cb(d)),
  onHide: (cb) => ipcRenderer.on('overlay-hide', () => cb()),
  onStatus: (cb) => ipcRenderer.on('overlay-status', (_e, t) => cb(t)),
});
