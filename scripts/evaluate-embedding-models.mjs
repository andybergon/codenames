import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { CLUE_BANK } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(ROOT, ".cache/evaluations/cultural-codes");
const REPORT_PATH = resolve(ROOT, "scripts/generated/embedding-model-comparison.json");
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const DATASET_COMMIT = "9bf4550e681f7a42ac406439b00b0c717f59f13c";
const DATASET_BASE = `https://raw.githubusercontent.com/SALT-NLP/codenames/${DATASET_COMMIT}/data`;
const CONNECTOR_COMMIT = "8d824794d623adf4dd19cbff13d987d539b19c5e";
const CONNECTOR_BASE = `https://raw.githubusercontent.com/hawkrobe/lexical-search-and-pragmatics/${CONNECTOR_COMMIT}/data/exp1`;
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
const [clueRows, guessRows] = await Promise.all([
  loadDataset("clue_generation_task/all.csv"),
  loadDataset("generate_guess_task/all.csv"),
]);
const [connectorRows, connectorBoards] = await Promise.all([
  loadConnectorCsv("cleaned.csv"),
  loadConnectorJson("boards.json"),
]);

if (clueRows.length !== guessRows.length) {
  throw new Error(`Dataset row mismatch: ${clueRows.length} clues vs ${guessRows.length} guesses`);
}

const culturalCodesTurns = clueRows.map((clueRow, index) => buildTurn(clueRow, guessRows[index]));
const connectorTurns = connectorRows.map((row) => buildConnectorTurn(row, connectorBoards));
const datasets = {
  culturalCodes: culturalCodesTurns,
  connector: connectorTurns,
};
const terms = [
  ...new Set(
    Object.values(datasets).flatMap((turns) =>
      turns.flatMap((turn) => [
        turn.clue,
        ...turn.remaining,
        ...turn.targets,
        ...turn.neutral,
        ...turn.avoid,
      ]),
    ),
  ),
].sort();

console.log(
  `Evaluating ${models.length} models on ${culturalCodesTurns.length + connectorTurns.length} human turns (${terms.length} unique terms)`,
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
  dataset: {
    culturalCodes: {
      name: "Cultural Codes",
      repository: "https://github.com/SALT-NLP/codenames",
      commit: DATASET_COMMIT,
      turns: culturalCodesTurns.length,
      note: "Human Codenames Duet games with clues, guesses, intended targets, neutral words, and avoid words.",
    },
    connector: {
      name: "Lexical Search and Pragmatics in Connector, Experiment 1",
      repository: "https://github.com/hawkrobe/lexical-search-and-pragmatics",
      commit: CONNECTOR_COMMIT,
      turns: connectorTurns.length,
      note: "Human production clues for fixed two-word targets on full 20-word boards in a simplified associative reference game.",
    },
    licenseNote:
      "Neither upstream repository has an explicit license file. Data is fetched into the gitignored cache and is not redistributed.",
  },
  evaluation: {
    transforms: `Each model is reported raw and after subtracting the mean over the trainer's ${clueCorpus.length}-word clue corpus and L2 normalizing`,
    guessMetrics:
      "Rank all words remaining on the human guesser's board by cosine similarity to the human clue.",
    targetMetrics:
      "Rank intended targets against neutral and avoid words from the human clue-giver state.",
    limitations: [
      "Codenames Duet has goal, neutral, and avoid roles rather than two competitive teams and one assassin.",
      "The dataset averages few intended targets per clue, so it tests semantic alignment more strongly than ambitious multi-target clue generation.",
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
        : {
            culturalCodes: metricDelta(
              result.datasets.culturalCodes,
              baseline.datasets.culturalCodes,
            ),
            connector: metricDelta(result.datasets.connector, baseline.datasets.connector),
          },
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
    "pairwise target": asPercent(result.datasets.connector.pairwiseTargetAccuracy),
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
  const rawResult = Object.fromEntries(
    Object.entries(evaluationDatasets).map(([name, turns]) => [name, scoreTurns(turns, rawTerms)]),
  );
  const centeredResult = Object.fromEntries(
    Object.entries(evaluationDatasets).map(([name, turns]) => [name, scoreTurns(turns, centeredTerms)]),
  );
  if (typeof extractor.dispose === "function") await extractor.dispose();
  const elapsedSeconds = round((Date.now() - startedAt) / 1000);
  return [
    { ...common, transform: "raw", datasets: rawResult, elapsedSeconds },
    { ...common, transform: "centered", datasets: centeredResult, elapsedSeconds },
  ];
}

function scoreTurns(evaluationTurns, vectors) {
  const totals = {
    guessTurns: 0,
    firstGuessHits: 0,
    guessRecall: 0,
    targetTurns: 0,
    targetRecall: 0,
    exactTargetSets: 0,
    avoidHits: 0,
    pairwiseCorrect: 0,
    pairwiseTotal: 0,
  };

  for (const turn of evaluationTurns) {
    const clueVector = vectors.get(turn.clue);
    const humanGuesses = turn.guesses.filter((word) => turn.remaining.includes(word));

    if (humanGuesses.length > 0) {
      const ranked = rankWords(turn.remaining, clueVector, vectors);
      const predicted = ranked.slice(0, humanGuesses.length).map(({ word }) => word);
      totals.guessTurns += 1;
      totals.firstGuessHits += Number(ranked[0]?.word === humanGuesses[0]);
      totals.guessRecall += intersectionSize(predicted, humanGuesses) / humanGuesses.length;
    }

    const candidates = [...new Set([...turn.targets, ...turn.neutral, ...turn.avoid])];
    if (turn.targets.length === 0 || candidates.length === 0) continue;
    const ranked = rankWords(candidates, clueVector, vectors);
    const predicted = ranked.slice(0, turn.targets.length).map(({ word }) => word);
    const targetSet = new Set(turn.targets);
    totals.targetTurns += 1;
    totals.targetRecall += intersectionSize(predicted, turn.targets) / turn.targets.length;
    totals.exactTargetSets += Number(
      predicted.length === turn.targets.length && predicted.every((word) => targetSet.has(word)),
    );
    totals.avoidHits += Number(predicted.some((word) => turn.avoid.includes(word)));

    for (const target of turn.targets) {
      const targetScore = dot(clueVector, vectors.get(target));
      for (const other of [...turn.neutral, ...turn.avoid]) {
        totals.pairwiseTotal += 1;
        totals.pairwiseCorrect += Number(targetScore > dot(clueVector, vectors.get(other)));
      }
    }
  }

  return {
    scoredGuessTurns: totals.guessTurns,
    scoredTargetTurns: totals.targetTurns,
    firstGuessAccuracy: round(totals.firstGuessHits / totals.guessTurns),
    guessRecallAtHumanCount: round(totals.guessRecall / totals.guessTurns),
    targetRecallAtCount: round(totals.targetRecall / totals.targetTurns),
    exactTargetSetAccuracy: round(totals.exactTargetSets / totals.targetTurns),
    avoidWordRate: round(totals.avoidHits / totals.targetTurns),
    pairwiseTargetAccuracy: round(totals.pairwiseCorrect / totals.pairwiseTotal),
  };
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

async function loadDataset(relativePath) {
  const cachePath = resolve(CACHE_DIR, relativePath);
  let raw;
  try {
    raw = await readFile(cachePath, "utf8");
  } catch {
    const response = await fetch(`${DATASET_BASE}/${relativePath}`);
    if (!response.ok) throw new Error(`Dataset download failed (${response.status}): ${relativePath}`);
    raw = await response.text();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, raw, "utf8");
  }
  return parseCsv(raw);
}

async function loadConnectorCsv(relativePath) {
  const raw = await loadRemoteFile(
    `${CONNECTOR_BASE}/${relativePath}`,
    resolve(CACHE_DIR, "connector", relativePath),
  );
  return parseCsv(raw);
}

async function loadConnectorJson(relativePath) {
  const raw = await loadRemoteFile(
    `${CONNECTOR_BASE}/${relativePath}`,
    resolve(CACHE_DIR, "connector", relativePath),
  );
  return JSON.parse(raw);
}

async function loadRemoteFile(url, cachePath) {
  try {
    return await readFile(cachePath, "utf8");
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Dataset download failed (${response.status}): ${url}`);
    const raw = await response.text();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, raw, "utf8");
    return raw;
  }
}

function buildTurn(clueRow, guessRow) {
  if (clueRow[""] !== guessRow[""]) {
    throw new Error(`Dataset rows are misaligned at ${clueRow[""]} / ${guessRow[""]}`);
  }
  return {
    clue: normalize(clueRow.output),
    targets: parseList(clueRow.base_text, "targets"),
    neutral: parseList(clueRow.base_text, "tan"),
    avoid: parseList(clueRow.base_text, "black"),
    remaining: parseList(guessRow.base_text, "remaining"),
    guesses: String(guessRow.output ?? "")
      .split(",")
      .map(normalize)
      .filter(Boolean),
  };
}

function buildConnectorTurn(row, boards) {
  const remaining = boards[row.boardnames]?.map(normalize);
  if (!remaining) throw new Error(`Unknown Connector board: ${row.boardnames}`);
  const targets = [normalize(row.Word1), normalize(row.Word2)];
  return {
    clue: normalize(row.correctedClue),
    targets,
    neutral: remaining.filter((word) => !targets.includes(word)),
    avoid: [],
    remaining,
    guesses: [],
  };
}

function parseList(text, label) {
  const match = text.match(new RegExp(`${label}: \\[(.*?)\\](?:,|$)`));
  if (!match) throw new Error(`Could not parse ${label} from: ${text}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => normalize(entry[1]));
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (character === '"' && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
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

function rankWords(words, clueVector, vectors) {
  return words
    .map((word) => ({ word, score: dot(clueVector, vectors.get(word)) }))
    .sort((left, right) => right.score - left.score || left.word.localeCompare(right.word));
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

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

function intersectionSize(left, right) {
  const rightSet = new Set(right);
  return left.reduce((total, value) => total + Number(rightSet.has(value)), 0);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
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
