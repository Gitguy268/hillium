# Threat model

What Hillium protects against, what it doesn't, and why. "Hillium" here means stock Helium plus the Hillium Home extension and scripts in this repository.

## What it helps with

| Threat | Protection | Strength |
|---|---|---|
| Ad and tracker networks following you across sites | Helium's uBlock Origin, third-party cookie blocking | Strong |
| Tracking IDs in links (`utm_*`, `fbclid`, `gclid`, …) | Hillium's offline URL cleaner, plus uBO's URL Tracking list once Helium services are on | Good for the 27 known parameter families; unknown ones pass |
| Your search engine building a profile of you | Local SearXNG: engines see queries from your IP, but no cookies, account or browser profile | Medium |
| Sites learning your IP | The Tor or proxy switch | Strong while it's on |
| A dropped Tor or proxy leaking your real IP | The kill switch (no fallback to a direct connection) | Strong, in normal windows |
| DNS lookups leaking outside Tor | DNS prefetching off while proxied; SOCKS5 resolves hostnames at the proxy | Good. Not yet checked with a packet capture |
| WebRTC revealing your local or real IP | `disable_non_proxied_udp` | Strong |
| Your ISP or network seeing DNS lookups | Helium's DNS-over-HTTPS (turn it on in Settings) | Strong for DNS. The site's hostname is still visible in TLS unless ECH is used |
| Simple fingerprinting scripts | Helium's noise on canvas, audio and `hardwareConcurrency` | Partial |

## What it doesn't protect against

- **Being identified while using Tor.** Tor Browser makes every user look the same. Hillium does not: your screen size, fonts, extensions and many other signals stay unique, so a site can recognise you across visits even through Tor. **If your safety depends on anonymity, use Tor Browser.**
- **Search engines seeing your queries.** In Direct mode, SearXNG sends your queries to Google, Bing, DuckDuckGo and others from your IP. In Tor or proxy mode, Hillium sends searches to a public SearXNG instance through Tor instead, and that instance's operator can see your queries.
- **Incognito windows.** The proxy, kill switch and WebRTC settings apply to normal windows. Incognito uses them only if you allow the extension in incognito.
- **Turning it off.** Hillium Home is an unpacked extension, so it can be disabled in `chrome://extensions`. When it is disabled, the proxy, the WebRTC block and the cleaner all stop.
- **Malware on your Mac, or a compromised Helium build.** Hillium runs inside the browser and trusts it.
- **Everything outside the browser.** Other apps keep using your normal connection.

## Trust

- **Helium.** You trust the Helium binary from imputnet's GitHub releases.
- **imputnet's servers.** You trust them only if you turn on Helium services without setting your own origin. With `services/run-local.sh`, filter lists and bangs come from your own machine, which fetches them from the original list hosts.
- **The public SearXNG instance** (default `searx.tiekoetter.com`, which you can change in the popup) sees fallback searches and all searches made in Tor mode.
- **The pinned SearXNG commit**, installed from GitHub.

## Reporting

Found a way around any of this? Please report it privately; see [SECURITY.md](../SECURITY.md).

## Hillium Browser

Hillium Browser (`browser/`) gives the same protection in its own Chromium shell, with some differences:

- **Every session is covered.** The proxy, the kill switch, the WebRTC block, the URL cleaner and ad blocking apply to normal tabs, private tabs, Glance, the assistant and the browser's own pages, including the block-list and model downloads.
- **Nothing can switch it off.** No extension can disable it.
- **No fingerprint noise.** Electron doesn't have Helium's canvas and audio noise, so fingerprinting is easier than in Helium.
- **Updates.** Chromium security fixes arrive with Electron releases. Keep `npm update electron` current.
- **The assistant runs locally.** Page text and screenshots stay on your Mac. Page text is passed to the model as quoted data. A small model can still be misled by text written into a page, but it has no tools: it can't click, type or browse.
- **Web pages run sandboxed.** They get no preload and no Node. Only Hillium's own `hillium://app` pages can talk to the browser.
