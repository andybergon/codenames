# TODO

- Add a word-set browser for the Official and Extended pools.
  - Show the complete 400- and 800-word lists and clearly identify the 400 Extended additions; Extended is a strict superset, so it removes no Official words.
  - Next: open a searchable compact dialog or drawer from the Words control.

- Evaluate a more game-specific semantic embedding or reranker.
  - Current: the human-data benchmark compares five browser-compatible models across 7,703 Codenames Duet turns and 2,250 two-target human clues. Mean-centered BGE-small is the best balanced embedding candidate; MiniLM-L12 is stronger on intended pairs but makes more avoid-word errors.
  - Next: A/B BGE-small and MiniLM-L12 in the trainer's generated top clues, then add lightweight gameplay-outcome capture before changing the production model or fitting a reranker.

- Expand the generated clue index beyond 3,000 candidates.
  - Current: frequent `wordfreq` entries filtered through WordNet, plus curated seeds, produce a 1.6 MB int8 index.
  - Next: benchmark 10,000 and 30,000 candidate indexes, review candidate quality and legality filters, and measure first-load size plus board re-analysis time.
