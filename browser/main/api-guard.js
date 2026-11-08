// Hillium's own pages (hillium://settings/, history, …) run in the web session, so their
// data endpoints must refuse anything but the page itself. Electron's protocol handler sees
// no Origin header, so each page instead carries a token, written into its HTML when it's
// served. Web pages can't read that HTML (no CORS), and sending the custom header from
// another origin needs a preflight, which the handler refuses.
import { createHmac, randomBytes } from "node:crypto";

const SECRET = randomBytes(32); // new every launch

export const tokenFor = (host) => createHmac("sha256", SECRET).update(host).digest("hex");

export function apiAllowed({ method, token, contentType }, host) {
  return method === "POST" && typeof token === "string" && token === tokenFor(host) && /^application\/json\b/.test(contentType ?? "");
}

// The page's HTML with its token in <meta name="hillium-token">.
export const withToken = (html, host) => html.replace("<head>", `<head>\n  <meta name="hillium-token" content="${tokenFor(host)}">`);
