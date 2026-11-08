// The data behind Hillium's tab pages (new tab, settings, history, bookmarks, downloads).
// Each function answers one POST /api/<name> from that page; protocol.js has already checked
// that the request came from the page itself.
import { app, dialog, systemPreferences, nativeTheme } from "electron";
import {
  getSettings, getBookmarks, removeBookmark, renameBookmark, addBookmarks, getHistory, removeHistory, clearHistory,
  getSites, setSite, clearSite, getFavicon, clearFavicons,
} from "./store.js";
import { topSites } from "./suggest.js";
import { importSources, readSource } from "./importers.js";
import { listDownloads, downloadAction } from "./downloads.js";

export function accentColor() {
  try {
    const rgba = systemPreferences.getAccentColor();
    if (/^[0-9a-f]{6}/i.test(rgba)) return `#${rgba.slice(0, 6)}`;
  } catch {
    // Not available: the look's own accent stays.
  }
  return "";
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
const withIcon = (x) => ({ ...x, icon: getFavicon(hostOf(x.url)) });

const RANGES = { hour: 3600e3, day: 24 * 3600e3, week: 7 * 24 * 3600e3, all: 0 };

export function createPagesApi({ applySettings, broadcast, sessions }) {
  const look = () => ({ theme: getSettings().theme, accent: accentColor(), dark: nativeTheme.shouldUseDarkColors });

  const newtab = {
    state: () => {
      const s = getSettings();
      const pinned = new Set(s.links.map((l) => hostOf(l.url)));
      return {
        ...look(),
        mode: s.mode,
        localSearch: s.localSearch,
        links: s.links.map(withIcon),
        tiles: topSites(getHistory(), 12).filter((t) => !pinned.has(t.host)).slice(0, Math.max(0, 8 - s.links.length)).map(withIcon),
      };
    },
    setLinks: (links) => {
      const clean = (Array.isArray(links) ? links : [])
        .filter((l) => l && typeof l.title === "string" && typeof l.url === "string" && /^https?:\/\//.test(l.url))
        .slice(0, 24)
        .map((l) => ({ title: l.title.slice(0, 40), url: l.url.slice(0, 2000) }));
      applySettings({ links: clean });
      return newtab.state();
    },
  };

  const settings = {
    state: look,
    get: () => ({
      ...look(),
      settings: getSettings(),
      sites: Object.entries(getSites()).map(([origin, v]) => ({ origin, ...v })),
      imports: importSources().map(({ id, name }) => ({ id, name })),
      packaged: app.isPackaged,
      isDefault: app.isPackaged && app.isDefaultProtocolClient("https"),
      downloads: app.getPath("downloads"),
      versions: { hillium: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome },
    }),
    set: async (patch) => {
      await applySettings(patch);
      return settings.get();
    },
    setSite: ({ origin, key, value }) => {
      setSite(origin, key, value);
      broadcast();
      return settings.get();
    },
    clearSite: ({ origin }) => {
      clearSite(origin);
      broadcast();
      return settings.get();
    },
    chooseDownloadDir: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], defaultPath: getSettings().downloadDir || app.getPath("downloads") });
      if (!canceled && filePaths[0]) await applySettings({ downloadDir: filePaths[0] });
      return settings.get();
    },
    makeDefault: () => {
      // Running from source this would register Electron itself, so only the installed app may.
      if (app.isPackaged) for (const scheme of ["http", "https"]) app.setAsDefaultProtocolClient(scheme);
      return settings.get();
    },
    importFrom: ({ id }) => {
      const source = importSources().find((s) => s.id === id);
      if (!source) throw new Error("That browser's bookmarks weren't found.");
      const added = addBookmarks(readSource(source), `Imported from ${source.name}`);
      broadcast();
      return { added };
    },
    clearHistory: ({ range }) => {
      if (!(range in RANGES)) throw new Error("Unknown range");
      clearHistory(RANGES[range] ? Date.now() - RANGES[range] : 0);
      return { done: true };
    },
    clearData: async ({ what }) => {
      if (what === "cookies") await Promise.all([sessions.tabs.clearStorageData(), sessions.tabs.clearAuthCache()]);
      if (what === "cache") await sessions.tabs.clearCache();
      if (what === "favicons") clearFavicons();
      return { done: true };
    },
  };

  const history = {
    state: look,
    list: ({ q = "", limit = 300 } = {}) => {
      const needle = String(q).toLowerCase();
      return getHistory()
        .filter((h) => !needle || h.title?.toLowerCase().includes(needle) || h.url.toLowerCase().includes(needle))
        .slice(0, Math.min(2000, Number(limit) || 300))
        .map(withIcon);
    },
    remove: ({ url }) => {
      removeHistory(String(url));
      return { done: true };
    },
    clear: ({ range }) => {
      if (!(range in RANGES)) throw new Error("Unknown range");
      clearHistory(RANGES[range] ? Date.now() - RANGES[range] : 0);
      return { done: true };
    },
  };

  const bookmarks = {
    state: look,
    list: () => getBookmarks().map(withIcon),
    remove: ({ url }) => {
      removeBookmark(String(url));
      broadcast();
      return { done: true };
    },
    rename: ({ url, title }) => {
      renameBookmark(String(url), title);
      broadcast();
      return { done: true };
    },
  };

  const downloads = {
    state: look,
    list: () => listDownloads(),
    action: ({ action, id }) => ({ done: downloadAction(String(action), id, sessions) }),
  };

  return { newtab, settings, history, bookmarks, downloads };
}
