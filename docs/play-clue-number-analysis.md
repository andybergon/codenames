# Play clue-number analysis

## 🎯 Conclusion

Play's single-clue bias is primarily a scoring and policy problem. The standard board word set is not responsible, and increasing the clue vocabulary beyond 10,000 candidates is not the best first fix.

| 🧩 Factor | 🎯 Verdict | 📊 Strongest evidence |
| --- | --- | --- |
| 🧮 Scoring policy | 🔴 Primary | Multi edge falls from +8.9 to -7.2 |
| 🧠 Embedding model | 🟠 Material | 31.65% to 50.36% full-game multi |
| ➕ Bonus guesses | 🟠 Harmful | Only 26.4% correct |
| 📚 Candidate count | 🟡 Secondary | 30k adds 7.3 percentage points |
| 🗂️ Board word set | 🟢 Not causal | Official and Extended differ by 5 points at opening |

The implemented Play default is BGE-small, the hybrid score, a five-point multi-clue tolerance, Dynamic operative aggression, and passing after the declared clue number. Across 100 deterministic games, that combination produced a 1.57 mean clue number and 49.7% multi-card clues. Opening clues averaged 2.18, the chronological first half averaged 1.90, and late-game singles remained available.

BGE-small is `Xenova/bge-small-en-v1.5`. Its quantized model is 34.0 MB versus 23.0 MB for the previous MiniLM-L6 model. With the same 5.3 MB 10k clue index, the total download is about 39.3 MB versus 28.2 MB.

This is a policy benchmark, not proof of human-level safety. The simulated spymaster and operative share the same embedding geometry, so their agreement is higher than agreement with a human player. The separate MiniLM-L6 operative run is a transfer stress test, not a human simulation.

## 👥 What human evidence supports

No large public dataset of standard competitive human Codenames games with freely chosen clue numbers was found. The best public human corpus is Codenames Duet, which has different incentives from the competitive game.

| 👥 Source | 🎮 Variant | 🔢 Turns | 📈 Mean number | 1️⃣ Singles |
| --- | --- | ---: | ---: | ---: |
| 🧑 Cultural Codes | Duet | 7,703 | 1.24 | 80.6% |
| 🔗 Connector | Fixed pair | 2,250 | 2.00 | N/A |
| 🆚 Standard logs | Competitive | None found | Unknown | Unknown |

The Cultural Codes corpus contains 6,212 number-1 turns, 1,225 number-2 turns, 216 number-3 turns, 41 number-4 turns, and 9 number-5 turns. It does not support a universal claim that humans average two or more.

The official rules do support the product direction: a clue for one word is allowed, but clues for more words are described as more fun. That makes human-like multi-clue play a reasonable design goal even though a standard competitive average of two is not yet measured.

The official base game has 200 double-sided cards containing 400 codenames. The app's Official pool contains those 400 names, so it is not an undersized 200-word substitute.

## 🔬 Controlled component ablation

The opening-board ablation uses the same 40 deterministic boards from both team perspectives. It selects the highest hybrid-scored clue to isolate the candidate vocabulary, board set, and embedding from later turn progression.

| 🧪 Configuration | 📈 Mean number | 🔢 Multi selected | 📋 Multi in top four | ✅ Multi available |
| --- | ---: | ---: | ---: | ---: |
| 🧠 MiniLM-L3, 10k | 2.24 | 93.8% | 74.1% | 100.0% |
| 🧠 BGE-small, 10k | 2.06 | 87.5% | 67.5% | 100.0% |
| 📚 MiniLM-L6, 100k | 2.04 | 88.8% | 66.6% | 100.0% |
| 📚 MiniLM-L6, 30k | 1.95 | 81.3% | 56.9% | 100.0% |
| 🗂️ MiniLM-L6, Extended | 1.88 | 76.3% | 46.6% | 100.0% |
| 📍 MiniLM-L6, 10k | 1.84 | 71.3% | 45.3% | 100.0% |
| 📚 MiniLM-L6, 3k | 1.55 | 48.8% | 30.9% | 100.0% |
| 🧠 MPNet-base, 10k | 1.45 | 42.5% | 22.5% | 97.5% |

BGE-small is the most promising model change because it also has the strongest human Duet target recall among the selectable models, 58.57% versus MiniLM-L6's 57.43%. MiniLM-L3 produces more multi clues but has lower human target recall, so its larger numbers are not automatically better.

Larger vocabularies improve opening multi-clue availability, but the full-game effect is smaller than the model and policy changes. On the same first 50 boards, moving MiniLM-L6 from 10k to 30k candidates raised the full-game multi rate from 20.0% to 27.3%, an increase of 7.3 percentage points, while roughly tripling scoring work. The deeper tiers also contain less familiar clues: the separate candidate evaluation found that the share of top suggestions matching human-used clues fell from 37.5% at 10k to 16.7% at 30k and 14.6% at 100k.

## 🧠 Same-policy full-game model comparison

Each selectable model played 100 complete games on the same deterministic boards with the recommended 10k vocabulary, hybrid score, five-point multi preference, stop-at-number policy, and the former Aggressive operative thresholds. The spymaster and operative use the same model, so these historical results compare model behavior rather than human agreement.

| 🧠 Model | 🔢 Multi clues | 📈 Mean number | ⏩ First-half mean | ✅ Correct per turn | ⏱️ Turns |
| --- | ---: | ---: | ---: | ---: | ---: |
| 🧠 MiniLM-L3 | 54.58% | 1.62 | 1.92 | 1.62 | 9.60 |
| 🧠 BGE-small | 50.36% | 1.58 | 1.92 | 1.58 | 9.85 |
| 🧠 MiniLM-L6 | 31.65% | 1.35 | 1.56 | 1.34 | 11.47 |

MiniLM-L3 produces the most multi-card clues, but BGE-small retains the strongest measured human target recall. The compact source data is stored in [`play-model-benchmark.json`](../scripts/generated/play-model-benchmark.json).

## 🧮 Why the score collapses toward singles

Multi-card suggestions are present for nearly every turn with four or more agents left. The hybrid score simply stops preferring them:

| 🕵️ Own agents left | 🔢 Mean number | 📈 Multi chosen | ✅ Multi available | ⚖️ Best multi edge |
| --- | ---: | ---: | ---: | ---: |
| 🔵 9 | 1.64 | 52.0% | 100.0% | +8.9 |
| 🔵 8 | 1.46 | 37.7% | 100.0% | +5.2 |
| 🔵 7 | 1.30 | 26.8% | 100.0% | +1.3 |
| 🔵 6 | 1.25 | 22.6% | 99.3% | -4.4 |
| 🔵 5 | 1.17 | 15.4% | 98.6% | -7.2 |
| 🔵 4 | 1.15 | 15.4% | 92.3% | -11.8 |
| 🔵 3 | 1.19 | 18.7% | 82.1% | -16.8 |
| 🔵 2 | 1.13 | 13.1% | 44.4% | -16.0 |
| 🔵 1 | 1.00 | 0.0% | 0.0% | 0.0 |

The current expected-net score treats multi-card success mostly as all-or-nothing. A clue for three receives little credit for two correct guesses followed by a miss, even though those two cards are real progress. The penalty compounds as the weakest target becomes less certain, which explains the growing negative edge.

The bot operative also takes an automatic number-plus-one guess using the current clue. In the baseline hybrid benchmark it made 2.16 bonus guesses per game and only 26.4% were correct. The official extra guess is strategically useful for revisiting earlier clues, but the bot has no prior-clue reasoning. Passing at the declared count is the sound default until that memory exists.

## 🧪 Implemented policy benchmark

| 🎛️ Policy | 📈 Full mean | ⏩ First-half mean | 🔢 Multi clues | ✅ Correct per turn | 🔴 Wrong hits | ☠️ Assassin | ⏱️ Turns |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 🧪 BGE hybrid, Dynamic, pass | 1.57 | 1.90 | 49.7% | 1.48 | 0.00 | 0.0% | 10.43 |
| 📍 BGE current, Dynamic, pass | 1.17 | 1.19 | 15.6% | 1.16 | 0.00 | 0.0% | 13.42 |
| 🧠 BGE hybrid, random, bonus | 1.42 | N/A | 37.7% | 1.49 | 0.57 | 3.0% | 9.74 |
| 🧱 MiniLM hybrid, random, bonus | 1.26 | N/A | 22.8% | 1.31 | 0.50 | 7.0% | 10.83 |

The first-half mean takes the first `ceiling(total clue turns / 2)` clue turns from each completed game, then aggregates their clue numbers. The implemented policy prefers the best multi-card clue when its hybrid score is within five points of the overall best clue. It does not force a pair when the score gap is larger. Its clue-number shape changes naturally with the board:

| 🕵️ Own agents left | 📈 Mean number | 🔢 Multi clues |
| --- | ---: | ---: |
| 🔵 9 | 2.18 | 98.0% |
| 🔵 8 | 2.25 | 95.1% |
| 🔵 7 | 1.94 | 85.5% |
| 🔵 6 | 1.78 | 68.7% |
| 🔵 5 | 1.62 | 58.1% |
| 🔵 4 | 1.36 | 36.1% |
| 🔵 3 | 1.20 | 19.6% |
| 🔵 2 | 1.14 | 14.2% |
| 🔵 1 | 1.00 | 0.0% |

The zero-error self-play result must not be treated as a human safety estimate. A real validation should replay human operative choices or collect Play sessions where the human guesses bot clues.

## ✅ Implemented Play defaults

1. Play bot turns use BGE-small while Train keeps its independent default.
2. The hybrid score prefers a multi clue within five points of the best clue.
3. Bot operatives use Dynamic aggression and adapt only to public remaining-agent counts.
4. Bot operatives pass after the declared clue number.
5. The default candidate vocabulary remains 10,000.
6. Official remains the default 400-word board set.
7. Play setup can override and persist every bot parameter.

The product target should be stage-dependent rather than a forced full-game mean of two. Aim for an opening mean around two, frequent pairs while five or more agents remain, and justified singles near the end.

## 🔁 Reproduce

- Run `npm run analyze:play-clues` for the controlled opening-board ablation. It updates [`play-clue-bias-analysis.json`](../scripts/generated/play-clue-bias-analysis.json).
- Run `npm run benchmark:play` for the checked 100-board clue-policy and operative-aggression benchmark.
- Run `node scripts/benchmark-play-policy.mjs --model bge-small --clue-selection tempo --multi-tolerance 5 --operative-aggression dynamic --bonus-guesses pass --output /tmp/play-bge-tempo.json` for the recommended experimental policy.
- Add `--operative-model minilm-l6 --report-detail compact` for the checked cross-model aggregate report without per-game records.
- Repeat the same policy command with `minilm-l6` and `minilm-l3` to refresh the same-policy full-game model comparison in [`play-model-benchmark.json`](../scripts/generated/play-model-benchmark.json).

## 📚 Primary sources

- [Cultural Codes human Codenames corpus](https://github.com/SALT-NLP/codenames)
- [Cultural Codes paper](https://aclanthology.org/2023.findings-acl.410/)
- [Official Codenames rules](https://filemanager.czechgames.com/storage/files/codenames/rules/codenames-rules-en.pdf)
- [Official Codenames product page](https://www.czechgames.com/games/codenames)
- [Connector human production corpus](https://github.com/hawkrobe/lexical-search-and-pragmatics)
- [Language graphs and word embeddings paper](https://arxiv.org/abs/2105.05885)
