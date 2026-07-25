# TODO

## 🔴 High

- 🧪 Complete Cohere Embed v4 and Voyage 4 Large evaluations.
  - Vercel AI Gateway allows isolated free-tier probes but returns model-level 429s during sustained generation; OIDC, a capped API key, and Cohere/Bedrock routing produced the same limit.
  - Next: try a paced Vercel run or another low-cost provider with an explicit $0.10-per-model ceiling, then run the human, same-model Fun, and MiniLM transfer gates.
  - Store the results in `docs/play-fun-optimization.md` and `scripts/generated/play-embedding-candidate-experiments.json`.

- 🛡️ Regenerate the clue vocabulary with consistent profanity filtering.
  - The WordNet-backed first 88,563 words currently bypass `better_profanity`; only the experimental fallback applies it.
  - Regenerate all affected shards, reports, and the stable-prefix baseline together after reviewing benign false positives.

## 🟡 Medium

- 📝 Keep completed Play game action records for calibration.
  - Current session history contains clues, intended targets, guesses, passes, outcomes, and bot settings, but starting another game replaces it.
  - Store a bounded local archive with export and clear controls so benchmarks can replay real human decisions.

- 📊 Calibrate Play bots and Worth from recorded outcomes.
  - Aggregate archived outcome summaries and fit bot confidence, multi tolerance, and Worth coefficients against actual play.

- 💬 Explain recommendations in plain language from existing scores.
  - Summarize intended targets, weakest target, closest danger, and the main failure risk without an LLM call.
  - Keep Worth, margin, fit, cohesion, and similarity values available behind expandable technical details.

- 🧠 Evaluate a more game-specific semantic embedding or reranker.
  - Current: Gemini Embedding 2 reached 72.9% human target recall, and Qwen3 Embedding 0.6B reached 88.19 Fun, but no tested model passes the human-data, Fun Index, and cross-model transfer gates together. See `docs/play-fun-optimization.md`.
  - Next: test Gemini or ConceptNet as a secondary human-alignment feature, then validate the best ensemble against human ratings of generated clues and recorded gameplay outcomes before changing the default.

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
