// Bookmark import from other browsers on this Mac. Chromium-based browsers keep a
// "Bookmarks" JSON file; Firefox-based ones keep places.sqlite, which is locked while the
// browser runs, so it's copied (with its write-ahead log) and the copy is read.
import { existsSync, readFileSync, readdirSync, statSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const SUPPORT = join(homedir(), "Library", "Application Support");

const CHROMIUM = [
  ["chrome", "Chrome", "Google/Chrome"],
  ["brave", "Brave", "BraveSoftware/Brave-Browser"],
  ["helium", "Helium", "net.imput.helium"],
  ["chromium", "Chromium", "Chromium"],
  ["edge", "Microsoft Edge", "Microsoft Edge"],
  ["vivaldi", "Vivaldi", "Vivaldi"],
];
const GECKO = [
  ["firefox", "Firefox", "Firefox/Profiles"],
  ["zen", "Zen", "zen/Profiles"],
  ["waterfox", "Waterfox", "Waterfox/Profiles"],
  ["librewolf", "LibreWolf", "librewolf/Profiles"],
];

// The places.sqlite of the profile used most recently.
function newestPlaces(profiles) {
  if (!existsSync(profiles)) return null;
  const found = readdirSync(profiles)
    .map((p) => join(profiles, p, "places.sqlite"))
    .filter((f) => existsSync(f))
    .map((f) => ({ f, t: statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return found[0]?.f ?? null;
}

export function importSources(base = SUPPORT) {
  const out = [];
  for (const [id, name, path] of CHROMIUM) {
    const file = join(base, path, "Default", "Bookmarks");
    if (existsSync(file)) out.push({ id, name, kind: "chromium", file });
  }
  for (const [id, name, path] of GECKO) {
    const file = newestPlaces(join(base, path));
    if (file) out.push({ id, name, kind: "gecko", file });
  }
  return out;
}

// Chromium's Bookmarks JSON → [{ title, url, folder }]. The bar's own folder is left out of paths.
export function readChromiumBookmarks(json) {
  const out = [];
  const walk = (node, path) => {
    if (!node) return;
    if (node.type === "url") out.push({ title: node.name, url: node.url, folder: path.join(" / ") });
    for (const child of node.children ?? []) walk(child, node.type === "folder" ? [...path, node.name] : path);
  };
  const roots = json?.roots ?? {};
  for (const [key, root] of Object.entries(roots)) {
    if (!root || typeof root !== "object") continue;
    for (const child of root.children ?? []) walk(child, key === "bookmark_bar" ? [] : [root.name]);
  }
  return out.filter((b) => /^https?:\/\//.test(b.url));
}

// places.sqlite → [{ title, url, folder }]. Tags and the built-in root folders are skipped.
export function readPlaces(file) {
  const dir = mkdtempSync(join(tmpdir(), "hillium-import-"));
  try {
    const copy = join(dir, "places.sqlite");
    copyFileSync(file, copy);
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`);
    const db = new DatabaseSync(copy);
    const rows = db.prepare("SELECT b.id, b.parent, b.type, b.title, b.guid, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id").all();
    db.close();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ROOTS = new Set(["root________", "menu________", "toolbar_____", "unfiled_____", "mobile______"]);
    const pathOf = (id) => {
      const names = [];
      for (let r = byId.get(id); r && !ROOTS.has(r.guid); r = byId.get(r.parent)) {
        if (r.guid === "tags________") return null;
        names.unshift(r.title);
      }
      return names.join(" / ");
    };
    return rows
      .filter((r) => r.type === 1 && /^https?:\/\//.test(r.url ?? ""))
      .map((r) => ({ title: r.title || r.url, url: r.url, folder: pathOf(r.parent) }))
      .filter((b) => b.folder !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function readSource(source) {
  return source.kind === "chromium" ? readChromiumBookmarks(JSON.parse(readFileSync(source.file, "utf8"))) : readPlaces(source.file);
}
