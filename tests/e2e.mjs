// End-to-end check of Hillium Home inside a real Helium build.
// Usage: HELIUM=/path/to/Helium.app PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node tests/e2e.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const app = process.env.HELIUM || "/Applications/Helium.app";
const ext = resolve(import.meta.dirname, "../extension");

// Stand-in for the public SearXNG instance, so the test needs no internet.
const publicHits = [];
const server = http.createServer((req, res) => {
  if (req.url !== "/favicon.ico") publicHits.push(req.url);
  res.end("public instance");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const publicSearch = `http://127.0.0.1:${server.address().port}`;
const deadLocal = "http://127.0.0.1:1"; // nothing listens here: local SearXNG "not running"

const profile = await mkdtemp(join(tmpdir(), "hillium-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: join(app, "Contents/MacOS/Helium"),
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const id = new URL(worker.url()).host;
  const setSettings = (s) => worker.evaluate((s) => chrome.storage.local.set(s), s);
  const settle = () => new Promise((r) => setTimeout(r, 500));
  // The extension redirects the tab itself, which can abort Playwright's own navigation wait, so poll.
  async function landsOn(page, url) {
    for (let i = 0; i < 50 && page.url() !== url; i++) await settle();
    assert.equal(page.url(), url);
  }

  await check("--load-extension works in Helium", async () => {
    assert.match(id, /^[a-p]{32}$/);
  });

  await check("new tab page makes no network requests", async () => {
    const external = [];
    const onRequest = (req) => {
      if (!req.url().startsWith(`chrome-extension://${id}/`)) external.push(req.url());
    };
    context.on("request", onRequest);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/newtab.html`);
    await page.waitForSelector("#clock:not(:empty)");
    await page.waitForTimeout(1000);
    context.off("request", onRequest);
    await page.close();
    assert.deepEqual(external, []);
  });

  await check("Helium shows Hillium Home as the new tab page", async () => {
    const page = await context.newPage();
    await page.goto("chrome://newtab/");
    await page.waitForSelector("#clock:not(:empty)", { timeout: 5000 });
    await page.close();
  });

  await check("tracking parameters are stripped", async () => {
    const page = await context.newPage();
    publicHits.length = 0;
    // uBO loads its lists asynchronously after first start, so allow a few tries.
    for (let i = 0; i < 10; i++) {
      // uBO's removeparam redirect aborts Playwright's navigation, so judge by what the server received.
      await page.goto(`${publicSearch}/clean?utm_source=x&fbclid=y&keep=1`).catch(() => {});
      await page.waitForTimeout(500);
      if (publicHits.at(-1) === "/clean?keep=1") break;
      await page.waitForTimeout(2000);
    }
    await page.close();
    assert.equal(publicHits.at(-1), "/clean?keep=1");
  });

  await check("search falls back to the public instance when local SearXNG is down", async () => {
    await setSettings({ mode: "direct", localSearch: deadLocal, publicSearch });
    await settle();
    const page = await context.newPage();
    await page.goto(`${deadLocal}/search?q=hillium+test`).catch(() => {});
    await landsOn(page, `${publicSearch}/search?q=hillium+test`);
    await page.close();
  });

  await check("WebRTC policy is locked down", async () => {
    const value = await worker.evaluate(async () => (await chrome.privacy.network.webRTCIPHandlingPolicy.get({})).value);
    assert.equal(value, "disable_non_proxied_udp");
  });

  await check("proxy mode redirects local searches before they reach SearXNG", async () => {
    // Port 9 is closed, which also exercises the kill switch below.
    await setSettings({ mode: "tor", torPort: 9, localSearch: "http://127.0.0.1:8888", publicSearch });
    await settle();
    const page = await context.newPage();
    publicHits.length = 0;
    await page.goto("http://127.0.0.1:8888/search?q=via+tor").catch(() => {});
    await landsOn(page, `${publicSearch}/search?q=via+tor`);
    assert.deepEqual(publicHits, ["/search?q=via+tor"]);
    await page.close();
  });

  await check("kill switch: with Tor down, sites fail instead of loading directly", async () => {
    const page = await context.newPage();
    const error = await page.goto("https://example.com/").then(() => null, (e) => e.message);
    assert.match(String(error), /ERR_PROXY_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/);
    await page.close();
  });

  await check("DNS prefetching is off while proxied", async () => {
    const value = await worker.evaluate(async () => (await chrome.privacy.network.networkPredictionEnabled.get({})).value);
    assert.equal(value, false);
  });

  await check("direct mode clears the proxy and DNS prefetch override", async () => {
    await setSettings({ mode: "direct" });
    await settle();
    const value = await worker.evaluate(async () => (await chrome.proxy.settings.get({})).value);
    assert.notEqual(value.mode, "fixed_servers");
    const prediction = await worker.evaluate(async () => (await chrome.privacy.network.networkPredictionEnabled.get({})).levelOfControl);
    assert.notEqual(prediction, "controlled_by_this_extension");
  });

  await check("WebRTC switch off restores Helium's default, not Chromium's", async () => {
    await setSettings({ mode: "direct", blockWebRTC: false });
    await settle();
    const value = await worker.evaluate(async () => (await chrome.privacy.network.webRTCIPHandlingPolicy.get({})).value);
    assert.equal(value, "default_public_interface_only");
  });
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
