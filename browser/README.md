# Hillium Browser

A Chromium browser for macOS with Hillium's privacy features built in. Tabs, the address field and the buttons live in a sidebar, as in Zen, and the page sits next to it as a card. You can also put the tabs on top for a Chrome-style window, or switch to the Windows 98 or Liquid Glass look. Electron supplies the engine, so it runs without compiling Chromium.

## Install

```sh
npm ci
npm run dist          # builds dist/mac-arm64/Hillium.app (unsigned, signed ad hoc)
npm run install-app   # copies it to /Applications
```

Then choose Hillium under System Settings › Desktop & Dock › Default web browser, or click **Make Default** in Hillium's settings.

To run it from this folder instead, double-click `start.command`, or run `npm start`. The first run installs Electron and the ad blocker (about 350 MB, needs Node.js 20 or later). Running from source can't be the default browser.

Your data lives in `~/Library/Application Support/Hillium Browser`. Search uses the SearXNG from `../searxng/install.sh` at `127.0.0.1:8888`. When it isn't running, searches go to the public fallback.

## What's in it

| | |
|---|---|
| **Sidebar** | Back, forward, reload and the address at the top. Pinned tabs as a grid of icons, then your tabs, then New Tab. Drag a tab onto the grid to pin it |
| **Compact mode** | ⌃⌥C hides the sidebar. Move the pointer to the window's left edge and it slides back in |
| **Address bar** | Suggestions from open tabs, bookmarks and history as you type, and the site's address completed in place. Search suggestions from your SearXNG are opt-in |
| **Tabs** | Right-click for pin, mute, duplicate, move to a new window and close others. A speaker icon on tabs playing sound. Tabs on top (Chrome style) if you prefer |
| **Site panel** | Click the icon left of the address: the connection, camera, microphone, location and notification permissions, and a switch to turn blocking off for that site |
| **Pages** | Settings, History, Bookmarks and Downloads open as tabs (⌘, ⌘Y ⌥⌘B ⇧⌘J) |
| **Downloads** | Files go straight to Downloads, or ask each time. A progress ring on the downloads button |
| **Import** | Bookmarks from Chrome, Brave, Edge, Helium, Vivaldi, Firefox, Zen, Waterfox and LibreWolf, from Settings |
| **Privacy** | Ghostery's ad blocker with EasyList, EasyPrivacy and the cookie-notice lists. Hillium's URL cleaner. Tor or a proxy with a kill switch for every tab. A WebRTC leak block. Private tabs (⇧⌘N) in a separate in-memory session |
| **Assistant** | ⇧⌘A, or the speech-bubble button. MiniCPM-V 4.7 1B on this Mac: it summarizes the page, answers questions about it and describes a screenshot. Private tabs are never read |
| **Looks** | Normal follows macOS light, dark and accent colour. Liquid Glass puts native glass behind the sidebar. Windows 98 has a caption bar, a coolbar and a status bar |

<details>
<summary><b>Keyboard shortcuts</b></summary>

| Action | Shortcut |
|---|---|
| New tab / window / private tab | ⌘T / ⌘N / ⇧⌘N |
| Close / reopen tab | ⌘W / ⇧⌘T |
| Address | ⌘L |
| Next / previous tab, tab 1–9 | ⌃Tab / ⇧⌃Tab (or ⌥⌘→ / ⌥⌘←), ⌘1–⌘9 |
| Compact mode | ⌃⌥C |
| Bookmarks bar | ⇧⌘B |
| Bookmark / bookmarks | ⌘D / ⌥⌘B |
| History / downloads / settings | ⌘Y / ⇧⌘J / ⌘, |
| Find / print / save page | ⌘F / ⌘P / ⌘S |
| Commands | ⌘K |
| Assistant / summarize / describe page | ⇧⌘A / ⇧⌘U / ⇧⌘L |
| View source / developer tools | ⌥⌘U / ⌥⌘I |

</details>

<details>
<summary><b>About the model</b></summary>

The assistant uses [MiniCPM-V 4.7 1B](https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf) (Apache-2.0) in llama.cpp's GGUF format: the Q4_K_M language model (672 MB) and its image projector (901 MB), pinned at revision `9684c734`.

The [int4 checkpoint](https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-int4) is a bitsandbytes NF4 file for CUDA GPUs, which can't run on a Mac. This is the same model in the format that can.

- **Download.** The first time you open the assistant, it downloads both files from Hugging Face in 64 MiB pieces. Each piece is checked against a pinned SHA-256 before it's kept, so a stopped download resumes where it left off.
- **Existing copies.** A copy already on this Mac (in `~/minimind-mermaid/gguf/`) is checked and hard-linked instead of downloaded again.
- **Tor and proxy.** Downloads go through Tor or the proxy when one is on.
- **Engine.** It runs on [wllama](https://github.com/ngxson/wllama), which is llama.cpp in WebAssembly, using a master build vendored in `ui/vendor/wllama/`.

</details>

<details>
<summary><b>How it fits together</b></summary>

- **`main/`** is the Electron main process.
  - `shell.js`: one window. The toolbar page fills it, and the active tab's view sits in the rectangle the toolbar page reports.
  - `sessions.js`: proxy, permissions and the request filter for every session.
  - `filter.js`: the single `onBeforeRequest` dispatcher. The order is Ghostery, then the URL cleaner, then the Tor search redirect.
  - `suggest.js`: address bar ranking. `importers.js`: bookmark import. `downloads.js`: downloads.
  - `protocol.js` and `pages.js`: `hillium://` and the data behind its pages.
- **`ui/`** holds Hillium's own pages: `chrome.html` (sidebar, toolbar, popovers), `assistant.html`, `newtab/` and `pages/` (settings, history, bookmarks, downloads).
- **Hillium pages in tabs.** They run in the web session without Node or a preload. Each gets a per-launch token in its HTML, and its data endpoints refuse requests without it, so web pages can't read or change them. Web pages also can't navigate to, open or frame `hillium://` pages.
- **Reused from the extension.** `../extension/lib.js` (proxy, WebRTC, search fallback) and `../extension/url-cleaner.json` are imported directly, so the extension and the browser stay in step. The packaged app carries copies in its Resources folder.
- **Popovers.** While one is open, the toolbar page moves above the web page. Its background gets holes where the page and the assistant are, so they show through.

</details>

## Limits

- **It's Electron, not Helium.** There's no fingerprint noise, and Chromium updates arrive with Electron releases. Use Tor Browser if you need anonymity.
- **No Chrome extensions, saved passwords or sync.**
- **Unsigned.** The app is signed ad hoc, so macOS may ask you to confirm the first launch (right-click › Open).
- **Liquid Glass is native glass on macOS 26 and later.** Earlier macOS gets vibrancy.

## Development

```sh
npm test       # unit tests: filter, proxy, address parsing, suggestions, import, page API, model pin
npm run e2e    # Playwright drives the real app; writes screenshots to test/screenshots/
```

`npm run e2e` needs Playwright. Set `PLAYWRIGHT=/path/to/node_modules/playwright` if it isn't installed here. `AI=1 npm run e2e` also loads the real model, which needs the files and a few minutes.
