// One browser window: the toolbar page (hillium://app/chrome.html) fills the window, the
// active tab's page sits in the rectangle the toolbar reports, and the assistant panel
// sits beside it. Only the active tab's view is attached; the rest stay alive off-screen.
import { BaseWindow, WebContentsView, Menu, clipboard, nativeImage, nativeTheme } from "electron";
import { fileURLToPath } from "node:url";
import { fallbackUrl } from "../../extension/lib.js";
import { sessions, blockedCount, resetBlocked, proxyStatus, noteLoadError, clearProxyError } from "./sessions.js";
import { getSettings, getBookmarks, toggleBookmark, addHistory, getFavicon, setFavicon, blockingOff } from "./store.js";
import { downloadSummary } from "./downloads.js";
import { accentColor } from "./pages.js";
import { EXTRACT } from "./page-text.js";
import { toUrl } from "./url.js";

export { toUrl };

export const PRELOAD = fileURLToPath(new URL("../preload/hillium.cjs", import.meta.url));
export const NEWTAB = "hillium://newtab/";

let liquidGlass = null;
try {
  liquidGlass = (await import("electron-liquid-glass")).default;
} catch {
  // Optional dependency: without it the Liquid Glass look uses macOS vibrancy.
}
export const nativeGlass = () => Boolean(liquidGlass?.isGlassSupported?.());
export const addNativeGlass = (win, cornerRadius) => liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius });

let nextTabId = 1;

const securePrefs = (extra) => ({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  safeDialogs: true,
  ...extra,
});

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
const FAVICON_MAX_BYTES = 96 * 1024;

export class Shell {
  // entries: [{ url, pinned }] to open. hooks: { spawn(entries), broadcast() } from main.
  constructor({ entries = [], onClosed, hooks }) {
    this.tabs = [];
    this.activeId = null;
    this.closedTabs = [];
    this.layout = { page: { x: 0, y: 80, width: 800, height: 600 }, panel: null };
    this.overlay = false;
    this.assistantOpen = false;
    this.assistant = null;
    this.glassId = null;
    this.hoverUrl = "";
    this.hooks = hooks;

    this.win = new BaseWindow({
      width: 1280,
      height: 840,
      minWidth: 560,
      minHeight: 380,
      title: "Hillium",
      show: false,
      // Transparent so the Liquid Glass look can put native glass behind the toolbar.
      transparent: true,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 13 },
    });
    this.ui = new WebContentsView({ webPreferences: securePrefs({ session: sessions.ui, preload: PRELOAD, spellcheck: false }) });
    this.ui.setBackgroundColor("#00000000");
    this.win.contentView.addChildView(this.ui);
    this.fitUi();
    this.guard(this.ui.webContents);
    this.ui.webContents.loadURL("hillium://app/chrome.html");
    this.ui.webContents.once("did-finish-load", () => {
      this.applyMaterial();
      this.win.show();
    });

    this.win.on("resize", () => this.fitUi());
    this.win.on("closed", () => {
      for (const tab of this.tabs) tab.view.webContents.close();
      this.assistant?.webContents.close();
      this.ui.webContents.close();
      onClosed(this);
    });

    for (const e of entries) this.createTab(e.url, { background: true, pinned: e.pinned });
    if (!this.tabs.some((t) => !t.pinned)) this.createTab(NEWTAB, { background: true });
    if (!this.activeId) this.activate(this.tabs.find((t) => !t.pinned)?.id ?? this.tabs[0].id);
  }

  // Hillium's own pages may never navigate away or open windows.
  guard(wc) {
    wc.on("will-navigate", (e, url) => {
      if (!url.startsWith("hillium://app/")) e.preventDefault();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) this.createTab(url);
      return { action: "deny" };
    });
  }

  fitUi() {
    const { width, height } = this.win.getContentBounds();
    this.ui.setBounds({ x: 0, y: 0, width, height });
    if (this.fullscreenTab) this.fullscreenTab.view.setBounds({ x: 0, y: 0, width, height });
  }

  get active() {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  owns(wc) {
    return wc === this.ui.webContents || wc === this.assistant?.webContents;
  }

  tab(id) {
    return this.tabs.find((t) => t.id === id);
  }

  get pinnedCount() {
    return this.tabs.filter((t) => t.pinned).length;
  }

  // --- tabs -----------------------------------------------------------------

  createTab(url = NEWTAB, { private: isPrivate = false, background = false, index, pinned = false } = {}) {
    const view = new WebContentsView({
      webPreferences: securePrefs({ session: isPrivate ? sessions.private : sessions.tabs, spellcheck: true }),
    });
    const tab = { id: nextTabId++, view, private: isPrivate, pinned: pinned && !isPrivate, title: "New Tab", url, favicon: "", loading: true, audible: false, muted: false };
    const wc = view.webContents;
    // hillium:// pages may link to each other; web pages may not reach them at all.
    const fromOwnPage = () => wc.getURL().startsWith("hillium://");

    wc.on("page-title-updated", (_, title) => {
      tab.title = title;
      if (!tab.private) addHistory({ url: tab.url, title });
      this.push();
    });
    wc.on("page-favicon-updated", (_, favicons) => {
      const icon = favicons.find((f) => /^(https?|data):/.test(f));
      if (icon) void this.cacheFavicon(tab, icon);
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      this.push();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      this.push();
    });
    // The new tab page is transparent so the window's look shows through; everything else,
    // error pages included, gets an opaque background. Set when a navigation starts, since a
    // failed one never commits.
    wc.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) view.setBackgroundColor(this.backgroundFor(details.url));
    });
    wc.on("did-navigate", (_, navUrl) => {
      tab.url = navUrl;
      tab.favicon = tab.private ? "" : getFavicon(hostOf(navUrl));
      resetBlocked(wc.id);
      clearProxyError();
      if (!tab.private) addHistory({ url: navUrl, title: wc.getTitle() });
      this.push();
    });
    wc.on("did-navigate-in-page", (_, navUrl, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = navUrl;
      if (!tab.private) addHistory({ url: navUrl, title: wc.getTitle() });
      this.push();
    });
    wc.on("did-fail-load", (_, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      // Local SearXNG isn't running: the same search goes to the public instance.
      const fallback = fallbackUrl(failedUrl, getSettings());
      if (fallback) return void wc.loadURL(fallback);
      // Show the address that failed, like other browsers, so it can be retried or edited.
      tab.url = failedUrl;
      noteLoadError(code);
      this.push();
    });
    wc.on("will-navigate", (e, target) => {
      if (target.startsWith("hillium:") && !fromOwnPage()) e.preventDefault();
    });
    wc.on("will-frame-navigate", (e) => {
      if (!e.isMainFrame && e.url.startsWith("hillium:")) e.preventDefault();
    });
    wc.on("will-redirect", (e, target) => {
      if (target.startsWith("hillium:")) e.preventDefault();
    });
    wc.on("audio-state-changed", (e) => {
      tab.audible = e.audible;
      this.push();
    });
    wc.on("update-target-url", (_, target) => {
      if (tab.id !== this.activeId) return;
      this.hoverUrl = target;
      this.push();
    });
    wc.on("found-in-page", (_, result) => this.ui.webContents.send("found", result));
    wc.setWindowOpenHandler(({ url: target, disposition }) => {
      if (/^https?:/.test(target) || (target.startsWith("hillium:") && fromOwnPage())) {
        const at = this.tabs.indexOf(tab) + 1;
        this.createTab(target, { private: tab.private, background: disposition === "background-tab", index: at });
      }
      return { action: "deny" };
    });
    wc.on("context-menu", (_, params) => this.contextMenu(tab, params));
    wc.on("enter-html-full-screen", () => {
      this.fullscreenTab = tab;
      this.win.setFullScreen(true);
      this.fitUi();
    });
    wc.on("leave-html-full-screen", () => {
      this.fullscreenTab = null;
      this.win.setFullScreen(false);
      this.place();
    });

    view.setBackgroundColor(this.backgroundFor(url));
    // Pinned tabs come first; others never go in front of them.
    const at = tab.pinned ? this.pinnedCount : index == null ? this.tabs.length : Math.max(index, this.pinnedCount);
    this.tabs.splice(at, 0, tab);
    wc.loadURL(url).catch(() => {});
    if (!background || !this.activeId) this.activate(tab.id);
    else this.push();
    return tab;
  }

  backgroundFor(url) {
    if (url.startsWith(NEWTAB)) return "#00000000";
    if (url.startsWith("hillium:")) return nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ffffff";
    return "#ffffff";
  }

  // The site's icon, copied once from the HTTP cache into favicons.json as a data: URL, so the
  // tab strip, history and the new tab page never fetch it again.
  async cacheFavicon(tab, iconUrl) {
    if (tab.private) return;
    const host = hostOf(tab.url);
    if (!host) return;
    let dataUrl = iconUrl.startsWith("data:") ? iconUrl : "";
    if (!dataUrl) {
      try {
        const res = await tab.view.webContents.session.fetch(iconUrl, { cache: "force-cache" });
        const type = res.headers.get("content-type")?.split(";")[0] ?? "";
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!res.ok || !/^image\//.test(type) || bytes.length > FAVICON_MAX_BYTES) return;
        dataUrl = `data:${type};base64,${bytes.toString("base64")}`;
      } catch {
        return;
      }
    }
    if (dataUrl.length > FAVICON_MAX_BYTES * 1.4 || hostOf(tab.url) !== host) return;
    setFavicon(host, dataUrl);
    tab.favicon = dataUrl;
    this.push();
  }

  activate(id) {
    const next = this.tab(id);
    if (!next) return;
    const previous = this.active;
    if (previous && previous !== next) this.win.contentView.removeChildView(previous.view);
    this.activeId = id;
    this.hoverUrl = "";
    this.stack();
    this.place();
    if (!this.overlay) next.view.webContents.focus();
    this.push();
  }

  closeTab(id = this.activeId) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [tab] = this.tabs.splice(i, 1);
    if (!tab.private) this.closedTabs.push({ url: tab.url, pinned: tab.pinned, index: i });
    this.win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (!this.tabs.length) return void this.win.close();
    if (id === this.activeId) {
      this.activeId = null;
      this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    } else this.push();
  }

  // focusId: the tab to show if the active one is among those closed.
  closeTabs(ids, focusId) {
    const keep = this.tabs.filter((t) => !ids.includes(t.id));
    if (!keep.length) return;
    if (!keep.some((t) => t.id === this.activeId)) this.activate(keep.find((t) => t.id === focusId)?.id ?? keep.at(-1).id);
    for (const id of ids) this.closeTab(id);
  }

  reopenTab() {
    const closed = this.closedTabs.pop();
    if (closed) this.createTab(closed.url, { pinned: closed.pinned, index: closed.index });
  }

  cycle(step) {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
    if (next) this.activate(next.id);
  }

  moveTab(id, to) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0 || to < 0 || to >= this.tabs.length) return;
    const [tab] = this.tabs.splice(i, 1);
    const pinned = this.pinnedCount;
    this.tabs.splice(tab.pinned ? Math.min(to, pinned) : Math.max(to, pinned), 0, tab);
    this.push();
  }

  setPinned(id, on) {
    const tab = this.tab(id);
    if (!tab || tab.private || tab.pinned === on) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    tab.pinned = on;
    this.tabs.splice(this.pinnedCount, 0, tab);
    this.push();
  }

  setMuted(id, on) {
    const tab = this.tab(id);
    if (!tab) return;
    tab.muted = on ?? !tab.muted;
    tab.view.webContents.setAudioMuted(tab.muted);
    this.push();
  }

  duplicate(id) {
    const tab = this.tab(id);
    if (tab) this.createTab(tab.url, { private: tab.private, index: this.tabs.indexOf(tab) + 1 });
  }

  moveToNewWindow(id) {
    const tab = this.tab(id);
    if (!tab || this.tabs.length < 2 || tab.private) return;
    const url = tab.url;
    this.closeTab(id);
    this.hooks.spawn([{ url, pinned: false }]);
  }

  // Opens one of Hillium's own pages, or switches to it if it's already open here.
  openPage(host) {
    const open = this.tabs.find((t) => t.url.startsWith(`hillium://${host}/`));
    if (open) return this.activate(open.id);
    const blank = this.active?.url.startsWith(NEWTAB) && !this.active.private ? this.active : null;
    if (blank) return void blank.view.webContents.loadURL(`hillium://${host}/`);
    this.createTab(`hillium://${host}/`);
  }

  navigate(text, { newTab = false } = {}) {
    const url = toUrl(text, getSettings());
    if (!url) return;
    if (newTab || !this.active) return void this.createTab(url, { private: Boolean(this.active?.private) });
    this.active.view.webContents.loadURL(url).catch(() => {});
    this.active.view.webContents.focus();
  }

  tabMenu(id) {
    const tab = this.tab(id);
    if (!tab) return;
    const i = this.tabs.indexOf(tab);
    const after = this.tabs.slice(i + 1).filter((t) => !t.pinned);
    const others = this.tabs.filter((t) => t !== tab && !t.pinned);
    const bookmarked = getBookmarks().some((b) => b.url === tab.url);
    const side = getSettings().tabs === "side";
    const web = /^https?:/.test(tab.url);
    Menu.buildFromTemplate([
      { label: "New Tab", click: () => this.createTab(NEWTAB, { index: i + 1 }) },
      { type: "separator" },
      { label: "Reload", click: () => tab.view.webContents.reload() },
      { label: "Duplicate", click: () => this.duplicate(id) },
      { label: tab.pinned ? "Unpin Tab" : "Pin Tab", enabled: !tab.private, click: () => this.setPinned(id, !tab.pinned) },
      { label: tab.muted ? "Unmute Tab" : "Mute Tab", click: () => this.setMuted(id) },
      { type: "separator" },
      {
        label: bookmarked ? "Remove Bookmark" : "Bookmark Tab",
        enabled: web,
        click: () => {
          toggleBookmark({ url: tab.url, title: tab.title });
          this.hooks.broadcast();
        },
      },
      { label: "Copy Link", enabled: web, click: () => clipboard.writeText(tab.url) },
      { label: "Move to New Window", enabled: this.tabs.length > 1 && !tab.private, click: () => this.moveToNewWindow(id) },
      { type: "separator" },
      { label: "Close Tab", click: () => this.closeTab(id) },
      { label: "Close Other Tabs", enabled: others.length > 0, click: () => this.closeTabs(others.map((t) => t.id), id) },
      { label: side ? "Close Tabs Below" : "Close Tabs to the Right", enabled: after.length > 0, click: () => this.closeTabs(after.map((t) => t.id)) },
      { type: "separator" },
      { label: "Reopen Closed Tab", enabled: this.closedTabs.length > 0, click: () => this.reopenTab() },
    ]).popup({ window: this.win });
  }

  // --- layout ---------------------------------------------------------------

  // Bottom to top: toolbar page, active tab, assistant. During an overlay (⌘K, menus,
  // the address suggestions) the toolbar page goes on top: its clear parts show the page beneath.
  stack() {
    const views = this.win.contentView;
    const tab = this.active;
    if (this.overlay) {
      views.addChildView(this.ui);
      return;
    }
    if (tab) views.addChildView(tab.view);
    if (this.assistant && this.assistantOpen) views.addChildView(this.assistant);
  }

  setLayout(layout) {
    const ok = (r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite);
    if (!ok(layout?.page)) return;
    this.layout = { page: layout.page, panel: ok(layout.panel) ? layout.panel : null, radius: Number(layout.radius) || 0, buttons: layout.buttons !== false };
    this.place();
    this.showWindowButtons();
  }

  place() {
    if (this.fullscreenTab) return;
    const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) });
    this.active?.view.setBounds(round(this.layout.page));
    // The toolbar page reports the page card's corner radius for the current look.
    this.active?.view.setBorderRadius?.(Math.min(16, Math.max(0, Math.round(this.layout.radius ?? 0))));
    if (this.assistant && this.layout.panel) this.assistant.setBounds(round(this.layout.panel));
  }

  setOverlay(open) {
    this.overlay = Boolean(open);
    if (!this.overlay) this.win.contentView.addChildView(this.ui, 0);
    this.stack();
    if (this.overlay) this.ui.webContents.focus();
    else this.active?.view.webContents.focus();
  }

  toggleAssistant(force) {
    this.assistantOpen = force ?? !this.assistantOpen;
    if (this.assistantOpen && !this.assistant) {
      this.assistant = new WebContentsView({ webPreferences: securePrefs({ session: sessions.ai, preload: PRELOAD, spellcheck: true }) });
      this.assistant.setBackgroundColor("#00000000");
      this.guard(this.assistant.webContents);
      this.assistant.webContents.on("did-finish-load", () => this.push());
      this.assistant.webContents.loadURL("hillium://app/assistant.html");
    }
    if (this.assistantOpen) this.stack();
    else if (this.assistant) this.win.contentView.removeChildView(this.assistant);
    this.push();
    if (this.assistantOpen) setTimeout(() => this.assistant?.webContents.focus(), 50);
  }

  ask(action) {
    this.toggleAssistant(true);
    const send = () => this.assistant.webContents.send("ask", action);
    if (this.assistant.webContents.isLoading()) this.assistant.webContents.once("did-finish-load", send);
    else send();
  }

  // --- look -----------------------------------------------------------------

  // Liquid Glass puts native NSGlassEffectView glass (macOS 26+) behind the window's
  // content, or vibrancy on older macOS. The glass can't be removed once added, so the
  // other looks simply paint over it.
  applyMaterial() {
    const glass = getSettings().theme === "glass";
    this.showWindowButtons();
    if (glass && nativeGlass()) {
      if (this.glassId == null) {
        this.glassId = addNativeGlass(this.win, 0);
      }
    } else this.win.setVibrancy(glass ? "under-window" : null);
  }

  // Windows 98 draws its own caption buttons; compact mode hides them with the sidebar.
  showWindowButtons() {
    this.win.setWindowButtonVisibility(this.win.isFullScreen() || (getSettings().theme !== "win98" && this.layout.buttons !== false));
  }

  // --- page tools -----------------------------------------------------------

  async pageText() {
    const tab = this.active;
    if (!tab) throw new Error("No page is open.");
    if (tab.private) throw new Error("Private tabs are never read by the assistant.");
    if (!/^https?:/.test(tab.url)) throw new Error("Open a web page first.");
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: EXTRACT }]);
  }

  async capture() {
    const tab = this.active;
    if (!tab) throw new Error("No page is open.");
    if (tab.private) throw new Error("Private tabs are never read by the assistant.");
    let image = await tab.view.webContents.capturePage();
    const { width } = image.getSize();
    if (width > 1024) image = image.resize({ width: 1024, quality: "good" });
    return { jpeg: image.toJPEG(82), title: tab.title, url: tab.url };
  }

  contextMenu(tab, p) {
    const wc = tab.view.webContents;
    const items = [];
    const newTab = (url, opts) => this.createTab(url, { private: tab.private, background: true, index: this.tabs.indexOf(tab) + 1, ...opts });
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      items.push(
        { label: "Open Link in New Tab", click: () => newTab(p.linkURL) },
        { label: "Open Link in New Window", enabled: !tab.private, click: () => this.hooks.spawn([{ url: p.linkURL, pinned: false }]) },
        { label: "Open Link in Private Tab", click: () => this.createTab(p.linkURL, { private: true }) },
        { type: "separator" },
        { label: "Save Link As…", click: () => wc.downloadURL(p.linkURL) },
        { label: "Copy Link", click: () => clipboard.writeText(p.linkURL) },
        { type: "separator" },
      );
    }
    if (p.mediaType === "image" && p.srcURL) {
      items.push(
        { label: "Open Image in New Tab", click: () => newTab(p.srcURL) },
        { label: "Save Image As…", click: () => wc.downloadURL(p.srcURL) },
        { label: "Copy Image", click: () => wc.copyImageAt(p.x, p.y) },
        { label: "Copy Image Address", click: () => clipboard.writeText(p.srcURL) },
        { type: "separator" },
      );
    }
    if (p.selectionText && !p.isEditable) {
      const short = p.selectionText.trim().slice(0, 24) + (p.selectionText.trim().length > 24 ? "…" : "");
      items.push(
        { role: "copy" },
        { label: `Search for “${short}”`, click: () => newTab(toUrl(p.selectionText, getSettings()), { background: false }) },
        { label: "Ask Assistant About Selection", enabled: !tab.private, click: () => this.ask({ kind: "selection", text: p.selectionText.slice(0, 4000) }) },
        { type: "separator" },
      );
    }
    if (p.isEditable) {
      for (const s of p.dictionarySuggestions ?? []) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (p.misspelledWord) items.push({ label: "Add to Dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
      items.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }, { type: "separator" });
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable && p.mediaType !== "image") {
      items.push(
        { label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: "Reload", click: () => wc.reload() },
        { type: "separator" },
        { label: "Save Page As…", enabled: /^https?:/.test(tab.url), click: () => wc.downloadURL(tab.url) },
        { label: "Print…", click: () => wc.print() },
        { label: "View Page Source", enabled: /^https?:/.test(tab.url), click: () => newTab(`view-source:${tab.url}`, { background: false }) },
        { type: "separator" },
        { label: "Summarize Page", enabled: !tab.private && /^https?:/.test(tab.url), click: () => this.ask({ kind: "summarize" }) },
        { type: "separator" },
      );
    }
    items.push({ label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // --- state ----------------------------------------------------------------

  snapshot() {
    const tab = this.active;
    const wc = tab?.view.webContents;
    const s = getSettings();
    return {
      tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading, private: t.private, pinned: t.pinned, audible: t.audible, muted: t.muted })),
      activeId: this.activeId,
      url: tab?.url.startsWith(NEWTAB) ? "" : tab?.url ?? "",
      canBack: wc?.navigationHistory.canGoBack() ?? false,
      canForward: wc?.navigationHistory.canGoForward() ?? false,
      bookmarked: Boolean(tab && getBookmarks().some((b) => b.url === tab.url)),
      blocked: wc ? blockedCount(wc.id) : 0,
      blockingOff: Boolean(tab && blockingOff(tab.url)),
      hoverUrl: this.hoverUrl,
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
      status: proxyStatus(),
      assistantOpen: this.assistantOpen,
      fullscreen: this.win.isFullScreen(),
      accent: accentColor(),
      downloads: downloadSummary(),
      bookmarks: s.bookmarksBar ? getBookmarks().slice(0, 40).map((b) => ({ title: b.title, url: b.url, icon: getFavicon(hostOf(b.url)) })) : [],
      settings: {
        theme: s.theme,
        tabs: s.tabs,
        compact: s.compact,
        bookmarksBar: s.bookmarksBar,
        mode: s.mode,
        adblock: s.adblock,
        searchSuggestions: s.searchSuggestions,
      },
      nativeGlass: nativeGlass(),
    };
  }

  // Coalesced: many page events in one tick send one update.
  push() {
    if (this.pushQueued) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (this.ui.webContents.isDestroyed()) return;
      const state = this.snapshot();
      this.ui.webContents.send("state", state);
      if (this.assistant && !this.assistant.webContents.isDestroyed()) this.assistant.webContents.send("state", state);
    });
  }

  // Theme change: the window material, the toolbar, and every Hillium page follow.
  refreshLook() {
    this.applyMaterial();
    this.place();
    for (const t of this.tabs) if (t.url.startsWith("hillium://")) t.view.webContents.reload();
    this.push();
  }

  sessionEntries() {
    return this.tabs.filter((t) => !t.private && /^https?:/.test(t.url)).map((t) => ({ url: t.url, pinned: t.pinned }));
  }

  setZoom(delta) {
    const wc = this.active?.view.webContents;
    if (!wc) return;
    const levels = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    const now = wc.getZoomFactor();
    const i = levels.findIndex((l) => l >= now - 0.001);
    wc.setZoomFactor(delta === 0 ? 1 : levels[Math.max(0, Math.min(levels.length - 1, (i < 0 ? 5 : i) + delta))]);
    this.push();
  }
}

export const icon = () => nativeImage.createFromPath(fileURLToPath(new URL("../../branding/logo-512.png", import.meta.url)));
