# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. Similarity calibration made Cohere look substantially better in same-model self-play and put Voyage level with BGE, but both failed the primary MiniLM-L6 operative transfer screen. Cohere and Voyage are therefore ineligible for the held-out test. The 30-task human round remains useful as a one-time gross-failure calibration baseline for future model work.

## 🧪 Calibrated development

| 🧠 Model | 🚦 Status | 💵 Added cost | 🎉 Same Fun | ✅ Same correct | ✅ Cross correct | 🔴 Cross wrong | ☠️ Cross assassin | ⛔ Stalls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 🟢 BGE-small | ✅ Keep | Local | 81.38 | 1.48 | 0.97 | 0.48 | 6.3% | 0 |
| 🪸 Cohere Embed v4 | ❌ Transfer | $0 cached | 86.72 | 1.56 | 0.67 | 1.41 | 30.5% | 6 |
| 🚢 Voyage 4 Large | ❌ Transfer | $0 cached | 81.49 | 1.48 | 0.76 | 1.20 | 23.4% | 2 |

Cohere's calibrated same-model correct-card delta was +0.089 with a paired 95% interval of +0.046 to +0.133. Voyage's delta was +0.003 with an interval of -0.039 to +0.046. In the primary cross-model screen, Cohere fell by 0.302 correct cards per turn and Voyage fell by 0.206, with both intervals entirely below the -0.05 noninferiority gate.

The checked reports are [same-model development](../scripts/generated/play-embedding-finalist-development.json), [cross-model development](../scripts/generated/play-embedding-finalist-development-cross-model.json), and the locked [selection protocol](../scripts/generated/embedding-finalist-protocol.json).

## 📚 Historical screening

| 🧠 Model | 🎯 Rating | 🌐 General benchmark | 💵 Test cost | 👥 Human target recall | 🎉 Fun Index | ✅ Cross correct | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | 62.17 MTEB | Local | 58.6% | 86.37 | 1.30 | 0.55 | 20.0% | ✅ Keep |
| 🐉 Qwen3 Embedding 0.6B | 🟢 4 | 70.70 MTEB v2 | Local | 60.3% | 88.19 | 1.02 | 1.85 | 20.0% | ❌ Transfer |
| 💎 Gemini Embedding 2 | 🟡 3.5 | N/A | $0.0514 | 72.9% | 51.30 | 1.03 | 0.95 | 15.0% | ❌ Low Fun |
| 🚢 Voyage 4 Large | 🟡 3.5 | #1 RTEB | $0.0321 | 66.6% | 68.46 | 🚫 Bound | 🚫 Bound | 🚫 Bound | ❌ Transfer |
| 🌐 ConceptNet Numberbatch | 🟡 3.5 | N/A | Local | 70.8% | 63.29 | 1.13 | 1.10 | 15.0% | 🧪 Ensemble |
| 🐲 Qwen3 Embedding 8B | 🟠 3 | 75.22 MTEB v2 | $0.0030 | 64.9% | 57.80 | 1.05 | 1.30 | 25.0% | ❌ Low Fun |
| 🧩 Jina v5 text-small | 🟠 2.5 | 71.7 MTEB v2 | Local | 62.6% | 52.40 | 0.86 | 1.60 | 50.0% | ❌ Reject |
| 🪸 Cohere Embed v4 | 🔴 2 | N/A | $0.0319 | 61.2% | 37.36 | 🚫 Bound | 🚫 Bound | 🚫 Bound | ❌ Low Fun |
| 🔴 OpenAI large | 🔴 2 | 64.6 MTEB | $0.0085 | 62.5% | 61.79 | 1.02 | 1.05 | 45.0% | ❌ Reject |

The general benchmark column provides broad embedding context from published model cards. MTEB and MTEB English v2 are different suites, so their scores are not a strict ranking. Voyage publishes an RTEB rank instead of an MTEB score. N/A means no defensible model-specific result was published. Sources: [BGE-small](https://huggingface.co/BAAI/bge-small-en-v1.5), [Qwen3 Embedding](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [Jina v5 text-small](https://huggingface.co/jinaai/jina-embeddings-v5-text-small), [Voyage 4](https://blog.voyageai.com/2026/01/15/voyage-4/), and [OpenAI large](https://openai.com/index/new-embedding-models-and-api-updates/).

## 🎉 Objective

The 0-100 Fun Index balances ambitious clues, productive guesses, close finishes, and playable game length. Wrong-team hits, assassin losses, neutral hits, analyzer fallbacks, and human clue recovery remain separate promotion gates.

Human target recall replays a real human clue and its intended number of targets, ranks every target, neutral, and avoid word by embedding similarity, then measures how many intended targets appear in the top N. It is averaged across the recorded Cultural Codes turns.

The table above is the historical exploratory sweep. It uses the same 20 deterministic boards, 10,000 clue candidates, hybrid scoring, five-point multi-clue tolerance, the former Aggressive operative thresholds, and passing at the declared clue number. Its raw Fun values are useful for screening, but not authoritative model rankings because the models use different similarity score ranges.

## 🧭 Authoritative protocol

| 🧪 Split | 🎴 Boards | 🔢 Offset | 🎯 Use |
| --- | ---: | ---: | --- |
| 💨 Smoke | 20 | 0 | Regression |
| 🧑 Calibration | 100 | 20 | Human round |
| 🛠️ Development | 128 | 120 | Tune once |
| 🔒 Test | 150 | 248 | Final decision |

- 📐 Measure every model on the same 16,384 fixed clue-word pairs. Match its mean and standard deviation to BGE-small with `npm run benchmark:calibrate-similarity` before tuning score thresholds.
- 🎚️ `multiTolerance` is the number of clue-score points a multi-card clue may trail the best overall clue and still be preferred. Tune it only on the development split after similarity calibration.
- 🎮 Use `--comparison-only` for model selection. It runs only the production Hybrid and Dynamic path, avoiding unrelated policy variants.
- 📊 Compare candidates on paired boards with `npm run benchmark:compare`. The report bootstraps whole boards 10,000 times and records 95% intervals.
- 🛡️ Require zero stalls, at most 1% fallback clues, and baseline-relative noninferiority bounds. The 95% upper bound may add at most 0.05 assassin losses, 0.15 wrong-team hits, or 0.15 neutral hits per game, while the lower bound may lose at most 0.05 correct cards per turn.
- 👥 Complete the first blinded human round at `?mode=calibrate`. The 30 tasks contain 10 paired-board opening clues per finalist. Answers are editable, browser-local, and exportable. Model labels, intended targets, and roles live in a separate answer key that the page never loads. Treat this single-rater round as a gross-failure disqualifier, not a ranker.
- 🔐 Run the 150-board test split once for finalists that pass development and human calibration. Do not tune against its result.
- 🧾 The checked protocol locks the held-out test when no candidate is eligible. A test run also requires `--test-protocol` and refuses to overwrite an existing result.

Same-model scores still measure the ceiling of a shared embedding space. Cross-model operative runs stress whether clues transfer beyond that space, but do not replace human guesses. The current Conservative, Aggressive, and Dynamic comparison is documented in [Clue engine](clue-engine.md#-play-operative-policy).

## 📈 Findings

- 🐉 Qwen raised same-model Fun from 86.37 to 88.19 and passed the human gate. Its cross-model wrong-team rate rose from 0.55 to 1.85. Reducing multi-clue tolerance to zero lowered self Fun to 81.85 but still produced 1.60 cross-model wrong-team hits per game.
- 💎 Gemini achieved 72.9% Cultural Codes target recall and 38.7% exact Connector pairs, the strongest human result in the sweep. Its same-model Fun was only 51.30, and cross-model correct cards per turn fell to 1.03.
- 🚢 Voyage achieved 66.6% Cultural Codes target recall and 36.3% exact Connector pairs. Its same-model Fun was 68.46, and the MiniLM transfer run exceeded 500 actions on board 11.
- 🌐 ConceptNet achieved 70.8% Cultural Codes target recall and 36.9% exact Connector pairs. It covered 96.6% of Cultural Codes turns, but its standalone Fun Index was only 63.29.
- 🐲 Qwen 8B reached 64.9% human target recall, but its same-model Fun was 57.80 and it produced 1.30 cross-model wrong-team hits per game.
- 🧩 Jina passed the human gate only with the text-matching model's required `Document:` prefix. It remained too conservative in self-play and transferred poorly.
- 🪸 Cohere achieved 61.2% Cultural Codes target recall, but same-model Fun fell to 37.36. The MiniLM transfer run exceeded 500 actions on board 8.
- 💵 The full OpenRouter Gemini and Qwen 8B generations cost $0.0544 combined.
- 💳 Vercel free-tier generation reached 480 terms before a model-level 429. Adding $10.0000 of paid credit cost $13.0300 after fees and tax, then completed both 31,253-term corpora for $0.0640 of model usage.

## 🧪 Historical promotion gates

| 🧠 Candidate | 🚦 Human | 🚦 Fun | 🚦 Bounded | 🚦 Cross correct | 🚦 Cross wrong | 🚦 Assassin |
| --- | --- | --- | --- | --- | --- | --- |
| 🧪 Qwen3 Embedding 0.6B | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Gemini Embedding 2 | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Voyage 4 Large | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| 🧪 ConceptNet Numberbatch | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Qwen3 Embedding 8B | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Jina v5 text-small | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| 🧪 Cohere Embed v4 | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |

## 🔁 Reproduction

1. Prepare the shared terms with `node scripts/prepare-embedding-candidate.mjs --output <experiment-dir>`.
2. Generate local vectors with `scripts/embed-local-candidate.py`, or hosted vectors with `npm run embed:gateway-candidate` and an explicit cost cap.
3. Build the human report and precomputed 10,000-clue index with `node scripts/finalize-embedding-candidate.mjs --experiment-dir <experiment-dir>`.
4. Run a one-board raw report per model, then derive the candidate transform with `npm run benchmark:calibrate-similarity`.
5. Run the development split with `--comparison-only` and the derived similarity scale and offset.
6. Build or extend a blinded human round with `npm run calibration:build -- --answer-key <key.json>`, then evaluate exported answers with `npm run calibration:evaluate -- --answer-key <key.json>`.
7. Run the test split once for finalists and compare paired results with `npm run benchmark:compare`.
8. Refresh the historical report with `node scripts/summarize-embedding-candidates.mjs` when adding candidates.

The checked machine-readable result is [play-embedding-candidate-experiments.json](../scripts/generated/play-embedding-candidate-experiments.json).

## ⚠️ Distribution constraints

Jina v5 text-small is CC BY-NC 4.0, and ConceptNet Numberbatch is CC BY-SA 4.0. Their local benchmark artifacts remain gitignored. Review licensing before distributing either model or a derived production index.
