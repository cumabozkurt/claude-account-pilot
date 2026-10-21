const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getState: () => ipcRenderer.invoke("pilot:getState"),
  setLang: (lang) => ipcRenderer.invoke("pilot:setLang", lang),
  setThreshold: (value) => ipcRenderer.invoke("pilot:setThreshold", value),
  setPort: (value) => ipcRenderer.invoke("pilot:setPort", value),
  setProxyEnabled: (enabled) => ipcRenderer.invoke("pilot:setProxyEnabled", enabled),
  setProvider: (id, enabled) => ipcRenderer.invoke("pilot:setProvider", id, enabled),
  setWidget: (enabled) => ipcRenderer.invoke("pilot:setWidget", enabled),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke("pilot:setLaunchAtLogin", enabled),
  addAccount: (input) => ipcRenderer.invoke("pilot:addAccount", input),
  toggleAccount: (id, enabled) => ipcRenderer.invoke("pilot:toggleAccount", id, enabled),
  removeAccount: (id) => ipcRenderer.invoke("pilot:removeAccount", id),
  toggleRoute: (id, enabled) => ipcRenderer.invoke("pilot:toggleRoute", id, enabled),
  addRoute: (input) => ipcRenderer.invoke("pilot:addRoute", input),
  removeRoute: (id) => ipcRenderer.invoke("pilot:removeRoute", id),
  moveRoute: (id, direction) => ipcRenderer.invoke("pilot:moveRoute", id, direction),
  importDiscovered: (provider) => ipcRenderer.invoke("pilot:importDiscovered", provider),
  applyClaude: () => ipcRenderer.invoke("pilot:applyClaude"),
  restoreClaude: () => ipcRenderer.invoke("pilot:restoreClaude"),
  setNotify: (enabled) => ipcRenderer.invoke("pilot:setNotify", enabled),
  startClaudeLogin: () => ipcRenderer.invoke("pilot:startClaudeLogin"),
  finishClaudeLogin: (pasted) => ipcRenderer.invoke("pilot:finishClaudeLogin", pasted),
  importClaudeCredentials: (raw) => ipcRenderer.invoke("pilot:importClaudeCredentials", raw),
  syncClaudeAccount: (id) => ipcRenderer.invoke("pilot:syncClaudeAccount", id),
  restoreClaudeCredentials: () => ipcRenderer.invoke("pilot:restoreClaudeCredentials"),
  startAntigravityLogin: () => ipcRenderer.invoke("pilot:startAntigravityLogin"),
  setAntigravityClient: (input) => ipcRenderer.invoke("pilot:setAntigravityClient", input),
  dismissWizard: () => ipcRenderer.invoke("pilot:dismissWizard"),
  exportData: () => ipcRenderer.invoke("pilot:export"),
  checkUpdate: () => ipcRenderer.invoke("pilot:checkUpdate"),
  openMain: () => ipcRenderer.invoke("pilot:openMain"),
  onState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("pilot:state", wrapped);
    return () => ipcRenderer.removeListener("pilot:state", wrapped);
  },
};

contextBridge.exposeInMainWorld("pilot", api);
