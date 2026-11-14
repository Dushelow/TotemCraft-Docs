const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (arg) => ipcRenderer.invoke(ch, arg);

contextBridge.exposeInMainWorld('totem', {
  qwenReload: call('qwen-reload'),
  qwenState: call('qwen-state'),
  qwenLoginChrome: call('qwen-login-chrome'),
  onLoginStatus: (cb) => ipcRenderer.on('qwen-login-status', (_e, t) => cb(t)),
  state: call('state'),
  saveSettings: call('save-settings'),
  botAdd: call('bot-add'),
  botRemove: call('bot-remove'),
  botPersona: call('bot-persona'),
  botStart: call('bot-start'),
  botStop: call('bot-stop'),
  botOrder: call('bot-order'),
  botNewChat: call('bot-newchat'),
  botChat: call('bot-chat'),
});
