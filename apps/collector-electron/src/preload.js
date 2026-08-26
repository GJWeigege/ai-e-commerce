const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronCollector', {
  openOzonLogin: () => ipcRenderer.invoke('open-ozon-login'),
  collectUrl: (url) => ipcRenderer.invoke('collect-url', url),
});
