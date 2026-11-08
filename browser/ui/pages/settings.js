// hillium://settings/
import { api, applyLook } from "/shared/page-api.js";
import { drawNav } from "/pages/nav.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
let data = null;

const SITE_LABELS = { camera: "Camera", microphone: "Microphone", geolocation: "Location", notifications: "Notifications" };
const VALUE_LABELS = { allow: "allowed", block: "blocked" };

function fill() {
  const s = data.settings;
  applyLook(data);
  for (const el of form.elements) {
    if (!el.name || !(el.name in s) || document.activeElement === el) continue;
    if (el.type === "radio") el.checked = s[el.name] === el.value;
    else if (el.type === "checkbox") el.checked = Boolean(s[el.name]);
    else el.value = s[el.name];
  }
  for (const row of document.querySelectorAll(".when-tor")) row.classList.toggle("on", s.mode === "tor");
  for (const row of document.querySelectorAll(".when-proxy")) row.classList.toggle("on", s.mode === "proxy");
  $("download-dir").textContent = s.downloadDir || data.downloads;

  $("default-note").textContent = !data.packaged
    ? "Install Hillium.app first: running from source can't be the default browser."
    : data.isDefault
      ? "Hillium is your default browser."
      : "Links from other apps open in another browser.";
  $("make-default").disabled = !data.packaged || data.isDefault;

  const sites = $("sites-list");
  if (!data.sites.length) {
    sites.innerHTML = '<div class="row"><small>Sites you allow or block camera, microphone, location or notifications for, or switch blocking off on, appear here.</small></div>';
  } else {
    sites.replaceChildren(
      ...data.sites.map((site) => {
        const row = document.createElement("div");
        row.className = "row";
        const text = document.createElement("div");
        text.textContent = site.origin.replace(/^https:\/\//, "");
        const detail = document.createElement("small");
        const parts = Object.entries(SITE_LABELS).filter(([k]) => site[k]).map(([k, label]) => `${label} ${VALUE_LABELS[site[k]]}`);
        if (site.blocking === false) parts.unshift("Blocking off");
        detail.textContent = parts.join(", ");
        text.append(detail);
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "Reset";
        reset.addEventListener("click", async () => {
          data = await api("clearSite", { origin: site.origin });
          fill();
        });
        row.append(text, reset);
        return row;
      }),
    );
  }

  const imports = $("imports");
  if (!data.imports.length) imports.innerHTML = '<div class="row"><small>No other browsers found on this Mac.</small></div>';
  else {
    imports.replaceChildren(
      ...data.imports.map((source) => {
        const row = document.createElement("div");
        row.className = "row";
        const label = document.createElement("div");
        label.textContent = source.name;
        const result = document.createElement("small");
        label.append(result);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Import";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const { added } = await api("importFrom", { id: source.id });
            result.textContent = added ? `Added ${added} bookmark${added === 1 ? "" : "s"}, in the folder “Imported from ${source.name}”.` : "Nothing new to add.";
          } catch (e) {
            result.textContent = e.message;
          }
          button.disabled = false;
        });
        row.append(label, button);
        return row;
      }),
    );
  }
  const v = data.versions;
  $("version").textContent = `Hillium ${v.hillium} · Electron ${v.electron} · Chromium ${v.chromium}`;
}

form.addEventListener("change", async (e) => {
  const el = e.target;
  if (!el.name) return;
  let value = el.type === "checkbox" ? el.checked : el.value;
  if (el.type === "number") value = Number(value);
  if (el.type === "url" && !/^https?:\/\/[^/]+/.test(value)) return fill();
  data = await api("set", { [el.name]: value });
  fill();
});
form.addEventListener("submit", (e) => e.preventDefault());

$("make-default").addEventListener("click", async () => {
  data = await api("makeDefault");
  fill();
});
$("choose-dir").addEventListener("click", async () => {
  data = await api("chooseDownloadDir");
  fill();
});
$("clear-history").addEventListener("click", async () => {
  await api("clearHistory", { range: $("clear-range").value });
  $("clear-history").textContent = "Cleared";
});
for (const b of document.querySelectorAll("[data-clear]")) {
  b.addEventListener("click", async () => {
    await api("clearData", { what: b.dataset.clear });
    b.textContent = "Cleared";
  });
}

drawNav("settings");
data = await api("get");
fill();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
