# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. Qwen3 Embedding 0.6B is the only candidate to beat its 20-board same-model Fun Index, but it transfers poorly to a different operative embedding. Gemini Embedding 2 has the strongest human clue recovery, but its full-game Fun is much lower. These human-alignment gains are promising ensemble signals, not standalone replacements.

| 🧠 Model | 🎯 Rating | 💵 Test cost | 👥 Human target recall | 🎉 Fun Index | ✅ Cross correct | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | Local | 58.6% | 86.37 | 1.30 | 0.55 | 20.0% | ✅ Keep |
| 🐉 Qwen3 Embedding 0.6B | 🟢 4 | Local | 60.3% | 88.19 | 1.02 | 1.85 | 20.0% | ❌ Transfer |
| 💎 Gemini Embedding 2 | 🟡 3.5 | $0.0514 | 72.9% | 51.30 | 1.03 | 0.95 | 15.0% | ❌ Low Fun |
| 🌐 ConceptNet Numberbatch | 🟡 3.5 | Local | 70.8% | 63.29 | 1.13 | 1.10 | 15.0% | 🧪 Ensemble |
| 🐲 Qwen3 Embedding 8B | 🟠 3 | $0.0030 | 64.9% | 57.80 | 1.05 | 1.30 | 25.0% | ❌ Low Fun |
| 🧩 Jina v5 text-small | 🟠 2.5 | Local | 62.6% | 52.40 | 0.86 | 1.60 | 50.0% | ❌ Reject |
| 🔴 OpenAI large | 🔴 2 | $0.0085 | 62.5% | 61.79 | 1.02 | 1.05 | 45.0% | ❌ Reject |
| 🚫 Cohere Embed v4 | 🔴 1 | $0.00 rounded | Not run | Not run | Not run | Not run | Not run | 🚫 Vercel limit |
| 🚫 Voyage 4 Large | 🔴 1 | $0.00 rounded | Not run | Not run | Not run | Not run | Not run | 🚫 Vercel limit |

## 🎉 Objective

The 0-100 Fun Index balances ambitious clues, productive guesses, close finishes, and playable game length. Wrong-team hits, assassin losses, neutral hits, analyzer fallbacks, and human clue recovery remain separate promotion gates.

Human target recall replays a real human clue and its intended number of targets, ranks every target, neutral, and avoid word by embedding similarity, then measures how many intended targets appear in the top N. It is averaged across the recorded Cultural Codes turns.

The model sweep uses the same 20 deterministic boards, 10,000 clue candidates, hybrid scoring, five-point multi-clue tolerance, and passing at the declared clue number. Same-model scores measure the ceiling of a shared embedding space. MiniLM-L6 operative runs stress whether clues transfer beyond that space.

## 📈 Findings

- 🐉 Qwen raised same-model Fun from 86.37 to 88.19 and passed the human gate. Its cross-model wrong-team rate rose from 0.55 to 1.85. Reducing multi-clue tolerance to zero lowered self Fun to 81.85 but still produced 1.60 cross-model wrong-team hits per game.
- 💎 Gemini achieved 72.9% Cultural Codes target recall and 38.7% exact Connector pairs, the strongest human result in the sweep. Its same-model Fun was only 51.30, and cross-model correct cards per turn fell to 1.03.
- 🌐 ConceptNet achieved 70.8% Cultural Codes target recall and 36.9% exact Connector pairs. It covered 96.6% of Cultural Codes turns, but its standalone Fun Index was only 63.29.
- 🐲 Qwen 8B reached 64.9% human target recall, but its same-model Fun was 57.80 and it produced 1.30 cross-model wrong-team hits per game.
- 🧩 Jina passed the human gate only with the text-matching model's required `Document:` prefix. It remained too conservative in self-play and transferred poorly.
- 💵 The full OpenRouter Gemini and Qwen 8B generations cost $0.0544 combined.
- 🚫 Vercel showed $3.1300 of free credit, but Cohere and Voyage returned model-level 429 responses after isolated successful probes. A project API key, OIDC, and Cohere routing through both Cohere and Bedrock produced the same sustained restriction.

## 🧪 Promotion gates

| 🧠 Candidate | 🚦 Human | 🚦 Fun | 🚦 Cross correct | 🚦 Cross wrong | 🚦 Assassin |
| --- | --- | --- | --- | --- | --- |
| 🧪 Qwen3 Embedding 0.6B | ✅ Pass | ✅ Pass | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Gemini Embedding 2 | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 ConceptNet Numberbatch | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Qwen3 Embedding 8B | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass |
| 🧪 Jina v5 text-small | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |

## 🔁 Reproduction

1. Prepare the shared terms with `node scripts/prepare-embedding-candidate.mjs --output <experiment-dir>`.
2. Generate local vectors with `scripts/embed-local-candidate.py`, or hosted vectors with `npm run embed:gateway-candidate` and an explicit cost cap.
3. Build the human report and precomputed 10,000-clue index with `node scripts/finalize-embedding-candidate.mjs --experiment-dir <experiment-dir>`.
4. Run same-model and MiniLM operative Play benchmarks with `scripts/benchmark-play-policy.mjs`.
5. Refresh this report with `node scripts/summarize-embedding-candidates.mjs`.

The checked machine-readable result is [play-embedding-candidate-experiments.json](../scripts/generated/play-embedding-candidate-experiments.json).

## ⚠️ Distribution constraints

Jina v5 text-small is CC BY-NC 4.0, and ConceptNet Numberbatch is CC BY-SA 4.0. Their local benchmark artifacts remain gitignored. Review licensing before distributing either model or a derived production index.
