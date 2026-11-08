// Downloads from web pages: saved straight to the downloads folder (or asked, if set),
// tracked for the toolbar button and hillium://downloads/. Private-tab downloads are listed
// while Hillium runs but never written to downloads.json.
import { app, shell as desktop } from "electron";
import { existsSync } from "node:fs";
import { join, parse } from "node:path";
import { getSettings, loadJson, saveJson } from "./store.js";

const MAX = 200;
let list = null; // newest first
const live = new Map(); // id → DownloadItem
let nextId = Date.now();
let onChange = () => {};

const all = () => (list ??= loadJson("downloads.json", []));
const persist = () => saveJson("downloads.json", all().filter((d) => !d.private && d.state !== "progressing").slice(0, MAX));

// A free name in the folder: "file.zip", then "file (1).zip", "file (2).zip"…
function freePath(dir, name) {
  const { name: base, ext } = parse(name || "download");
  let path = join(dir, `${base}${ext}`);
  for (let n = 1; existsSync(path) || all().some((d) => d.path === path && d.state === "progressing"); n++) path = join(dir, `${base} (${n})${ext}`);
  return path;
}

export function watchDownloads(ses, { isPrivate = false } = {}) {
  ses.on("will-download", (_, item) => {
    const s = getSettings();
    if (!s.downloadAsk) item.setSavePath(freePath(s.downloadDir || app.getPath("downloads"), item.getFilename()));
    const d = {
      id: nextId++,
      url: item.getURL(),
      filename: item.getFilename(),
      path: item.getSavePath(),
      total: item.getTotalBytes(),
      received: 0,
      state: "progressing",
      paused: false,
      private: isPrivate,
      started: Date.now(),
    };
    all().unshift(d);
    live.set(d.id, item);
    item.on("updated", (_, state) => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.path = item.getSavePath() || d.path;
      d.filename = d.path ? parse(d.path).base : d.filename;
      d.state = state === "interrupted" ? "interrupted" : "progressing";
      d.paused = item.isPaused();
      onChange();
    });
    item.once("done", (_, state) => {
      d.received = item.getReceivedBytes();
      d.path = item.getSavePath() || d.path;
      d.filename = d.path ? parse(d.path).base : d.filename;
      d.state = state; // completed | cancelled | interrupted
      d.finished = Date.now();
      live.delete(d.id);
      if (state === "completed" && process.platform === "darwin") app.dock?.downloadFinished(d.path);
      persist();
      onChange();
    });
    onChange();
  });
}

export function setDownloadsListener(fn) {
  onChange = fn;
}

export const listDownloads = ({ includePrivate = true } = {}) => all().filter((d) => includePrivate || !d.private).map((d) => ({ ...d, exists: d.state === "completed" ? existsSync(d.path) : undefined }));

// For the toolbar button: how many are running and how far along they are together.
export function downloadSummary() {
  const running = all().filter((d) => d.state === "progressing");
  const total = running.reduce((n, d) => n + (d.total || 0), 0);
  const received = running.reduce((n, d) => n + d.received, 0);
  return { active: running.length, progress: total ? received / total : running.length ? -1 : 0, recent: all().slice(0, 5) };
}

const find = (id) => all().find((d) => d.id === id);

export function downloadAction(action, id, sessions) {
  const d = find(Number(id));
  if (!d && action !== "clear") return false;
  switch (action) {
    case "show":
      if (existsSync(d.path)) desktop.showItemInFolder(d.path);
      break;
    case "open":
      if (d.state === "completed" && existsSync(d.path)) void desktop.openPath(d.path);
      break;
    case "cancel":
      live.get(d.id)?.cancel();
      break;
    case "pause":
      live.get(d.id)?.pause();
      break;
    case "resume":
      if (live.get(d.id)?.canResume()) live.get(d.id).resume();
      break;
    case "retry":
      (d.private ? sessions.private : sessions.tabs).downloadURL(d.url);
      list.splice(list.indexOf(d), 1);
      break;
    case "remove":
      if (d.state === "progressing") return false;
      list.splice(list.indexOf(d), 1);
      break;
    case "clear":
      list = all().filter((x) => x.state === "progressing");
      break;
  }
  persist();
  onChange();
  return true;
}
