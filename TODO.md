# TODO

## 🔴 High

- 🎮 Add a self-play mode that records real guesses and turn outcomes.
  - Selecting a clue should start a turn rather than assume every intended target was guessed correctly.
  - Record guesses in order, support pass and undo, and end on neutral, enemy, or assassin reveals.
  - Compare predicted and actual outcomes locally so clue quality and Worth can eventually be calibrated against real play.

- 👁️ Add a compact read-only board for normal play and keep editing explicit.
  - Put recommendations first: show clues beside the compact board on desktop and prioritize Clues after analysis on mobile.
  - Preserve roles, guessed state, active team, board order, and share-link behavior without relying only on color.
  - Move the existing word and role controls into an Edit mode, while keeping corrections one action away.

- 🛡️ Regenerate the clue vocabulary with consistent profanity filtering.
  - The WordNet-backed first 88,563 words currently bypass `better_profanity`; only the experimental fallback applies it.
  - Regenerate all affected shards, reports, and the stable-prefix baseline together after reviewing benign false positives.

## 🟡 Medium

- 💾 Persist sessions and support resumable games.
  - Autosave board progress, active side, selected clue, and turn history locally; offer resume and discard actions.
  - Use a versioned event history that can also support undo/redo and optional progress-inclusive share links.
  - Keep board-only sharing as the default and preserve v1-v3 link decoding.

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
