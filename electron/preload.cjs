const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('skyCreatorPro', {
  desktop: true,
  platform: process.platform,
  version: '0.1.9',
  cloudProjects: {
    getConfigStatus: () => ipcRenderer.invoke('r2:get-config-status'),
    saveConfig: (config) => ipcRenderer.invoke('r2:save-config', config),
    saveProject: (project) => ipcRenderer.invoke('r2:save-project', project),
    listProjects: () => ipcRenderer.invoke('r2:list-projects'),
    loadProject: (key) => ipcRenderer.invoke('r2:load-project', key),
  },
})
