// Main renderer preload bridge.
// Functionality: exposes the IPC contract consumed by renderer/app.js and
// renderer/workspace-page-tabs.js.
// Dependencies: main.js IPC handler names must stay in sync with this surface.
const { contextBridge, ipcRenderer } = require('electron');
 
contextBridge.exposeInMainWorld('nucleus', {
  getThemeConfig: () => ipcRenderer.sendSync('theme:get_config'),
  listThemes: () => ipcRenderer.invoke('theme:list'),
  setTheme: (name) => ipcRenderer.invoke('theme:set', name),
  startTask:    (task)    => ipcRenderer.invoke('tasks:start', task),
  tabschanged:  (tabs, activeTabId = null) => ipcRenderer.invoke('tabs:push', { tabs, activeTabId }),
  newactivetab: (tab)     => ipcRenderer.invoke('tabs:new_active', tab),
  pushUiState:  (uiState) => ipcRenderer.send('context:ui_state', uiState),
  pushScreenText: (payload) => ipcRenderer.send('context:screen_text', payload),
  navigateBrowserTab: (tabid, value) => ipcRenderer.invoke('tabs:navigate', tabid, value),
  backBrowserTab: (tabid) => ipcRenderer.invoke('tabs:back', tabid),
  setWorkspaceSidebarCollapsed: (collapsed) => ipcRenderer.invoke('layout:workspace_sidebar_collapsed', collapsed),
  setRightPanelWidth: (width) => ipcRenderer.invoke('layout:right_panel_width', width),
  getData:      ()        => ipcRenderer.invoke('data:get'),
  getEngineUrl: ()        => ipcRenderer.invoke('engine:url'),
  newTask:      (payload) => ipcRenderer.invoke('tasks:new', payload),
  newWorkspace: (workspace) => ipcRenderer.invoke('workspaces:new', workspace),
  deleteWorkspace: (workspaceid) => ipcRenderer.invoke('workspaces:delete', workspaceid),
  sendprompt:   (payload) => ipcRenderer.invoke('prompt:send', { message: payload }),
  synapseSend:  (payload) => ipcRenderer.invoke('synapse:send', payload),
  ensureCanvasAuth: () => ipcRenderer.invoke('canvas:ensure_auth'),
  clearCanvasSyncData: () => ipcRenderer.invoke('canvas:clear_sync_data'),
  logoutCanvas: () => ipcRenderer.invoke('canvas:logout'),
  openCanvasApp: () => ipcRenderer.invoke('canvas:open_app'),
  ensureMailAuth: () => ipcRenderer.invoke('mail:ensure_auth'),
  getMailInbox: () => ipcRenderer.invoke('mail:get_inbox'),
  getMailView: (payload) => ipcRenderer.invoke('mail:get_view', payload),
  getMailMessage: (payload) => ipcRenderer.invoke('mail:get_message', payload),
  getMailThread: (payload) => ipcRenderer.invoke('mail:get_thread', payload),
  sendMail: (payload) => ipcRenderer.invoke('mail:send', payload),
  modifyMail: (payload) => ipcRenderer.invoke('mail:modify', payload),
  trashMail: (payload) => ipcRenderer.invoke('mail:trash', payload),
  untrashMail: (payload) => ipcRenderer.invoke('mail:untrash', payload),
  deleteMail: (payload) => ipcRenderer.invoke('mail:delete', payload),
  startMailWatch: (payload) => ipcRenderer.invoke('mail:start_watch', payload),
  stopMailWatch: () => ipcRenderer.invoke('mail:stop_watch'),
  getMailContacts: () => ipcRenderer.invoke('mail:get_contacts'),
  addMailContact: (payload) => ipcRenderer.invoke('mail:add_contact', payload),
  syncMailContacts: (payload) => ipcRenderer.invoke('mail:sync_contacts', payload),
  getinjection: () => ipcRenderer.invoke('injection:get'),
  writeActiveTabHtml: () => ipcRenderer.invoke('tabs:write_active_html'),
  writeActiveTabFramesHtml: () => ipcRenderer.invoke('tabs:write_active_frames_html'),
  captureRegionContext: (payload) => ipcRenderer.invoke('region:text_context', payload),
  captureRegionShortcut: (payload) => ipcRenderer.invoke('region:capture_shortcut', payload),
  setRendererOverlay: (payload) => ipcRenderer.invoke('overlay:set_open', payload),
  on: (channel, cb) => {
  const listener = (_, data) => cb(data);
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
});












