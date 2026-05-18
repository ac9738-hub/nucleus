const { contextBridge, ipcRenderer } = require('electron');

window.console.log("preload loaded");

contextBridge.exposeInMainWorld('nucleus', {
  startTask: (task) => ipcRenderer.invoke('tasks:start', task),
  getData: () => ipcRenderer.invoke('data:get'),
  newTask: (payload) => ipcRenderer.invoke('tasks:new', payload),
  newWorkspace: (payload) => ipcRenderer.invoke('workspaces:new', payload),
  sendprompt: (payload) => {ipcRenderer.invoke('prompt:send', { message: payload })},
  on: (channel, cb) => ipcRenderer.on(channel, (_, data) => cb(data))
});
