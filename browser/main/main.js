// Hillium Browser: app lifecycle, the menu (every keyboard shortcut lives here), links from
// other apps, and the IPC bridge from Hillium's own pages.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BaseWindow, Menu, dialog, ipcMain, nativeTheme } from "electron";
import "./protocol.js"; // registers the hillium:// scheme before ready
import { registerProtocol, PAGES } from "./protocol.js";
import { setupSessions, applyNetwork, sessions, blockedCount } from "./sessions.js";
import { startAdblock, getBlocker } from "./adblock.js";
import { Shell, icon, nativeGlass } from "./shell.js";
import { getSettings, updateSettings, getBookmarks, toggleBookmark, getHistory, saveSession, loadSession, siteOf, setSite, blockingOff } from "./store.js";
import { ensureModel, isModelReady, MODEL_NAME, TOTAL_BYTES, FILES } from "./model.js";
import { suggest } from "./suggest.js";
import { toUrl } from "./url.js";
import { createPagesApi } from "./pages.js";
import { setDownloadsListener, downloadAction } from "./downloads.js";

app.setName("Hillium");
// Its own folder: "Hillium" already holds the SearXNG install from searxng/install.sh.
app.setPath("userData", process.env.HILLIUM_USER_DATA || join(app.getPath("appData"), "Hillium Browser"));
// Hardening that costs nothing: no remote debugging, no background sync of anything.
app.commandLine.appendSwitch("disable-features", "MediaRouter,OptimizationHints,InterestFeedContentSuggestions");

if (!app.requestSingleInstanceLock()) app.quit();

const shells = new Set();
let ready = false;
let quitting = false;
const pendingUrls = []; // links from other apps that arrive before the first window

const focused = () => {
  const win = BaseWindow.getFocusedWindow();
  return [...shells].find((s) => s.win === win) ?? [...shells].at(-1);
};

function openWindow(entries) {
  const shell = new Shell({
    entries,
    hooks: { spawn: (e) => openWindow(e), broadcast },
    onClosed: (s) => {
      shells.delete(s);
      if (!quitting) persistSession();
    },
  });
  shells.add(shell);
  // Firefox and ungoogled-chromium's --close-confirmation: closing several tabs at once asks first.
  shell.win.on("close", (e) => {
    if (quitting || shell.confirmedClose) return;
    const count = shell.tabs.filter((t) => !t.pinned).length;
    if (count < 2) return;
    e.preventDefault();
    const answer = dialog.showMessageBoxSync({
      type: "question",
      buttons: [`Close ${count} Tabs`, "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: `Close this window and its ${count} tabs?`,
    });
    if (answer === 0) {
      shell.confirmedClose = true;
      shell.win.close();
    }
  });
  return shell;
}

function persistSession() {
  saveSession([...shells].flatMap((s) => s.sessionEntries()));
}

function broadcast() {
  for (const s of shells) s.push();
}

function refreshLook() {
  for (const s of shells) s.refreshLook();
  rebuildMenu();
}

// Links from other apps (Hillium as the default browser), Finder and the command line.
function openExternal(url) {
  if (!/^(https?:|file:)/i.test(url)) return;
  if (!ready) return void pendingUrls.push(url);
  const shell = focused() ?? openWindow();
  shell.createTab(url);
  shell.win.focus();
}
app.on("open-url", (e, url) => {
  e.preventDefault();
  openExternal(url);
});
app.on("open-file", (e, path) => {
  e.preventDefault();
  openExternal(pathToFileURL(path).href);
});

// Commands from the menu, the toolbar page and the ⌘K palette. Ones the page handles
// itself (address field, find bar, palette, popovers) are forwarded to it.
const PAGE_COMMANDS = new Set(["focus-address", "find", "palette", "share-qr", "escape", "site-info", "downloads-panel"]);

function run(command, arg, shell = focused()) {
  if (PAGE_COMMANDS.has(command)) {
    if (!shell) return;
    if (command === "focus-address" && getSettings().compact && getSettings().tabs === "top") applySettings({ compact: false });
    return shell.ui.webContents.send("command", command);
  }
  const wc = shell?.active?.view.webContents;
  switch (command) {
    case "new-window":
      return openWindow();
    case "new-tab":
      return shell ? shell.createTab(arg) : openWindow();
    case "new-private-tab":
      return (shell ?? openWindow()).createTab(undefined, { private: true });
    case "close-tab":
      return shell?.closeTab(arg);
    case "reopen-tab":
      return shell?.reopenTab();
    case "next-tab":
      return shell?.cycle(1);
    case "prev-tab":
      return shell?.cycle(-1);
    case "tab-index": {
      const tab = shell?.tabs[arg === 9 ? shell.tabs.length - 1 : arg - 1];
      return tab && shell.activate(tab.id);
    }
    case "pin-tab":
      return shell?.active && shell.setPinned(shell.activeId, !shell.active.pinned);
    case "mute-tab":
      return shell?.setMuted(shell.activeId);
    case "duplicate-tab":
      return shell?.duplicate(shell.activeId);
    case "back":
      return wc?.navigationHistory.canGoBack() && wc.navigationHistory.goBack();
    case "forward":
      return wc?.navigationHistory.canGoForward() && wc.navigationHistory.goForward();
    case "reload":
      return wc?.reload();
    case "hard-reload":
      return wc?.reloadIgnoringCache();
    case "stop":
      return wc?.stop();
    case "home":
      return wc?.loadURL("hillium://newtab/");
    case "bookmark":
      if (shell?.active && /^https?:/.test(shell.active.url)) toggleBookmark({ url: shell.active.url, title: shell.active.title });
      return broadcast();
    case "settings":
    case "history":
    case "bookmarks":
    case "downloads":
      return (shell ?? openWindow()).openPage(command);
    case "tabs-position":
      return applySettings({ tabs: getSettings().tabs === "side" ? "top" : "side" });
    case "compact":
      return applySettings({ compact: !getSettings().compact });
    case "bookmarks-bar":
      return applySettings({ bookmarksBar: !getSettings().bookmarksBar });
    case "assistant":
      return shell?.toggleAssistant();
    case "summarize":
      return shell?.ask({ kind: "summarize" });
    case "look":
      return shell?.ask({ kind: "look" });
    case "theme":
      return applySettings({ theme: arg });
    case "zoom-in":
      return shell?.setZoom(1);
    case "zoom-out":
      return shell?.setZoom(-1);
    case "zoom-reset":
      return shell?.setZoom(0);
    case "print":
      return wc?.print();
    case "save-page":
      return shell?.active && /^https?:/.test(shell.active.url) && wc.downloadURL(shell.active.url);
    case "view-source":
      return shell?.active && /^https?:/.test(shell.active.url) && shell.createTab(`view-source:${shell.active.url}`, { index: shell.tabs.indexOf(shell.active) + 1 });
    case "devtools":
      return wc?.toggleDevTools();
    case "win-min":
      return shell?.win.minimize();
    case "win-max":
      return shell && (shell.win.isMaximized() ? shell.win.unmaximize() : shell.win.maximize());
    case "win-close":
      return shell?.win.close();
  }
}

function rebuildMenu() {
  const s = getSettings();
  const item = (label, accelerator, command, arg) => ({ label, accelerator, click: () => run(command, arg) });
  const check = (label, accelerator, command, checked) => ({ ...item(label, accelerator, command), type: "checkbox", checked });
  const template = [
    {
      label: "Hillium",
      submenu: [
        { role: "about" },
        { type: "separator" },
        item("Settings…", "CmdOrCtrl+,", "settings"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        item("New Tab", "CmdOrCtrl+T", "new-tab"),
        item("New Window", "CmdOrCtrl+N", "new-window"),
        item("New Private Tab", "Shift+CmdOrCtrl+N", "new-private-tab"),
        { type: "separator" },
        item("Open Location…", "CmdOrCtrl+L", "focus-address"),
        item("Reopen Closed Tab", "Shift+CmdOrCtrl+T", "reopen-tab"),
        { type: "separator" },
        item("Close Tab", "CmdOrCtrl+W", "close-tab"),
        { label: "Close Window", accelerator: "Shift+CmdOrCtrl+W", click: () => focused()?.win.close() },
        { type: "separator" },
        item("Save Page As…", "CmdOrCtrl+S", "save-page"),
        item("Share Page as QR Code…", undefined, "share-qr"),
        { type: "separator" },
        item("Print…", "CmdOrCtrl+P", "print"),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
        { type: "separator" },
        item("Find…", "CmdOrCtrl+F", "find"),
      ],
    },
    {
      label: "View",
      submenu: [
        check("Always Show Bookmarks Bar", "Shift+CmdOrCtrl+B", "bookmarks-bar", s.bookmarksBar),
        check("Compact Mode", "Control+Alt+C", "compact", s.compact),
        check("Tabs on the Side", undefined, "tabs-position", s.tabs === "side"),
        {
          label: "Look",
          submenu: [
            ["normal", "Normal"],
            ["win98", "Windows 98"],
            ["glass", "Liquid Glass"],
          ].map(([id, label]) => ({ label, type: "radio", checked: s.theme === id, click: () => run("theme", id) })),
        },
        { type: "separator" },
        item("Stop", "CmdOrCtrl+.", "stop"),
        item("Reload This Page", "CmdOrCtrl+R", "reload"),
        item("Force Reload This Page", "Shift+CmdOrCtrl+R", "hard-reload"),
        { type: "separator" },
        item("Zoom In", "CmdOrCtrl+Plus", "zoom-in"),
        { ...item("Zoom In", "CmdOrCtrl+=", "zoom-in"), visible: false, acceleratorWorksWhenHidden: true },
        item("Zoom Out", "CmdOrCtrl+-", "zoom-out"),
        item("Actual Size", "CmdOrCtrl+0", "zoom-reset"),
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Developer",
          submenu: [item("View Source", "Alt+CmdOrCtrl+U", "view-source"), item("Developer Tools", "Alt+CmdOrCtrl+I", "devtools")],
        },
      ],
    },
    {
      label: "History",
      submenu: [
        item("Home", "Shift+CmdOrCtrl+H", "home"),
        item("Back", "CmdOrCtrl+[", "back"),
        item("Forward", "CmdOrCtrl+]", "forward"),
        { type: "separator" },
        item("Show All History", "CmdOrCtrl+Y", "history"),
      ],
    },
    {
      label: "Bookmarks",
      submenu: [item("Bookmark This Tab…", "CmdOrCtrl+D", "bookmark"), item("Bookmark Manager", "Alt+CmdOrCtrl+B", "bookmarks")],
    },
    {
      label: "Tools",
      submenu: [
        item("Downloads", "Shift+CmdOrCtrl+J", "downloads"),
        item("Commands…", "CmdOrCtrl+K", "palette"),
        { type: "separator" },
        item("Assistant", "Shift+CmdOrCtrl+A", "assistant"),
        item("Summarize Page", "Shift+CmdOrCtrl+U", "summarize"),
        item("Describe This Page", "Shift+CmdOrCtrl+L", "look"),
      ],
    },
    {
      label: "Tab",
      submenu: [
        item("Next Tab", "Control+Tab", "next-tab"),
        item("Previous Tab", "Shift+Control+Tab", "prev-tab"),
        { ...item("Next Tab", "Alt+CmdOrCtrl+Right", "next-tab"), visible: false, acceleratorWorksWhenHidden: true },
        { ...item("Previous Tab", "Alt+CmdOrCtrl+Left", "prev-tab"), visible: false, acceleratorWorksWhenHidden: true },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ ...item(`Tab ${n === 9 ? "(last)" : n}`, `CmdOrCtrl+${n}`, "tab-index", n), visible: false, acceleratorWorksWhenHidden: true })),
        { type: "separator" },
        item("Pin Tab", undefined, "pin-tab"),
        item("Mute Tab", undefined, "mute-tab"),
        item("Duplicate Tab", undefined, "duplicate-tab"),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function applySettings(patch) {
  const before = getSettings();
  const after = updateSettings(patch);
  const network = ["mode", "torPort", "proxyScheme", "proxyHost", "proxyPort", "blockWebRTC"].some((k) => before[k] !== after[k]);
  if (network) await applyNetwork();
  if (before.theme !== after.theme) refreshLook();
  else if (["tabs", "compact", "bookmarksBar"].some((k) => before[k] !== after[k])) rebuildMenu();
  if (before.restoreSession !== after.restoreSession) persistSession();
  broadcast();
  return after;
}

// Suggestions typed into the address bar may go to the local SearXNG only: never in private
// tabs, never through Tor or a proxy (loopback isn't proxied), never to the public fallback.
async function remoteSuggestions(text, isPrivate) {
  const s = getSettings();
  if (!s.searchSuggestions || isPrivate || s.mode !== "direct" || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(s.localSearch)) return [];
  try {
    const res = await fetch(`${s.localSearch.replace(/\/$/, "")}/autocompleter?q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(800) });
    const data = await res.json();
    const list = Array.isArray(data) ? data[1] : data?.suggestions ?? [];
    return (Array.isArray(list) ? list : []).filter((x) => typeof x === "string").slice(0, 5);
  } catch {
    return [];
  }
}

// --- IPC from Hillium's pages -------------------------------------------------

const isOwnPage = (frame) => frame?.url.startsWith("hillium://app/");

ipcMain.on("hillium", (e, command, arg) => {
  if (!isOwnPage(e.senderFrame)) return;
  const shell = [...shells].find((s) => s.owns(e.sender));
  if (!shell) return;
  switch (command) {
    case "ready":
      return shell.push();
    case "layout":
      return shell.setLayout(arg);
    case "overlay":
      return shell.setOverlay(arg);
    case "navigate":
      return shell.navigate(String(arg?.text ?? arg ?? ""), { newTab: Boolean(arg?.newTab) });
    case "activate":
      return shell.activate(arg);
    case "move-tab":
      return shell.moveTab(arg?.id, arg?.to);
    case "tab-menu":
      return shell.tabMenu(arg);
    case "pin":
      return shell.setPinned(arg?.id, Boolean(arg?.on));
    case "mute":
      return shell.setMuted(arg);
    case "find":
      if (arg?.text) shell.active?.view.webContents.findInPage(String(arg.text), { forward: arg.forward !== false, findNext: Boolean(arg.next) });
      return;
    case "stop-find":
      return shell.active?.view.webContents.stopFindInPage("clearSelection");
    case "assistant-close":
      return shell.toggleAssistant(false);
    case "focus-page":
      return shell.active?.view.webContents.focus();
    default:
      return run(command, arg, shell);
  }
});

ipcMain.handle("hillium", async (e, command, arg) => {
  if (!isOwnPage(e.senderFrame)) throw new Error("Not allowed");
  const shell = [...shells].find((s) => s.owns(e.sender));
  switch (command) {
    case "settings":
      return getSettings();
    case "set-settings":
      return applySettings(arg);
    case "search": {
      // ⌘K: open tabs, bookmarks and history matching the text.
      const q = String(arg ?? "").toLowerCase().trim();
      const match = (x) => !q || x.title?.toLowerCase().includes(q) || x.url.toLowerCase().includes(q);
      const tabs = [...shells].flatMap((s) => s.tabs.map((t) => ({ kind: "tab", id: t.id, title: t.title, url: t.url, private: t.private, own: s === shell }))).filter(match);
      return {
        tabs: tabs.slice(0, 8),
        bookmarks: getBookmarks().filter(match).slice(0, 8),
        history: getHistory().filter(match).slice(0, 12),
      };
    }
    case "suggest": {
      const isPrivate = Boolean(shell?.active?.private);
      const tabs = [...shells].flatMap((s) => s.tabs.filter((t) => t.id !== s.activeId && t.private === isPrivate).map((t) => ({ id: t.id, title: t.title, url: t.url, own: s === shell })));
      return suggest(String(arg ?? ""), {
        tabs,
        bookmarks: getBookmarks(),
        // Private tabs still get suggestions from saved history; they just never add to it.
        history: getHistory(),
        looksLikeUrl: (t) => !toUrl(t, getSettings())?.startsWith(getSettings().localSearch),
      });
    }
    case "suggest-remote":
      return remoteSuggestions(String(arg ?? "").slice(0, 200), Boolean(shell?.active?.private));
    case "site-info": {
      const tab = shell?.active;
      let origin = "";
      try {
        origin = /^https?:/.test(tab?.url) ? new URL(tab.url).origin : "";
      } catch {
        // Not a web page.
      }
      return {
        url: tab?.url ?? "",
        origin,
        private: Boolean(tab?.private),
        secure: Boolean(tab?.url.startsWith("https:")),
        site: origin ? siteOf(origin) : {},
        blocking: getSettings().adblock && !(origin && blockingOff(tab.url)),
        adblock: getSettings().adblock,
        blocked: tab ? blockedCount(tab.view.webContents.id) : 0,
      };
    }
    case "set-site":
      setSite(String(arg?.origin), String(arg?.key), arg?.value);
      if (arg?.key === "blocking") shell?.active?.view.webContents.reload();
      broadcast();
      return true;
    case "download-action":
      return downloadAction(String(arg?.action), arg?.id, sessions);
    case "remove-bookmark":
      if (getBookmarks().some((b) => b.url === arg)) toggleBookmark({ url: arg });
      broadcast();
      return getBookmarks();
    case "page-text":
      if (!shell) throw new Error("No window");
      return shell.pageText();
    case "capture":
      if (!shell) throw new Error("No window");
      return shell.capture();
    case "model-status":
      return { name: MODEL_NAME, ready: isModelReady(), total: TOTAL_BYTES, files: FILES };
    case "model-download": {
      const sender = e.sender;
      await ensureModel((p) => !sender.isDestroyed() && sender.send("model-progress", p));
      return { ready: isModelReady(), files: FILES };
    }
  }
  throw new Error(`Unknown command ${command}`);
});

// --- lifecycle --------------------------------------------------------------

app.on("second-instance", (_, argv) => {
  const urls = argv.slice(1).filter((a) => /^https?:\/\//i.test(a));
  if (urls.length) return urls.forEach(openExternal);
  const shell = focused() ?? openWindow();
  shell.win.focus();
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(icon());
  nativeTheme.themeSource = "system";
  // Light/dark or the system accent changed: every window and Hillium page follows.
  nativeTheme.on("updated", broadcast);
  await setupSessions((kind, id) => {
    if (kind === "blocked") {
      for (const s of shells) if (s.active?.view.webContents.id === id) s.push();
    } else broadcast();
  });
  setDownloadsListener(broadcast);

  const api = createPagesApi({ applySettings, broadcast, sessions });
  if (globalThis.__hillium) globalThis.__hillium.pages = api;
  registerProtocol(sessions.ui, ["app"], api);
  registerProtocol(sessions.ai, ["app", "models"], api); // "models": hillium://app/models/
  registerProtocol(sessions.tabs, PAGES, api);
  registerProtocol(sessions.private, PAGES, api);

  rebuildMenu();
  ready = true;
  const restored = loadSession();
  openWindow(restored.length ? restored : undefined);
  for (const url of pendingUrls.splice(0)) openExternal(url);
  for (const url of process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => /^https?:\/\//i.test(a))) openExternal(url);
  void startAdblock();
});

app.on("activate", () => {
  if (!shells.size) openWindow();
});

app.on("before-quit", () => {
  quitting = true;
  persistSession();
});

app.on("window-all-closed", () => {
  // Like other Mac browsers, Hillium stays running with no windows.
  if (process.platform !== "darwin") app.quit();
});

// Test hook: Playwright drives commands without synthesising menu shortcuts.
if (process.env.HILLIUM_TEST) {
  globalThis.__hillium = {
    run,
    shells,
    getSettings,
    setSettings: applySettings,
    history: getHistory,
    blockerReady: () => Boolean(getBlocker()),
    blocker: getBlocker,
    nativeGlass,
    ensureModel,
    openExternal,
    sessions: () => sessions,
  };
}
