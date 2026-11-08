// The one webRequest.onBeforeRequest listener per session. Electron keeps a single
// listener per event, so a second registration silently replaces the first: the
// ad blocker, the URL cleaner and the Tor search redirect all run from here, in that order.
// Pure apart from the callback, so the tests drive it with plain objects.
import { readFileSync } from "node:fs";
import { fallbackUrl, isLocalSearchUrl } from "../../extension/lib.js";

const RULES = JSON.parse(readFileSync(new URL("../../extension/url-cleaner.json", import.meta.url), "utf8"));

// The extension's DNR rules, reused as one flat list of parameter names.
export const TRACKING_PARAMS = new Set(
  RULES.flatMap((r) => r.action.redirect.transform.queryTransform.removeParams),
);

const DOCUMENTS = new Set(["mainFrame", "subFrame"]);
const INTERNAL = /^(hillium|devtools|chrome|data|blob|file):/;

// The URL without tracking parameters, or null when there is nothing to remove.
export function cleanUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.search) return null;
  // Works on the raw pairs: URLSearchParams would re-encode the ones it keeps (%20 → +).
  const pairs = u.search.slice(1).split("&");
  const kept = pairs.filter((pair) => {
    const name = pair.split("=")[0];
    try {
      return !TRACKING_PARAMS.has(decodeURIComponent(name));
    } catch {
      return true;
    }
  });
  if (kept.length === pairs.length) return null;
  u.search = kept.length ? `?${kept.join("&")}` : "";
  return u.href;
}

// What to do with a top-level or frame request that the ad blocker let through.
export function decide(details, settings) {
  if (INTERNAL.test(details.url) || !DOCUMENTS.has(details.resourceType)) return {};
  // Chromium never proxies loopback, so in Tor or proxy mode a local search would
  // reach the engines from the real IP. Send it to the public instance instead.
  if (details.resourceType === "mainFrame" && settings.mode !== "direct" && isLocalSearchUrl(details.url, settings)) {
    const target = fallbackUrl(details.url, settings);
    if (target) return { redirectURL: cleanUrl(target) ?? target };
  }
  const clean = cleanUrl(details.url);
  return clean ? { redirectURL: clean } : {};
}

// getBlocker(details): something with onBeforeRequest(details, callback), or null while the
// lists load, with blocking off, or for a site where it's switched off.
// onBlocked(details) is told about every request the blocker cancels or redirects.
export function createDispatcher({ getSettings, getBlocker, onBlocked = () => {} }) {
  return (details, callback) => {
    if (INTERNAL.test(details.url)) return callback({});
    const next = () => callback(decide(details, getSettings()));
    const blocker = getBlocker(details);
    if (!blocker) return next();
    let answered = false;
    blocker.onBeforeRequest(details, (res) => {
      if (answered) return;
      answered = true;
      if (res && (res.cancel || res.redirectURL)) {
        onBlocked(details);
        return callback(res);
      }
      next();
    });
  };
}
