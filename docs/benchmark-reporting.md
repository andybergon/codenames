# Benchmark reporting

`npm run benchmark:compare` turns full Play benchmark artifacts into one deterministic candidate-versus-accepted-baseline decision report. It writes machine-readable JSON and a compact Markdown summary with evidence provenance, sample size, paired uncertainty, metric deltas, board-level regressions, promotion gates, and a final `promote`, `block`, or `needs-more-data` verdict.

## Run the pipeline

Generate the accepted production baseline on the frozen development split:

```sh
npm run benchmark:play -- \
  --split development \
  --comparison-only \
  --output scripts/generated/play-accepted-baseline-development.json

npm run benchmark:compare -- \
  --baseline scripts/generated/play-accepted-baseline-development.json \
  --baseline-id accepted-production-development \
  --baseline-only \
  --output scripts/generated/play-model-comparison-v3.json
```

The baseline-only v3 report is the scorecard source until real candidate evidence is available. It records the accepted artifact, full configuration and fingerprint, provenance, split, and sample size without creating deltas, intervals, gates, or a promotion verdict.

Generate a candidate on the same frozen split:

```sh
npm run benchmark:play -- \
  --split development \
  --comparison-only \
  --model <candidate-model> \
  --output .cache/benchmarks/candidate-development.json
```

Compare them:

```sh
npm run benchmark:compare -- \
  --baseline scripts/generated/play-accepted-baseline-development.json \
  --baseline-id accepted-production-development \
  --candidate candidate=.cache/benchmarks/candidate-development.json \
  --output scripts/generated/play-model-comparison-v3.json
```

The comparison command also writes `play-model-comparison-v3.md`. Repeating the command with identical artifacts, seed, and iteration count produces the same statistics, artifact hashes, comparison fingerprint, and report timestamp. The timestamp is the latest source-artifact timestamp rather than the wall-clock comparison time. Run `npm run validate:benchmark-report` after refreshing the checked report.

`npm run benchmark:audit:summary` consolidates isolated smoke and development comparisons under `.cache/benchmark-audit/` into the checked [English Play default one-factor audit](evaluations/play-default-audit/play-default-audit.md). The audit keeps the accepted baseline immutable, uses six workers by default, stops smoke gate failures before development, and never consumes held-out boards. `--clue-policy current` or `--clue-policy hybrid` selects one exact scoring policy for comparison-only runs.

### Accepted development baseline

The checked baseline uses the documented current English production behavior on development boards 120 through 247:

- Generated at: `2026-07-29T03:40:12.862Z`.
- Full artifact: [`play-accepted-baseline-development.json`](../scripts/generated/play-accepted-baseline-development.json), SHA-256 `4d4bf6e12354c865f4db933925fe207fff816bc3f689e0f4fb6e908d1857085e`.
- Canonical configuration fingerprint: `cf888693ae7567c012460f8b697231911be13352d88a7e122d4cb19879c3633b`.
- Behavior implementation: SHA-256 `233e0fabc574c8ad101d62e7f0618da7cfb5c963920728939d24d99b3650e9a4`.
- BGE-small manifest: SHA-256 `df9997658cb028aac476db5291b03d2fb88a7923304036c651da7206968da8fb`, with exact selected shard hashes retained in the artifact.
- Official English word pool: SHA-256 `b2bdf45505d9a23da8f127923c62a33be570d9fc1646400ad8038a18e78ab9a2`.
- WordNet concept assets: version 2, SHA-256 `d23c4a06d0dfb491b512349659e2a95bf05b9b8cb15a8a52bc648fbb45c77c01`.
- Canonical v3 scorecard report: [`play-model-comparison-v3.json`](../scripts/generated/play-model-comparison-v3.json), comparison fingerprint `68f7e3b4a1a58393a0768ddc171969d46267c59bc5d21afa2aa3940050761b0a`.

This development artifact is accepted as the reproducible baseline for tuning comparisons. It is not held-out promotion evidence.

### Board-vector cache

Local transformer-backed benchmarks cache centered board vectors under `.cache/benchmark-board-vectors/`. The content-addressed key includes the cache format, language, word set and exact word content, model and revision, task prefix, dimensions, full index manifest hash, and centering method and mean.

For the fixed 20-board smoke split on the same machine, the cold vector stage took `11966.7 ms`; the identical warm stage took `3.6 ms`. Total warm smoke runtime was `41.45 s`. Cache mismatch, corruption, or truncation regenerates the vectors, and the fixed board counts and gates do not change.

Attach an evaluated blinded human report only after its gross-failure decision has been reviewed:

```sh
npm run benchmark:compare -- \
  --baseline <accepted-test.json> \
  --candidate candidate=<candidate-test.json> \
  --human-evidence candidate=<human-calibration-report.json> \
  --human-verdict candidate=pass \
  --output <held-out-comparison.json>
```

The comparator records the reviewed `pass` or `fail`. It does not invent a numeric human threshold or use the human round as a model ranker. Only an explicitly held-out round can satisfy the human promotion requirement. Tuning, calibration, and player-feedback evidence can block or request more evidence, but cannot promote.

`npm run calibration:evaluate` writes each answered blinded round separately in `rounds[]`, pins its public definition plus answer key by SHA-256, and retains the aggregate `models` object for older consumers. The decision report emits one held-out slice per round only when both the accepted baseline and candidate have observations in that round.

Attach an aggregate human embedding report with exact result selectors:

```sh
npm run benchmark:compare -- \
  --baseline <accepted-development.json> \
  --candidate candidate=<candidate-development.json> \
  --human-alignment candidate=scripts/generated/embedding-model-comparison.json \
  --human-alignment-baseline candidate=Xenova/bge-small-en-v1.5#centered \
  --human-alignment-candidate candidate=<candidate-model>#centered \
  --human-alignment-role candidate=tuning \
  --output <development-comparison.json>
```

The `#transform` suffix disambiguates raw and centered results. The selected baseline must represent the accepted system. Public datasets default to tuning evidence and require an explicit `held-out` role to claim otherwise.

## Canonical configuration

Every newly generated Play benchmark result includes:

- `configuration`, the exact behavior configuration.
- `configurationFingerprint`, a stable SHA-256 fingerprint of canonical sorted JSON.
- `configurationLabels`, compact labels derived from the exact configuration for summaries and downstream views.

The configuration includes every Play setting that can change simulated game behavior:

- Board language, word set, exact word-content hash, board order, word-reuse policy, board range, and deterministic board seed scheme.
- Spymaster model and index identity, manifest and selected-shard hashes, vocabulary size, clue policy variants, comparison policy, clue scoring contract, clue selection, multi-clue tolerance, clue reuse, missed-target timing, and suggestion depth.
- Operative model and index identity, aggression, concept-bridge request and resolved behavior, concept-data identity, optional reranker identity, guess variation and range, and extra-guess policy.
- Similarity scale and offset, starting side, simulated seat, action bound, fallback clue behavior, forced-progress behavior, and every decision-seed input.
- Frozen split role and held-out protocol authorization when applicable.
- A simulation-contract version plus content hashes for gameplay implementation files that own board generation, embeddings, clue scoring, bot decisions, concepts, settings, and rules.

Visual-only state is excluded. Developer score ordering, live-analysis visibility, expanded panels, and other presentation preferences cannot affect the fingerprint.

Model manifests, every selected index shard, and precomputed auxiliary vector assets receive content hashes. English concept runs also hash the complete generated concept asset set. The board-word hash captures the exact selected pool even when its source module has no separate version number.

When a new behavior-affecting setting is added to Play or the benchmark runner, add it to `scripts/benchmark-configuration.mjs`, its required-field validation, fingerprint tests, and these docs in the same change. Bump `game.simulationContractVersion` when benchmark-only simulation semantics change without a separate exact configuration field.

## Evidence split

| 🧪 Split | 📌 Role | 🔢 Boards | 🚦 Promotion use |
| --- | --- | ---: | --- |
| 🔬 Smoke | Tuning | 20 | ❌ No |
| 📐 Calibration | Tuning | 100 | ❌ No |
| 🛠️ Development | Tuning | 128 | ❌ No |
| 🔒 Test | Held-out | 150 | ✅ Once |
| 🧩 Custom | Unspecified | Variable | ❌ No |

`benchmark:play` refuses a `test` run unless the supplied protocol marks the model eligible and the output path is new. The result records the protocol path, SHA-256 hash, schema version, and authorized model ID. The comparator refuses mismatched board ranges, languages, word sets, operative models, or seed schemes.

Tuning evidence can block a candidate or request more data, but it cannot promote one. A promotion requires:

1. A canonical accepted-baseline artifact and canonical candidate artifact.
2. Passing Play gates on an authorized one-time held-out test split.
3. A reviewed blinded human calibration pass.

## Metrics and uncertainty

The comparator pairs games by deterministic board ID and resamples whole boards 10,000 times by default. Every delta is `candidate - baseline`.

| 📏 Metric | 🎯 Better | 📐 Status rule | 🧾 Source |
| --- | --- | --- | --- |
| ✅ Correct cards/turn | Higher | 95% interval | Paired boards |
| 🔴 Wrong-team hits/game | Lower | 95% interval | Paired boards |
| 🟠 Neutral hits/game | Lower | 95% interval | Paired boards |
| ☠️ Assassin rate | Lower | 95% interval | Paired boards |
| 🛟 Fallback clue rate | Lower | 95% interval | Paired boards |
| 🧱 Stall rate | Lower | 95% interval | Paired boards |
| ⏱️ Turns/game | Context | Changed only | Paired boards |

An improvement or regression requires the full 95% interval to clear zero in the relevant direction. An interval crossing zero is `uncertain`; an exact zero interval is `unchanged`. Turns per game has no universal preferred direction, so the report marks a conclusive movement as `changed` without calling it better.

The Play promotion gates retain the existing conservative thresholds:

| 🚦 Gate | 📐 Required |
| --- | ---: |
| 🧱 Stalls | 0 |
| 🛟 Candidate fallback rate | ≤ 0.01 |
| ✅ Correct-card lower delta | > -0.05 |
| ☠️ Assassin upper delta | ≤ +0.05 |
| 🔴 Wrong-team upper delta | ≤ +0.15 |
| 🟠 Neutral upper delta | ≤ +0.15 |

If a point estimate crosses a threshold, the candidate is blocked. If the point estimate remains within the threshold but its confidence bound does not, the result needs more data. This prevents a small, noisy sample from being reported as a conclusive failure.

## Artifacts

The comparison JSON preserves the previous `baseline`, `candidates`, `comparison`, and `promotion` fields and adds:

- Baseline and candidate roles, paths, SHA-256 hashes, canonical configurations, fingerprints, compact labels, and evidence metadata.
- Per-metric labels, preferred direction, baseline value, candidate value, delta, 95% interval, and status.
- Exact changed configuration paths.
- Up to ten numeric board-level regression records by default, with the total affected-board count retained.
- Optional blinded human evidence metadata and reviewed verdict.
- A final verdict with reasons and missing evidence.
- A stable comparison fingerprint derived from artifact hashes and comparison methodology.

Schema version 3 keeps `baseline` and `candidates[]` as the stable presentation roots and adds:

- `summary`, a compact candidate and verdict inventory with Play metric-status counts and human-evidence coverage.
- `evidenceFamilies.humanAlignment.slices[]`, one expandable slice per source and game or task format.
- `methodology.evidenceLayers`, the artifact-owned human, fixed-board, safety, transfer, and promotion-flow explanation rendered by the scorecard's Tests & data tab.

Every human-alignment slice includes:

- Candidate ID, tuning or held-out role, source identity, format, repository when available, and an exact pinned revision.
- Attached artifact path, SHA-256 hash, and source report timestamp.
- Observation unit and source, baseline, and candidate counts.
- Metric definitions, baseline values, candidate values, candidate-minus-baseline deltas, intervals when available, and status.
- Explicit baseline and candidate result identities.

Aggregate human reports do not provide paired observations, so their slice intervals are `null` and metric status is `reported` or `unchanged`. The report does not infer significance from aggregate deltas. Reviewed blinded calibration uses its existing `pass`, `fail`, or `unreviewed` gross-failure status.

Human source rows remain outside the report. Only aggregate evaluated human metrics may be attached. Cultural Codes and Connector remain separate slices because Duet games and fixed two-target reference games are incompatible formats. The comparator never collapses them into an opaque score. Board-level details come from deterministic project-generated simulations, not the unlicensed human source rows.
