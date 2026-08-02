# 🧠 Owner concept reranker smoke

The first bounded experiment supports further evaluation, not runtime use. A concept-aware reranker changed 1 of 16 deterministic opening Owner decisions while preserving the existing legal 30,000-clue vocabulary. The changed clue needs human review, so same-model scores do not establish quality.

## 🧪 Experiment

- Start with the production BGE-small model, 30,000-clue index, legality filter, Hybrid clue policy, and five-point multi-clue tolerance.
- Retrieve at most 64 legal clues that have WordNet definitions, remain below the `0.20` direct activation ceiling for every active card, and have the strongest direct support across two friendly cards.
- Compute `max(direct similarity, concept similarity - 0.05)` for every active friendly, enemy, neutral, and assassin card.
- Rerun the unchanged target, danger, Worth, and policy ranking for clue numbers of two or more. Number-one clues keep exact direct scoring.
- Keep direct similarities when definitions are missing or an override row is incomplete.

## 📊 Checked result

| 🧪 Check | 📌 Result | 🔎 Evidence |
|---|---|---|
| 🎴 Openings | 🟡 1 changed | 16 side cases |
| ⚔️ JOUST 4 | 🟢 Recovered | Four targets above PIANO |
| 📚 Vocabulary | 🟢 Unchanged | Existing legal 30k |
| 🌐 Provider use | 🟢 None | Local cached BGE |
| ⏱️ Median screen | 🔴 1.52 s | Four measured phases |

The forced fixture models `JOUST -> medieval tournament -> MATCH / CROWN / GLOVE / BELT`. Direct scoring did not generate JOUST 4. Concept scoring generated it and put all four intended words above PIANO. JOUST is vocabulary position 39,742, so the fixture is deliberately forced and does not claim that the current 30,000-clue prefix can retrieve it.

The single changed opening moved from `MURRAY 2 -> PIN / ROBIN` to `FLOCK 2 -> GRASS / CIRCLE`, with NET as the closest danger. That result demonstrates that the mechanism can affect clue generation. It also demonstrates the main calibration risk because automatic same-model scores cannot establish whether people will understand the shared concept.

The warm local medians were `341 ms` for direct analysis, `569 ms` for bounded candidate retrieval, `255 ms` for concept preparation, and `350 ms` for the second analysis pass. The experiment reuses existing WordNet and BGE assets, so it adds no runtime asset download. Its unoptimized evaluation path adds about `1.17 s` beyond the direct baseline.

The complete board, role, score, and timing records are in [`owner-concept-reranker-smoke.json`](owner-concept-reranker-smoke.json).

## 🚦 Gates

1. **Go for a larger local screen:** repeat on a frozen 100-board development split and inspect every changed clue plus the highest-scoring rejected bridges.
2. **No-go for runtime without human evidence:** run a blinded comparison where people rate direct and concept clues and guess from each clue using the public board only. Keep results separate from model self-play.
3. **No-go on safety regression:** after human plausibility passes, run paired full-game BGE regression and a different operative model for transfer stress. Wrong-team, neutral, and assassin gates must not regress.
4. **No-go on latency:** reduce retrieval and duplicate scoring before considering an interactive path. The incremental warm cost must fit the Owner turn budget on representative browsers.
5. **Fail closed:** unsupported language or model, missing concepts, incomplete card coverage, load failure, or an exceeded latency budget must retain exact direct ordering.
