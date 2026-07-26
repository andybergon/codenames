import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(
  ROOT,
  "scripts/generated/benchmark-scorecard.json",
);

const [
  humanReport,
  playPolicyReport,
  embeddingExperiments,
  crossModelReport,
] = await Promise.all([
  readJson("scripts/generated/human-data-embedding-comparison.json"),
  readJson("scripts/generated/play-policy-benchmark.json"),
  readJson("scripts/generated/play-embedding-candidate-experiments.json"),
  readJson(
    "scripts/generated/play-embedding-finalist-development-cross-model.json",
  ),
]);

const bgeHuman = summarizeHuman(
  humanReport.models.bgeSmall.centered,
);
const voyageHuman = summarizeHuman(
  humanReport.models.voyage4Large.centered,
);
const voyageExperiment = embeddingExperiments.candidates.find(
  ({ id }) => id === "voyage-4-large",
);
const voyageTransfer = crossModelReport.candidates.find(
  ({ id }) => id === "voyage-4-large",
);
if (!voyageExperiment || !voyageTransfer) {
  throw new Error("Voyage benchmark evidence is incomplete.");
}

const baselineTransfer = transferMetrics(
  voyageTransfer.comparison.metrics,
  "baseline",
);
const rows = [
  buildRow({
    id: "bge-hybrid-aggressive",
    label: "BGE · Hybrid · Aggressive",
    status: "needs-transfer",
    settings: settings({
      embedding: "BGE-small",
      scoring: "Hybrid",
      aggression: "Aggressive",
    }),
    human: bgeHuman,
    selfPlay: playPolicyReport.operativeAggression.aggressive,
    evidence: {
      selfPlayBoards: playPolicyReport.methodology.boardCount,
      transferBoards: 0,
    },
  }),
  buildRow({
    id: "bge-hybrid-dynamic",
    label: "BGE · Hybrid · Dynamic",
    status: "production",
    settings: settings({
      embedding: "BGE-small",
      scoring: "Hybrid",
      aggression: "Dynamic",
    }),
    human: bgeHuman,
    selfPlay: playPolicyReport.policies.hybrid,
    transfer: baselineTransfer,
    evidence: {
      selfPlayBoards: playPolicyReport.methodology.boardCount,
      transferBoards:
        crossModelReport.baseline.methodology.boardCount,
    },
  }),
  buildRow({
    id: "voyage-hybrid-dynamic",
    label: "Voyage · Hybrid · Dynamic",
    status: "blocked",
    settings: settings({
      embedding: "Voyage 4 Large",
      provider: "Vercel AI Gateway",
      scoring: "Hybrid",
      aggression: "Dynamic",
    }),
    human: voyageHuman,
    selfPlay: normalizeExperimentPolicy(
      voyageExperiment.selfPlay,
    ),
    transfer: transferMetrics(
      voyageTransfer.comparison.metrics,
      "candidate",
    ),
    evidence: {
      selfPlayBoards: embeddingExperiments.sample.boards,
      transferBoards:
        voyageTransfer.methodology.boardCount,
    },
  }),
  buildRow({
    id: "bge-hybrid-conservative",
    label: "BGE · Hybrid · Conservative",
    status: "needs-transfer",
    settings: settings({
      embedding: "BGE-small",
      scoring: "Hybrid",
      aggression: "Conservative",
    }),
    human: bgeHuman,
    selfPlay: playPolicyReport.operativeAggression.conservative,
    evidence: {
      selfPlayBoards: playPolicyReport.methodology.boardCount,
      transferBoards: 0,
    },
  }),
  buildRow({
    id: "bge-current-dynamic",
    label: "BGE · Current · Dynamic",
    status: "needs-transfer",
    settings: settings({
      embedding: "BGE-small",
      scoring: "Current",
      aggression: "Dynamic",
    }),
    human: bgeHuman,
    selfPlay: playPolicyReport.policies.current,
    evidence: {
      selfPlayBoards: playPolicyReport.methodology.boardCount,
      transferBoards: 0,
    },
  }),
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  objective: {
    version: 1,
    defaultWeights: {
      humanAlignment: 0.6,
      selfPlayFun: 0.4,
    },
    formula:
      "Headline score is the weighted mean of macro-averaged human alignment and same-model Fun. Transfer remains a separate promotion gate.",
    humanAlignment:
      "Each source is scored independently, then the five source scores are macro-averaged. Available first-guess, guess-recall, target-recall, exact-set, pairwise, good-word, and inverted avoid-rate metrics receive equal weight within their source.",
    transfer:
      "Development transfer uses a fixed MiniLM-L6 operative on 128 paired boards. Missing or failed transfer evidence never receives a hidden score bonus.",
  },
  baselineId: "bge-hybrid-dynamic",
  sources: {
    human: "scripts/generated/human-data-embedding-comparison.json",
    selfPlay: "scripts/generated/play-policy-benchmark.json",
    embeddingExperiments:
      "scripts/generated/play-embedding-candidate-experiments.json",
    transfer:
      "scripts/generated/play-embedding-finalist-development-cross-model.json",
  },
  rows,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH}`);

function buildRow({
  id,
  label,
  status,
  settings: rowSettings,
  human,
  selfPlay,
  transfer = null,
  evidence,
}) {
  return {
    id,
    label,
    status,
    settings: rowSettings,
    scores: {
      humanAlignment: human.score,
      selfPlayFun: round(selfPlay.fun.score),
    },
    human: human.sources,
    selfPlay: {
      funComponents: selfPlay.fun.components ?? null,
      guardrailsPassed:
        selfPlay.fun.guardrailsPassed ?? true,
      multiClueRate: nullableRound(selfPlay.multiClueRate),
      correctCardsPerTurn: round(
        selfPlay.correctCardsPerTurn,
      ),
      wrongTeamHitsPerGame: nullableRound(
        selfPlay.wrongTeamHitsPerGame,
      ),
      neutralHitsPerGame: nullableRound(
        selfPlay.neutralHitsPerGame,
      ),
      assassinRate: nullableRound(selfPlay.assassinRate),
      meanTurnsPerGame: nullableRound(
        selfPlay.meanTurnsPerGame,
      ),
    },
    transfer,
    evidence,
  };
}

function settings({
  embedding,
  provider = "Local",
  scoring,
  aggression,
}) {
  return {
    language: "English",
    wordSet: "Official",
    embedding,
    provider,
    transform: "Centered",
    candidates: 10000,
    scoring,
    multiTolerance: 5,
    aggression,
    bonusGuesses: "Pass at number",
  };
}

function summarizeHuman(datasets) {
  const metricMap = {
    culturalCodes: [
      "firstGuessAccuracy",
      "guessRecallAtHumanCount",
      "targetRecallAtCount",
      "exactTargetSetAccuracy",
      "pairwiseTargetAccuracy",
      "avoidWordRate",
    ],
    connector: [
      "targetRecallAtCount",
      "exactTargetSetAccuracy",
      "pairwiseTargetAccuracy",
    ],
    strategyHumanClues: [
      "firstGuessAccuracy",
      "guessRecallAtHumanCount",
      "targetRecallAtCount",
      "exactTargetSetAccuracy",
      "pairwiseTargetAccuracy",
    ],
    strategyGptClues: [
      "firstGuessAccuracy",
      "guessRecallAtHumanCount",
      "targetRecallAtCount",
      "exactTargetSetAccuracy",
      "pairwiseTargetAccuracy",
    ],
    cooccurrence: [
      "firstGuessAccuracy",
      "guessRecallAtHumanCount",
      "goodWordRateAtHumanCount",
    ],
  };
  const sources = Object.fromEntries(
    Object.entries(metricMap).map(([source, metrics]) => {
      const values = metrics
        .map((metric) => {
          const value = datasets[source][metric];
          if (!Number.isFinite(value)) return null;
          return metric === "avoidWordRate" ? 1 - value : value;
        })
        .filter(Number.isFinite);
      return [
        source,
        {
          score: round(mean(values) * 100),
          metrics: Object.fromEntries(
            metrics
              .filter((metric) =>
                Number.isFinite(datasets[source][metric]),
              )
              .map((metric) => [
                metric,
                round(datasets[source][metric]),
              ]),
          ),
        },
      ];
    }),
  );
  return {
    score: round(
      mean(
        Object.values(sources).map(({ score }) => score),
      ),
    ),
    sources,
  };
}

function transferMetrics(metrics, side) {
  return {
    listener: "MiniLM-L6",
    correctCardsPerTurn: round(
      metrics.correctCardsPerTurn[side],
    ),
    wrongTeamHitsPerGame: round(
      metrics.wrongTeamHitsPerGame[side],
    ),
    neutralHitsPerGame: round(
      metrics.neutralHitsPerGame[side],
    ),
    assassinRate: round(metrics.assassinRate[side]),
    fallbackClueRate: round(
      metrics.fallbackClueRate[side],
    ),
    stallRate: round(metrics.stallRate[side]),
    meanTurnsPerGame: round(
      metrics.meanTurnsPerGame[side],
    ),
  };
}

function normalizeExperimentPolicy(policy) {
  return {
    ...policy,
    fun:
      typeof policy.fun === "number"
        ? { score: policy.fun }
        : policy.fun,
    neutralHitsPerGame: policy.neutralHitsPerGame ?? null,
  };
}

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(resolve(ROOT, relativePath), "utf8"),
  );
}

function mean(values) {
  return (
    values.reduce((total, value) => total + value, 0) /
    values.length
  );
}

function nullableRound(value) {
  return Number.isFinite(value) ? round(value) : null;
}

function round(value) {
  return Number(Number(value ?? 0).toFixed(4));
}
