// hillium://downloads/: files saved from web pages, newest first.
import { api, applyLook, hostOf } from "/shared/page-api.js";
import { drawNav } from "/pages/nav.js";

const $ = (id) => document.getElementById(id);
const clear = document.createElement("button");
clear.textContent = "Clear List";
$("toolbar").append(clear);

const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const FILE = '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/></svg>';

function button(label, action, id) {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", async () => {
    await api("action", { action, id });
    draw();
  });
  return b;
}

let timer = 0;
async function draw() {
  clearTimeout(timer);
  const items = await api("list");
  const content = $("content");
  clear.disabled = !items.some((d) => d.state !== "progressing");
  if (!items.length) {
    content.innerHTML = '<p class="empty">Files you download appear here.</p>';
    return;
  }
  const group = document.createElement("div");
  group.className = "group";
  for (const d of items) {
    const row = document.createElement("div");
    row.className = "dl";
    const icon = document.createElement("span");
    icon.className = "file";
    icon.innerHTML = FILE;
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = d.filename;
    name.classList.toggle("gone", d.state === "completed" && d.exists === false);
    const meta = document.createElement("div");
    meta.className = "meta";
    const from = hostOf(d.url);
    meta.textContent = [
      d.state === "progressing" ? `${size(d.received)}${d.total ? ` of ${size(d.total)}` : ""}${d.paused ? ", paused" : ""}` : d.state === "completed" ? (d.exists === false ? "Deleted" : size(d.received)) : d.state === "cancelled" ? "Cancelled" : "Failed",
      from,
      d.private ? "Private tab" : "",
    ].filter(Boolean).join(" · ");
    info.append(name, meta);
    if (d.state === "progressing") {
      const bar = document.createElement("progress");
      bar.max = 1;
      if (d.total) bar.value = d.received / d.total;
      info.append(bar);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    if (d.state === "progressing") actions.append(button(d.paused ? "Resume" : "Pause", d.paused ? "resume" : "pause", d.id), button("Cancel", "cancel", d.id));
    else if (d.state === "completed" && d.exists !== false) actions.append(button("Open", "open", d.id), button("Show in Finder", "show", d.id));
    else actions.append(button("Retry", "retry", d.id));
    if (d.state !== "progressing") actions.append(button("Remove", "remove", d.id));
    row.append(icon, info, actions);
    group.append(row);
  }
  content.replaceChildren(group);
  if (items.some((d) => d.state === "progressing")) timer = setTimeout(draw, 700);
}

clear.addEventListener("click", async () => {
  await api("action", { action: "clear" });
  draw();
});
drawNav("downloads");
applyLook(await api("state"));
draw();
