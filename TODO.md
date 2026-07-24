# TODO

## 🔴 High

- 🛡️ Regenerate the clue vocabulary with consistent profanity filtering.
  - The WordNet-backed first 88,563 words currently bypass `better_profanity`; only the experimental fallback applies it.
  - Regenerate all affected shards, reports, and the stable-prefix baseline together after reviewing benign false positives.

## 🟡 Medium

- 🎯 Favor useful multi-card clues in Play without suppressing justified singles.
  - On 100 generated boards, every team perspective had a viable 2+ clue, but only 15.5% of human suggestions and 10.9% of the bot shortlist were multi-card.
  - The paired 100-board benchmark raised multi-card clues from 10.9% to 22.8%, correct cards per turn from 1.18 to 1.31, and shortened games from 12.01 to 10.83 turns without increasing wrong-team or assassin hits.
  - Next: adopt the hybrid Worth, expected-net, success, margin, and risk score as a Play-only policy, then calibrate it against recorded human games. Keep Train ranking and legal typed clues unchanged.

- 📊 Calibrate Play bots and Worth from recorded outcomes.
  - Play now stores intended targets, ordered guesses, passes, and reveal outcomes locally.
  - Next: aggregate local outcome summaries and fit bot confidence and Worth coefficients against actual play.

- 💬 Explain recommendations in plain language from existing scores.
  - Summarize intended targets, weakest target, closest danger, and the main failure risk without an LLM call.
  - Keep Worth, margin, fit, cohesion, and similarity values available behind expandable technical details.

- 🧠 Evaluate a more game-specific semantic embedding or reranker.
  - Current: the benchmark spans 17.5 MB MiniLM-L3 through 110 MB MPNet-base; the picker keeps the distinct Pareto choices MiniLM-L3, MiniLM-L6, and BGE-small. Every model still has compatible lazy-loaded indexes, measured human target recall, model size, and controlled median Node scoring time.
  - Next: capture human ratings of the trainer's generated top clues and gameplay outcomes before changing the default or fitting a reranker. Embedding-layer recall alone does not validate the end-to-end ranking.

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
