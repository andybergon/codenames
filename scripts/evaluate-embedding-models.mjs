import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { CLUE_BANK } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";
import {
  loadHumanEmbeddingBenchmark,
  scoreHumanEmbeddingBenchmark,
} from "./human-embedding-benchmark.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = resolve(ROOT, "scripts/generated/embedding-model-comparison.json");
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const DEFAULT_MODELS = [
  "Xenova/paraphrase-MiniLM-L3-v2",
  "Xenova/all-MiniLM-L6-v2",
  "Xenova/bge-small-en-v1.5",
  "Xenova/all-MiniLM-L12-v2",
  "Xenova/all-mpnet-base-v2",
];
const BATCH_SIZE = 64;

env.cacheDir = resolve(ROOT, ".cache/huggingface");
env.allowLocalModels = false;

const models = readModelArguments(process.argv.slice(2));
const wordSource = JSON.parse(await readFile(WORDS_PATH, "utf8"));
const clueCorpus = buildClueCandidates(wordSource.words, CLUE_BANK).map(({ word }) => word);
const benchmark = await loadHumanEmbeddingBenchmark(ROOT);
const { datasets, terms } = benchmark;
const benchmarkTasks = Object.values(datasets).reduce(
  (total, turns) => total + turns.length,
  0,
);

console.log(
  `Evaluating ${models.length} models on ${benchmarkTasks} human-data tasks (${terms.length} unique terms)`,
);

const results = [];
for (const model of models) {
  results.push(...(await evaluateModel(model, clueCorpus, terms, datasets)));
}

const baseline =
  results.find(
    (result) => result.model === "Xenova/all-MiniLM-L6-v2" && result.transform === "centered",
  ) ?? results[0];
const report = {
  generatedAt: new Date().toISOString(),
  dataset: benchmark.metadata,
  evaluation: {
    transforms: `Each model is reported raw and after subtracting the mean over the trainer's ${clueCorpus.length}-word clue corpus and L2 normalizing`,
    guessMetrics:
      "Rank all words remaining on the human guesser's board by cosine similarity to the human clue.",
    targetMetrics:
      "Rank intended targets against neutral and avoid words from the human clue-giver state.",
    limitations: [
      "Codenames Duet has goal, neutral, and avoid roles rather than two competitive teams and one assassin.",
      "Strategy and Structure uses 12-card boards with exactly three intended targets and no danger roles.",
      "The co-occurrence dataset uses 20-card boards split into good and bad words; intended machine targets are not published, so only human guess agreement and good-word rate are scored.",
      "Dataset metrics are reported separately because the game variants and response collection methods are not interchangeable.",
      "This isolates embedding quality and does not evaluate the trainer's clue vocabulary, legality filter, or Worth formula.",
    ],
  },
  results: results.map((result) => ({
    model: result.model,
    transform: result.transform,
    dimensions: result.dimensions,
    q8ModelBytes: result.q8ModelBytes,
    elapsedSeconds: result.elapsedSeconds,
    datasets: result.datasets,
    deltaVsBaseline:
      result.model === baseline.model && result.transform === baseline.transform
        ? null
        : Object.fromEntries(
            Object.keys(result.datasets).map((name) => [
              name,
              metricDelta(
                result.datasets[name],
                baseline.datasets[name],
              ),
            ]),
          ),
  })),
};

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.table(
  report.results.map((result) => ({
    model: result.model.replace("Xenova/", ""),
    transform: result.transform,
    dimensions: result.dimensions,
    "q8 MB": (result.q8ModelBytes / 1_000_000).toFixed(1),
    "CC first guess": asPercent(result.datasets.culturalCodes.firstGuessAccuracy),
    "CC target recall": asPercent(result.datasets.culturalCodes.targetRecallAtCount),
    "CC avoid rate": asPercent(result.datasets.culturalCodes.avoidWordRate),
    "pair target recall": asPercent(result.datasets.connector.targetRecallAtCount),
    "exact pair": asPercent(result.datasets.connector.exactTargetSetAccuracy),
    "S&S human first": asPercent(
      result.datasets.strategyHumanClues.firstGuessAccuracy,
    ),
    "S&S human target": asPercent(
      result.datasets.strategyHumanClues.targetRecallAtCount,
    ),
    "S&S GPT first": asPercent(
      result.datasets.strategyGptClues.firstGuessAccuracy,
    ),
    "S&S GPT target": asPercent(
      result.datasets.strategyGptClues.targetRecallAtCount,
    ),
    "cooccur first": asPercent(
      result.datasets.cooccurrence.firstGuessAccuracy,
    ),
    "cooccur recall": asPercent(
      result.datasets.cooccurrence.guessRecallAtHumanCount,
    ),
    "cooccur good": asPercent(
      result.datasets.cooccurrence.goodWordRateAtHumanCount,
    ),
    seconds: result.elapsedSeconds,
  })),
);
console.log(`Wrote ${REPORT_PATH}`);

async function evaluateModel(modelName, corpus, evaluationTerms, evaluationDatasets) {
  const startedAt = Date.now();
  console.log(`\nLoading ${modelName}`);
  const extractor = await pipeline("feature-extraction", modelName, { dtype: "q8" });
  const corpusVectors = await embed(extractor, corpus, `${modelName} centering corpus`);
  const dimensions = corpusVectors[0].length;
  const mean = meanVector(corpusVectors, dimensions);
  const termVectors = await embed(extractor, evaluationTerms, `${modelName} evaluation terms`);
  const centeredTerms = new Map(
    evaluationTerms.map((term, index) => [term, centerAndNormalize(termVectors[index], mean)]),
  );
  const rawTerms = new Map(
    evaluationTerms.map((term, index) => [term, Float32Array.from(termVectors[index])]),
  );
  const common = {
    model: modelName,
    dimensions,
    q8ModelBytes: (
      await stat(resolve(env.cacheDir, modelName, "onnx/model_quantized.onnx"))
    ).size,
  };
  const rawResult = scoreHumanEmbeddingBenchmark(
    evaluationDatasets,
    rawTerms,
  );
  const centeredResult = scoreHumanEmbeddingBenchmark(
    evaluationDatasets,
    centeredTerms,
  );
  if (typeof extractor.dispose === "function") await extractor.dispose();
  const elapsedSeconds = round((Date.now() - startedAt) / 1000);
  return [
    { ...common, transform: "raw", datasets: rawResult, elapsedSeconds },
    { ...common, transform: "centered", datasets: centeredResult, elapsedSeconds },
  ];
}

async function embed(extractor, values, label) {
  const vectors = [];
  for (let start = 0; start < values.length; start += BATCH_SIZE) {
    const batch = values.slice(start, start + BATCH_SIZE);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    vectors.push(...output.tolist());
    if (start === 0 || start + batch.length === values.length || start % (BATCH_SIZE * 20) === 0) {
      console.log(`${label}: ${Math.min(start + batch.length, values.length)}/${values.length}`);
    }
  }
  return vectors;
}

function readModelArguments(args) {
  const option = args.find((argument) => argument.startsWith("--models="));
  return option
    ? option
        .slice("--models=".length)
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
    : DEFAULT_MODELS;
}

function meanVector(vectors, dimensions) {
  const mean = new Float32Array(dimensions);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) mean[index] += vector[index] / vectors.length;
  }
  return mean;
}

function centerAndNormalize(vector, mean) {
  const centered = Float32Array.from(vector, (value, index) => value - mean[index]);
  let magnitudeSquared = 0;
  for (const value of centered) magnitudeSquared += value * value;
  const magnitude = Math.sqrt(magnitudeSquared);
  if (magnitude > 0) {
    for (let index = 0; index < centered.length; index += 1) centered[index] /= magnitude;
  }
  return centered;
}

function round(value) {
  return Number(value.toFixed(4));
}

function asPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function metricDelta(result, baselineResult) {
  return Object.fromEntries(
    Object.entries(result)
      .filter(([, value]) => typeof value === "number")
      .map(([metric, value]) => [metric, round(value - baselineResult[metric])]),
  );
}
