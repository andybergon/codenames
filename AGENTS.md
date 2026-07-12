# Codenames Trainer

Local-first Vite application for embedding-powered Codenames clue recommendations.

## Checks

- Run `npm test` before publishing changes. It covers the smoke suite, production build, and responsive Playwright tests.
- Keep generated Extended word data and `scripts/generated/extended-word-report.json` in sync with `npm run generate:extended`.

## Share Compatibility

- Current share links use v3 and the 800-word Extended pool.
- Preserve v1 links against the historical 366-word pool and v2 links against the former 407-word Extended pool. Do not silently decode old links with the current word bank.

## Deployment

- GitHub: `https://github.com/andybergon/codenames`
- Vercel project: `codenames`
- Production: `https://codenames.andybergon.me`
- Public Vercel alias: `https://codenames-trainer.vercel.app`
- Deploy through pushes to `main`; do not upload the working directory directly with the Vercel CLI.
- Keep Vercel SSO deployment protection disabled so the public `vercel.app` alias does not redirect visitors to Vercel login.
- Cloudflare owns DNS. The production record is a DNS-only `CNAME` from `codenames.andybergon.me` to `90043d1adb0620da.vercel-dns-016.com`.
