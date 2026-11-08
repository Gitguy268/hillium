// The only bridge into Hillium's own pages (toolbar, assistant). Web pages never get it.
const { contextBridge, ipcRenderer } = require("electron");

const EVENTS = new Set(["state", "command", "found", "model-progress", "ask"]);

contextBridge.exposeInMainWorld("hillium", {
  send: (command, arg) => ipcRenderer.send("hillium", command, arg),
  invoke: (command, arg) => ipcRenderer.invoke("hillium", command, arg),
  on(event, fn) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    ipcRenderer.on(event, (_, data) => fn(data));
  },
});
