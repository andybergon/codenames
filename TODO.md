# TODO

## High

- Add a self-play mode that records real guesses and turn outcomes.
  - Selecting a clue should start a turn rather than assume every intended target was guessed correctly.
  - Record guesses in order, support pass and undo, and end on neutral, enemy, or assassin reveals.
  - Compare predicted and actual outcomes locally so clue quality and Worth can eventually be calibrated against real play.

- Add a compact read-only board for normal play and keep editing explicit.
  - Put recommendations first: show clues beside the compact board on desktop and prioritize Clues after analysis on mobile.
  - Preserve roles, guessed state, active team, board order, and share-link behavior without relying only on color.
  - Move the existing word and role controls into an Edit mode, while keeping corrections one action away.

## Medium

- Persist sessions and support resumable games.
  - Autosave board progress, active side, selected clue, and turn history locally; offer resume and discard actions.
  - Use a versioned event history that can also support undo/redo and optional progress-inclusive share links.
  - Keep board-only sharing as the default and preserve v1-v3 link decoding.

- Explain recommendations in plain language from existing scores.
  - Summarize intended targets, weakest target, closest danger, and the main failure risk without an LLM call.
  - Keep Worth, margin, fit, cohesion, and similarity values available behind expandable technical details.

- Evaluate a more game-specific semantic embedding or reranker.
  - Current: Model picker spans 17.5 MB MiniLM-L3 through 110 MB MPNet-base, with MiniLM-L6, BGE-small, and MiniLM-L12 between them. Every model has compatible lazy-loaded indexes, measured human target recall, model size, and per-device runtime. BGE-small has the best played-turn target recall; MiniLM-L12 is stronger on intended pairs but makes more avoid-word errors.
  - Next: capture human ratings of the trainer's generated top clues and gameplay outcomes before changing the default or fitting a reranker. Embedding-layer recall alone does not validate the end-to-end ranking.

## Low

- Add bulk board import.
  - Accept 25 newline-, tab-, comma-, or spreadsheet-separated words and validate count, duplicates, length, and empty entries before applying them.
  - Add a compact keyboard-accessible role assignment flow while preserving generated, sample, shared-board, and per-card editing paths.

- Add a word-set browser for the Official and Extended pools.
  - Show the complete 400- and 800-word lists and clearly identify the 400 Extended additions; Extended is a strict superset, so it removes no Official words.
  - Next: open a searchable compact dialog or drawer from the Words control.

- Review larger clue indexes before changing the 3,000-candidate default.
  - Current: Model picker exposes incremental 3k, 10k, and 30k int8 shards for every selectable model. Exact coverage of 9,932 usable human clues is 61.8%, 85.1%, and 93.5%; runtime scoring is measured in the browser.
  - Next: review the extra 27k candidates for obscure, illegal, or boring high-ranked clues, then collect end-to-end human ratings per model/candidate combination.
