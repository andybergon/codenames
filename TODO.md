# TODO

- Evaluate a more game-specific semantic embedding or reranker.
  - Current: mean-centered `all-MiniLM-L6-v2` provides general semantic similarity but is not trained on Codenames associations.
  - Next: create a small board-and-clue evaluation set, then compare stronger embedding models and an embedding-shortlist reranker on top-k clue quality, latency, and browser size.

- Expand the generated clue index beyond 3,000 candidates.
  - Current: frequent `wordfreq` entries filtered through WordNet, plus curated seeds, produce a 1.6 MB int8 index.
  - Next: benchmark 10,000 and 30,000 candidate indexes, review candidate quality and legality filters, and measure first-load size plus board re-analysis time.
