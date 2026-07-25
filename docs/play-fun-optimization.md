# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. OpenAI `text-embedding-3-large` is better aligned with human clue data, but its generated clues do not transfer safely to a different operative embedding and its default-policy Fun Index is lower.

| 🧠 Model | 🎯 Rating | 💵 Experiment | 🎉 Self fun | 👥 Human target | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | Local | 86.37 | 58.6% | 0.55 | 20.0% | ✅ Keep |
| 🔴 OpenAI large | 🔴 2 | $0.0085 | 61.79 | 62.5% | 1.05 | 45.0% | ❌ Reject |

## 🎉 Objective

The 0-100 Fun Index balances four proxies:

- 🔢 Ambition, multi-card share and first-half clue number.
- ✅ Momentum, correct cards per turn.
- 🤝 Suspense, close finishes and balanced wins.
- ⏱️ Flow, games in the 8 to 12 turn range.

Wrong-team hits, assassin losses, neutral hits, and analyzer fallbacks are promotion guardrails. Human clue recovery is evaluated separately because same-model self-play overstates agreement.

## 🧪 Promotion gates

| 🧪 Gate | 🚦 Status | 📊 Candidate | 🎯 Requirement |
| --- | --- | ---: | ---: |
| 🧪 Human validity | ✅ Pass | Pass | Pass |
| 🧪 Default Fun Index | ❌ Fail | 61.7864 | >= 86.3699 |
| 🧪 Cross-model correct per turn | ❌ Fail | 1.0199 | >= 1.2467 |
| 🧪 Cross-model wrong per game | ❌ Fail | 1.05 | <= 0.65 |
| 🧪 Cross-model assassin rate | ❌ Fail | 0.45 | <= 25.0% |

## 📈 Findings

- 👥 OpenAI large improved Cultural Codes first-guess agreement from 52.0% to 55.0%, target recall from 58.6% to 62.5%, and avoid rate from 9.5% to 9.0%.
- 🎉 With the production tolerance of 5, its self-play Fun Index was 61.79 versus 86.37 for BGE-small.
- 🧰 Raising OpenAI's tolerance to 20 lifted self-play Fun to 88.74, but this optimizes shared-model agreement rather than human safety.
- 🔴 In the cross-model stress test, OpenAI clues produced 1.05 wrong-team hits per game and a 45.0% assassin rate. The BGE-to-MiniLM baseline was 0.55 and 20.0%.
- 💵 Confirmed successful API responses cost $0.0085. One timed-out request could add at most about $0.0002, keeping the experiment below $0.0087.

## 🔁 Experiment workflow

1. Generate a cached, cost-capped API index with `npm run experiment:api-index -- --max-cost-usd 0.03`.
2. Validate human agreement with `npm run evaluate:api-embeddings`.
3. Run same-model Play to measure the Fun Index.
4. Run a cross-model operative stress test with `--operative-model <model-id>`.
5. Promote only candidates that improve fun without regressing human or cross-model safety gates.

The checked machine-readable result is [play-fun-experiments.json](../scripts/generated/play-fun-experiments.json).
