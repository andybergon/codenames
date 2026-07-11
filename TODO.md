# TODO

- Apply a recommendation to mark its target cards as guessed.
  - Current: individual cards can already be marked done and are excluded from later recommendations.
  - Next: make a recommendation row actionable, confirm the affected targets, then reuse the existing done-card flow for every target in that clue.

- Support recommendations for either Blue or Red.
  - Current: recommendations are generated from the Friendly/Blue perspective only.
  - Next: add an active-team control and run the same scoring pipeline with the selected team's cards treated as friendly.

- Add a manual full-game loop.
  - Depends on applying recommendations and supporting both team perspectives.
  - Next: after applying one side's recommendation, switch to the other side automatically while retaining a manual team override, until the board reaches an end state.

- Curate the Extended board word set.
  - Current: Official 400 plus seven non-duplicate words retained from the trainer's historical pool.
  - Next: define inclusion criteria, review themed and regional coverage, and test additions for clue quality before expanding the set.

- Evaluate a more game-specific semantic embedding or reranker.
  - Current: mean-centered `all-MiniLM-L6-v2` provides general semantic similarity but is not trained on Codenames associations.
  - Next: create a small board-and-clue evaluation set, then compare stronger embedding models and an embedding-shortlist reranker on top-k clue quality, latency, and browser size.

- Expand the generated clue index beyond 3,000 candidates.
  - Current: frequent `wordfreq` entries filtered through WordNet, plus curated seeds, produce a 1.6 MB int8 index.
  - Next: benchmark 10,000 and 30,000 candidate indexes, review candidate quality and legality filters, and measure first-load size plus board re-analysis time.
