import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest, topSites } from "../main/suggest.js";
import { normalizeSession } from "../main/session-file.js";
import { apiAllowed, tokenFor, withToken } from "../main/api-guard.js";

const now = Date.parse("2026-10-19T12:00:00Z");
const history = [
  { url: "https://news.ycombinator.com/item?id=1", title: "A story", visited: now - 1000, visits: 1 },
  { url: "https://github.com/", title: "GitHub", visited: now - 3600e3, visits: 40 },
  { url: "https://github.com/ungoogled-software/ungoogled-chromium", title: "ungoogled-chromium", visited: now - 7200e3, visits: 3 },
  { url: "https://www.gitlab.com/", title: "GitLab", visited: now - 30 * 864e5, visits: 2 },
  { url: "https://example.org/notes", title: "Git notes", visited: now - 864e5 * 2, visits: 1 },
];

test("inline completion finishes the host, keeping the typed letters", () => {
  const { inline, items } = suggest("Git", { history, now });
  assert.deepEqual(inline, { completion: "Github.com", url: "https://github.com/" });
  assert.equal(items[0].kind, "go");
  assert.equal(items[1].kind, "search");
});

test("frequent, recent host matches rank above title matches", () => {
  const { items } = suggest("git", { history, now });
  const urls = items.filter((i) => i.kind === "history").map((i) => i.url);
  assert.ok(urls.indexOf("https://github.com/ungoogled-software/ungoogled-chromium") < urls.indexOf("https://example.org/notes"));
  assert.ok(urls.includes("https://www.gitlab.com/"), "www. is ignored when matching");
});

test("no inline completion for text with spaces; open tabs and bookmarks are listed", () => {
  const tabs = [{ id: 7, title: "GitHub notifications", url: "https://github.com/notifications" }];
  const bookmarks = [{ url: "https://example.org/notes", title: "Git notes" }];
  const { inline, items } = suggest("git notes", { history, tabs, bookmarks, now });
  assert.equal(inline, null);
  assert.equal(items[0].kind, "search");
  assert.ok(items.some((i) => i.kind === "bookmark" && i.url === "https://example.org/notes"));
  assert.equal(suggest("", { history }).items.length, 0);
  assert.ok(suggest("notif", { history, tabs, now }).items.some((i) => i.kind === "tab" && i.id === 7));
});

test("typed addresses are offered as addresses, not searches", () => {
  const { items } = suggest("wikipedia.org", { history, looksLikeUrl: () => true, now });
  assert.deepEqual(items[0], { kind: "go", title: "wikipedia.org" });
});

test("top sites: one tile per host, most visited first", () => {
  const sites = topSites(history);
  assert.equal(sites[0].host, "github.com");
  assert.equal(sites[0].visits, 43);
  assert.equal(sites[0].title, "GitHub");
  assert.equal(new Set(sites.map((s) => s.host)).size, sites.length);
});

test("session file: old URL lists and new entries both load", () => {
  assert.deepEqual(normalizeSession(["https://a.example/", "javascript:alert(1)"]), [{ url: "https://a.example/", pinned: false }]);
  assert.deepEqual(normalizeSession([{ url: "https://b.example/", pinned: 1 }, null, { url: 5 }]), [{ url: "https://b.example/", pinned: true }]);
  assert.deepEqual(normalizeSession("nope"), []);
});

test("page API: only the page's own token, POST and JSON get through", () => {
  const good = { method: "POST", token: tokenFor("settings"), contentType: "application/json" };
  assert.equal(apiAllowed(good, "settings"), true);
  assert.equal(apiAllowed(good, "history"), false, "a token only opens its own page's API");
  assert.equal(apiAllowed({ ...good, token: null }, "settings"), false);
  assert.equal(apiAllowed({ ...good, method: "GET" }, "settings"), false);
  assert.equal(apiAllowed({ ...good, contentType: "text/plain" }, "settings"), false);
  assert.match(withToken("<html><head><title>x</title>", "history"), new RegExp(`<meta name="hillium-token" content="${tokenFor("history")}">`));
});
