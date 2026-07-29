import assert from "node:assert/strict";
import {
  classifyMetricChanges,
  comparePairedGameResults,
  createPromotionAssessment,
  findPairedGameRegressions,
  wilsonInterval,
  zeroEventUpperBound,
} from "./benchmark-statistics.mjs";
import {
  artifactRecord,
  comparisonFingerprint,
  createFinalVerdict,
  humanEvidenceRecord,
  renderBenchmarkComparisonSummary,
  validateComparableReports,
} from "./benchmark-comparison-report.mjs";
import {
  createBenchmarkConfiguration,
  stableFingerprint,
} from "./benchmark-configuration.mjs";

const baseline = Array.from({ length: 20 }, (_, index) => ({
  board: index + 1,
  turns: 10,
  correctGuesses: 12,
  wrongTeamHits: 1,
  neutralHits: 0,
  assassinHits: 0,
  fallbackClues: 0,
  stalled: false,
}));
const candidate = baseline.map((game) => ({
  ...game,
  correctGuesses: 14,
  wrongTeamHits: 0,
}));
const comparison = comparePairedGameResults(baseline, candidate, {
  iterations: 1_000,
  seed: "smoke",
});
assert.equal(comparison.pairedBoards, 20);
assert.equal(comparison.metrics.correctCardsPerTurn.delta.estimate, 0.2);
assert.equal(comparison.metrics.wrongTeamHitsPerGame.delta.estimate, -1);
assert.ok(comparison.metrics.correctCardsPerTurn.delta.lower > 0);
assert.throws(
  () =>
    comparePairedGameResults(baseline, candidate.slice(1), {
      iterations: 10,
    }),
  /differ in length/u,
);

const assessment = createPromotionAssessment(comparison, candidate);
assert.equal(assessment.gates.zeroStalls.passed, true);
assert.equal(assessment.gates.correctSuperiority.passed, true);
assert.equal(assessment.playPromotionPassed, true);
assert.equal(assessment.playGateStatus, "pass");
assert.equal(wilsonInterval(0, 150).upper < 0.025, true);
assert.equal(zeroEventUpperBound(150) < 0.02, true);

const metrics = classifyMetricChanges(comparison);
assert.equal(metrics.correctCardsPerTurn.status, "improved");
assert.equal(metrics.wrongTeamHitsPerGame.status, "improved");
assert.equal(metrics.neutralHitsPerGame.status, "unchanged");
assert.equal(metrics.meanTurnsPerGame.status, "unchanged");

const regressions = findPairedGameRegressions(
  baseline,
  candidate.map((game, index) =>
    index === 0
      ? {
          ...game,
          assassinHits: 1,
          neutralHits: 1,
        }
      : game,
  ),
);
assert.equal(regressions.totalWithRegression, 1);
assert.deepEqual(Object.keys(regressions.items[0].metrics), [
  "neutralHitsPerGame",
  "assassinRate",
]);

const methodology = {
  boardCount: 20,
  boardOffset: 120,
  split: "development",
  pairedBoards: true,
  wordSet: "official",
  language: "en",
  operativeModelId: "same",
  boardSeed: "fixed",
};

const canonical = createBenchmarkConfiguration({
  activeAggressions: ["dynamic"],
  activePolicies: ["hybrid"],
  benchmarkReranker: null,
  boardWords: ["ALPHA", "BETA"],
  conceptAsset: {
    contentSha256: "concepts",
  },
  conceptRankingEnabled: true,
  heldOutProtocol: null,
  implementationAsset: {
    contentSha256: "implementation",
    files: [
      {
        file: "src/play/bots.js",
        sha256: "bots",
      },
    ],
  },
  modelAsset: {
    id: "bge-small",
    manifestSha256: "model-manifest",
    selectedShards: [{ file: "0.json", sha256: "model-shard" }],
  },
  operativeAsset: {
    id: "same",
    resolvedModelId: "bge-small",
    manifestSha256: "model-manifest",
  },
  options: {
    split: "development",
    boardOffset: 120,
    boards: 20,
    language: "en",
    wordSet: "official",
    maxActions: 100,
    candidates: 30_000,
    clueSelection: "tempo",
    multiTolerance: 5,
    clueRepeatPolicy: "never",
    missedTargetTiming: "late",
    operativeAggression: "dynamic",
    operativeRanking: "concept",
    operativeNoise: "none",
    bonusGuesses: "pass",
    similarityScale: 1,
    similarityOffset: 0,
  },
  resultsPerTargetSize: 6,
});
assert.equal(canonical.configuration.board.language, "en");
assert.equal(canonical.configuration.board.wordSet, "official");
assert.equal(
  canonical.configuration.spymaster.modelIndex.id,
  "bge-small",
);
assert.equal(canonical.configuration.spymaster.vocabularySize, 30_000);
assert.equal(canonical.configuration.spymaster.clueSelection, "tempo");
assert.equal(canonical.configuration.spymaster.multiClueTolerance, 5);
assert.equal(canonical.configuration.spymaster.clueRepeatPolicy, "never");
assert.equal(canonical.configuration.spymaster.missedTargetTiming, "late");
assert.equal(canonical.configuration.operative.aggression, "dynamic");
assert.equal(
  canonical.configuration.operative.conceptBridges.resolved,
  "guarded-wordnet",
);
assert.equal(
  canonical.configuration.operative.conceptBridges.playSetting,
  "guarded",
);
assert.equal(canonical.configuration.operative.guessVariation, "none");
assert.equal(canonical.configuration.operative.extraGuessPolicy, "pass");
assert.equal(canonical.configuration.randomness.deterministic, true);
assert.match(canonical.configurationLabels.modelIndex, /30k/u);

for (const [path, value] of [
  ["board.language", "it"],
  ["board.wordSet", "extended"],
  ["board.wordReusePolicy", "avoid-recent"],
  ["game.simulationContractVersion", 2],
  ["spymaster.modelIndex.id", "candidate-model"],
  ["spymaster.vocabularySize", 10_000],
  ["spymaster.comparisonPolicy", "current"],
  ["spymaster.clueSelection", "random"],
  ["spymaster.multiClueTolerance", 8],
  ["spymaster.clueRepeatPolicy", "previous"],
  ["spymaster.missedTargetTiming", "balanced"],
  ["operative.aggression", "aggressive"],
  ["operative.conceptBridges.resolved", "direct"],
  ["operative.conceptBridges.playSetting", "direct"],
  ["operative.guessVariation", "standard"],
  ["operative.extraGuessPolicy", "allow"],
  ["randomness.decisionSeed", "different-seed-scheme"],
]) {
  const changed = structuredClone(canonical.configuration);
  setPath(changed, path, value);
  assert.notEqual(
    stableFingerprint(changed),
    canonical.configurationFingerprint,
    `${path} must affect the canonical configuration fingerprint`,
  );
}

validateComparableReports(
  { methodology },
  { methodology: { ...methodology, modelId: "candidate" } },
  "candidate",
);
assert.throws(
  () =>
    validateComparableReports(
      { methodology },
      {
        methodology: {
          ...methodology,
          boardOffset: 248,
        },
      },
      "candidate",
    ),
  /boardOffset/u,
);

const needsHeldOut = createFinalVerdict({
  promotion: assessment,
  split: "development",
  heldOutProtocol: null,
  humanEvidence: { verdict: "pass" },
});
assert.equal(needsHeldOut.status, "needs-more-data");
const promote = createFinalVerdict({
  promotion: assessment,
  split: "test",
  heldOutProtocol: { sha256: "protocol" },
  humanEvidence: { verdict: "pass" },
});
assert.equal(promote.status, "promote");
const humanEvidence = humanEvidenceRecord({
  candidateId: "candidate",
  path: "human.json",
  bytes: Buffer.from("human"),
  report: {
    generatedAt: "2026-01-03T00:00:00.000Z",
    methodology: {
      unit: "answered blinded clue task",
    },
    models: {
      candidate: {
        answeredTasks: 10,
        targetRecallAtDeclaredCount: 0.7,
        wrongTeamHitsPerTask: 0.1,
      },
    },
  },
  verdict: "pass",
});
assert.equal(humanEvidence.sampleSize, 10);
assert.equal(humanEvidence.verdict, "pass");
assert.equal(humanEvidence.automaticThreshold, null);
const block = createFinalVerdict({
  promotion: assessment,
  split: "test",
  heldOutProtocol: { sha256: "protocol" },
  humanEvidence: { verdict: "fail" },
});
assert.equal(block.status, "block");

const baselineArtifact = artifactRecord({
  id: "accepted",
  path: "baseline.json",
  bytes: Buffer.from("baseline"),
  report: { generatedAt: "2026-01-01T00:00:00.000Z", methodology },
  role: "accepted-baseline",
});
const canonicalArtifact = artifactRecord({
  id: "canonical",
  path: "canonical.json",
  bytes: Buffer.from("canonical"),
  report: {
    generatedAt: "2026-01-01T00:00:00.000Z",
    methodology,
    configuration: canonical.configuration,
    configurationFingerprint: canonical.configurationFingerprint,
    configurationLabels: canonical.configurationLabels,
  },
  role: "candidate",
});
assert.equal(
  canonicalArtifact.configurationContract,
  "canonical-v1",
);
assert.throws(
  () =>
    artifactRecord({
      id: "tampered",
      path: "tampered.json",
      bytes: Buffer.from("tampered"),
      report: {
        methodology,
        configuration: canonical.configuration,
        configurationFingerprint: "wrong",
      },
      role: "candidate",
    }),
  /configurationFingerprint/u,
);
const candidateArtifact = artifactRecord({
  id: "candidate",
  path: "candidate.json",
  bytes: Buffer.from("candidate"),
  report: { generatedAt: "2026-01-02T00:00:00.000Z", methodology },
  role: "candidate",
});
const fingerprint = comparisonFingerprint({
  baseline: baselineArtifact,
  candidates: [{ artifact: candidateArtifact }],
  methodology: { bootstrapIterations: 1_000 },
});
assert.equal(
  fingerprint,
  comparisonFingerprint({
    baseline: baselineArtifact,
    candidates: [{ artifact: candidateArtifact }],
    methodology: { bootstrapIterations: 1_000 },
  }),
);

const summary = renderBenchmarkComparisonSummary({
  evidence: {
    split: "development",
    splitRole: "tuning",
    pairedBoards: 20,
  },
  methodology: { bootstrapIterations: 1_000 },
  candidates: [
    {
      id: "candidate",
      artifact: candidateArtifact,
      metrics,
      configurationChanges: {
        modelId: { baseline: "accepted", candidate: "candidate" },
      },
      humanEvidence: null,
      perExampleRegressions: regressions,
      verdict: needsHeldOut,
    },
  ],
});
assert.match(summary, /needs-more-data/u);
assert.match(summary, /95% interval/u);
assert.match(summary, /Board 1/u);

console.log("Benchmark statistics smoke checks passed.");

function setPath(target, path, value) {
  const parts = path.split(".");
  const leaf = parts.pop();
  const parent = parts.reduce((current, part) => current[part], target);
  parent[leaf] = value;
}
