const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("helper", {
  env: () => ipcRenderer.invoke("env"),
  permissions: () => ipcRenderer.invoke("permissions"),
  askAccessibility: () => ipcRenderer.invoke("ask-accessibility"),
  openSettings: which => ipcRenderer.invoke("open-settings", which),
  relaunch: () => ipcRenderer.invoke("relaunch"),
  minimize: () => ipcRenderer.invoke("minimize"),
  attention: text => ipcRenderer.invoke("attention", text),
  controlStart: platform => ipcRenderer.invoke("control-start", platform),
  controlEnd: () => ipcRenderer.invoke("control-end"),
  input: m => ipcRenderer.send("input", m),
  eyes: (on, text) => ipcRenderer.invoke("eyes", on, text),
  point: (x, y) => ipcRenderer.invoke("point", x, y),
  onPoint: fn => ipcRenderer.on("point", (_e, m) => fn(m)),
  barStop: () => ipcRenderer.send("bar-stop"),
  startupGet: () => ipcRenderer.invoke("startup-get"),
  startupSet: on => ipcRenderer.invoke("startup-set", on),
  onStopHotkey: fn => ipcRenderer.on("stop-hotkey", () => fn()),
});
