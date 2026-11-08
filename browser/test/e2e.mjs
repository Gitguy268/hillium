// End-to-end checks in the real app, driven by Playwright's Electron support.
// Needs no internet once the ad-block engine is cached (the first run downloads it).
//   npm run e2e            the checks below, plus screenshots in test/screenshots/
//   AI=1 npm run e2e       also loads the real MiniCPM-V model and asks it about a page
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeWindow } from "./compose.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "package.json"));
const playwright = process.env.PLAYWRIGHT ? require(process.env.PLAYWRIGHT) : require("playwright");
const shots = join(root, "test", "screenshots");
mkdirSync(shots, { recursive: true });

// A local site: a page with a tracker script and a link carrying tracking parameters.
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url.startsWith("/file.txt")) {
    res.setHeader("content-type", "text/plain");
    res.setHeader("content-disposition", 'attachment; filename="hillium-e2e.txt"');
    return res.end("downloaded by the Hillium e2e test\n");
  }
  if (req.url.startsWith("/article")) {
    return res.end(`<!doctype html><title>Hillium test article</title><main><h1>Lighthouses</h1>
      <p>A lighthouse is a tower with a bright lamp that guides ships at night and warns them of rocks.</p>
      <p>The Pharos of Alexandria, built around 280 BC, was one of the Seven Wonders of the Ancient World.</p></main>`);
  }
  res.end(`<!doctype html><title>Hillium test page</title><h1>Test page</h1>
    <script src="https://www.google-analytics.com/analytics.js"></script>
    <script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
    <a id="out" href="/article?utm_source=newsletter&id=7&fbclid=abc">Read the article</a>
    <div class="ad_banner" id="slot1" style="width:300px;height:250px">ad</div>
    <div id="carbonads"><span id="slot2">ad</span></div>
    <div id="keep" class="story">story</div>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// A real-looking name mapped to the local server: Ghostery skips cosmetic rules on bare IPs.
const site = `http://news.example.com:${server.address().port}`;

// A fresh profile each run. The compiled block lists are copied in when this Mac has them,
// so the run needs no internet.
const userData = mkdtempSync(join(tmpdir(), "hillium-e2e-"));
const downloadDir = mkdtempSync(join(tmpdir(), "hillium-e2e-dl-"));
const cachedEngine = join(homedir(), "Library", "Application Support", "Hillium Browser", "adblock-engine.bin");
if (existsSync(cachedEngine)) copyFileSync(cachedEngine, join(userData, "adblock-engine.bin"));
const app = await playwright._electron.launch({
  executablePath: require("electron"),
  args: [root, "--host-resolver-rules=MAP news.example.com 127.0.0.1"],
  env: { ...process.env, HILLIUM_TEST: "1", HILLIUM_USER_DATA: userData },
});
const errors = [];
app.on("window", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const main = (fn, arg) => app.evaluate(fn, arg);
const shell = () => main(() => {
  const s = [...globalThis.__hillium.shells][0];
  return { ...s.snapshot(), urls: s.tabs.map((t) => t.url) };
});
const run = (command, arg) => main((_, [c, a]) => globalThis.__hillium.run(c, a), [command, arg]);
async function until(check, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(200);
  }
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n    ${e.message}`);
  }
}
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const ui = () => until(() => app.windows().find((w) => w.url() === "hillium://app/chrome.html"), "the toolbar page");
const tabPage = (prefix) => until(() => app.windows().find((w) => w.url().startsWith(prefix)), prefix);
const activeEval = (code) => main((_, c) => [...globalThis.__hillium.shells][0].active.view.webContents.executeJavaScript(c), code);

try {
  await ui();
  await until(() => main(() => [...globalThis.__hillium.shells][0]?.tabs.length), "the first tab");

  await check("opens with the new tab page", async () => {
    const s = await shell();
    assert(s.urls[0] === "hillium://newtab/", `first tab is ${s.urls[0]}`);
  });

  await check("ad blocker engine is ready", async () => {
    await until(() => main(() => globalThis.__hillium.blockerReady()), "Ghostery's engine", 120000);
  });

  await check("blocks trackers on a page", async () => {
    await main((_, url) => [...globalThis.__hillium.shells][0].navigate(url), `${site}/`);
    await until(async () => (await shell()).blocked >= 2, "2 blocked requests");
  });

  await check("hides ad slots (cosmetic filtering)", async () => {
    const page = await until(() => app.windows().find((w) => w.url().startsWith(site)), "the test page");
    const shown = await until(() => page.evaluate(() => {
      // An ancestor hidden counts as hidden.
      const visible = (id) => document.getElementById(id).checkVisibility();
      return visible("keep") && !visible("slot1") && !visible("slot2") ? "ok" : null;
    }), "ad slots hidden", 8000);
    assert(shown === "ok", "ad slots still visible");
  });

  await check("strips tracking parameters from links", async () => {
    const page = await until(() => app.windows().find((w) => w.url().startsWith(site)), "the test page");
    await page.click("#out");
    await until(async () => (await shell()).url.includes("/article"), "the article");
    const { url } = await shell();
    assert(url === `${site}/article?id=7`, `got ${url}`);
  });

  for (const theme of ["normal", "win98", "glass"]) {
    await check(`renders the ${theme} look`, async () => {
      await run("theme", theme);
      const page = await ui();
      await until(() => page.evaluate((t) => document.body.dataset.theme === t, theme), `data-theme=${theme}`);
      const s = await shell();
      assert(s.tabs.length === 1 && !s.assistantOpen, `unexpected state: ${s.tabs.length} tabs, assistant ${s.assistantOpen}`);
      if (theme === "glass") {
        const glass = await main(() => ({ native: globalThis.__hillium.nativeGlass(), id: [...globalThis.__hillium.shells][0].glassId }));
        assert(!glass.native || glass.id >= 0, `native glass supported but not added (id ${glass.id})`);
        console.log(`    window material: ${glass.native ? `native NSGlassEffectView (id ${glass.id})` : "vibrancy fallback"}`);
      }
      await wait(800);
      writeFileSync(join(shots, `look-${theme}-page.png`), await composeWindow(app));
      await run("new-tab");
      await wait(1500);
      writeFileSync(join(shots, `look-${theme}-newtab.png`), await composeWindow(app));
      writeFileSync(join(shots, `look-${theme}-newtab-plain.png`), await composeWindow(app, 0, "plain"));
      await run("close-tab");
    });
  }
  await run("theme", "normal");

  await check("⌘K palette finds the open tab", async () => {
    const page = await ui();
    await run("palette");
    await page.waitForSelector("#palette:not([hidden])");
    await page.fill("#palette-input", "Hillium test");
    await page.waitForSelector(".palette-item >> text=Hillium test article");
    await wait(300);
    writeFileSync(join(shots, "palette.png"), await composeWindow(app));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#palette", { state: "hidden" });
    assert(!(await main(() => [...globalThis.__hillium.shells][0].overlay)), "overlay stayed on");
  });

  await check("tabs move to the top and back to the side", async () => {
    const page = await ui();
    await run("tabs-position");
    await page.waitForSelector('body[data-layout="classic"] #tabstrip .tab');
    await run("tabs-position");
    await page.waitForSelector('body[data-layout="zen"] #side-head #omnibox');
  });

  await check("compact mode hides the sidebar and the left edge brings it back", async () => {
    const page = await ui();
    const left = () => main(() => [...globalThis.__hillium.shells][0].layout.page.x);
    const wide = await left();
    await run("compact");
    await until(async () => (await left()) < wide - 100, `the page widened (from x=${wide})`).catch(async (e) => {
      throw new Error(`${e.message}; now x=${await left()}, body: ${await page.evaluate(() => [...document.body.attributes].map((a) => a.name).join(" "))}`);
    });
    await page.mouse.move(3, 300);
    await page.waitForSelector("body[data-reveal] #sidebar");
    assert(await main(() => [...globalThis.__hillium.shells][0].overlay), "the revealed sidebar isn't above the page");
    await page.mouse.move(700, 300);
    await page.waitForSelector("body:not([data-reveal])");
    await run("compact");
    await until(async () => (await left()) === wide, "the sidebar back");
  });

  await check("address bar suggests and completes a visited site", async () => {
    const page = await ui();
    const host = new URL(site).host;
    await page.click("#address");
    await page.keyboard.type("news.ex", { delay: 30 });
    await page.waitForSelector("#suggest:not([hidden]) .suggest-item");
    const value = await page.inputValue("#address");
    assert(value === host, `inline completion gave “${value}”`);
    const kinds = await page.$$eval(".suggest-item .suggest-label", (els) => els.map((e) => e.textContent));
    assert(kinds.some((k) => k.includes("Hillium test")), `suggestions: ${kinds.join(" | ")}`);
    writeFileSync(join(shots, "suggestions.png"), await composeWindow(app));
    await page.keyboard.press("Enter");
    await until(async () => (await shell()).url === `${site}/`, "the completed address");
    assert(!(await main(() => [...globalThis.__hillium.shells][0].overlay)), "overlay stayed on after Enter");
  });

  await check("pin, mute, close other tabs, and pinned tabs are saved", async () => {
    await run("new-tab", `${site}/article?n=2`);
    await run("new-tab", `${site}/article?n=3`);
    await until(async () => (await shell()).tabs.length === 3, "3 tabs");
    const third = (await shell()).tabs[2].id;
    await main((_, id) => [...globalThis.__hillium.shells][0].setPinned(id, true), third);
    let s = await shell();
    assert(s.tabs[0].id === third && s.tabs[0].pinned, "the pinned tab didn't move first");
    await (await ui()).waitForSelector(`#essentials .tab[data-id="${third}"]`);
    await main((_, id) => [...globalThis.__hillium.shells][0].setMuted(id, true), third);
    assert(await main((_, id) => [...globalThis.__hillium.shells][0].tab(id).view.webContents.isAudioMuted(), third), "not muted");
    const entries = await main(() => [...globalThis.__hillium.shells][0].sessionEntries());
    assert(entries.some((e) => e.pinned && e.url.includes("n=3")), "the pinned tab isn't in the session");
    const keep = s.tabs[1].id;
    await main((_, id) => { const sh = [...globalThis.__hillium.shells][0]; sh.closeTabs(sh.tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id), id); }, keep);
    s = await shell();
    assert(s.tabs.length === 2 && s.activeId === keep, `after closing others: ${s.tabs.length} tabs`);
    await main((_, id) => [...globalThis.__hillium.shells][0].setPinned(id, false), third);
    await main((_, id) => [...globalThis.__hillium.shells][0].closeTab(id), third);
  });

  await check("blocking can be switched off for one site", async () => {
    const origin = new URL(site).origin;
    await main((_, url) => [...globalThis.__hillium.shells][0].navigate(url), `${site}/`);
    await until(async () => (await shell()).blocked >= 2, "trackers blocked first");
    const page = await ui();
    await run("site-info");
    await page.waitForSelector("#siteinfo:not([hidden]) .si-switch input:checked");
    writeFileSync(join(shots, "site-panel.png"), await composeWindow(app));
    await page.click("#siteinfo .si-switch input");
    await until(async () => (await shell()).blockingOff, "blocking off for the site");
    await until(async () => !(await shell()).loading, "the reload");
    await wait(800);
    assert((await shell()).blocked === 0, "requests still blocked with blocking off");
    await page.keyboard.press("Escape");
    await main((_, o) => globalThis.__hillium.pages.settings.clearSite({ origin: o }), origin);
  });

  await check("site permissions are stored and answer permission queries", async () => {
    const origin = new URL(site).origin;
    await main((_, o) => globalThis.__hillium.pages.settings.setSite({ origin: o, key: "geolocation", value: "allow" }), origin);
    const state = await activeEval("navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)");
    assert(state === "granted", `geolocation is ${state}`);
    await main((_, o) => globalThis.__hillium.pages.settings.clearSite({ origin: o }), origin);
  });

  await check("settings, history and bookmarks open as pages", async () => {
    await run("bookmark");
    await run("settings");
    const settings = await tabPage("hillium://settings/");
    await settings.waitForSelector("#version:not(:empty)");
    writeFileSync(join(shots, "settings.png"), await composeWindow(app));
    await settings.click('label:has(input[name="bookmarksBar"])', { force: true }).catch(() => settings.check('input[name="bookmarksBar"]'));
    await until(() => main(() => globalThis.__hillium.getSettings().bookmarksBar), "the bookmarks bar setting");
    await (await ui()).waitForSelector("#bookmarks-bar:not([hidden]) .bar-item");
    await main(() => globalThis.__hillium.setSettings({ bookmarksBar: false }));
    await run("history");
    const history = await tabPage("hillium://history/");
    await history.waitForSelector(".item a >> text=Hillium test article");
    await run("bookmarks");
    const bookmarks = await tabPage("hillium://bookmarks/");
    await bookmarks.waitForSelector(".item a >> text=Hillium test page");
    for (let i = 0; i < 3; i++) await run("close-tab");
  });

  await check("downloads save to the folder and are listed", async () => {
    await main((_, dir) => globalThis.__hillium.setSettings({ downloadDir: dir }), downloadDir);
    await run("new-tab", `${site}/file.txt`);
    await until(() => existsSync(join(downloadDir, "hillium-e2e.txt")) && readFileSync(join(downloadDir, "hillium-e2e.txt"), "utf8").includes("e2e"), "the downloaded file");
    await until(async () => (await shell()).downloads.recent[0]?.state === "completed", "a completed download");
    await run("downloads");
    const page = await tabPage("hillium://downloads/");
    await page.waitForSelector(".dl .name >> text=hillium-e2e.txt");
    writeFileSync(join(shots, "downloads.png"), await composeWindow(app));
    await run("close-tab");
  });

  await check("web pages can't open or call Hillium's own pages", async () => {
    await main((_, url) => [...globalThis.__hillium.shells][0].navigate(url), `${site}/`);
    await until(async () => (await shell()).url === `${site}/`, "the test page");
    const result = await activeEval(`fetch("hillium://settings/api/get", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status, (e) => "refused")`);
    assert(result === "refused" || result === 403, `fetch answered ${result}`);
    await activeEval(`location.href = "hillium://history/"; window.open("hillium://settings/"); 1`);
    await wait(800);
    const s = await shell();
    assert(s.url === `${site}/` && !s.tabs.some((t) => t.url.startsWith("hillium://settings") || t.url.startsWith("hillium://history")), `got ${s.url}, tabs ${s.tabs.map((t) => t.url).join(" ")}`);
  });

  await check("links from other apps open in a tab", async () => {
    await main((_, url) => globalThis.__hillium.openExternal(url), `${site}/article?from=finder`);
    await until(async () => (await shell()).urls.some((u) => u.includes("from=finder")), "the link in a tab");
    await run("close-tab");
  });

  await check("private tabs stay out of history and the assistant", async () => {
    await run("new-private-tab");
    await main((_, url) => [...globalThis.__hillium.shells][0].navigate(url), `${site}/article?private=1`);
    await until(async () => (await shell()).url.includes("private=1"), "the private page");
    const inHistory = await main(() => globalThis.__hillium.history().some((h) => h.url.includes("private=1")));
    assert(!inHistory, "private page was saved to history");
    const refused = await main(() => [...globalThis.__hillium.shells][0].pageText().then(() => false, () => true));
    assert(refused, "assistant could read a private tab");
    await run("close-tab");
  });

  await check("assistant answers about the page (scripted engine)", async () => {
    await main((_, url) => [...globalThis.__hillium.shells][0].navigate(url), `${site}/article`);
    await wait(800);
    await run("assistant");
    const panel = await until(() => app.windows().find((w) => w.url() === "hillium://app/assistant.html"), "the assistant");
    await panel.waitForLoadState();
    await panel.evaluate(() => {
      globalThis.__hilliumEngineFactory = () => ({
        async chat(messages, onDelta) {
          const last = messages.at(-1).content;
          onDelta(last.includes("Pharos") ? "It is about lighthouses." : "No page text arrived.");
        },
      });
    });
    await panel.fill("#input", "What is this page about?");
    await panel.click("#send");
    await panel.waitForSelector(".msg.assistant:not(.pending)");
    const answer = await panel.textContent(".msg.assistant");
    assert(answer === "It is about lighthouses.", `got “${answer}”`);
    writeFileSync(join(shots, "assistant.png"), await composeWindow(app));
  });

  await check("Tor mode with Tor down fails closed", async () => {
    await main(() => globalThis.__hillium.setSettings({ mode: "tor", torPort: 9 }));
    await main(() => [...globalThis.__hillium.shells][0].navigate("https://example.com/"));
    await until(async () => (await shell()).status, "the kill-switch banner");
    const { status } = await shell();
    // The address bar shows the failed URL on purpose; the page itself must not have loaded.
    const text = await main(() => [...globalThis.__hillium.shells][0].active.view.webContents.executeJavaScript("document.title + ' ' + (document.body?.innerText ?? '')"));
    assert(!/Example Domain/.test(text), "example.com loaded without Tor");
    writeFileSync(join(shots, "kill-switch.png"), await composeWindow(app));
    await main(() => globalThis.__hillium.setSettings({ mode: "direct" }));
    console.log(`    banner: ${status}`);
  });

  if (process.env.AI) {
    await check("MiniCPM-V summarizes a page (real model)", async () => {
      await main((_, url) => [...globalThis.__hillium.shells][0].navigate(url), `${site}/article`);
      await until(async () => (await shell()).url === `${site}/article`, "the article");
      const panel = app.windows().find((w) => w.url() === "hillium://app/assistant.html");
      await panel.evaluate(() => delete globalThis.__hilliumEngineFactory);
      await panel.reload();
      await panel.waitForLoadState();
      if (await panel.locator("#download").isVisible()) {
        await panel.click("#download");
        await panel.waitForFunction(() => document.getElementById("setup").hidden, null, { timeout: 900000 });
      }
      await panel.waitForFunction(() => /WebGPU|CPU/.test(document.getElementById("model-line").textContent), null, { timeout: 300000 });
      const ask = async (action) => {
        const before = await panel.locator(".msg").count();
        const started = Date.now();
        await panel.click(`[data-action="${action}"]`);
        await panel.waitForFunction((n) => { const m = [...document.querySelectorAll(".msg")]; return m.length >= n + 2 && !m.at(-1).classList.contains("pending"); }, before, { timeout: 300000 });
        const answer = (await panel.locator(".msg").last().textContent()).replace(/\s+/g, " ");
        console.log(`    ${action} (${((Date.now() - started) / 1000).toFixed(1)} s): ${answer.slice(0, 260)}`);
        return answer;
      };
      console.log(`    ${await panel.textContent("#model-line")}`);
      assert(/lighthouse|ship|pharos|alexandria/i.test(await ask("summarize")), "the summary doesn't mention the page");
      assert((await ask("look")).length > 20, "no description of the screenshot");
      writeFileSync(join(shots, "assistant-real.png"), await composeWindow(app));
    });
  }

  await check("no script errors in Hillium's pages", async () => {
    assert(!errors.length, errors.join("\n"));
  });
} finally {
  await app.close().catch(() => {});
  server.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(downloadDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed. Screenshots: test/screenshots/`);
process.exit(failed ? 1 : 0);
