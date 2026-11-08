// The toolbar page: tabs, address field and its suggestions, menus, ⌘K, the site panel,
// downloads and the find bar. It owns no browsing state; main sends a snapshot on every
// change and this page draws it, then reports where the web page and the assistant panel
// should sit.
import qrcodegen from "./vendor/qrcodegen/qrcodegen.js";

const api = window.hillium;
const $ = (id) => document.getElementById(id);
const body = document.body;
let state = null;
let overlay = null; // the open popover element
let revealed = false; // compact mode: the sidebar slid in over the page
let floating = false; // Zen layout: the address field floats over the page while in use
let suggestOpen = false; // the address suggestions are showing
let topmost = false; // this page is above the web page
let lastLayout = "";

const COMMANDS = [
  ["New Tab", "new-tab", "⌘T"],
  ["New Window", "new-window", "⌘N"],
  ["New Private Tab", "new-private-tab", "⇧⌘N"],
  ["Reopen Closed Tab", "reopen-tab", "⇧⌘T"],
  ["Pin or Unpin Tab", "pin-tab", ""],
  ["Mute or Unmute Tab", "mute-tab", ""],
  ["Duplicate Tab", "duplicate-tab", ""],
  ["Bookmark This Tab", "bookmark", "⌘D"],
  ["History", "history", "⌘Y"],
  ["Bookmarks", "bookmarks", "⌥⌘B"],
  ["Downloads", "downloads", "⇧⌘J"],
  ["Settings", "settings", "⌘,"],
  ["Find in Page", "find", "⌘F"],
  ["Print", "print", "⌘P"],
  ["Save Page As", "save-page", "⌘S"],
  ["Share Page as QR Code", "share-qr", ""],
  ["Compact Mode", "compact", "⌃⌥C"],
  ["Bookmarks Bar", "bookmarks-bar", "⇧⌘B"],
  ["Tabs on the Side or Top", "tabs-position", ""],
  ["Look: Normal", "theme:normal", ""],
  ["Look: Windows 98", "theme:win98", ""],
  ["Look: Liquid Glass", "theme:glass", ""],
  ["Assistant", "assistant", "⇧⌘A"],
  ["Summarize Page", "summarize", "⇧⌘U"],
  ["Describe This Page", "look", "⇧⌘L"],
  ["View Page Source", "view-source", "⌥⌘U"],
  ["Developer Tools", "devtools", "⌥⌘I"],
];

// --- commands ---------------------------------------------------------------

function command(cmd, source) {
  if (cmd.startsWith("theme:")) return setSettings({ theme: cmd.slice(6) });
  switch (cmd) {
    case "focus-address":
      closeOverlay();
      if (state?.settings.compact && body.dataset.layout === "zen") reveal(true);
      $("address").focus();
      $("address").select();
      return;
    case "find":
      closeOverlay();
      return openFind();
    case "palette":
      return openPalette("");
    case "share-qr":
      return openQr();
    case "site-info":
      return openSiteInfo(source);
    case "downloads-panel":
      return openDownloads(source);
    case "escape":
      return closeOverlay();
    case "zoom-in":
    case "zoom-out":
    case "zoom-reset":
      // Keeps the menu open, like Chrome's zoom row.
      return api.send(cmd);
    default:
      closeOverlay();
      reveal(false);
      api.send(cmd);
  }
}

api.on("command", (cmd) => command(cmd));
document.addEventListener("click", (e) => {
  const menu = e.target.closest("[data-menu]");
  if (menu) return overlay === $("menu") ? closeOverlay() : openOverlay($("menu"), { anchor: menu });
  const el = e.target.closest("[data-cmd]");
  if (el) {
    e.preventDefault();
    command(el.dataset.cmd, el);
  }
});

// --- state ------------------------------------------------------------------

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

function faviconEl(tab) {
  const el = document.createElement("span");
  el.className = "tab-icon";
  if (tab.loading) el.classList.add("loading");
  else if (tab.private) el.innerHTML = icon("mask");
  else if (tab.favicon) {
    const img = document.createElement("img");
    img.src = tab.favicon;
    img.alt = "";
    img.onerror = () => (el.innerHTML = icon("globe"));
    el.append(img);
  } else el.innerHTML = icon(tab.url.startsWith("hillium:") ? "file" : "globe");
  return el;
}

function tabElement(tab, kind) {
  const el = document.createElement("div");
  el.className = `tab ${kind}`;
  el.role = "tab";
  el.draggable = true;
  el.dataset.id = tab.id;
  el.title = `${tab.title}${tab.url.startsWith("hillium:") ? "" : `\n${tab.url}`}`;
  el.setAttribute("aria-selected", String(tab.id === state.activeId));
  el.classList.toggle("private", tab.private);
  el.classList.toggle("pinned", tab.pinned);
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || hostOf(tab.url) || "New Tab";
  el.append(faviconEl(tab));
  if (kind !== "essential") el.append(title);
  if (tab.audible || tab.muted) {
    const audio = document.createElement("button");
    audio.className = "tab-audio";
    audio.title = tab.muted ? "Unmute tab" : "Mute tab";
    audio.setAttribute("aria-label", audio.title);
    audio.innerHTML = icon(tab.muted ? "muted" : "speaker");
    audio.addEventListener("click", (e) => {
      e.stopPropagation();
      api.send("mute", tab.id);
    });
    el.append(audio);
  }
  if (!tab.pinned) {
    const close = document.createElement("button");
    close.className = "tab-close";
    close.setAttribute("aria-label", `Close ${title.textContent}`);
    close.innerHTML = icon("close");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      api.send("close-tab", tab.id);
    });
    el.append(close);
  }
  el.addEventListener("mousedown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      api.send("close-tab", tab.id);
    } else if (e.button === 0 && !e.target.closest(".tab-close, .tab-audio")) api.send("activate", tab.id);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    api.send("tab-menu", tab.id);
  });
  el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/hillium-tab", String(tab.id)));
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = Number(e.dataTransfer.getData("text/hillium-tab"));
    const dragged = state.tabs.find((t) => t.id === id);
    if (!dragged || id === tab.id) return;
    if (dragged.pinned !== tab.pinned) api.send("pin", { id, on: tab.pinned });
    api.send("move-tab", { id, to: state.tabs.findIndex((t) => t.id === tab.id) });
  });
  return el;
}

// Dropping a tab on the pinned grid pins it; dropping a pinned one on the list unpins it.
for (const [id, on] of [["essentials", true], ["sidetabs", false]]) {
  $(id).addEventListener("dragover", (e) => e.preventDefault());
  $(id).addEventListener("drop", (e) => {
    e.preventDefault();
    const tabId = Number(e.dataTransfer.getData("text/hillium-tab"));
    if (tabId) api.send("pin", { id: tabId, on });
  });
}

function render(next) {
  state = next;
  const s = state.settings;
  const active = state.tabs.find((t) => t.id === state.activeId);
  const zen = s.tabs === "side" && s.theme !== "win98";
  body.dataset.theme = s.theme;
  body.dataset.tabs = s.tabs;
  body.dataset.layout = zen ? "zen" : "classic";
  body.dataset.nativeGlass = String(state.nativeGlass);
  body.toggleAttribute("data-compact", s.compact);
  body.toggleAttribute("data-assistant", state.assistantOpen);
  body.toggleAttribute("data-private", Boolean(active?.private));
  body.toggleAttribute("data-fullscreen", state.fullscreen);
  if (state.accent && s.theme !== "win98") document.documentElement.style.setProperty("--accent", state.accent);
  else document.documentElement.style.removeProperty("--accent");
  placeToolbar(zen);
  if (!s.compact && revealed) reveal(false);

  const pinned = state.tabs.filter((t) => t.pinned);
  const rest = state.tabs.filter((t) => !t.pinned);
  $("tabstrip").replaceChildren(...pinned.map((t) => tabElement(t, "strip")), ...rest.map((t) => tabElement(t, "strip")));
  $("essentials").replaceChildren(...pinned.map((t) => tabElement(t, "essential")));
  $("essentials").hidden = !pinned.length;
  $("sidetabs").replaceChildren(...rest.map((t) => tabElement(t, "vertical")));
  for (const strip of [$("tabstrip"), $("sidetabs")]) strip.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });

  $("back").disabled = !state.canBack;
  $("forward").disabled = !state.canForward;
  const loading = Boolean(active?.loading);
  $("reload").dataset.cmd = loading ? "stop" : "reload";
  $("reload").querySelector("use").setAttribute("href", loading ? "#i-stop" : "#i-reload");
  $("reload").querySelector(".label").textContent = loading ? "Stop" : "Refresh";
  $("reload").title = loading ? "Stop loading (⌘.)" : "Reload (⌘R)";

  const address = $("address");
  if (document.activeElement !== address) address.value = displayUrl(state.url);
  const secure = state.url.startsWith("https:");
  const own = state.url.startsWith("hillium:") || state.url.startsWith("view-source:");
  $("site").querySelector("use").setAttribute("href", !state.url ? "#i-search" : own ? "#i-info" : secure ? "#i-lock" : "#i-warn");
  $("site").title = !state.url ? "" : own ? "Hillium page" : secure ? `Connection to ${hostOf(state.url)} is secure` : `Connection to ${hostOf(state.url)} is not secure`;
  $("site").classList.toggle("insecure", Boolean(state.url) && !secure && !own);
  $("star").classList.toggle("on", state.bookmarked);
  $("star").disabled = !/^https?:/.test(state.url);
  $("qr-btn").disabled = !/^https?:/.test(state.url);
  $("zoom-chip").hidden = state.zoom === 100;
  $("zoom-chip").textContent = `${state.zoom}%`;
  $("zoom-level").textContent = `${state.zoom}%`;

  const blocked = $("blocked");
  const blocking = s.adblock && !state.blockingOff;
  blocked.hidden = !state.blocked || !blocking;
  blocked.textContent = state.blocked > 99 ? "99+" : String(state.blocked);
  $("shield").title = !s.adblock ? "Blocking is off" : state.blockingOff ? "Blocking is off for this site" : `${state.blocked} ads and trackers blocked on this page`;
  $("shield").querySelector("use").setAttribute("href", blocking ? "#i-shield" : "#i-shield-off");
  $("shield").classList.toggle("off", !blocking);

  const chip = $("mode-chip");
  chip.hidden = s.mode === "direct";
  chip.textContent = s.mode === "tor" ? "Tor" : "Proxy";
  chip.classList.toggle("error", Boolean(state.status));
  $("ai-btn").classList.toggle("on", state.assistantOpen);

  drawDownloads();
  drawBookmarksBar();

  const banner = $("banner");
  banner.hidden = !state.status;
  banner.textContent = state.status;

  $("caption-title").textContent = active ? `${active.title || "New Tab"} - Hillium` : "Hillium";
  document.title = active?.title || "Hillium";
  $("status-text").textContent = state.hoverUrl || (loading ? `Opening page ${hostOf(state.url)}…` : "Done");
  $("status-blocked").textContent = s.adblock ? `${state.blocked} blocked` : "Blocking off";
  $("status-zone").textContent = s.mode === "tor" ? "Tor" : s.mode === "proxy" ? "Proxy" : active?.private ? "Private" : "Internet";

  for (const b of document.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-pressed", String(b.dataset.themePick === s.theme));
  for (const b of document.querySelectorAll("[data-tabs-pick]")) b.setAttribute("aria-pressed", String(b.dataset.tabsPick === s.tabs));
  $("compact-item").setAttribute("aria-checked", String(s.compact));
  $("bar-item").setAttribute("aria-checked", String(s.bookmarksBar));
  $("panel-slot").hidden = !state.assistantOpen;
  if (overlay === $("dlpanel")) fillDownloads();
  queueLayout();
}

api.on("state", render);

// Like Chrome: no "https://" or trailing slash on a plain site address while it's not being
// edited. The Zen sidebar is narrow, so it shows only the site, like Zen does.
function displayUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (body.dataset.layout === "zen" && /^https?:$/.test(u.protocol)) return u.host.replace(/^www\./, "");
    if (u.protocol === "https:" && u.pathname === "/" && !u.search && !u.hash) return u.host;
  } catch {
    // Shown as it is.
  }
  return url;
}

// The Zen layout keeps the navigation buttons and address field at the top of the sidebar.
function placeToolbar(zen) {
  const toolbar = $("toolbar");
  const home = zen ? $("side-head") : $("top").parentNode;
  if (zen && toolbar.parentNode !== home) home.append(toolbar);
  if (!zen && toolbar.parentNode !== home) $("top").after(toolbar);
}

function drawDownloads() {
  const d = state.downloads;
  for (const b of document.querySelectorAll(".dl-btn")) {
    b.classList.toggle("active", d.active > 0);
    b.classList.toggle("has", d.recent.length > 0);
    b.style.setProperty("--p", d.progress < 0 ? 0.25 : d.progress);
    b.classList.toggle("unknown", d.progress < 0);
    b.title = d.active ? `${d.active} download${d.active > 1 ? "s" : ""} in progress` : "Downloads";
  }
}

let barKey = "";
function drawBookmarksBar() {
  const bar = $("bookmarks-bar");
  bar.hidden = !state.settings.bookmarksBar;
  const key = JSON.stringify(state.bookmarks);
  if (key === barKey) return;
  barKey = key;
  if (!state.bookmarks.length) {
    const empty = document.createElement("span");
    empty.className = "bar-empty";
    empty.textContent = "Bookmarks you add with ⌘D appear here.";
    return bar.replaceChildren(empty);
  }
  bar.replaceChildren(
    ...state.bookmarks.map((b) => {
      const el = document.createElement("button");
      el.className = "bar-item";
      el.title = `${b.title}\n${b.url}`;
      el.append(faviconEl({ favicon: b.icon, url: b.url }));
      const t = document.createElement("span");
      t.textContent = b.title || hostOf(b.url);
      el.append(t);
      el.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.send("new-tab", b.url);
        }
      });
      el.addEventListener("click", (e) => (e.metaKey ? api.send("new-tab", b.url) : api.send("navigate", b.url)));
      return el;
    }),
  );
}

// --- layout -----------------------------------------------------------------

function rectOf(el) {
  if (el.hidden || !el.offsetParent) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

let layoutQueued = false;
function queueLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    const slot = $("page-slot");
    const layout = {
      page: rectOf(slot),
      panel: rectOf($("panel-slot")),
      radius: parseFloat(getComputedStyle(slot).borderTopLeftRadius) || 0,
      // Compact Zen hides the window buttons along with the sidebar.
      buttons: !(body.dataset.layout === "zen" && state?.settings.compact && !revealed),
    };
    const key = JSON.stringify(layout);
    if (!layout.page || key === lastLayout) return;
    lastLayout = key;
    cutHoles(layout);
    api.send("layout", layout);
    if (floating) floatAddress(true);
  });
}
// The window background's holes for the page and the assistant (used while this page is on top).
function cutHoles(layout) {
  const rounded = ({ x, y, width: w, height: h }, r) =>
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  const panelRadius = parseFloat(getComputedStyle($("panel-slot")).borderTopLeftRadius) || 0;
  const parts = [`M0 0H${innerWidth}V${innerHeight}H0Z`, rounded(layout.page, layout.radius)];
  if (layout.panel) parts.push(rounded(layout.panel, panelRadius));
  body.style.setProperty("--holes", `path(evenodd, "${parts.join(" ")}")`);
}

new ResizeObserver(queueLayout).observe($("page-slot"));
new ResizeObserver(queueLayout).observe($("panel-slot"));
addEventListener("resize", queueLayout);

// --- above the page -----------------------------------------------------------

// Popovers, the slid-in sidebar and the floating address field all need this page on top
// of the web page; its clear parts let the page show through.
function syncTop() {
  const on = Boolean(overlay || revealed || floating || suggestOpen);
  if (on === topmost) return;
  topmost = on;
  body.toggleAttribute("data-overlay", on);
  api.send("overlay", on);
}

// Compact mode: the sidebar slides in when the pointer reaches the window's left edge.
function reveal(on) {
  if (on && (!state?.settings.compact || body.dataset.layout !== "zen")) return;
  if (revealed === on) return;
  revealed = on;
  body.toggleAttribute("data-reveal", on);
  syncTop();
  queueLayout();
}
document.addEventListener("mousemove", (e) => {
  if (!revealed && e.clientX <= 10) reveal(true);
});
$("sidebar").addEventListener("mouseleave", (e) => {
  if (!revealed || overlay || floating || e.relatedTarget?.closest?.(".popover")) return;
  reveal(false);
});

// --- address field and suggestions --------------------------------------------

let suggestions = [];
let suggestIndex = 0;
let inlineUrl = null; // the address the inline completion stands for
let typed = ""; // what the user typed, without the inline completion
let remoteTimer = 0;
let suggestSeq = 0;

// Zen: while in use, the address field floats in the middle of the page, wide enough to read.
function floatAddress(on) {
  if (body.dataset.layout !== "zen") on = false;
  floating = on;
  const box = $("omnibox");
  body.toggleAttribute("data-floating", on);
  if (on) {
    const page = $("page-slot").getBoundingClientRect();
    const width = Math.min(680, Math.max(360, page.width - 64));
    box.style.left = `${Math.round(page.left + (page.width - width) / 2)}px`;
    box.style.top = `${Math.round(page.top + Math.min(120, page.height * 0.16))}px`;
    box.style.width = `${Math.round(width)}px`;
    $("scrim").hidden = false;
    $("scrim").classList.add("dim");
  } else {
    box.style.left = box.style.top = box.style.width = "";
    if (!overlay) $("scrim").hidden = true;
  }
  syncTop();
}

$("address").addEventListener("focus", () => {
  typed = "";
  if ($("address").value === displayUrl(state?.url ?? "")) $("address").value = state?.url ?? "";
  floatAddress(true);
  // Don't select once typing has started, or the next key replaces the first letter.
  requestAnimationFrame(() => typed || $("address").select());
});
$("address").addEventListener("blur", () => {
  closeSuggest();
  if (floating) floatAddress(false);
  if (document.activeElement !== $("address")) $("address").value = displayUrl(state?.url ?? "");
  if (revealed && !$("sidebar").matches(":hover")) reveal(false);
});

$("address").addEventListener("input", async (e) => {
  const input = $("address");
  typed = input.value.slice(0, input.selectionStart ?? input.value.length);
  if (input.selectionStart === input.value.length) typed = input.value;
  const seq = ++suggestSeq;
  const result = await api.invoke("suggest", typed);
  if (seq !== suggestSeq) return;
  const deleting = e.inputType?.startsWith("delete");
  inlineUrl = null;
  // Inline completion, as in Chrome and Firefox; not while deleting.
  if (result.inline && !deleting && input.value === typed && result.inline.completion.toLowerCase().startsWith(typed.toLowerCase())) {
    input.value = result.inline.completion;
    input.setSelectionRange(typed.length, input.value.length);
    inlineUrl = result.inline.url;
  }
  suggestions = result.items;
  suggestIndex = 0;
  drawSuggest();
  clearTimeout(remoteTimer);
  if (state.settings.searchSuggestions && typed.trim()) {
    remoteTimer = setTimeout(async () => {
      const words = await api.invoke("suggest-remote", typed.trim());
      if (seq !== suggestSeq || !words.length) return;
      const seen = new Set(suggestions.filter((x) => x.kind === "search").map((x) => x.title.toLowerCase()));
      const extra = words.filter((w) => !seen.has(w.toLowerCase())).map((w) => ({ kind: "search", title: w, remote: true }));
      const at = suggestions.findIndex((x) => x.kind === "search") + 1;
      suggestions.splice(at, 0, ...extra.slice(0, 4));
      drawSuggest();
    }, 120);
  }
});

$("address").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (!$("suggest").hidden) return closeSuggest();
    $("address").value = displayUrl(state?.url ?? "");
    $("address").blur();
    api.send("focus-page");
  } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && suggestions.length) {
    e.preventDefault();
    suggestIndex = (suggestIndex + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
    const item = suggestions[suggestIndex];
    $("address").value = item.kind === "search" || item.kind === "go" ? item.title : item.url;
    inlineUrl = item.kind === "go" ? item.url : null;
    drawSuggest();
  }
});

$("omnibox").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("address").value.trim();
  if (!text) return;
  const item = suggestions[suggestIndex];
  // ⌘⏎ opens in a new tab, like Chrome and Firefox.
  const newTab = lastEnterMeta;
  lastEnterMeta = false;
  if (item?.kind === "tab" && $("address").value === item.url) pickSuggestion(suggestIndex, newTab);
  else api.send("navigate", { text: inlineUrl && text === $("address").value ? inlineUrl : text, newTab });
  $("address").blur();
});
let lastEnterMeta = false;
$("address").addEventListener("keydown", (e) => {
  if (e.key === "Enter") lastEnterMeta = e.metaKey;
});

function pickSuggestion(i, newTab = false) {
  const item = suggestions[i];
  if (!item) return;
  if (item.kind === "tab") api.send("activate", item.id);
  else api.send("navigate", { text: item.kind === "search" ? item.title : item.url ?? item.title, newTab });
  $("address").blur();
}

const KIND_ICON = { search: "search", go: "globe", tab: "tabs", bookmark: "star", history: "clock" };

function drawSuggest() {
  const list = $("suggest-list");
  if (!suggestions.length || !$("address").value.trim()) return closeSuggest();
  list.replaceChildren(
    ...suggestions.map((item, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.className = "suggest-item";
      li.setAttribute("aria-selected", String(i === suggestIndex));
      const ic = document.createElement("span");
      ic.className = "suggest-icon";
      ic.innerHTML = icon(KIND_ICON[item.kind]);
      const label = document.createElement("span");
      label.className = "suggest-label";
      label.textContent = item.title;
      const hint = document.createElement("span");
      hint.className = "suggest-hint";
      hint.textContent = item.kind === "tab" ? "Switch to tab" : item.kind === "search" ? (item.remote ? "" : "Search") : item.kind === "go" ? "" : hostOf(item.url);
      li.append(ic, label, hint);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickSuggestion(i, e.metaKey || e.button === 1);
      });
      return li;
    }),
  );
  const box = $("suggest");
  const r = $("omnibox").getBoundingClientRect();
  box.style.left = `${r.left}px`;
  box.style.top = `${r.bottom + 4}px`;
  box.style.width = `${Math.max(r.width, body.dataset.layout === "zen" && !floating ? 420 : 0)}px`;
  box.hidden = false;
  // No scrim: a click anywhere else just closes the list.
  suggestOpen = true;
  syncTop();
}

function closeSuggest() {
  $("suggest").hidden = true;
  suggestions = [];
  suggestOpen = false;
  syncTop();
}
document.addEventListener("mousedown", (e) => {
  if (!$("suggest").hidden && !e.target.closest("#suggest, #omnibox")) $("address").blur();
});

// --- popovers -----------------------------------------------------------------

// anchor: the button it hangs from (opens below it, or above when it's low in the window);
// none: centred with a dimmed scrim.
function openOverlay(el, { anchor } = {}) {
  if (overlay && overlay !== el) overlay.hidden = true;
  overlay = el;
  $("scrim").hidden = false;
  $("scrim").classList.toggle("dim", !anchor);
  el.hidden = false;
  el.style.top = el.style.bottom = el.style.left = el.style.right = "";
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    if (r.top > innerHeight / 2) el.style.bottom = `${innerHeight - r.top + 6}px`;
    else el.style.top = `${r.bottom + 6}px`;
    if (r.left < innerWidth / 2) el.style.left = `${Math.max(8, r.left)}px`;
    else el.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  }
  syncTop();
}

function closeOverlay() {
  if (!overlay) return;
  overlay.hidden = true;
  overlay = null;
  if (!floating) $("scrim").hidden = true;
  syncTop();
  if (revealed && !$("sidebar").matches(":hover")) reveal(false);
}

$("scrim").addEventListener("mousedown", () => {
  if (floating) return $("address").blur();
  closeOverlay();
});
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", closeOverlay);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) {
    e.preventDefault();
    closeOverlay();
  }
});
for (const b of document.querySelectorAll("[data-theme-pick]")) b.addEventListener("click", () => setSettings({ theme: b.dataset.themePick }));
for (const b of document.querySelectorAll("[data-tabs-pick]")) b.addEventListener("click", () => setSettings({ tabs: b.dataset.tabsPick }));

async function setSettings(patch) {
  await api.invoke("set-settings", patch);
}

// --- ⌘K palette -------------------------------------------------------------

let paletteItems = [];
let paletteIndex = 0;

async function openPalette(text) {
  openOverlay($("palette"));
  const input = $("palette-input");
  input.value = text;
  input.focus();
  await fillPalette();
}

async function fillPalette() {
  const q = $("palette-input").value.trim();
  const lower = q.toLowerCase();
  const found = await api.invoke("search", q);
  const items = [];
  for (const [label, cmd, keys] of COMMANDS) {
    if (!q || label.toLowerCase().includes(lower)) items.push({ group: "Commands", label, hint: keys, run: () => command(cmd) });
  }
  if (q) {
    for (const t of found.tabs) items.push({ group: "Open Tabs", label: t.title || t.url, hint: hostOf(t.url), run: () => (t.own ? api.send("activate", t.id) : api.send("new-tab", t.url)) });
    for (const b of found.bookmarks) items.push({ group: "Bookmarks", label: b.title, hint: hostOf(b.url), run: () => api.send("navigate", b.url) });
    for (const h of found.history) items.push({ group: "History", label: h.title, hint: hostOf(h.url), run: () => api.send("navigate", h.url) });
  }
  paletteItems = items;
  paletteIndex = 0;
  drawPalette();
}

function drawPalette() {
  const list = $("palette-list");
  let group = "";
  const nodes = [];
  paletteItems.forEach((item, i) => {
    if (item.group !== group) {
      group = item.group;
      const h = document.createElement("li");
      h.className = "palette-group";
      h.textContent = group;
      nodes.push(h);
    }
    const li = document.createElement("li");
    li.role = "option";
    li.className = "palette-item";
    li.setAttribute("aria-selected", String(i === paletteIndex));
    const label = document.createElement("span");
    label.className = "palette-label";
    label.textContent = item.label;
    const hint = document.createElement("span");
    hint.className = "palette-hint";
    hint.textContent = item.hint ?? "";
    li.append(label, hint);
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pick(i);
    });
    nodes.push(li);
  });
  if (!paletteItems.length) {
    const empty = document.createElement("li");
    empty.className = "palette-empty";
    empty.textContent = "No matches.";
    nodes.push(empty);
  }
  list.replaceChildren(...nodes);
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function pick(i) {
  const item = paletteItems[i];
  if (!item) return;
  closeOverlay();
  item.run();
}

$("palette-input").addEventListener("input", fillPalette);
$("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
    drawPalette();
  } else if (e.key === "Enter") {
    e.preventDefault();
    pick(paletteIndex);
  }
});

// --- site panel ---------------------------------------------------------------

const PERMISSIONS = [
  ["camera", "Camera"],
  ["microphone", "Microphone"],
  ["geolocation", "Location"],
  ["notifications", "Notifications"],
];

async function openSiteInfo(source) {
  const info = await api.invoke("site-info");
  const host = hostOf(info.url);
  $("siteinfo-host").textContent = info.origin ? host : info.url.startsWith("hillium:") ? "Hillium page" : host || "New Tab";
  $("siteinfo-conn").textContent = !info.origin ? "" : info.secure ? "Connection is secure" : "Connection is not secure. Don't enter passwords or card details here.";
  $("siteinfo-conn").classList.toggle("insecure", Boolean(info.origin) && !info.secure);
  const box = $("siteinfo-body");
  box.replaceChildren();
  if (info.origin) {
    const shield = document.createElement("label");
    shield.className = "si-row si-switch";
    shield.innerHTML = `<span><b>Block ads and trackers</b><small></small></span><input type="checkbox" role="switch">`;
    const input = shield.querySelector("input");
    input.checked = info.blocking;
    input.disabled = !info.adblock;
    shield.querySelector("small").textContent = !info.adblock ? "Blocking is off for every site in Settings." : info.blocking ? `${info.blocked} blocked on this page` : "Off for this site";
    input.addEventListener("change", async () => {
      await api.invoke("set-site", { origin: info.origin, key: "blocking", value: input.checked });
      openSiteInfo(source);
    });
    box.append(shield);
    if (!info.private) {
      const h = document.createElement("p");
      h.className = "si-label";
      h.textContent = "Permissions";
      box.append(h);
      for (const [key, label] of PERMISSIONS) {
        const row = document.createElement("label");
        row.className = "si-row";
        row.innerHTML = `<span></span><select><option value="ask">Ask</option><option value="allow">Allow</option><option value="block">Block</option></select>`;
        row.querySelector("span").textContent = label;
        const sel = row.querySelector("select");
        sel.value = info.site[key] ?? "ask";
        sel.addEventListener("change", () => api.invoke("set-site", { origin: info.origin, key, value: sel.value }));
        box.append(row);
      }
    } else {
      const p = document.createElement("p");
      p.className = "si-note";
      p.textContent = "Private tab: permissions last until you quit.";
      box.append(p);
    }
  }
  const more = document.createElement("button");
  more.className = "si-more";
  more.textContent = "Site Settings";
  more.dataset.cmd = "settings";
  box.append(more);
  openOverlay($("siteinfo"), { anchor: source?.closest?.("button") ?? $("site") });
}

// --- downloads panel ----------------------------------------------------------

const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);

function fillDownloads() {
  const list = $("dl-list");
  const recent = state.downloads.recent;
  if (!recent.length) {
    const li = document.createElement("li");
    li.className = "dl-empty";
    li.textContent = "No downloads yet.";
    return list.replaceChildren(li);
  }
  list.replaceChildren(
    ...recent.map((d) => {
      const li = document.createElement("li");
      li.className = `dl-item ${d.state}`;
      const name = document.createElement("span");
      name.className = "dl-name";
      name.textContent = d.filename;
      const meta = document.createElement("span");
      meta.className = "dl-meta";
      meta.textContent =
        d.state === "progressing" ? `${fmtSize(d.received)}${d.total ? ` of ${fmtSize(d.total)}` : ""}` : d.state === "completed" ? fmtSize(d.received) : d.state === "cancelled" ? "Cancelled" : "Failed";
      const bar = document.createElement("progress");
      bar.max = 1;
      bar.value = d.total ? d.received / d.total : 0;
      bar.hidden = d.state !== "progressing";
      const act = document.createElement("button");
      act.className = "icon mini";
      if (d.state === "progressing") {
        act.innerHTML = icon("close");
        act.title = "Cancel";
        act.onclick = () => api.invoke("download-action", { action: "cancel", id: d.id });
      } else if (d.state === "completed") {
        act.innerHTML = icon("search");
        act.title = "Show in Finder";
        act.onclick = () => api.invoke("download-action", { action: "show", id: d.id });
      } else {
        act.innerHTML = icon("reload");
        act.title = "Retry";
        act.onclick = () => api.invoke("download-action", { action: "retry", id: d.id });
      }
      act.setAttribute("aria-label", act.title);
      const text = document.createElement("span");
      text.className = "dl-text";
      text.append(name, meta, bar);
      li.append(text, act);
      if (d.state === "completed") li.addEventListener("dblclick", () => api.invoke("download-action", { action: "open", id: d.id }));
      return li;
    }),
  );
}

function openDownloads(source) {
  fillDownloads();
  openOverlay($("dlpanel"), { anchor: source?.closest?.("button") ?? document.querySelector(".dl-btn") });
}

// --- share as QR ------------------------------------------------------------

function openQr() {
  if (!/^https?:/.test(state?.url ?? "")) return;
  const qr = qrcodegen.QrCode.encodeText(state.url, qrcodegen.QrCode.Ecc.MEDIUM);
  const canvas = $("qr-canvas");
  const quiet = 4;
  const scale = Math.floor(canvas.width / (qr.size + quiet * 2));
  const offset = Math.floor((canvas.width - scale * qr.size) / 2);
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#000";
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) c.fillRect(offset + x * scale, offset + y * scale, scale, scale);
  $("qr-url").textContent = state.url;
  $("qr-copy").textContent = "Copy Link";
  openOverlay($("qr"));
}
$("qr-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.url);
  $("qr-copy").textContent = "Copied";
});

// --- find in page -----------------------------------------------------------

function openFind() {
  $("findbar").hidden = false;
  $("find").focus();
  $("find").select();
  queueLayout();
}
function closeFind() {
  $("findbar").hidden = true;
  $("find-count").textContent = "";
  api.send("stop-find");
  queueLayout();
}
let findText = "";
$("find").addEventListener("input", () => {
  findText = $("find").value;
  if (findText) api.send("find", { text: findText });
  else {
    api.send("stop-find");
    $("find-count").textContent = "";
  }
});
$("find").addEventListener("keydown", (e) => {
  if (e.key === "Enter") api.send("find", { text: findText, forward: !e.shiftKey, next: true });
  if (e.key === "Escape") closeFind();
});
$("find-next").addEventListener("click", () => findText && api.send("find", { text: findText, next: true }));
$("find-prev").addEventListener("click", () => findText && api.send("find", { text: findText, forward: false, next: true }));
$("find-close").addEventListener("click", closeFind);
api.on("found", (r) => {
  $("find-count").textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : "No matches";
});

api.send("ready");
