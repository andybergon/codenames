# 🧠 Owner concept reranker smoke

The frozen 100-board screen rejects the current independent sense-pair reranker. It changed 18 of 200 deterministic opening Owner decisions while preserving the existing legal 30,000-clue vocabulary, but exploratory qualitative triage found many opaque or incoherent clues. This variant should not consume human-calibration or cross-model promotion effort until clue-sense coherence improves.

## 🧪 Experiment

- Start with the production BGE-small model, 30,000-clue index, legality filter, Hybrid clue policy, and five-point multi-clue tolerance.
- Retrieve at most 64 legal clues that have WordNet definitions, remain below the `0.20` direct activation ceiling for every active card, and have the strongest direct support across two friendly cards.
- Compute `max(direct similarity, concept similarity - 0.05)` for every active friendly, enemy, neutral, and assassin card.
- Rerun the unchanged target, danger, Worth, and policy ranking for clue numbers of two or more. Number-one clues keep exact direct scoring.
- Keep direct similarities when definitions are missing or an override row is incomplete.

## 📊 Checked result

| 🧪 Check | 📌 Result | 🔎 Evidence |
|---|---|---|
| 🎴 Openings | 🔴 18 changed | 200 side cases |
| 🔎 Near misses | 🟡 2 cases | Within 2 points |
| ⚔️ JOUST 4 | 🟢 Recovered | Four targets above PIANO |
| 📚 Vocabulary | 🟢 Unchanged | Existing legal 30k |
| 🌐 Provider use | 🟢 None | Local cached BGE |
| ⏱️ Median path | 🔴 1.85 s | Four measured phases |

The forced fixture models `JOUST -> medieval tournament -> MATCH / CROWN / GLOVE / BELT`. It uses JOUST's checked precomputed BGE vector so activation cannot drift with runtime quantization or embedding-batch order. Direct scoring did not generate JOUST 4. Concept scoring generated it and put all four intended words above PIANO. JOUST is source-vocabulary position 39,742 and model-index position 39,744, both outside the production 30,000-clue prefix.

## 🔍 Changed-clue triage

This is an exploratory semantic review, not independent human evidence. It is useful as a gross-failure screen because obvious failures should not be promoted into a more expensive calibration round.

| 🔗 Bridge clue | 📌 Triage | 🎯 Proposed targets |
|---|---|---|
| 🔗 PREY 2 | 🟢 Plausible | GAME, NET |
| 🔗 ATHLETICS 2 | 🟢 Plausible | FAN, CLUB |
| 🔗 SUBSTANTIAL 2 | 🟢 Plausible | MAMMOTH, GIANT |
| 🔗 CROWD 2 | 🟢 Plausible | JAM, CIRCLE |
| 🔗 IDENTIFY 2 | 🟢 Plausible | KEY, STATE |
| 🔗 FORMIDABLE 2 | 🟡 Mixed | GIANT, MAMMOTH |
| 🔗 BEAUTIFUL 2 | 🟡 Mixed | GENIUS, GRACE |
| 🔗 FLOCK 2 | 🔴 Poor | CIRCLE, GRASS |
| 🔗 PENAL 2 | 🔴 Poor | BEAT, CHARGE |
| 🔗 BEZEL 3 | 🔴 Poor | FILE, FACE, NEEDLE |
| 🔗 WARMING 4 | 🔴 Poor | WAVE, IRON, FIRE, WAKE |
| 🔗 DISAGREE 2 | 🔴 Poor | FAIR, CHANGE |
| 🔗 VOWEL 3 | 🔴 Poor | RING, SPELL, ORGAN |
| 🔗 PICNIC 2 | 🔴 Poor | DANCE, DAY |
| 🔗 GIGGLE 2 | 🔴 Poor | KID, SLIP |
| 🔗 MIST 4 | 🔴 Poor | BED, COLD, STREAM, EYE |
| 🔗 ABSTRACTION 2 | 🔴 Poor | TEACHER, FORK |
| 🔗 PEACE 3 | 🔴 Poor | FAIR, COLD, LIFE |

The two unchanged near misses were `ALLIANCE 2 -> BOND / WAR`, which is plausible, and `BLAST 2 -> SOUND / SLUG`, which is mixed. The dominant failure mode is consistent with independently maximizing the clue-card sense pair for every card. Different target cards can win through different clue senses, even though a human Owner must communicate one coherent clue meaning to the whole target set.

The warm local medians were `510 ms` for direct analysis, `717 ms` for bounded candidate retrieval, `104 ms` for concept preparation, and `521 ms` for the second analysis pass. The experiment reuses existing WordNet and BGE assets, so it adds no runtime asset download. Its unoptimized evaluation path adds about `1.34 s` beyond the direct baseline.

The complete board, role, score, and timing records are in [`owner-concept-reranker-smoke.json`](owner-concept-reranker-smoke.json).

## 🚦 Gates

1. **No-go for the current variant:** do not run human calibration or cross-model full games on independent per-card sense maxima.
2. **Go for one smaller local refinement:** require one shared clue sense to support the full proposed target set, then rerun the same frozen 100 boards and reject any variant that retains obvious incoherent changes.
3. **No-go on latency:** eliminate the duplicate 30,000-clue scan and second full analysis before considering an interactive path.
4. **Human gate after local quality passes:** compare direct and concept clues blindly, then collect guesses using only the public clue and board. Keep this separate from model self-play.
5. **Safety gate after human plausibility passes:** run paired BGE full games and a different operative model. Wrong-team, neutral, and assassin gates must not regress.
6. **Fail closed:** unsupported language or model, missing concepts, incomplete card coverage, load failure, or an exceeded latency budget must retain exact direct ordering.
