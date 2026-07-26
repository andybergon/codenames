# Codenames Trainer

Local-first Vite application for embedding-powered Codenames clue recommendations.

## Checks

- Run `npm test` before publishing changes. It covers the smoke suite, production build, and responsive Playwright tests.
- Playwright owns port `42873` with server reuse disabled. Keep it isolated so tests cannot silently run against another repo's local server. If another Codenames worktree already owns the port, use a temporary config with a distinct port; do not stop the other worktree's server.
- Playwright explicitly clears `DATABASE_URL` and `CALIBRATION_SYNC_SECRET`. Keep browser tests isolated from real calibration answers even when `.env.local` is configured.
- Play suggestion UI tests use the development-only `analysisExecutor` and `guessCandidateExecutor` options in `src/play/mode.js`. Keep their fixtures deterministic and block external requests so UI coverage never downloads embedding models.
- Keep generated Extended word data and `scripts/generated/extended-word-report.json` in sync with `npm run generate:extended`.
- Run `npm run evaluate:embeddings` to refresh the human-data embedding comparison and `scripts/generated/embedding-model-comparison.json`. The benchmark pins Cultural Codes and Connector upstream commits and keeps their data under `.cache`; neither upstream repository declares a license, so do not vendor or redistribute those datasets.
- Keep `scripts/generated/clue-words.json` and every selectable `public/data/model-lab/<model>/` manifest/shard set in sync with `npm run generate:data`. Picker indexes are incremental 0-3k, 3k-10k, 10k-30k, and 30k-100k shards and all use the 30k-corpus mean; do not change one shard independently. The hidden L12 and MPNet comparison artifacts remain capped at 30k.
- Run `npm run evaluate:candidates` after changing clue filtering or ordering. It measures exact vocabulary coverage against cached/fetched Cultural Codes and Connector clues and updates `scripts/generated/candidate-coverage.json`. Keep only all-letter single-word observations; rejecting spaces and punctuation avoids turning multi-word clues into artificial compounds.
- Run `npm run evaluate:explanations -- --max-cost-usd 0.08` after changing recommendation explanation rules or prompts. It compares three low-cost OpenAI models across varied semantic relationships, uses GPT-5.6 Sol as a blinded judge, and updates `scripts/generated/recommendation-explanation-evaluation.json`. Refresh model availability and prices from official OpenAI docs before a paid rerun, inject only `OPENAI_API_KEY`, and keep the hard cap.
- Run `npm run benchmark:picker` after changing scoring performance or selectable model/index dimensions. It benchmarks every picker cell in one Node process with warmups and repeated runs, then updates `scripts/generated/model-picker-benchmark.json`.
- Run `npm run evaluate:italian` when changing the Italian feasibility fixture or candidate models. It uses only original test terms, writes `scripts/generated/italian-embedding-feasibility.json`, and does not import the official Italian card list.
- Run `npm run generate:italian` after changing `scripts/italian/extended-words.txt`, the pinned Leipzig source, Italian clue filters, E5 revision or prefix, centering, or shard boundaries. Keep `src/generated/italian-word-data.js` and `public/data/model-lab/it/multilingual-e5-small/` synchronized. The source-created pool is not an official Italian list.
- Keep `docs/clue-engine.md` synchronized with model/index selection, legality rules, scoring coefficients, lane thresholds, board metrics, generated assets, and evaluation commands. README remains the compact product and setup entry point.
- `server/recommendation-explanation-prompt.js` owns Train's semantic explanation contract. Keep the shared-concept opening, explicit relationship for every target, bounded structured output, and current judge-selected model synchronized with `docs/clue-engine.md`.
- `src/recommendation-explanation.js` owns the local score summary and score-grounded risk sentence. Keep danger roles and margins out of the hosted semantic prompt.
- Semantic explanations must remain explicit paid actions. Train requests one selected recommendation, and Play offers the same action only after a completed game reveals the clue's intended targets.
- Bump the session cache key in `src/recommendation-explanation-client.js` whenever the semantic prompt version or production model changes.
- Local semantic development uses `npm run dev:semantic`, which narrowly reads `CODENAMES_OPENAI_API_KEY` from Doppler `apps/shared` when `OPENAI_API_KEY` is absent. Production requires the server-side Vercel variable and must never expose it through Vite client environment variables.

## Embedding Model Evaluation

- Mean-centering improves every tested model on the human Codenames datasets; compare centered variants when evaluating a production swap. The checked report and runtime indexes use the same 30,000-clue centering corpus, including the experimental 100k tail.
- The July 2026 benchmark identifies BGE-small as the strongest target-recall candidate and MiniLM-L12 as the strongest two-target candidate with more avoid-word errors. Treat this as an embedding-layer result, not proof that generated clue rankings improve end to end.
- Model size is not a quality proxy here: centered MiniLM-L3 is 17.5 MB with 56.09% target recall, while 110 MB MPNet-base reaches only 55.85%; both trail the 23 MB MiniLM-L6 default at 57.43%.
- Use `npm run prepare:embedding-candidate -- --output <experiment-dir>` and `npm run finalize:embedding-candidate -- --experiment-dir <experiment-dir>` for external candidate models. Keep vectors and indexes under `.cache`, then check in only the compact report produced by `npm run summarize:embedding-candidates`.
- Local MLX candidate runs must preserve the model's symmetric task format. Jina v5 text-small uses its text-matching adapter with the `Document:` prefix. Qwen3 Embedding uses the same semantic-similarity instruction for every clue and board word.
- The July 2026 external sweep keeps BGE-small in production. Qwen3 Embedding 0.6B improved same-model Fun but failed cross-model safety. Gemini Embedding 2 produced the strongest human clue recovery but much lower full-game Fun. ConceptNet and Gemini are future ensemble signals rather than standalone replacements.
- Use `npm run embed:gateway-candidate` for resumable OpenRouter or Vercel AI Gateway runs. Keep an explicit cost cap, tune batch size before a full run, and preserve the fixed task prefix across clue and board terms.
- Before relying on Vercel free credits for an embedding benchmark, verify sustained multi-request throughput. A visible balance and one successful probe do not prove that model-level free-tier limits permit corpus generation.
- When a paid credit top-up is required, report the credit purchase, fees, and tax separately from measured model usage. Keep the generation resumable and retain the original per-model cost cap.
- Jina v5 text-small is CC BY-NC 4.0, and ConceptNet Numberbatch is CC BY-SA 4.0. Do not distribute their models or derived indexes without reviewing those licenses.

## Share Compatibility

- English share links use v3 and the 800-word Extended pool. Italian Train and Play board links use v4 with language and `it:extended-v1` asset identity.
- Preserve v1 links against the historical 366-word pool and v2 links against the former 407-word Extended pool. Do not silently decode old links with the current word bank.
- Unknown v4 language or asset versions must fail closed. Do not fall back to English.

## Play Mode

- Train and Play are separate UI modes. Preserve Train recommendation/apply behavior when changing Play.
- Bare app URLs default to Play. Use `?mode=train` for Train, including board-only share links that rely on Train's shared-board decoder.
- Play defaults to the preserved table order. Spymasters can switch to a team-grouped key view; operatives must remain in the preserved table order so sorting never reveals hidden roles.
- `src/play/game-state.js` is the pure rules and event-history owner. Keep clue, guess, pass, turn-end, assassin, final-agent, and history-restoration behavior out of UI event handlers.
- Reconstruct post-game clue turns from ordered event history. Completion-gate replay and operative score overlays so live operative views never expose intended targets, hidden roles, or analysis. Keep selected and hovered review treatment spanning the clue plus every guess, pass, and outcome row in that turn.
- `src/play/settings.js` owns validated Play bot defaults and saved configuration. Keep Play settings independent from Train's Model picker.
- `src/play/word-reuse.js` owns the fully-random and avoid-recent board policies plus the bounded `codenames-play-word-reuse-v1` history. Record started boards under both policies, preserve the selected policy when clearing history, and prefer least-recently-used words only after unseen words cannot fill 25 cards.
- `src/play/mode.js` owns Play DOM rendering, model orchestration, bot pacing, setup, resume, backward/forward history controls, and post-game score overlays. Keep `src/app.js` focused on Train and top-level mode switching.
- `src/info-control.js` owns the accessible tooltip control and viewport-aware positioning shared by Train and Play.
- Bot operatives must receive only public clue-to-word similarity candidates. Do not pass hidden roles, intended target IDs, recommendation danger metrics, or the full analysis into `chooseBotGuess`.
- Public remaining-agent scores are visible to operatives and must use authoritative `game.cards`. Do not derive them from `publicGameView`, which removes unrevealed team identities.
- Developer games use the root `developerMode` marker, repeat it on the canonical `game-started` event, and retain versioned score and bot-decision diagnostics on the related history events. Preserve these fields in completed-game archives and full-game share payloads so analytics can filter developer-generated data. Developer mode is selected before a new game, while the live diagnostics checkbox controls display only.
- Play sessions use versioned local storage key `codenames-play-session-v1` and persist their language. Recent-word history uses `codenames-play-word-reuse-v1` and keeps at most 32 boards. Board share links remain board-only and retain v1-v4 compatibility; avoid-recent boards require explicit links because their words are history-dependent. English stays the first-visit default; Italian Play is an explicit beta.
- New Play games reuse the current or validated saved human seat. Only the explicit Random control rerolls it; missing, stale, or invalid session data receives a fresh random seat.
- `scripts/play-smoke.mjs` is the headless Play gate. Keep it in `npm run check` alongside the existing trainer smoke suite.
- Run `npm run benchmark:play` after changing Play clue or guess policy. It supports frozen smoke, calibration, development, and test board splits. Use `--comparison-only` for embedding selection, then compare full reports with `npm run benchmark:compare`. Keep first-half mean clue number, clue distribution, low-similarity clue-number fills, pre-number passes, correct cards per turn, wrong-team hits, assassin rate, turns per game, and bounded completion covered by the smoke gate.
- Run `npm run benchmark:play:italian` and `npm run benchmark:play:italian-transfer` after changing Italian Play assets, legality, or policy. Keep the same-model and MiniLM operative reports separate because same-model safety overstates clue-to-guess agreement.
- The Play Fun Index balances ambition, momentum, suspense, and flow. Treat wrong-team hits, assassin losses, neutral hits, fallbacks, human embedding agreement, and cross-model transfer as promotion guardrails, not point-scoring opportunities.
- Use `--operative-model <model-id>` for cross-model stress tests. Same-model self-play remains the production regression baseline but overstates clue-to-guess agreement.
- Use `--report-detail compact` for checked cross-model reports that need aggregate policy and operative metrics without duplicating per-game records.
- Hosted embedding experiments must use a cached, resumable provider script with an explicit preflight and billed-cost cap, followed by the human-data gate. Keep generated vectors under `.cache`; check in only compact reports and conclusions.
- The production Play defaults are BGE-small, 10,000 candidates, hybrid scoring, a five-point multi-clue tolerance, late missed-target recovery, Dynamic operative aggression, and passing at the declared clue number. Late recovery strongly prefers never-targeted friendly cards until few remain; Balanced mixes missed targets from mid-game, and Immediate applies no fresh-target bias. Dynamic operative aggression may use guesses made, clue number, and public remaining-agent counts, but no hidden role or intended-target data. Keep each parameter overridable in Play setup and persisted in the saved game.
- Run `npm run analyze:play-clues` after changing the Play embedding, candidate depth, word set, or multi-clue score. It compares identical opening boards and updates `scripts/generated/play-clue-bias-analysis.json`.
- The full-game benchmark accepts `--language`, `--model`, `--word-set`, `--clue-selection`, `--multi-tolerance`, `--missed-target-timing`, `--operative-aggression`, `--bonus-guesses`, `--similarity-scale`, and `--similarity-offset` for controlled policy experiments. Match candidate similarity geometry to BGE-small with `npm run benchmark:calibrate-similarity` before comparing absolute thresholds or multi-tolerance values. Keep the default command aligned with English production behavior.
- Same-model spymaster and operative self-play overstates agreement. Treat self-play safety metrics as regression signals, then validate clue policy against human guesses before using them as real-world error estimates.
- Italian generated clue scoring applies a pairwise orthographic false-friend penalty. Keep `MONOLOGO → MONGOLFIERA` and `PARTONO → PANTERA + BURATTINO` as rejected regression fixtures, preserve the allowed semantic controls, and refresh the Italian feasibility and both full-game benchmarks when changing its thresholds.
- The full-game benchmark uses and counts a legal number-1 fallback when the analyzer returns no ranked clue. Do not omit those end states from aggregate policy results.
- The full-game benchmark forces the highest-similarity available guess after two consecutive passes and reports those guesses separately. This keeps cross-model stress tests bounded without changing live Play behavior.
- The hidden `?mode=calibrate` page owns versioned blinded human rounds. Keep public definitions under `public/data/calibration/`, separate model and role answer keys under `scripts/generated/calibration-answer-keys/`, and JSON import/export compatible so answers can be corrected or later rounds added. Guesses, ratings, notes, and timestamped deletion records persist to the versioned local storage record and sync through `api/calibration.js` when `DATABASE_URL` and `CALIBRATION_SYNC_SECRET` are configured. Preserve newest-event reconciliation, stale-write conflicts, transient retries, and tombstones so cleared or invalidated answers cannot reappear. Keep the production sync key server-side, use the HTTP-only pairing cookie, and bypass it only for loopback socket addresses in Vite. Retain local-only behavior when the database is unavailable. Empty passes require an explicit action. Treat the first single-rater round as a gross-failure disqualifier, not a model ranker.
- Keep `scripts/generated/embedding-finalist-protocol.json` synchronized with frozen model-selection splits, calibrated transforms, promotion gates, and held-out eligibility. Cross-model transfer is the primary model-selection screen. Same-model self-play remains a regression and efficacy screen.

## Deployment

- GitHub: `https://github.com/andybergon/codenames`
- Vercel project: `codenames`
- Production: `https://codenames.andybergon.me`
- Public Vercel alias: `https://codenames-trainer.vercel.app`
- Deploy through pushes to `main`; do not upload the working directory directly with the Vercel CLI.
- Keep Vercel SSO deployment protection disabled so the public `vercel.app` alias does not redirect visitors to Vercel login.
- Cloudflare owns DNS. The production record is a DNS-only `CNAME` from `codenames.andybergon.me` to `90043d1adb0620da.vercel-dns-016.com`.
