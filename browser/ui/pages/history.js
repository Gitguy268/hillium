// hillium://history/: visits grouped by day, newest first.
import { api, applyLook, hostOf, siteIcon } from "/shared/page-api.js";
import { drawNav } from "/pages/nav.js";

const $ = (id) => document.getElementById(id);

const search = document.createElement("input");
search.type = "search";
search.placeholder = "Search history";
search.setAttribute("aria-label", "Search history");
const range = document.createElement("select");
range.setAttribute("aria-label", "Time range to clear");
range.innerHTML = '<option value="hour">Last hour</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="all">Everything</option>';
const clear = document.createElement("button");
clear.textContent = "Clear History";
$("toolbar").append(search, range, clear);

function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

async function draw() {
  const items = await api("list", { q: search.value, limit: 1000 });
  const content = $("content");
  if (!items.length) {
    content.innerHTML = `<p class="empty">${search.value ? "No matching pages." : "Pages you visit appear here. Private tabs are never saved."}</p>`;
    return;
  }
  const nodes = [];
  let day = "";
  let list = null;
  for (const h of items) {
    const label = dayLabel(h.visited);
    if (label !== day) {
      day = label;
      const head = document.createElement("h2");
      head.className = "day";
      head.textContent = label;
      list = document.createElement("ul");
      list.className = "list";
      nodes.push(head, list);
    }
    const li = document.createElement("li");
    li.className = "item";
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(h.visited).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const a = document.createElement("a");
    a.href = h.url;
    a.textContent = h.title || h.url;
    a.title = h.url;
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = hostOf(h.url);
    const actions = document.createElement("span");
    actions.className = "actions";
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await api("remove", { url: h.url });
      li.remove();
    });
    actions.append(remove);
    li.append(time, siteIcon(h.icon), a, host, actions);
    list.append(li);
  }
  content.replaceChildren(...nodes);
}

let timer = 0;
search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(draw, 120);
});
clear.addEventListener("click", async () => {
  await api("clear", { range: range.value });
  draw();
});

drawNav("history");
applyLook(await api("state"));
search.focus();
draw();
