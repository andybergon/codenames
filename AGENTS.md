# Codenames Trainer

Local-first Vite application for embedding-powered Codenames clue recommendations.

## Checks

- Run `npm test` before publishing changes. It covers the smoke suite, production build, and responsive Playwright tests.
- Playwright owns port `42873` with server reuse disabled. Keep it isolated so tests cannot silently run against another repo's local server.
- Keep generated Extended word data and `scripts/generated/extended-word-report.json` in sync with `npm run generate:extended`.
- Run `npm run evaluate:embeddings` to refresh the human-data embedding comparison and `scripts/generated/embedding-model-comparison.json`. The benchmark pins Cultural Codes and Connector upstream commits and keeps their data under `.cache`; neither upstream repository declares a license, so do not vendor or redistribute those datasets.

## Embedding Model Evaluation

- Mean-centering improves every tested model on the human Codenames datasets; compare centered variants when evaluating a production swap.
- The July 2026 benchmark identifies BGE-small as the best balanced candidate and MiniLM-L12 as the strongest two-target candidate with more avoid-word errors. Treat this as an embedding-layer result, not proof that generated clue rankings improve end to end.

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
