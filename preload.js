// Guck — context bridge. Exposes a minimal, typed-ish API to the renderer.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gitbar', {
  getState: () => ipcRenderer.invoke('state:get'),
  diff: () => ipcRenderer.invoke('git:diff'),
  statusText: () => ipcRenderer.invoke('git:status-text'),
  commit: (message) => ipcRenderer.invoke('git:commit', { message }),
  add: (files) => ipcRenderer.invoke('git:add', files),
  unstage: (files) => ipcRenderer.invoke('git:unstage', files),
  setRemote: (url) => ipcRenderer.invoke('remote:set', url),
  tokenStatus: () => ipcRenderer.invoke('github:token-status'),
  setToken: (token) => ipcRenderer.invoke('github:set-token', token),
  clearToken: () => ipcRenderer.invoke('github:clear-token'),
  verifyToken: () => ipcRenderer.invoke('github:verify'),
  branches: () => ipcRenderer.invoke('git:branches'),
  checkout: (branch) => ipcRenderer.invoke('git:checkout', branch),
  initRepo: () => ipcRenderer.invoke('git:init'),
  tree: () => ipcRenderer.invoke('browse:tree'),
  openFile: (relPath) => ipcRenderer.invoke('file:open', relPath),
  pickDir: () => ipcRenderer.invoke('dir:pick'),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  setMode: (mode) => ipcRenderer.invoke('window:mode', mode),
  setPanelArea: (h) => ipcRenderer.send('window:panel-area', h),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  pull: () => ipcRenderer.send('git:pull'),
  push: () => ipcRenderer.send('git:push'),
  onStatus: (cb) => ipcRenderer.on('git:status', (_e, state) => cb(state)),
  onStream: (cb) => ipcRenderer.on('git:stream', (_e, data) => cb(data))
})
