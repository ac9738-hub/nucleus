const { contextBridge, ipcRenderer } = require('electron');
 
contextBridge.exposeInMainWorld('nucleus', {
  startTask:    (task)    => ipcRenderer.invoke('tasks:start', task),
  tabschanged:  (tabs)    => ipcRenderer.invoke('tabs:push', tabs),
  newactivetab: (tab)     => ipcRenderer.invoke('tabs:new_active', tab),
  navigateBrowserTab: (tabid, value) => ipcRenderer.invoke('tabs:navigate', tabid, value),
  backBrowserTab: (tabid) => ipcRenderer.invoke('tabs:back', tabid),
  getData:      ()        => ipcRenderer.invoke('data:get'),
  getEngineUrl: ()        => ipcRenderer.invoke('engine:url'),
  newTask:      (payload) => ipcRenderer.invoke('tasks:new', payload),
  newWorkspace: (workspace) => ipcRenderer.invoke('workspaces:new', workspace),
  deleteWorkspace: (workspaceid) => ipcRenderer.invoke('workspaces:delete', workspaceid),
  sendprompt:   (payload) => ipcRenderer.invoke('prompt:send', { message: payload }),
  ensureCanvasAuth: () => ipcRenderer.invoke('canvas:ensure_auth'),
  openCanvasApp: () => ipcRenderer.invoke('canvas:open_app'),
  getinjection: () => ipcRenderer.invoke('injection:get'),
  writeActiveTabHtml: () => ipcRenderer.invoke('tabs:write_active_html'),
  writeActiveTabFramesHtml: () => ipcRenderer.invoke('tabs:write_active_frames_html'),
  canvasBlankShown: () => ipcRenderer.send('canvas:blank-shown'),
  canvasWipeCovered: () => ipcRenderer.send('canvas:wipe-covered'),
  canvasWipeHidden: () => ipcRenderer.send('canvas:wipe-hidden'),
  on: (channel, cb) => {
  const listener = (_, data) => cb(data);
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
});
















