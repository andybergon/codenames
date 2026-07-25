import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUE_BANK, WORD_SET, getWordsForSet } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";
import {
  loadHumanEmbeddingBenchmark,
  scoreHumanEmbeddingBenchmark,
} from "./human-embedding-benchmark.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const LOCAL_REPORT_PATH = resolve(
  ROOT,
  "scripts/generated/embedding-model-comparison.json",
);
const REPORT_PATH = resolve(
  ROOT,
  "scripts/generated/api-embedding-comparison.json",
);
const CENTERING_COUNT = 30_000;
const BATCH_SIZE = 512;
const PRICE_PER_MILLION = 0.13;
const MAX_COST_USD = 0.01;
const MODEL = "text-embedding-3-large";
const DIMENSIONS = 1024;
const EXPERIMENT_DIRECTORY = resolve(
  ROOT,
  `.cache/embedding-experiments/openai-${MODEL}-${DIMENSIONS}`,
);
const RAW_DIRECTORY = resolve(EXPERIMENT_DIRECTORY, "raw");
const HUMAN_RAW_DIRECTORY = resolve(EXPERIMENT_DIRECTORY, "human-raw");

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");

const wordSource = JSON.parse(await readFile(WORDS_PATH, "utf8"));
const clueCorpus = buildClueCandidates(
  wordSource.words,
  CLUE_BANK,
  CENTERING_COUNT,
)
  .slice(0, CENTERING_COUNT)
  .map(({ word }) => word);
const boardWords = [
  ...new Set([
    ...getWordsForSet(WORD_SET.OFFICIAL),
    ...getWordsForSet(WORD_SET.EXTENDED),
  ]),
];
const baseTerms = [...new Set([...clueCorpus, ...boardWords])];
const baseMetadata = JSON.parse(
  await readFile(resolve(EXPERIMENT_DIRECTORY, "metadata.json"), "utf8"),
);
const expectedBaseHash = createHash("sha256")
  .update(JSON.stringify(baseTerms))
  .digest("hex");
if (
  baseMetadata.inputHash !== expectedBaseHash ||
  baseMetadata.model !== MODEL ||
  baseMetadata.dimensions !== DIMENSIONS
) {
  throw new Error("The cached API index does not match this evaluation.");
}

const benchmark = await loadHumanEmbeddingBenchmark(ROOT);
const vectors = await loadBaseVectors(baseTerms);
const missingTerms = benchmark.terms.filter((term) => !vectors.has(term));
const missingHash = createHash("sha256")
  .update(JSON.stringify(missingTerms))
  .digest("hex");
await mkdir(HUMAN_RAW_DIRECTORY, { recursive: true });
const humanMetadataPath = resolve(HUMAN_RAW_DIRECTORY, "metadata.json");
const humanMetadata = await readJson(humanMetadataPath);
if (humanMetadata && humanMetadata.inputHash !== missingHash) {
  throw new Error(
    "Cached human-evaluation embeddings do not match the current benchmark.",
  );
}
await writeFile(
  humanMetadataPath,
  `${JSON.stringify(
    {
      inputHash: missingHash,
      model: MODEL,
      dimensions: DIMENSIONS,
      termCount: missingTerms.length,
    },
    null,
    2,
  )}\n`,
);

const missingRanges = [];
for (let start = 0; start < missingTerms.length; start += BATCH_SIZE) {
  const end = Math.min(start + BATCH_SIZE, missingTerms.length);
  const path = chunkPath(HUMAN_RAW_DIRECTORY, start, end);
  if (!(await validChunk(path, end - start))) {
    missingRanges.push({ start, end, path });
  }
}
const uncachedTerms = missingRanges.flatMap(({ start, end }) =>
  missingTerms.slice(start, end),
);
const estimatedTokens = estimateTokens(uncachedTerms);
const estimatedCost = (estimatedTokens / 1_000_000) * PRICE_PER_MILLION;
console.log(
  `Human preflight: ${benchmark.terms.length.toLocaleString("en-US")} terms, ${uncachedTerms.length.toLocaleString("en-US")} uncached, at most $${estimatedCost.toFixed(4)}.`,
);
if (estimatedCost > MAX_COST_USD) {
  throw new Error(
    `Estimated cost $${estimatedCost.toFixed(4)} exceeds the $${MAX_COST_USD.toFixed(2)} cap.`,
  );
}

let billedTokens = 0;
for (const [rangeIndex, range] of missingRanges.entries()) {
  const batch = missingTerms.slice(range.start, range.end);
  const response = await createEmbeddings(batch);
  billedTokens += response.usage?.total_tokens ?? estimateTokens(batch);
  const billedCost = (billedTokens / 1_000_000) * PRICE_PER_MILLION;
  if (billedCost > MAX_COST_USD) {
    throw new Error(`Billed cost guard exceeded at $${billedCost.toFixed(4)}.`);
  }
  const buffer = Buffer.alloc(batch.length * DIMENSIONS * 4);
  response.data
    .sort((left, right) => left.index - right.index)
    .forEach((item, row) => {
      const decoded = Buffer.from(item.embedding, "base64");
      if (decoded.byteLength !== DIMENSIONS * 4) {
        throw new Error(`Unexpected embedding size for ${batch[row]}.`);
      }
      decoded.copy(buffer, row * DIMENSIONS * 4);
    });
  await writeFile(range.path, buffer);
  console.log(
    `Human API ${rangeIndex + 1}/${missingRanges.length}: ${range.end}/${missingTerms.length}, $${billedCost.toFixed(4)}.`,
  );
}

await loadHumanVectors(missingTerms, vectors);
const mean = meanVector(
  clueCorpus.map((word) => requiredVector(vectors, word)),
);
const rawVectors = new Map(
  benchmark.terms.map((term) => [term, requiredVector(vectors, term)]),
);
const centeredVectors = new Map(
  benchmark.terms.map((term) => [
    term,
    centerAndNormalize(requiredVector(vectors, term), mean),
  ]),
);
const localReport = JSON.parse(await readFile(LOCAL_REPORT_PATH, "utf8"));
const bgeBaseline = localReport.results.find(
  (result) =>
    result.model === "Xenova/bge-small-en-v1.5" &&
    result.transform === "centered",
);
if (!bgeBaseline) throw new Error("Could not find the centered BGE baseline.");
const raw = scoreHumanEmbeddingBenchmark(benchmark.datasets, rawVectors);
const centered = scoreHumanEmbeddingBenchmark(
  benchmark.datasets,
  centeredVectors,
);
const deltas = metricDeltas(centered, bgeBaseline.datasets);
const guardrails = [
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
const report = {
  generatedAt: new Date().toISOString(),
  provider: "openai",
  model: MODEL,
  dimensions: DIMENSIONS,
  dataset: benchmark.metadata,
  costControl: {
    pricePerMillionTokens: PRICE_PER_MILLION,
    maxCostUsd: MAX_COST_USD,
    cachedBaseTerms: baseTerms.length,
    humanTerms: benchmark.terms.length,
    uncachedTerms: uncachedTerms.length,
    estimatedTokens,
    billedTokens,
    billedCostUsd: round(
      (billedTokens / 1_000_000) * PRICE_PER_MILLION,
      6,
    ),
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
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.table(
  [
    {
      model: "BGE-small centered",
      "CC first": bgeBaseline.datasets.culturalCodes.firstGuessAccuracy,
      "CC target": bgeBaseline.datasets.culturalCodes.targetRecallAtCount,
      "CC avoid": bgeBaseline.datasets.culturalCodes.avoidWordRate,
      "pair recall": bgeBaseline.datasets.connector.targetRecallAtCount,
      "exact pair":
        bgeBaseline.datasets.connector.exactTargetSetAccuracy,
    },
    {
      model: "OpenAI large centered",
      "CC first": centered.culturalCodes.firstGuessAccuracy,
      "CC target": centered.culturalCodes.targetRecallAtCount,
      "CC avoid": centered.culturalCodes.avoidWordRate,
      "pair recall": centered.connector.targetRecallAtCount,
      "exact pair": centered.connector.exactTargetSetAccuracy,
    },
  ],
);
console.log(
  `Human validity guardrails: ${report.humanValidityGuardrails.passed ? "PASS" : "FAIL"}`,
);
console.log(`Wrote ${REPORT_PATH}`);

async function loadBaseVectors(terms) {
  const result = new Map();
  for (let start = 0; start < terms.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, terms.length);
    const buffer = await readFile(chunkPath(RAW_DIRECTORY, start, end));
    addVectors(result, terms.slice(start, end), buffer);
  }
  return result;
}

async function loadHumanVectors(terms, target) {
  for (let start = 0; start < terms.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, terms.length);
    const buffer = await readFile(
      chunkPath(HUMAN_RAW_DIRECTORY, start, end),
    );
    addVectors(target, terms.slice(start, end), buffer);
  }
}

function addVectors(target, terms, buffer) {
  terms.forEach((term, row) => {
    const vector = new Float32Array(DIMENSIONS);
    const byteOffset = row * DIMENSIONS * 4;
    for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) {
      vector[dimension] = buffer.readFloatLE(byteOffset + dimension * 4);
    }
    target.set(term, vector);
  });
}

async function createEmbeddings(input) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          model: MODEL,
          dimensions: DIMENSIONS,
          encoding_format: "base64",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response.json();
      const text = await response.text();
      if (
        attempt === 3 ||
        ![408, 409, 429, 500, 502, 503, 504].includes(response.status)
      ) {
        throw new Error(
          `OpenAI embeddings failed (${response.status}): ${text.slice(0, 500)}`,
        );
      }
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`Human API attempt ${attempt} failed; retrying.`);
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, attempt * 1_000),
    );
  }
  throw new Error("OpenAI embeddings request exhausted retries.");
}

function meanVector(vectors) {
  const mean = new Float32Array(DIMENSIONS);
  for (const vector of vectors) {
    for (let index = 0; index < DIMENSIONS; index += 1) {
      mean[index] += vector[index] / vectors.length;
    }
  }
  return mean;
}

function centerAndNormalize(vector, mean) {
  const centered = Float32Array.from(
    vector,
    (value, index) => value - mean[index],
  );
  let magnitudeSquared = 0;
  for (const value of centered) magnitudeSquared += value * value;
  const magnitude = Math.sqrt(magnitudeSquared);
  if (magnitude > 0) {
    for (let index = 0; index < centered.length; index += 1) {
      centered[index] /= magnitude;
    }
  }
  return centered;
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

function estimateTokens(terms) {
  return terms.reduce(
    (total, term) =>
      total + Math.max(1, Math.ceil(Buffer.byteLength(term, "utf8") / 3) + 1),
    0,
  );
}

function chunkPath(directory, start, end) {
  return resolve(
    directory,
    `${String(start).padStart(6, "0")}-${String(end).padStart(6, "0")}.f32`,
  );
}

async function validChunk(path, rows) {
  try {
    return (await stat(path)).size === rows * DIMENSIONS * 4;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function requiredVector(vectors, term) {
  const vector = vectors.get(term);
  if (!vector) throw new Error(`No embedding for ${term}.`);
  return vector;
}

function round(value, places = 4) {
  return Number(value.toFixed(places));
}
