# TODO

- 🇮🇹 Review the Italian language beta before merging.
  - Review language selection, official and extended word sources, multilingual embedding tradeoffs, morphology, share compatibility, and responsive Train and Play behavior on `codex/analyze-italian-support`.
  - Keep the branch separate from `main` until it is explicitly approved.

- 🏆 Support a full match across rotating roles.
  - Design a multi-round match that rotates players through roles and tracks an overall result instead of treating each board as the whole game.
  - Planning only for now; do not implement it as part of the current feedback batch.

## 🔴 High

- 🛡️ Regenerate the clue vocabulary with consistent profanity filtering.
  - The WordNet-backed first 88,563 words currently bypass `better_profanity`; only the experimental fallback applies it.
  - Regenerate all affected shards, reports, and the stable-prefix baseline together after reviewing benign false positives.

## 🟡 Medium

- 📝 Keep completed Play game action records for calibration.
  - Current session history contains clues, intended targets, guesses, passes, outcomes, and bot settings, but starting another game replaces it.
  - Store a bounded local archive with export and clear controls so benchmarks can replay real human decisions.

- 📊 Calibrate Play bots and Worth from recorded outcomes.
  - Aggregate archived outcome summaries and fit bot confidence, multi tolerance, and Worth coefficients against actual play.

- 🧠 Evaluate a more game-specific semantic embedding or reranker.
  - Current: calibrated same-model development favored Cohere and tied Voyage with BGE, but both failed the primary MiniLM-L6 transfer gates, so BGE stays in production and the held-out test remains locked.
  - Require any future candidate to pass calibrated development, cross-model transfer, and human gates before unlocking the held-out test.

- 👥 Finish the first human embedding calibration and analyze it.
  - Current: the first export contained one substantive Cohere answer and four accidental empty passes caused by unclear navigation; clear those passes before continuing.
  - Connect Neon to the `codenames` Vercel project and configure `CALIBRATION_SYNC_SECRET` to activate the implemented automatic database backup.
  - Complete all 30 blinded tasks at `?mode=calibrate`, export the corrected answers, then run `npm run calibration:evaluate -- --input <export.json> --answer-key scripts/generated/calibration-answer-keys/embedding-finalists-v1.json`.
  - Review pass rate, target recall, exact targets, and wrong-team, neutral, and assassin selections per model as a gross-failure screen, not a model ranker.

- 🧪 Remove network dependence from Play suggestion UI tests.
  - Full-suite runs can show `Failed to fetch` while waiting for `.play-suggestion`; the exact tests pass immediately in isolation.
  - Preload the model fixture or route embedding fetches to deterministic local test assets so UI verification does not depend on transient model downloads.

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
