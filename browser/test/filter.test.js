import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl, decide, createDispatcher, TRACKING_PARAMS } from "../main/filter.js";
import { DEFAULTS } from "../../extension/lib.js";

const direct = { ...DEFAULTS, mode: "direct" };
const tor = { ...DEFAULTS, mode: "tor" };

test("uses every parameter from the extension's URL cleaner", () => {
  for (const p of ["utm_source", "fbclid", "gclid", "msclkid", "mc_eid", "srsltid"]) assert.ok(TRACKING_PARAMS.has(p), p);
});

test("strips tracking parameters and keeps the rest byte for byte", () => {
  assert.equal(cleanUrl("https://a.example/p?utm_source=x&q=a%20b+c&fbclid=1#top"), "https://a.example/p?q=a%20b+c#top");
  assert.equal(cleanUrl("https://a.example/?utm_medium=mail"), "https://a.example/");
  assert.equal(cleanUrl("https://a.example/?q=1"), null);
  assert.equal(cleanUrl("https://a.example/"), null);
  assert.equal(cleanUrl("not a url"), null);
});

test("only documents are cleaned; scripts and images pass untouched", () => {
  const url = "https://a.example/?utm_source=x";
  assert.deepEqual(decide({ url, resourceType: "mainFrame" }, direct), { redirectURL: "https://a.example/" });
  assert.deepEqual(decide({ url, resourceType: "subFrame" }, direct), { redirectURL: "https://a.example/" });
  assert.deepEqual(decide({ url, resourceType: "script" }, direct), {});
  assert.deepEqual(decide({ url: "hillium://newtab/?utm_source=x", resourceType: "mainFrame" }, direct), {});
});

test("Tor mode sends local searches to the public instance, cleaned", () => {
  const url = `${DEFAULTS.localSearch}/search?q=tor&utm_source=x`;
  assert.deepEqual(decide({ url, resourceType: "mainFrame" }, tor), { redirectURL: `${DEFAULTS.publicSearch}/search?q=tor` });
  assert.deepEqual(decide({ url: `${DEFAULTS.localSearch}/search?q=tor`, resourceType: "mainFrame" }, direct), {});
});

const run = (dispatch, details) => new Promise((resolve) => dispatch(details, resolve));

test("dispatcher: the ad blocker answers first, then the cleaner", async () => {
  const blocked = [];
  const blocker = { onBeforeRequest: (d, cb) => cb(d.url.includes("ads.") ? { cancel: true } : {}) };
  const dispatch = createDispatcher({ getSettings: () => direct, getBlocker: () => blocker, onBlocked: (d) => blocked.push(d.url) });
  assert.deepEqual(await run(dispatch, { url: "https://ads.example/x.js", resourceType: "script" }), { cancel: true });
  assert.deepEqual(await run(dispatch, { url: "https://a.example/?gclid=1", resourceType: "mainFrame" }), { redirectURL: "https://a.example/" });
  assert.deepEqual(await run(dispatch, { url: "https://a.example/app.js", resourceType: "script" }), {});
  assert.deepEqual(blocked, ["https://ads.example/x.js"]);
});

test("dispatcher works before the block lists load, and skips Hillium's own pages", async () => {
  let asked = false;
  const dispatch = createDispatcher({ getSettings: () => direct, getBlocker: () => null });
  assert.deepEqual(await run(dispatch, { url: "https://a.example/?fbclid=1", resourceType: "mainFrame" }), { redirectURL: "https://a.example/" });
  const guarded = createDispatcher({ getSettings: () => direct, getBlocker: () => ({ onBeforeRequest: () => (asked = true) }) });
  assert.deepEqual(await run(guarded, { url: "hillium://app/chrome.html", resourceType: "mainFrame" }), {});
  assert.equal(asked, false);
});
