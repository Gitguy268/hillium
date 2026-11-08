// The side navigation shared by Hillium's tab pages.
const PAGES = [
  ["settings", "Settings", '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'],
  ["history", "History", '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
  ["bookmarks", "Bookmarks", '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>'],
  ["downloads", "Downloads", '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>'],
];

export function drawNav(current) {
  const nav = document.querySelector(".nav");
  const h = document.createElement("h1");
  h.textContent = "Hillium";
  nav.append(h);
  for (const [host, label, path] of PAGES) {
    const a = document.createElement("a");
    a.href = `hillium://${host}/`;
    a.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`;
    a.append(label);
    if (host === current) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
}
