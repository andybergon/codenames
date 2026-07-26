import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadHumanEmbeddingBenchmark,
  scoreHumanEmbeddingBenchmark,
} from "./human-embedding-benchmark.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOCAL_REPORT_PATH = resolve(
  ROOT,
  "scripts/generated/embedding-model-comparison.json",
);
const SCALE = 127;
const options = parseOptions(process.argv.slice(2));
const experimentDirectory = resolve(ROOT, options.experimentDir);
const termsData = JSON.parse(
  await readFile(resolve(experimentDirectory, "terms.json"), "utf8"),
);
const vectorMetadata = JSON.parse(
  await readFile(
    resolve(experimentDirectory, "vector-metadata.json"),
    "utf8",
  ),
);
if (vectorMetadata.inputHash !== termsData.inputHash) {
  throw new Error("Vector metadata does not match the prepared term set.");
}

const availableTerms = new Set(
  await readAvailableTerms(experimentDirectory, termsData.terms),
);
const vectors = await loadVectors(
  resolve(experimentDirectory, "vectors"),
  termsData.terms,
  availableTerms,
  vectorMetadata.dimensions,
);
const centeringWords = termsData.clueCorpus.filter((word) =>
  availableTerms.has(word),
);
if (centeringWords.length < 10_000) {
  throw new Error(
    `Only ${centeringWords.length} centering words have embeddings.`,
  );
}
const mean = meanVector(
  centeringWords.map((word) => requiredVector(vectors, word)),
  vectorMetadata.dimensions,
);

const benchmark = await loadHumanEmbeddingBenchmark(ROOT);
const filteredDatasets = Object.fromEntries(
  Object.entries(benchmark.datasets).map(([name, turns]) => [
    name,
    turns.filter((turn) => turnTerms(turn).every((term) => vectors.has(term))),
  ]),
);
const coverage = Object.fromEntries(
  Object.entries(benchmark.datasets).map(([name, turns]) => [
    name,
    {
      scoredTurns: filteredDatasets[name].length,
      totalTurns: turns.length,
      rate: round(filteredDatasets[name].length / turns.length),
      scoredResponses: responseCount(filteredDatasets[name]),
      totalResponses: responseCount(turns),
      responseRate: round(
        responseCount(filteredDatasets[name]) /
          Math.max(1, responseCount(turns)),
      ),
    },
  ]),
);
const humanTerms = [
  ...new Set(
    Object.values(filteredDatasets).flatMap((turns) =>
      turns.flatMap(turnTerms),
    ),
  ),
];
const rawVectors = new Map(
  humanTerms.map((term) => [
    term,
    normalize(requiredVector(vectors, term)),
  ]),
);
const centeredVectors = new Map(
  humanTerms.map((term) => [
    term,
    centerAndNormalize(requiredVector(vectors, term), mean),
  ]),
);
const raw = scoreHumanEmbeddingBenchmark(filteredDatasets, rawVectors);
const centered = scoreHumanEmbeddingBenchmark(
  filteredDatasets,
  centeredVectors,
);
const localReport = JSON.parse(await readFile(LOCAL_REPORT_PATH, "utf8"));
const bgeBaseline = localReport.results.find(
  (result) =>
    result.model === "Xenova/bge-small-en-v1.5" &&
    result.transform === "centered",
);
if (!bgeBaseline) throw new Error("Could not find the centered BGE baseline.");
const deltas = metricDeltas(centered, bgeBaseline.datasets);
const guardrails = [
  ...Object.entries(coverage).map(([name, result]) => ({
    metric: `${benchmark.metadata[name].name} task coverage`,
    passed: result.rate >= 0.95,
    actual: result.rate,
    minimum: 0.95,
  })),
  {
    metric: "Cultural Codes target recall",
    passed: deltas.culturalCodes.targetRecallAtCount >= -0.005,
    delta: deltas.culturalCodes.targetRecallAtCount,
    minimumDelta: -0.005,
  },
  {
    metric: "Cultural Codes avoid rate",
    passed: deltas.culturalCodes.avoidWordRate <= 0.005,
    delta: deltas.culturalCodes.avoidWordRate,
    maximumDelta: 0.005,
  },
  {
    metric: "Connector exact pair",
    passed: deltas.connector.exactTargetSetAccuracy >= -0.005,
    delta: deltas.connector.exactTargetSetAccuracy,
    minimumDelta: -0.005,
  },
];

const selectedCandidates = termsData.clueCandidates
  .filter(({ word }) => vectors.has(word))
  .slice(0, options.candidates);
if (selectedCandidates.length < options.candidates) {
  throw new Error(
    `Only ${selectedCandidates.length} clue candidates have embeddings.`,
  );
}
const missingBoardWords = termsData.boardWords.filter(
  (word) => !vectors.has(word),
);
if (missingBoardWords.length > 0) {
  throw new Error(
    `Missing board embeddings: ${missingBoardWords.slice(0, 20).join(", ")}`,
  );
}
const indexDirectory = resolve(experimentDirectory, "index");
await mkdir(indexDirectory, { recursive: true });
const cluePayload = quantizedPayload(
  selectedCandidates.map(({ word }) => word),
  selectedCandidates.map(({ zipf }) => zipf),
  vectors,
  mean,
  vectorMetadata.dimensions,
);
const clueFile = `clues-0-${options.candidates}.json`;
const clueContent = `${JSON.stringify(cluePayload)}\n`;
await writeFile(resolve(indexDirectory, clueFile), clueContent);
const boardPayload = quantizedPayload(
  termsData.boardWords,
  null,
  vectors,
  mean,
  vectorMetadata.dimensions,
);
const boardFile = "board-vectors.json";
await writeFile(
  resolve(indexDirectory, boardFile),
  `${JSON.stringify(boardPayload)}\n`,
);
await writeFile(
  resolve(indexDirectory, "manifest.json"),
  `${JSON.stringify(
    {
      version: 2,
      provider: vectorMetadata.provider,
      embeddingRuntime: "precomputed",
      model: vectorMetadata.model,
      dimensions: vectorMetadata.dimensions,
      quantization: { type: "symmetric-int8", scale: SCALE },
      centering: {
        method: `${centeringWords.length}-available-clue-corpus-mean`,
        mean: Array.from(mean, (value) => Number(value.toFixed(8))),
      },
      vocabulary: termsData.vocabulary,
      experiment: {
        generatedAt: new Date().toISOString(),
        sourceTerms: termsData.terms.length,
        availableTerms: vectors.size,
        centeringWords: centeringWords.length,
        candidatePoolScanned:
          termsData.clueCandidates.findIndex(
            ({ word }) =>
              word === selectedCandidates.at(-1)?.word,
          ) + 1,
        runtime: vectorMetadata.runtime,
        cost: vectorMetadata.cost ?? null,
      },
      modelBytes: 0,
      boardVectors: {
        file: boardFile,
        wordSets: ["official", "extended"],
        words: termsData.boardWords.length,
      },
      shards: [
        {
          start: 0,
          end: options.candidates,
          file: clueFile,
          bytes: Buffer.byteLength(clueContent),
        },
      ],
    },
    null,
    2,
  )}\n`,
);

const report = {
  generatedAt: new Date().toISOString(),
  provider: vectorMetadata.provider,
  model: vectorMetadata.model,
  dimensions: vectorMetadata.dimensions,
  dataset: benchmark.metadata,
  vectorSource: vectorMetadata,
  vocabularyCoverage: {
    availableTerms: vectors.size,
    totalTerms: termsData.terms.length,
    rate: round(vectors.size / termsData.terms.length),
    centeringWords: centeringWords.length,
    candidatePoolScanned:
      termsData.clueCandidates.findIndex(
        ({ word }) => word === selectedCandidates.at(-1)?.word,
      ) + 1,
    humanTurns: coverage,
  },
  transforms: { raw, centered },
  baseline: {
    model: bgeBaseline.model,
    transform: bgeBaseline.transform,
    datasets: bgeBaseline.datasets,
  },
  centeredDeltaVsBgeSmall: deltas,
  humanValidityGuardrails: {
    passed: guardrails.every(({ passed }) => passed),
    checks: guardrails,
  },
};
await writeFile(
  resolve(experimentDirectory, "human-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.table([
  summaryRow("BGE-small centered", bgeBaseline.datasets),
  summaryRow(vectorMetadata.model, centered),
]);
console.log(
  `Human validity guardrails: ${report.humanValidityGuardrails.passed ? "PASS" : "FAIL"}`,
);
console.log(`Wrote ${resolve(experimentDirectory, "human-report.json")}`);
console.log(`Wrote ${indexDirectory}`);

async function readAvailableTerms(directory, fallback) {
  try {
    return JSON.parse(
      await readFile(resolve(directory, "available-terms.json"), "utf8"),
    );
  } catch {
    return fallback;
  }
}

async function loadVectors(directory, terms, available, dimensions) {
  const result = new Map();
  const files = (await readdir(directory))
    .map((file) => {
      const match = file.match(/^(\d+)-(\d+)\.f32$/u);
      return match
        ? { file, start: Number(match[1]), end: Number(match[2]) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
  for (const { file, start, end } of files) {
    const buffer = await readFile(resolve(directory, file));
    if (buffer.byteLength !== (end - start) * dimensions * 4) {
      throw new Error(`Unexpected vector chunk size: ${file}`);
    }
    for (let row = 0; row < end - start; row += 1) {
      const term = terms[start + row];
      if (!available.has(term)) continue;
      const vector = new Float32Array(dimensions);
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        vector[dimension] = buffer.readFloatLE(
          (row * dimensions + dimension) * 4,
        );
      }
      result.set(term, vector);
    }
  }
  if (result.size !== available.size) {
    throw new Error(
      `Loaded ${result.size} vectors for ${available.size} available terms.`,
    );
  }
  return result;
}

function quantizedPayload(words, frequencies, vectors, mean, dimensions) {
  const quantized = new Int8Array(words.length * dimensions);
  words.forEach((word, row) => {
    const centered = centerAndNormalize(requiredVector(vectors, word), mean);
    centered.forEach((value, column) => {
      quantized[row * dimensions + column] = Math.round(
        Math.max(-1, Math.min(1, value)) * SCALE,
      );
    });
  });
  return {
    words: frequencies ? undefined : words,
    clues: frequencies ? words : undefined,
    frequencies: frequencies ?? undefined,
    dimensions,
    quantization: { type: "symmetric-int8", scale: SCALE },
    vectors: Buffer.from(quantized).toString("base64"),
  };
}

function meanVector(vectors, dimensions) {
  const mean = new Float32Array(dimensions);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      mean[index] += vector[index] / vectors.length;
    }
  }
  return mean;
}

function normalize(vector) {
  let magnitudeSquared = 0;
  for (const value of vector) magnitudeSquared += value * value;
  const magnitude = Math.sqrt(magnitudeSquared);
  return magnitude > 0
    ? Float32Array.from(vector, (value) => value / magnitude)
    : Float32Array.from(vector);
}

function centerAndNormalize(vector, mean) {
  return normalize(
    Float32Array.from(vector, (value, index) => value - mean[index]),
  );
}

function turnTerms(turn) {
  return [
    turn.clue,
    ...turn.remaining,
    ...turn.targets,
    ...turn.neutral,
    ...turn.avoid,
  ];
}

function metricDeltas(result, baseline) {
  return Object.fromEntries(
    Object.entries(result).map(([dataset, metrics]) => [
      dataset,
      Object.fromEntries(
        Object.entries(metrics)
          .filter(([, value]) => Number.isFinite(value))
          .map(([metric, value]) => [
            metric,
            round(value - baseline[dataset][metric]),
          ]),
      ),
    ]),
  );
}

function summaryRow(model, datasets) {
  return {
    model,
    "CC first": datasets.culturalCodes.firstGuessAccuracy,
    "CC target": datasets.culturalCodes.targetRecallAtCount,
    "CC avoid": datasets.culturalCodes.avoidWordRate,
    "pair recall": datasets.connector.targetRecallAtCount,
    "exact pair": datasets.connector.exactTargetSetAccuracy,
    "S&S human": datasets.strategyHumanClues.targetRecallAtCount,
    "S&S GPT": datasets.strategyGptClues.targetRecallAtCount,
    "cooccur first": datasets.cooccurrence.firstGuessAccuracy,
    "cooccur recall": datasets.cooccurrence.guessRecallAtHumanCount,
  };
}

function responseCount(turns) {
  return turns.reduce(
    (total, turn) =>
      total +
      (turn.guessSets?.length ?? (turn.guesses?.length > 0 ? 1 : 0)),
    0,
  );
}

function requiredVector(vectors, term) {
  const vector = vectors.get(term);
  if (!vector) throw new Error(`No embedding for ${term}.`);
  return vector;
}

function parseOptions(args) {
  const values = {
    experimentDir: null,
    candidates: 10_000,
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--experiment-dir") values.experimentDir = value;
    else if (option === "--candidates") values.candidates = Number(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!values.experimentDir) {
    throw new Error("--experiment-dir is required.");
  }
  return values;
}

function round(value, places = 4) {
  return Number(value.toFixed(places));
}
