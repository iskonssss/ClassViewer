const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("keys", {
  getState: () => ipcRenderer.invoke("get-state"),
  onState: fn => ipcRenderer.on("state", (_e, s) => fn(s)),
  onShow: fn => ipcRenderer.on("show", (_e, m) => fn(m)),
  onFlash: fn => ipcRenderer.on("flash", (_e, t) => fn(t)),
  onRecorded: fn => ipcRenderer.on("recorded", (_e, c) => fn(c)),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragEnd: () => ipcRenderer.send("drag-end"),
  mouseIgnore: on => ipcRenderer.send("mouse-ignore", on),
  saveCfg: c => ipcRenderer.invoke("save-cfg", c),
  record: on => ipcRenderer.invoke("record", on),
  normalize: s => ipcRenderer.invoke("normalize", s),
  defaults: () => ipcRenderer.invoke("defaults"),
  exportSets: () => ipcRenderer.invoke("export"),
  importSets: () => ipcRenderer.invoke("import"),
  askPermission: () => ipcRenderer.invoke("ask-permission"),
  relaunch: () => ipcRenderer.invoke("relaunch"),
  startupSet: on => ipcRenderer.invoke("startup-set", on),
  quit: () => ipcRenderer.invoke("quit"),
});
