# TODO

- 🏆 Support a full match across rotating roles.
  - Design a multi-round match that rotates players through roles and tracks an overall result instead of treating each board as the whole game.
  - Planning only for now; do not implement it as part of the current feedback batch.

- 🔄 Retry transient local model loads safely.
  - Use three total attempts (the initial load plus two short backoff retries) only after an actual rejected model or index load.
  - Clear rejected extractor and index promises before retrying so one failure cannot poison that configuration until reload.
  - Keep initialization single-flight and do not launch a parallel model load merely because the first attempt is slow.
  - Retry transient network, 408, 429, and 5xx failures, but fail immediately for corrupt indexes, incompatible dimensions, and other deterministic errors.
  - Add deterministic recovery coverage and a readable loading or retry state for model-backed UI paths.

## 🔴 High

- 🧠 Prevent the bot spymaster from repeating the previous clue.
  - A human operative remembers an immediately repeated clue, so giving it again adds no useful information even when it remains the highest-ranked option.
  - Select the next-best legal clue instead. Its intended cards may overlap with zero, some, or all of the previous clue's intended cards.
  - Decide whether this rule is always enabled or exposed as a Play bot setting.
  - Add deterministic consecutive-turn coverage, then rerun the English and Italian Play benchmarks to measure clue quality, safety, and full-game effects.

- 🛡️ Regenerate the clue vocabulary with consistent profanity filtering.
  - The WordNet-backed first 88,563 words currently bypass `better_profanity`; only the experimental fallback applies it.
  - Regenerate all affected shards, reports, and the stable-prefix baseline together after reviewing benign false positives.

- 👥 Finish the first human embedding calibration and analyze it.
  - Current: browser and Neon persistence are verified, with 3 live answers stored. Clears use timestamped deletion records so stale browsers or imports cannot restore removed answers.
  - Complete all 30 blinded tasks at `?mode=calibrate`, export the corrected answers, then run `npm run calibration:evaluate -- --input <export.json> --answer-key scripts/generated/calibration-answer-keys/embedding-finalists-v1.json`.
  - Review pass rate, target recall, exact targets, and wrong-team, neutral, and assassin selections per model as a gross-failure screen, not a model ranker.

## 🟡 Medium

- 🧪 Isolate embedding-backed UI tests from external model downloads.
  - `npm test` can fail in Italian Train and completed Play post-game analysis when the browser cannot fetch embedding model assets, including on unchanged `main`.
  - Add deterministic Train-analysis and post-game-score executors, block external requests, and keep real model coverage in a separate integration check.

- ⚖️ Obtain redistribution terms for the official Italian word list.
  - Request the current second-edition 400-word list and written public-redistribution permission from Cranio Creations or Czech Games Edition.
  - Do not check in a transcription or expose an Official Italian preset without that grant.

- 🇮🇹 Native-review the Italian Train and Play beta.
  - Have two native Italian speakers review all 800 `it:extended-v1` words, localized copy, and generated clues for familiarity, regional bias, clue potential, and accidental offensiveness.
  - Same-model and MiniLM operative runs now cover 100 paired boards each. The MiniLM stress run is intentionally harsh and reached a 61% hybrid assassin rate after the spelling-artifact guard, so do not treat E5 self-play as human safety evidence.
  - Next: expand the original fixture to at least 100 reviewed turns and collect native-player guesses before removing the beta label.

- 📊 Calibrate Play bots and Worth from recorded outcomes.
  - Aggregate archived outcome summaries and fit bot confidence, multi tolerance, and Worth coefficients against actual play.

- 🧠 Evaluate a more game-specific semantic embedding or reranker.
  - Current: calibrated same-model development favored Cohere and tied Voyage with BGE, but both failed the primary MiniLM-L6 transfer gates, so BGE stays in production and the held-out test remains locked.
  - Require any future candidate to pass calibrated development, cross-model transfer, and human gates before unlocking the held-out test.

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
