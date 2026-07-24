# Codenames Trainer

Local-first Vite application for embedding-powered Codenames clue recommendations.

## Checks

- Run `npm test` before publishing changes. It covers the smoke suite, production build, and responsive Playwright tests.
- Playwright owns port `42873` with server reuse disabled. Keep it isolated so tests cannot silently run against another repo's local server.
- Keep generated Extended word data and `scripts/generated/extended-word-report.json` in sync with `npm run generate:extended`.
- Run `npm run evaluate:embeddings` to refresh the human-data embedding comparison and `scripts/generated/embedding-model-comparison.json`. The benchmark pins Cultural Codes and Connector upstream commits and keeps their data under `.cache`; neither upstream repository declares a license, so do not vendor or redistribute those datasets.
- Keep `scripts/generated/clue-words.json` and every selectable `public/data/model-lab/<model>/` manifest/shard set in sync with `npm run generate:data`. Picker indexes are incremental 0-3k, 3k-10k, 10k-30k, and 30k-100k shards and all use the 30k-corpus mean; do not change one shard independently. The hidden L12 and MPNet comparison artifacts remain capped at 30k.
- Run `npm run evaluate:candidates` after changing clue filtering or ordering. It measures exact vocabulary coverage against cached/fetched Cultural Codes and Connector clues and updates `scripts/generated/candidate-coverage.json`. Keep only all-letter single-word observations; rejecting spaces and punctuation avoids turning multi-word clues into artificial compounds.
- Run `npm run benchmark:picker` after changing scoring performance or selectable model/index dimensions. It benchmarks every picker cell in one Node process with warmups and repeated runs, then updates `scripts/generated/model-picker-benchmark.json`.

## Embedding Model Evaluation

- Mean-centering improves every tested model on the human Codenames datasets; compare centered variants when evaluating a production swap. The checked report and runtime indexes use the same 30,000-clue centering corpus, including the experimental 100k tail.
- The July 2026 benchmark identifies BGE-small as the strongest target-recall candidate and MiniLM-L12 as the strongest two-target candidate with more avoid-word errors. Treat this as an embedding-layer result, not proof that generated clue rankings improve end to end.
- Model size is not a quality proxy here: centered MiniLM-L3 is 17.5 MB with 56.09% target recall, while 110 MB MPNet-base reaches only 55.85%; both trail the 23 MB MiniLM-L6 default at 57.43%.

## Share Compatibility

- Current share links use v3 and the 800-word Extended pool.
- Preserve v1 links against the historical 366-word pool and v2 links against the former 407-word Extended pool. Do not silently decode old links with the current word bank.

## Play Mode

- Train and Play are separate UI modes. Preserve Train recommendation/apply behavior when changing Play.
- Play defaults to the preserved table order. Spymasters can switch to a team-grouped key view; operatives must remain in the preserved table order so sorting never reveals hidden roles.
- `src/play/game-state.js` is the pure rules and event-history owner. Keep clue, guess, pass, turn-end, assassin, and final-agent behavior out of UI event handlers.
- `src/play/mode.js` owns Play DOM rendering, model orchestration, bot pacing, setup, undo, and resume. Keep `src/app.js` focused on Train and top-level mode switching.
- Bot operatives must receive only public clue-to-word similarity candidates. Do not pass hidden roles, intended target IDs, recommendation danger metrics, or the full analysis into `chooseBotGuess`.
- Play sessions use versioned local storage key `codenames-play-session-v1`. Board share links remain board-only and retain v1-v3 compatibility.
- `scripts/play-smoke.mjs` is the headless Play gate. Keep it in `npm run check` alongside the existing trainer smoke suite.
- Run `npm run benchmark:play` after changing Play clue or guess policy. It runs 100 paired deterministic boards through complete games and updates `scripts/generated/play-policy-benchmark.json` plus the Markdown summary beside it; keep clue distribution, correct cards per turn, wrong-team hits, assassin rate, turns per game, and bounded completion covered by the smoke gate.
- Run `npm run analyze:play-clues` after changing the Play embedding, candidate depth, word set, or multi-clue score. It compares identical opening boards and updates `scripts/generated/play-clue-bias-analysis.json`.
- The full-game benchmark accepts `--model`, `--word-set`, `--clue-selection`, `--multi-tolerance`, and `--bonus-guesses` for controlled policy experiments. Keep the default command aligned with production behavior.
- Same-model spymaster and operative self-play overstates agreement. Treat self-play safety metrics as regression signals, then validate clue policy against human guesses before using them as real-world error estimates.
- The full-game benchmark uses and counts a legal number-1 fallback when the analyzer returns no ranked clue. Do not omit those end states from aggregate policy results.

## Deployment

- GitHub: `https://github.com/andybergon/codenames`
- Vercel project: `codenames`
- Production: `https://codenames.andybergon.me`
- Public Vercel alias: `https://codenames-trainer.vercel.app`
- Deploy through pushes to `main`; do not upload the working directory directly with the Vercel CLI.
- Keep Vercel SSO deployment protection disabled so the public `vercel.app` alias does not redirect visitors to Vercel login.
- Cloudflare owns DNS. The production record is a DNS-only `CNAME` from `codenames.andybergon.me` to `90043d1adb0620da.vercel-dns-016.com`.
