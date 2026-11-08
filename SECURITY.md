# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/hillium/security/advisories/new>

Include what you found, how to reproduce it, and your Helium and macOS versions. You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

[docs/threat-model.md](docs/threat-model.md) says what Hillium does and doesn't try to protect against. The most useful reports are about:

- traffic that leaves without the proxy while Tor or proxy mode is on (the kill switch failing);
- a WebRTC, DNS or search request that reveals the real IP in Tor mode;
- the new tab page making a network request;
- the scripts in `searxng/` or `services/` exposing a service beyond `127.0.0.1` / `localhost`, or leaking the secrets they generate;
- the GitHub Actions workflows in this repository.

Bugs in Helium itself belong with [Helium](https://github.com/imputnet/helium/security), and bugs in SearXNG with [SearXNG](https://github.com/searxng/searxng/security).

## Supported versions

Only the latest version on the `main` branch is supported.
