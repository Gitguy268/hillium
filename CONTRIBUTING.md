# Contributing

Thanks for helping with Hillium.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/Gitguy268/hillium/issues/new/choose) and use the template. Say which Helium and macOS versions you use, and which network mode was on.

Report security problems, such as a leak around the kill switch, privately: see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Load `extension/` unpacked in Helium (`chrome://extensions` → Developer mode → Load unpacked). After each edit, click the reload icon on the extension's card.
3. Keep commits small, each with a clear message.
4. Run the checks below and update the README or the threat model if behaviour changed.
5. Open a pull request and fill in the template.

## Checks

```sh
node --test extension/                     # unit tests, no install needed (Node 24, see .nvmrc)
shellcheck searxng/*.sh services/*.sh branding/*.sh
HELIUM=/Applications/Helium.app \
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
node tests/e2e.mjs                         # end-to-end in a real Helium
```

CI runs the first two. The end-to-end test needs Helium, so run it yourself and say in the pull request that you did.

Ground rules for the extension:
- The new tab page must make **no** network requests. The end-to-end test checks this.
- Anything that touches the proxy must **fail closed**: block traffic rather than send it direct.
- Add no runtime dependencies.

## Licences

Hillium is GPL-3.0 (see [LICENSE](LICENSE)), and your contribution is accepted under the same licence. Don't add libraries, fonts or images unless their licence allows redistribution under GPL-3.0, and list each one in [NOTICE](NOTICE) in the same pull request.
