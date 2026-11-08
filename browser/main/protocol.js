// hillium:// serves the browser's own pages. It is registered per session:
//   hillium://app/…        the toolbar and assistant pages (UI and AI sessions only)
//   hillium://app/models/… the verified model files (AI session only; same origin as the
//                          assistant, because custom schemes get no CORS)
//   hillium://newtab/, settings/, history/, bookmarks/, downloads/
//                          pages that open in tabs. Their data comes from POST /api/<name>,
//                          which only the page itself may call (see api-guard.js).
import { protocol, net } from "electron";
import { join, normalize, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { FILES, modelDir, isModelReady } from "./model.js";
import { apiAllowed, withToken } from "./api-guard.js";

export const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));
export const PAGES = ["newtab", "settings", "history", "bookmarks", "downloads"];

protocol.registerSchemesAsPrivileged([
  {
    scheme: "hillium",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' data: blob: https: http:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");
// Tab pages load nothing from the network: favicons arrive as data: URLs.
const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".md": "text/plain; charset=utf-8",
};

function inside(base, path) {
  const full = normalize(join(base, decodeURIComponent(path)));
  return full === base.replace(/[\\/]$/, "") || full.startsWith(base.endsWith(sep) ? base : base + sep) ? full : null;
}

async function serveFile(full, csp, extra = {}) {
  const res = await net.fetch(pathToFileURL(full).href);
  if (!res.ok) return new Response("Not found", { status: 404 });
  const ext = full.slice(full.lastIndexOf("."));
  const headers = { "content-type": TYPES[ext] ?? "application/octet-stream", ...extra };
  if (ext === ".html") headers["content-security-policy"] = csp;
  return new Response(res.body, { status: 200, headers });
}

// Files each tab page may load, besides its own.
const PAGE_FILES = /^\/(pages|themes|shared|assets)\//;
const NEWTAB_FILES = /^\/(newtab|themes|shared|assets|vendor\/liquid-glass-web)\//;

// hosts: which of "app", "models" and the PAGES this session may load.
// api: { [host]: { [name]: async (body) => json } } for the tab pages.
export function registerProtocol(ses, hosts, api = {}) {
  ses.protocol.handle("hillium", async (req) => {
    const url = new URL(req.url);
    const host = url.hostname;
    if (!hosts.includes(host) || host === "models") return new Response("Forbidden", { status: 403 });

    if (host === "app" && url.pathname.startsWith("/models/")) {
      const name = decodeURIComponent(url.pathname.slice("/models/".length));
      if (!hosts.includes("models") || !FILES.includes(name) || !isModelReady()) return new Response("Not found", { status: 404 });
      return serveFile(join(modelDir(), name), APP_CSP, { "cross-origin-resource-policy": "same-origin" });
    }

    if (host === "app") {
      const full = inside(UI_DIR, url.pathname === "/" ? "/chrome.html" : url.pathname);
      if (!full) return new Response("Forbidden", { status: 403 });
      // Isolated, so the assistant gets SharedArrayBuffer and wllama runs multithreaded.
      return serveFile(full, APP_CSP, {
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "credentialless",
        "cross-origin-resource-policy": "same-origin",
      });
    }

    // A tab page: its data API, or its files.
    if (url.pathname.startsWith("/api/")) {
      const fn = api[host]?.[url.pathname.slice(5)];
      const check = { method: req.method, token: req.headers.get("x-hillium-token"), contentType: req.headers.get("content-type") };
      if (!fn || !apiAllowed(check, host)) return new Response("Forbidden", { status: 403 });
      let body = {};
      try {
        body = (await req.json()) ?? {};
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      try {
        return Response.json((await fn(body)) ?? null);
      } catch (e) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }
    const path = url.pathname === "/" ? (host === "newtab" ? "/newtab/newtab.html" : `/pages/${host}.html`) : url.pathname;
    if (!(host === "newtab" ? NEWTAB_FILES : PAGE_FILES).test(path)) return new Response("Not found", { status: 404 });
    const full = inside(UI_DIR, path);
    if (!full) return new Response("Forbidden", { status: 403 });
    if (!full.endsWith(".html")) return serveFile(full, PAGE_CSP);
    const res = await net.fetch(pathToFileURL(full).href);
    if (!res.ok) return new Response("Not found", { status: 404 });
    return new Response(withToken(await res.text(), host), { headers: { "content-type": TYPES[".html"], "content-security-policy": PAGE_CSP, "cache-control": "no-store" } });
  });
}
