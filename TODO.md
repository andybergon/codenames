# TODO

- 🏆 Support a full match across rotating roles.
  - Design a multi-round match that rotates players through roles and tracks an overall result instead of treating each board as the whole game.
  - Planning only for now; do not implement it as part of the current feedback batch.

## 🚨 Critical

- 🤖 Evaluate an LLM reranker as a benchmarked candidate policy.
  - Keep the embedding system as the safe shortlist generator, pass the selected clue through the existing engine, and compare fairly against the embedding-only accepted baseline.
  - The subscription CLI screen found smoke regressions for Claude Opus, GPT-5.6 Sol, and GPT-5.6 Terra. Sol and Terra also regressed on development; Opus reached its monthly subscription limit during development. None currently justifies an API rollout.
  - Preflight with an absolute total API spend cap of `$5` unless the user explicitly raises it. The first pass must be a tiny equivalent smoke or gold screen with strict request and token accounting; Opus is not eligible for a meaningful development run within this cap.
  - Preserve the canonical configuration, provenance, measured cost, and latency controls.
  - Do not replace the full engine without separate evidence that clears the existing benchmark gates.

## 🔴 High

- 🔐 Add informed consent and privacy controls for Play analytics.
  - Initial analytics collection may ship without a banner, but treat that as a temporary privacy gap and keep this item high priority.
  - Current collection begins after one completed turn, stores replayable snapshots under a random HTTP-only browser cookie, and keeps Developer and loopback-local games as separate cohorts.
  - Explain that active and completed snapshots include player-written clues, the hidden key, intended targets, settings, and full action history.
  - Add an explicit opt-in or other reviewed lawful collection boundary, plus stop-sharing and delete-my-shared-games controls.
  - Document retention, anonymous-cookie behavior, Developer and Local cohort handling, and whether transient IP-based abuse protection is used. Do not persist raw IP addresses.

- 🛡️ Regenerate the clue vocabulary with consistent profanity filtering.
  - The WordNet-backed first 88,563 words currently bypass `better_profanity`; only the experimental fallback applies it.
  - Regenerate all affected shards, reports, and the stable-prefix baseline together after reviewing benign false positives.

- 👥 Validate finalists with exact-current human calibration.
  - The automatic benchmark covers 14,404 human guess sequences across Cultural Codes, Strategy and Structure, and CodeNamesAgent, plus 2,250 Connector target tasks. Use it as the primary broad human-alignment screen.
  - Browser and Neon persistence are verified, with 3 live answers stored. Clears use timestamped deletion records so stale browsers or imports cannot restore removed answers.
  - Use the blinded round only to test current generated clues and competitive danger roles that historical datasets cannot reproduce. Evaluate it with `npm run calibration:evaluate -- --input <export.json> --answer-key scripts/generated/calibration-answer-keys/embedding-finalists-v1.json`.
  - Treat the manual result as a gross-failure screen, not a model ranker. Prefer targeted disagreement tasks over another broad round when later evidence is needed.

## 🟡 Medium

- 🧪 Isolate embedding-backed UI tests from external model downloads.
  - `npm test` can fail in Italian Train and completed Play post-game analysis when the browser cannot fetch embedding model assets, including on unchanged `main`.
  - A repeated post-game run captured `Failed to fetch dynamically imported module` for jsDelivr's `ort-wasm-simd-threaded.jsep.mjs`; the next isolated Italian run passed in 5.1 seconds.
  - Completed Play post-game coverage now uses the deterministic `guessCandidateExecutor`; Italian Train still performs a real external model load.
  - Next: add a deterministic Train-analysis executor, block external requests in the general UI suite, and keep real model coverage in a separate integration check.

- ⚖️ Obtain redistribution terms for the official Italian word list.
  - Request the current second-edition 400-word list and written public-redistribution permission from Cranio Creations or Czech Games Edition.
  - Do not check in a transcription or expose an Official Italian preset without that grant.

- 🇮🇹 Native-review the Italian Train and Play beta.
  - Have two native Italian speakers review all 800 `it:extended-v1` words, localized copy, and generated clues for familiarity, regional bias, clue potential, and accidental offensiveness.
  - Same-model and MiniLM operative runs now cover 100 paired boards each. The MiniLM stress run is intentionally harsh and reached a 63% hybrid assassin rate, so do not treat E5 self-play as human safety evidence.
  - Next: expand the original fixture to at least 100 reviewed turns and collect native-player guesses before removing the beta label.

- 📊 Calibrate Play bots and Worth from recorded outcomes.
  - Aggregate archived outcome summaries and fit bot confidence, multi tolerance, and Worth coefficients against actual play.

- 🧹 Bound Model picker caches so exploration cannot retain every loaded model and index.
  - Index promises, parsed shards, model pipelines, and term vectors currently remain cached for the page lifetime.
  - Keep the active configuration and a small warm cache, then verify memory while switching through all 100k cells.

- ⏱️ Benchmark picker speed with real centered board embeddings.
  - Synthetic vectors produced fewer suggestions and ran about 9% faster than the checked real MiniLM-L6 fixture at 30k.
  - Generate a fixed real board fixture per selectable model outside the timed scoring region.

## 🟢 Low

- 📥 Add bulk board import.
  - Accept 25 newline-, tab-, comma-, or spreadsheet-separated words and validate count, duplicates, length, and empty entries before applying them.
  - Add a compact keyboard-accessible role assignment flow while preserving generated, sample, shared-board, and per-card editing paths.

- 🔎 Add a word-set browser for the Official and Extended pools.
  - Show the complete 400- and 800-word lists and clearly identify the 400 Extended additions; Extended is a strict superset, so it removes no Official words.
  - Next: open a searchable compact dialog or drawer from the Words control.
