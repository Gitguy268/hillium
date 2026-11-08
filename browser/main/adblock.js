// Ghostery's ad and tracker blocker (MPL-2.0, used unmodified from npm) with EasyList,
// EasyPrivacy, uBlock Origin's lists and the cookie-notice (annoyances) lists. The lists download through the default session,
// so Tor and proxy mode cover them, and the compiled engine is cached in userData:
// after the first run the blocker starts offline.
import { app, ipcMain, session as electronSession } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { createRequire } from "node:module";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getSettings, blockingOff } from "./store.js";

const PRELOAD = createRequire(import.meta.url).resolve("@ghostery/adblocker-electron-preload");
const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;

let blocker = null;
const preloads = new Map(); // session → registered preload id

export const getBlocker = () => blocker;

const cachePath = () => join(app.getPath("userData"), "adblock-engine.bin");
// Electron's own fetch: it honours the session's proxy, Node's global fetch does not.
const proxiedFetch = (url, init) => electronSession.defaultSession.fetch(url, init);

async function build() {
  return ElectronBlocker.fromPrebuiltFull(proxiedFetch, {
    path: cachePath(),
    read: readFile,
    write: writeFile,
  });
}

// Loads the cached engine (or downloads the lists once), then refreshes a stale cache in the background.
export async function startAdblock() {
  try {
    blocker = await build();
  } catch (e) {
    console.warn(`[hillium] ad blocker lists unavailable: ${e.message}`);
    return null;
  }
  // Wrapped, so a refreshed engine takes over without re-registering.
  // Sites with blocking switched off (or blocking off altogether) get no cosmetic filters.
  ipcMain.handle("@ghostery/adblocker/inject-cosmetic-filters", (event, url, msg) =>
    getSettings().adblock && !blockingOff(event.sender.getURL()) ? blocker.onInjectCosmeticFilters(event, url, msg) : undefined,
  );
  ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", (...a) => blocker.onIsMutationObserverEnabled(...a));
  for (const ses of preloads.keys()) addPreload(ses);
  void refreshIfStale();
  return blocker;
}

async function refreshIfStale() {
  try {
    const { mtimeMs } = await stat(cachePath());
    if (Date.now() - mtimeMs < REFRESH_AFTER_MS) return;
    const fresh = await ElectronBlocker.fromPrebuiltFull(proxiedFetch);
    await writeFile(cachePath(), fresh.serialize());
    blocker = fresh;
  } catch {
    // Keep the cached engine; the next start tries again.
  }
}

function addPreload(ses) {
  if (!blocker || preloads.get(ses)) return;
  preloads.set(ses, ses.registerPreloadScript({ type: "frame", filePath: PRELOAD }));
}

// Cosmetic filtering (hiding ad slots) needs Ghostery's preload in each web session.
export function enableCosmetics(ses) {
  if (!preloads.has(ses)) preloads.set(ses, null);
  addPreload(ses);
}

export function onHeadersReceived(details, callback) {
  if (blocker) return blocker.onHeadersReceived(details, callback);
  callback({});
}
