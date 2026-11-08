// Every session gets the same network policy: proxy (with kill switch), the request
// dispatcher, and deny-by-default permissions. A session left out would be a leak.
import { app, dialog, session, webContents } from "electron";
import { createDispatcher } from "./filter.js";
import { sessionProxy, sessionWebRTC } from "./privacy.js";
import { getBlocker, onHeadersReceived, enableCosmetics } from "./adblock.js";
import { getSettings, siteOf, setSite, blockingOff } from "./store.js";
import { watchDownloads } from "./downloads.js";

export let sessions; // { tabs, private, ui, ai }
const blockedBy = new Map(); // webContents id → requests blocked on its current page
let proxyError = "";
let onChange = () => {};

export const blockedCount = (id) => blockedBy.get(id) ?? 0;
export const resetBlocked = (id) => blockedBy.delete(id);
export const proxyStatus = () => proxyError;

// Camera, microphone, location and notifications are asked once per site; normal tabs
// remember the answer (changed in the site panel), private tabs only until Hillium quits.
const ALWAYS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
const SESSION_ONLY = new Set(["midi", "clipboard-read"]);
const answers = new Map(); // private tabs and SESSION_ONLY kinds: key → true/false

// Electron's permission (plus media types) → the keys the site panel stores.
function siteKeys(permission, mediaTypes = []) {
  if (permission === "media") {
    const keys = [];
    if (mediaTypes.includes("video")) keys.push("camera");
    if (mediaTypes.includes("audio")) keys.push("microphone");
    return keys.length ? keys : ["camera", "microphone"];
  }
  if (permission === "geolocation" || permission === "notifications") return [permission];
  return null;
}

function permissionLabel(permission, details) {
  if (permission === "media") {
    const kinds = details.mediaTypes ?? [];
    if (kinds.includes("video") && kinds.includes("audio")) return "use your camera and microphone";
    return kinds.includes("video") ? "use your camera" : "use your microphone";
  }
  return { geolocation: "know your location", notifications: "show notifications", midi: "use MIDI devices", "clipboard-read": "read your clipboard" }[permission];
}

// "allow" | "block" | "ask" for this request, from what's stored.
function stored(ses, origin, permission, mediaTypes) {
  const keys = siteKeys(permission, mediaTypes);
  if (!keys || ses === sessions.private) {
    const v = answers.get(`${ses === sessions.private ? "p" : "n"}|${origin}|${permission}|${mediaTypes?.join() ?? ""}`);
    return v == null ? "ask" : v ? "allow" : "block";
  }
  const site = siteOf(origin);
  const values = keys.map((k) => site[k] ?? "ask");
  if (values.includes("block")) return "block";
  return values.every((v) => v === "allow") ? "allow" : "ask";
}

function remember(ses, origin, permission, mediaTypes, allow) {
  const keys = siteKeys(permission, mediaTypes);
  if (!keys || ses === sessions.private) return answers.set(`${ses === sessions.private ? "p" : "n"}|${origin}|${permission}|${mediaTypes?.join() ?? ""}`, allow);
  for (const k of keys) setSite(origin, k, allow ? "allow" : "block");
}

function webPermissions(ses) {
  const web = ses === sessions.tabs || ses === sessions.private;
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (ALWAYS.has(permission)) return callback(true);
    if (!web || !(siteKeys(permission) || SESSION_ONLY.has(permission))) return callback(false);
    let origin;
    try {
      origin = new URL(details.requestingUrl).origin;
    } catch {
      return callback(false);
    }
    const now = stored(ses, origin, permission, details.mediaTypes);
    if (now !== "ask") return callback(now === "allow");
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["Block", "Allow"],
      defaultId: 0,
      cancelId: 0,
      message: `Allow ${new URL(origin).host} to ${permissionLabel(permission, details)}?`,
      detail: ses === sessions.private ? "Remembered until you quit Hillium." : "You can change this later: click the icon left of the address.",
    });
    remember(ses, origin, permission, details.mediaTypes, response === 1);
    callback(response === 1);
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    if (ALWAYS.has(permission)) return true;
    if (!web) return false;
    try {
      const types = details?.mediaType && details.mediaType !== "unknown" ? [details.mediaType] : undefined;
      return stored(ses, new URL(origin).origin, permission, types) === "allow";
    } catch {
      return false;
    }
  });
  ses.setDevicePermissionHandler(() => false);
}

// The page a request belongs to: its own URL for a page load, otherwise the tab's.
function siteUrl(details) {
  if (details.resourceType === "mainFrame") return details.url;
  if (details.webContentsId == null) return "";
  return webContents.fromId(details.webContentsId)?.getURL() ?? "";
}

export function setupSessions(changed) {
  onChange = changed;
  sessions = {
    tabs: session.defaultSession,
    private: session.fromPartition("hillium-private"), // in memory: gone when Hillium quits
    ui: session.fromPartition("persist:hillium-ui"),
    // persist: Chromium can't read back a 1.6 GB Blob in an in-memory session.
    ai: session.fromPartition("persist:hillium-ai"),
  };
  // Look like Chrome: "Electron" and the app name in the user agent get pages blocked.
  const ua = app.userAgentFallback.replace(/ (Electron|hillium-browser|Hillium)\/\S+/g, "");
  app.userAgentFallback = ua;

  const dispatcher = createDispatcher({
    getSettings,
    getBlocker: (details) => (getSettings().adblock && !blockingOff(siteUrl(details)) ? getBlocker() : null),
    onBlocked: (details) => {
      if (details.webContentsId == null) return;
      blockedBy.set(details.webContentsId, blockedCount(details.webContentsId) + 1);
      onChange("blocked", details.webContentsId);
    },
  });
  for (const ses of Object.values(sessions)) {
    ses.setUserAgent(ua);
    ses.webRequest.onBeforeRequest(dispatcher);
    ses.webRequest.onHeadersReceived((details, callback) =>
      getSettings().adblock && !blockingOff(siteUrl(details)) ? onHeadersReceived(details, callback) : callback({}),
    );
    webPermissions(ses);
  }
  enableCosmetics(sessions.tabs);
  enableCosmetics(sessions.private);
  watchDownloads(sessions.tabs);
  watchDownloads(sessions.private, { isPrivate: true });
  return applyNetwork();
}

// Pushes the stored network settings into every session and every page.
export async function applyNetwork() {
  const s = getSettings();
  const { config, error } = sessionProxy(s);
  proxyError = error;
  await Promise.all(
    Object.values(sessions).map(async (ses) => {
      await ses.setProxy(config);
      await ses.closeAllConnections(); // open sockets would otherwise keep the old route
    }),
  );
  for (const wc of webContents.getAllWebContents()) wc.setWebRTCIPHandlingPolicy(sessionWebRTC(s));
  onChange("network");
}

// Pages created later get the policy as they appear.
app.on("web-contents-created", (_, wc) => {
  wc.setWebRTCIPHandlingPolicy(sessionWebRTC(getSettings()));
  wc.on("will-attach-webview", (e) => e.preventDefault());
});

// Tor or the proxy is down: pages fail with a proxy error rather than going direct.
export function noteLoadError(errorCode) {
  if ([-130, -115, -125, -127].includes(errorCode) && getSettings().mode !== "direct") {
    proxyError = getSettings().mode === "tor" ? "Tor is not reachable. Pages are blocked until it is back." : "The proxy is not reachable. Pages are blocked until it is back.";
    onChange("network");
  }
}
export function clearProxyError() {
  if (proxyError && !sessionProxy(getSettings()).error) {
    proxyError = "";
    onChange("network");
  }
}
