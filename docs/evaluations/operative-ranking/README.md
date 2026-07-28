# Operative ranking evaluations

BGE-small with the guarded WordNet sense bridge remains the production default. The preserved reports in this directory cover direct rerankers, explicit bridge evidence, bounded bridge-plus-rerank pipelines, full-game effects, and cross-model safety.

| 🧠 Candidate | 📌 Decision | 💾 Local asset | 🎯 Direct JOUST | 👥 Cultural target recall |
|---|---|---:|---|---:|
| 🌉 BGE + WordNet | 🟢 Keep | Existing | ✅ Pass | 59.16% |
| 🍞 Mixedbread xsmall | 🔴 Reject | 95.9 MB | ✅ Pass | 53.15% |
| 🤖 MiniLM reranker | 🔴 Reject | 47.7 MB | ❌ Fail | 48.39% |
| 🌐 BGE v2-m3 | 🔴 Reject | 587.8 MB | ❌ Fail | 53.17% sample |
| 📦 BGE reranker base | 🔴 Reject | 296.4 MB | ❌ Fail | 41.04% sample |
| 🌍 GTE multilingual | 🔴 Reject | 340.9 MB | ❌ Fail | Fixed screen |
| 📚 Jina v3 | 🚫 License | 1.22 GB | ✅ Pass | Fixed screen |
| ☁️ GPT-5.4 nano | 🚫 Hosted | $0.0008 | ✅ Pass | Fixed screen |

Mixedbread was the strongest production-eligible reranker. Adding it after WordNet reached 59.13% Cultural Codes target recall versus 59.16% for WordNet alone, then produced zero paired deltas in the 20-board full-game comparison. It added about 547 MB resident peak and 20.6 ms warm shortlist latency.

## Evidence inventory

| 📄 Report | 🔬 Scope | 📐 Scale |
|---|---|---|
| 🧠 [`concept-ranking-evaluation.json`](concept-ranking-evaluation.json) | Direct, bridge, rerank | Human + fixed |
| 🧪 [`reranker-supplemental-screen.json`](reranker-supplemental-screen.json) | GTE and Jina | Six fixtures |
| ☁️ [`hosted-listwise-reranker-evaluation.json`](hosted-listwise-reranker-evaluation.json) | Hosted listwise | Six fixtures |
| 🌉 [`concept-ranking-full-game-comparison.json`](concept-ranking-full-game-comparison.json) | WordNet bridge | 100 boards |
| 🔬 [`concept-ranking-30k-smoke-comparison.json`](concept-ranking-30k-smoke-comparison.json) | Current candidate depth | 20 boards |
| 🛡️ [`concept-ranking-cross-model-comparison.json`](concept-ranking-cross-model-comparison.json) | Guarded transfer | 100 boards |
| ⚠️ [`concept-ranking-unrestricted-cross-model-comparison.json`](concept-ranking-unrestricted-cross-model-comparison.json) | Unsafe transfer ablation | 100 boards |
| 🤖 [`bridge-reranker-full-game-comparison.json`](bridge-reranker-full-game-comparison.json) | MiniLM after WordNet | 20 boards |
| 🍞 [`mixedbread-bridge-reranker-full-game-comparison.json`](mixedbread-bridge-reranker-full-game-comparison.json) | Mixedbread after WordNet | 20 boards |
| 🔒 [`bridge-reranker-cross-model-comparison.json`](bridge-reranker-cross-model-comparison.json) | Reranker fail-closed path | 20 boards |

## Evaluation contract

- Preserve `JOUST → medieval tournament → MATCH / CROWN / GLOVE / BELT`, with `PIANO` ranked after all four targets.
- Operative inputs remain limited to the public clue, public card words, local WordNet definitions, and public remaining-agent counts.
- Automatic ranking remains local, offline, bounded, and free per turn.
- Treat same-model full-game runs as regressions. Cross-model safety and human association data remain promotion gates.
- Keep hosted models comparison-only. Require an explicit preflight, cache, and hard cost cap before a paid run.
- Retain model revisions, licensing, latency, memory, cost, and dataset sampling in checked reports.
- Score fixed candidate groups independently. ONNX cross-encoder scores can shift when unrelated examples change batch padding.

The aggregate human reports do not redistribute the unlicensed Cultural Codes or Connector source datasets. Their cached upstream data remains outside version control.

## Reproduction

Refresh the main local report:

```sh
npm run evaluate:concept-ranking
```

Check the hosted fixture without spending:

```sh
npm run evaluate:hosted-reranker -- --preflight-only --max-cost-usd 0.005
```

Full-game candidates use `scripts/benchmark-play-policy.mjs` with `--comparison-only` and `--operative-ranking direct|concept|concept-rerank`, followed by `scripts/compare-play-benchmarks.mjs`. Set `BENCHMARK_RERANKER_ID` to the pinned MiniLM control or Mixedbread candidate for `concept-rerank`.

The implementation surfaces to retain when revising the framework are:

- [`scripts/evaluate-concept-ranking.mjs`](../../../scripts/evaluate-concept-ranking.mjs) for fixed fixtures, human aggregates, reranker ablations, latency, and memory.
- [`scripts/evaluate-hosted-listwise-reranker.mjs`](../../../scripts/evaluate-hosted-listwise-reranker.mjs) for capped hosted comparisons.
- [`scripts/benchmark-play-policy.mjs`](../../../scripts/benchmark-play-policy.mjs) for deterministic full-game runs.
- [`scripts/compare-play-benchmarks.mjs`](../../../scripts/compare-play-benchmarks.mjs) for paired bootstrap comparisons and promotion gates.
- [`scripts/play-smoke.mjs`](../../../scripts/play-smoke.mjs) for report schema and regression assertions.

Evaluator refreshes update the canonical reports in this directory. Git history retains earlier snapshots for future framework migrations.
