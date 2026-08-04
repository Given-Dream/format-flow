const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('licenseManager', {
  getStatus: () => ipcRenderer.invoke('license-manager:status'),
  generatePassword: (machineCode) => ipcRenderer.invoke('license-manager:generate', machineCode),
  copyText: (text) => ipcRenderer.invoke('license-manager:copy', text)
})
