# Benchmark reporting

`npm run benchmark:compare` turns full Play benchmark artifacts into one deterministic candidate-versus-accepted-baseline decision report. It writes machine-readable JSON and a compact Markdown summary with evidence provenance, sample size, paired uncertainty, metric deltas, board-level regressions, promotion gates, and a final `promote`, `block`, or `needs-more-data` verdict.

## Run the pipeline

Generate baseline and candidate artifacts on the same frozen split:

```sh
npm run benchmark:play -- \
  --split development \
  --comparison-only \
  --output .cache/benchmarks/accepted-development.json

npm run benchmark:play -- \
  --split development \
  --comparison-only \
  --model <candidate-model> \
  --output .cache/benchmarks/candidate-development.json
```

Compare them:

```sh
npm run benchmark:compare -- \
  --baseline .cache/benchmarks/accepted-development.json \
  --baseline-id accepted-bge-small \
  --candidate candidate=.cache/benchmarks/candidate-development.json \
  --output scripts/generated/candidate-development-comparison.json
```

The comparison command also writes `candidate-development-comparison.md`. Repeating the command with identical artifacts, seed, and iteration count produces the same statistics, artifact hashes, comparison fingerprint, and report timestamp. The timestamp is the latest source-artifact timestamp rather than the wall-clock comparison time.

Attach an evaluated blinded human report only after its gross-failure decision has been reviewed:

```sh
npm run benchmark:compare -- \
  --baseline <accepted-test.json> \
  --candidate candidate=<candidate-test.json> \
  --human-evidence candidate=<human-calibration-report.json> \
  --human-verdict candidate=pass \
  --output <held-out-comparison.json>
```

The comparator records the reviewed `pass` or `fail`. It does not invent a numeric human threshold or use the human round as a model ranker.

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

Every human-alignment slice includes:

- Candidate ID, tuning or held-out role, source identity, format, repository when available, and an exact pinned revision.
- Attached artifact path, SHA-256 hash, and source report timestamp.
- Observation unit and source, baseline, and candidate counts.
- Metric definitions, baseline values, candidate values, candidate-minus-baseline deltas, intervals when available, and status.
- Explicit baseline and candidate result identities.

Aggregate human reports do not provide paired observations, so their slice intervals are `null` and metric status is `reported` or `unchanged`. The report does not infer significance from aggregate deltas. Reviewed blinded calibration uses its existing `pass`, `fail`, or `unreviewed` gross-failure status.

Human source rows remain outside the report. Only aggregate evaluated human metrics may be attached. Cultural Codes and Connector remain separate slices because Duet games and fixed two-target reference games are incompatible formats. The comparator never collapses them into an opaque score. Board-level details come from deterministic project-generated simulations, not the unlicensed human source rows.
