// hillium://bookmarks/: every bookmark, grouped by folder (imports keep theirs).
import { api, applyLook, hostOf, siteIcon } from "/shared/page-api.js";
import { drawNav } from "/pages/nav.js";

const $ = (id) => document.getElementById(id);

const search = document.createElement("input");
search.type = "search";
search.placeholder = "Search bookmarks";
search.setAttribute("aria-label", "Search bookmarks");
const importLink = document.createElement("a");
importLink.href = "hillium://settings/#import";
importLink.textContent = "Import from another browser";
$("toolbar").append(search, importLink);

let all = [];

function row(b) {
  const li = document.createElement("li");
  li.className = "item";
  const a = document.createElement("a");
  a.href = b.url;
  a.textContent = b.title || b.url;
  a.title = b.url;
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = hostOf(b.url);
  const actions = document.createElement("span");
  actions.className = "actions";
  const rename = document.createElement("button");
  rename.textContent = "Rename";
  rename.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = b.title;
    input.style.flex = "1";
    a.replaceWith(input);
    input.focus();
    input.select();
    const done = async (save) => {
      if (save && input.value.trim() && input.value !== b.title) {
        await api("rename", { url: b.url, title: input.value });
        b.title = input.value.trim();
        a.textContent = b.title;
      }
      input.replaceWith(a);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(true), { once: true });
  });
  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await api("remove", { url: b.url });
    all = all.filter((x) => x !== b);
    li.remove();
  });
  actions.append(rename, remove);
  li.append(siteIcon(b.icon), a, host, actions);
  return li;
}

function draw() {
  const q = search.value.toLowerCase();
  const items = all.filter((b) => !q || b.title?.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
  const content = $("content");
  if (!items.length) {
    content.innerHTML = `<p class="empty">${q ? "No matching bookmarks." : "No bookmarks yet. Press ⌘D on a page, or import them from another browser."}</p>`;
    return;
  }
  const folders = new Map();
  for (const b of items) {
    const f = b.folder || "";
    if (!folders.has(f)) folders.set(f, []);
    folders.get(f).push(b);
  }
  const nodes = [];
  for (const [folder, list] of [...folders].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))) {
    if (folder || folders.size > 1) {
      const head = document.createElement("h2");
      head.className = "day";
      head.textContent = folder || "Bookmarks";
      nodes.push(head);
    }
    const ul = document.createElement("ul");
    ul.className = "list";
    ul.append(...list.map(row));
    nodes.push(ul);
  }
  content.replaceChildren(...nodes);
}

search.addEventListener("input", draw);
drawNav("bookmarks");
applyLook(await api("state"));
all = await api("list");
search.focus();
draw();
