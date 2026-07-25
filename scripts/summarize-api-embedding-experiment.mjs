import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const options = parseOptions(process.argv.slice(2));
const [
  baselineSelfReport,
  baselineCrossReport,
  candidateSelfReport,
  candidateCrossReport,
  tunedCandidateSelfReport,
  humanReport,
  indexManifest,
] = await Promise.all([
  readJson(options.baselineSelf),
  readJson(options.baselineCross),
  readJson(options.candidateSelf),
  readJson(options.candidateCross),
  readJson(options.tunedCandidateSelf),
  readJson(
    resolve(ROOT, "scripts/generated/api-embedding-comparison.json"),
  ),
  readJson(
    resolve(
      ROOT,
      ".cache/embedding-experiments/openai-text-embedding-3-large-1024/index/manifest.json",
    ),
  ),
]);

const baselineSelf = baselineSelfReport.policies.hybrid;
const baselineCross = baselineCrossReport.policies.hybrid;
const candidateSelf = candidateSelfReport.policies.hybrid;
const candidateCross = candidateCrossReport.policies.hybrid;
const tunedCandidateSelf = tunedCandidateSelfReport.policies.hybrid;
const knownTokens =
  indexManifest.apiExperiment.cumulativeKnownBilledTokens +
  humanReport.costControl.billedTokens;
const knownCost =
  (knownTokens / 1_000_000) *
  humanReport.costControl.pricePerMillionTokens;
const gates = [
  {
    gate: "Human validity",
    passed: humanReport.humanValidityGuardrails.passed,
    candidate: "Pass",
    requirement: "Pass",
  },
  {
    gate: "Default Fun Index",
    passed: candidateSelf.fun.score >= baselineSelf.fun.score,
    candidate: candidateSelf.fun.score,
    requirement: `>= ${baselineSelf.fun.score}`,
  },
  {
    gate: "Cross-model correct per turn",
    passed:
      candidateCross.correctCardsPerTurn >=
      baselineCross.correctCardsPerTurn - 0.05,
    candidate: candidateCross.correctCardsPerTurn,
    requirement: `>= ${rounded(baselineCross.correctCardsPerTurn - 0.05)}`,
  },
  {
    gate: "Cross-model wrong per game",
    passed:
      candidateCross.wrongTeamHitsPerGame <=
      baselineCross.wrongTeamHitsPerGame + 0.1,
    candidate: candidateCross.wrongTeamHitsPerGame,
    requirement: `<= ${rounded(baselineCross.wrongTeamHitsPerGame + 0.1)}`,
  },
  {
    gate: "Cross-model assassin rate",
    passed:
      candidateCross.assassinRate <= baselineCross.assassinRate + 0.05,
    candidate: candidateCross.assassinRate,
    requirement: `<= ${percent(baselineCross.assassinRate + 0.05)}`,
  },
];
const report = {
  generatedAt: new Date().toISOString(),
  sample: {
    boards: baselineSelfReport.methodology.boardCount,
    policy: "hybrid",
    clueSelection: "tempo",
    defaultMultiTolerance: 5,
    tunedCandidateMultiTolerance: 20,
  },
  objective: baselineSelfReport.methodology.funObjective,
  cost: {
    knownBilledTokens: knownTokens,
    knownBilledCostUsd: rounded(knownCost, 6),
    maximumPossibleTimedOutRequestCostUsd: 0.0002,
    upperBoundCostUsd: rounded(knownCost + 0.0002, 6),
  },
  humanAlignment: {
    baseline: humanReport.baseline.datasets,
    candidate: humanReport.transforms.centered,
    deltaVsBaseline: humanReport.centeredDeltaVsBgeSmall,
    guardrails: humanReport.humanValidityGuardrails,
  },
  candidates: {
    baseline: summarize(
      baselineSelfReport,
      baselineSelf,
      baselineCrossReport,
      baselineCross,
    ),
    api: summarize(
      candidateSelfReport,
      candidateSelf,
      candidateCrossReport,
      candidateCross,
    ),
    apiTunedSelfPlay: {
      model: tunedCandidateSelfReport.methodology.model,
      multiTolerance: 20,
      fun: tunedCandidateSelf.fun,
      multiClueRate: tunedCandidateSelf.multiClueRate,
      correctCardsPerTurn: tunedCandidateSelf.correctCardsPerTurn,
      meanTurnsPerGame: tunedCandidateSelf.meanTurnsPerGame,
    },
  },
  promotionGates: gates,
  verdict: {
    promote: gates.every(({ passed }) => passed),
    recommendation:
      "Keep BGE-small in production. Retain OpenAI large as a human-alignment challenger, but do not ship it until generated clues pass cross-model or collected human-game safety gates.",
  },
};

await writeFile(
  resolve(ROOT, "scripts/generated/play-fun-experiments.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  resolve(ROOT, "docs/play-fun-optimization.md"),
  renderMarkdown(report),
);
console.log("Wrote scripts/generated/play-fun-experiments.json");
console.log("Wrote docs/play-fun-optimization.md");

function summarize(selfReport, self, crossReport, cross) {
  return {
    model: selfReport.methodology.model,
    dimensions: selfReport.methodology.dimensions,
    selfPlay: {
      fun: self.fun,
      multiClueRate: self.multiClueRate,
      firstHalfMeanClueNumber: self.firstHalfMeanClueNumber,
      correctCardsPerTurn: self.correctCardsPerTurn,
      closeFinishRate: self.closeFinishRate,
      meanTurnsPerGame: self.meanTurnsPerGame,
      wrongTeamHitsPerGame: self.wrongTeamHitsPerGame,
      assassinRate: self.assassinRate,
    },
    crossModel: {
      operativeModel: crossReport.methodology.operativeModel,
      fun: cross.fun,
      correctCardsPerTurn: cross.correctCardsPerTurn,
      wrongTeamHitsPerGame: cross.wrongTeamHitsPerGame,
      assassinRate: cross.assassinRate,
    },
  };
}

function renderMarkdown(result) {
  const baseline = result.candidates.baseline;
  const candidate = result.candidates.api;
  const humanBaseline = result.humanAlignment.baseline.culturalCodes;
  const humanCandidate = result.humanAlignment.candidate.culturalCodes;
  const gateRows = result.promotionGates
    .map(
      ({ gate, passed, candidate: value, requirement }) =>
        `| 🧪 ${gate} | ${passed ? "✅ Pass" : "❌ Fail"} | ${value} | ${requirement} |`,
    )
    .join("\n");
  return `# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. OpenAI \`text-embedding-3-large\` is better aligned with human clue data, but its generated clues do not transfer safely to a different operative embedding and its default-policy Fun Index is lower.

| 🧠 Model | 🎯 Rating | 💵 Experiment | 🎉 Self fun | 👥 Human target | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | Local | ${decimal(baseline.selfPlay.fun.score)} | ${percent(humanBaseline.targetRecallAtCount)} | ${decimal(baseline.crossModel.wrongTeamHitsPerGame)} | ${percent(baseline.crossModel.assassinRate)} | ✅ Keep |
| 🔴 OpenAI large | 🔴 2 | $${result.cost.knownBilledCostUsd.toFixed(4)} | ${decimal(candidate.selfPlay.fun.score)} | ${percent(humanCandidate.targetRecallAtCount)} | ${decimal(candidate.crossModel.wrongTeamHitsPerGame)} | ${percent(candidate.crossModel.assassinRate)} | ❌ Reject |

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
${gateRows}

## 📈 Findings

- 👥 OpenAI large improved Cultural Codes first-guess agreement from ${percent(humanBaseline.firstGuessAccuracy)} to ${percent(humanCandidate.firstGuessAccuracy)}, target recall from ${percent(humanBaseline.targetRecallAtCount)} to ${percent(humanCandidate.targetRecallAtCount)}, and avoid rate from ${percent(humanBaseline.avoidWordRate)} to ${percent(humanCandidate.avoidWordRate)}.
- 🎉 With the production tolerance of 5, its self-play Fun Index was ${decimal(candidate.selfPlay.fun.score)} versus ${decimal(baseline.selfPlay.fun.score)} for BGE-small.
- 🧰 Raising OpenAI's tolerance to 20 lifted self-play Fun to ${decimal(result.candidates.apiTunedSelfPlay.fun.score)}, but this optimizes shared-model agreement rather than human safety.
- 🔴 In the cross-model stress test, OpenAI clues produced ${decimal(candidate.crossModel.wrongTeamHitsPerGame)} wrong-team hits per game and a ${percent(candidate.crossModel.assassinRate)} assassin rate. The BGE-to-MiniLM baseline was ${decimal(baseline.crossModel.wrongTeamHitsPerGame)} and ${percent(baseline.crossModel.assassinRate)}.
- 💵 Confirmed successful API responses cost $${result.cost.knownBilledCostUsd.toFixed(4)}. One timed-out request could add at most about $${result.cost.maximumPossibleTimedOutRequestCostUsd.toFixed(4)}, keeping the experiment below $${result.cost.upperBoundCostUsd.toFixed(4)}.

## 🔁 Experiment workflow

1. Generate a cached, cost-capped API index with \`npm run experiment:api-index -- --max-cost-usd 0.03\`.
2. Validate human agreement with \`npm run evaluate:api-embeddings\`.
3. Run same-model Play to measure the Fun Index.
4. Run a cross-model operative stress test with \`--operative-model <model-id>\`.
5. Promote only candidates that improve fun without regressing human or cross-model safety gates.

The checked machine-readable result is [play-fun-experiments.json](../scripts/generated/play-fun-experiments.json).
`;
}

function parseOptions(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith("--") || !value) {
      throw new Error(`Invalid option near ${option ?? "end of arguments"}.`);
    }
    values[toCamelCase(option.slice(2))] = resolve(value);
  }
  for (const required of [
    "baselineSelf",
    "baselineCross",
    "candidateSelf",
    "candidateCross",
    "tunedCandidateSelf",
  ]) {
    if (!values[required]) throw new Error(`Missing --${toKebabCase(required)}.`);
  }
  return values;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, character) => character.toUpperCase());
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function decimal(value) {
  return Number(value).toFixed(2);
}

function rounded(value, places = 4) {
  return Number(value.toFixed(places));
}
