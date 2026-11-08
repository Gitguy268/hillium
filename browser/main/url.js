// Typed text → URL: addresses as they are, bare domains over HTTPS, everything else a search.
export function toUrl(text, settings) {
  const t = text.trim();
  if (!t) return null;
  if (/^(https?|hillium|file|about):/i.test(t)) return t;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return `https://${t}`;
  return `${settings.localSearch.replace(/\/$/, "")}/search?q=${encodeURIComponent(t)}`;
}
