// The new tab page. Everything is local: shortcuts show the icons Hillium already saved
// when the sites were visited, and nothing is fetched from the network. Shortcuts are the
// ones you added, then your most visited sites.
import { paintClouds, paintAurora } from "/shared/wallpaper.js";
import { glass } from "/shared/glass.js";
import { api, applyLook, hostOf, siteIcon } from "/shared/page-api.js";

const $ = (id) => document.getElementById(id);
let state = { theme: "normal", links: [], tiles: [], mode: "direct", localSearch: "http://127.0.0.1:8888" };

function toUrl(text) {
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return `${state.localSearch.replace(/\/$/, "")}/search?q=${encodeURIComponent(text)}`;
}

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("q").value.trim();
  if (text) location.href = toUrl(text);
});

async function saveLinks(links) {
  state = await api("setLinks", links);
  renderLinks();
}

function tile({ title, url, icon }, onRemove) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = url;
  a.className = "link";
  a.title = `${title}\n${url}`;
  const box = document.createElement("span");
  box.className = "tile";
  box.append(siteIcon(icon, 24));
  const name = document.createElement("span");
  name.className = "link-name";
  name.textContent = title || hostOf(url).replace(/^www\./, "");
  a.append(box, name);
  li.append(a);
  if (onRemove) {
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Remove shortcut";
    remove.setAttribute("aria-label", `Remove ${title}`);
    remove.addEventListener("click", onRemove);
    li.append(remove);
  }
  return li;
}

function renderLinks() {
  const items = [
    ...state.links.map((link, i) => tile(link, () => saveLinks(state.links.filter((_, j) => j !== i)))),
    // Visited sites: short names, since home page titles tend to be long.
    ...state.tiles.map((t) => tile({ ...t, title: t.host.replace(/^www\./, "") })),
  ];
  if (state.links.length < 24) {
    const li = document.createElement("li");
    const add = document.createElement("button");
    add.className = "link add-tile";
    add.innerHTML = '<span class="tile"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><span class="link-name">Add shortcut</span>';
    add.addEventListener("click", () => {
      $("add-link").hidden = false;
      $("add-link").title.focus();
    });
    li.append(add);
    items.push(li);
  }
  $("links").replaceChildren(...items);
  if (state.theme === "glass") glass(document.querySelectorAll(".tile"), { radius: 14 });
}

$("add-link").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const url = new URL(form.url.value);
  if (!["http:", "https:"].includes(url.protocol)) return;
  saveLinks([...state.links, { title: form.title.value.trim(), url: url.href }]);
  form.reset();
  form.hidden = true;
});
$("add-cancel").addEventListener("click", () => {
  $("add-link").reset();
  $("add-link").hidden = true;
});

function paint() {
  const canvas = $("wallpaper");
  if (state.theme === "win98") paintClouds(canvas);
  else if (state.theme === "glass") paintAurora(canvas, matchMedia("(prefers-color-scheme: dark)").matches);
}

async function start() {
  try {
    state = await api("state");
  } catch {
    // Defaults: still a working page.
  }
  applyLook(state);
  const mode = $("mode");
  mode.hidden = state.mode === "direct";
  mode.textContent = state.mode === "tor" ? "Connected through Tor" : "Connected through a proxy";
  paint();
  addEventListener("resize", paint);
  renderLinks();
  if (state.theme === "glass") glass([$("search")], { shape: "pill" });
}
start();
