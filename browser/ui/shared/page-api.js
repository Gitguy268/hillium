// Hillium's tab pages talk to the browser through POST /api/<name> on their own origin;
// each page sends the token Hillium wrote into its HTML, so no other page can make the call.
const token = document.querySelector('meta[name="hillium-token"]')?.content ?? "";

export async function api(name, body = {}) {
  const res = await fetch(`/api/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-hillium-token": token }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `${name} failed`);
  return data;
}

// The look and the macOS accent colour, applied to <body> and :root.
export function applyLook({ theme, accent }) {
  document.body.dataset.theme = theme;
  if (accent && theme !== "win98") document.documentElement.style.setProperty("--accent", accent);
}

export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// A site icon: the cached favicon, or a plain globe.
export function siteIcon(src, size = 16) {
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.width = img.height = size;
    img.className = "site-icon";
    return img;
  }
  const span = document.createElement("span");
  span.className = "site-icon globe";
  span.style.width = span.style.height = `${size}px`;
  span.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/></svg>';
  return span;
}
