import { cpus, platform, release } from "node:os";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { env, pipeline } from "@huggingface/transformers";
import { normalizeTerm } from "../src/model.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(
  ROOT,
  "scripts/generated/italian-embedding-feasibility.json",
);
const BATCH_SIZE = 64;
const LATENCY_RUNS = 5;

const MODELS = [
  {
    id: "bge-small-en",
    model: "Xenova/bge-small-en-v1.5",
    label: "BGE-small English",
    prefix: "",
    languageScope: "English",
  },
  {
    id: "multilingual-e5-small",
    model: "Xenova/multilingual-e5-small",
    label: "Multilingual E5 small",
    prefix: "query: ",
    languageScope: "94 languages",
  },
  {
    id: "paraphrase-multilingual-minilm-l12",
    model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    label: "Multilingual MiniLM L12",
    prefix: "",
    languageScope: "50 languages",
  },
];

// This fixture is original project test data. It does not reproduce any
// Codenames card list or third-party evaluation dataset.
const TURNS = [
  turn("medicina", ["dottore", "ospedale"], ["ponte", "violino", "foresta"], ["virus"]),
  turn("mare", ["spiaggia", "nave"], ["forno", "castello", "matita"], ["squalo"]),
  turn("musica", ["pianoforte", "chitarra"], ["deserto", "chiave", "balcone"], ["rumore"]),
  turn("scuola", ["maestro", "quaderno"], ["fiume", "stella", "cucina"], ["esame"]),
  turn("spazio", ["pianeta", "razzo"], ["scarpa", "giardino", "pane"], ["buco nero"]),
  turn("regno", ["re", "castello"], ["bicicletta", "nuvola", "telefono"], ["guerra"]),
  turn("freddo", ["neve", "ghiaccio"], ["tamburo", "mercato", "leone"], ["valanga"]),
  turn("viaggio", ["treno", "valigia"], ["candela", "ragno", "specchio"], ["incidente"]),
  turn("cucina", ["forno", "pentola"], ["luna", "porto", "libro"], ["fuoco"]),
  turn("animale", ["cane", "gatto"], ["torre", "pittura", "moneta"], ["lupo"]),
  turn("tempo", ["orologio", "calendario"], ["isola", "medico", "bottiglia"], ["scadenza"]),
  turn("giustizia", ["giudice", "tribunale"], ["montagna", "caffè", "motore"], ["prigione"]),
  turn("tecnologia", ["computer", "robot"], ["fiore", "cavallo", "finestra"], ["virus"]),
  turn("festa", ["torta", "regalo"], ["ospedale", "ponte", "deserto"], ["alcol"]),
  turn("agricoltura", ["fattoria", "trattore"], ["satellite", "teatro", "anello"], ["siccità"]),
  turn("notte", ["luna", "stella"], ["martello", "scuola", "mela"], ["buio"]),
];

const MORPHOLOGY_PAIRS = [
  ["cane", "cani", "number"],
  ["casa", "case", "number"],
  ["fiore", "fiori", "number"],
  ["libro", "libri", "number"],
  ["medico", "medici", "number"],
  ["gatto", "gatta", "gender"],
  ["attore", "attrice", "gender"],
  ["uovo", "uova", "irregular-number"],
  ["braccio", "braccia", "irregular-number"],
  ["andare", "andato", "verb"],
  ["scrivere", "scritto", "verb"],
  ["città", "citta", "accent"],
  ["caffè", "caffe", "accent"],
  ["perché", "perche", "accent"],
  ["università", "universita", "accent"],
];

const selectedIds = new Set(process.argv.slice(2));
const selectedModels = selectedIds.size
  ? MODELS.filter(({ id }) => selectedIds.has(id))
  : MODELS;

if (selectedModels.length === 0) {
  throw new Error(`Unknown model selection: ${[...selectedIds].join(", ")}`);
}

env.cacheDir = resolve(ROOT, ".cache/huggingface");
env.allowLocalModels = false;

const terms = [
  ...new Set([
    ...TURNS.flatMap(({ clue, targets, neutral, avoid }) => [
      clue,
      ...targets,
      ...neutral,
      ...avoid,
    ]),
    ...MORPHOLOGY_PAIRS.flatMap(([left, right]) => [left, right]),
  ]),
];
const latencyTerms = Array.from(
  { length: 25 },
  (_, index) => terms[index % terms.length],
);

const results = [];
for (const definition of selectedModels) {
  results.push(await evaluateModel(definition));
}

const normalizationCases = [
  "città",
  "caffè",
  "perché",
  "università",
  "più",
  "papà",
].map((term) => ({ term, current: normalizeTerm(term) }));

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCores: cpus().length,
  },
  methodology: {
    fixture:
      "Original project fixture with 16 Italian clue turns, 96 board-role observations, and 15 morphology pairs. It contains no official Codenames vocabulary.",
    semantic:
      "Rank two intended targets against three neutral words and one high-risk related word. Report target recall in the top two, exact target-set accuracy, and risk-word intrusion.",
    morphology:
      "Mean cosine similarity for number, gender, verb, irregular, and accent variants.",
    transforms:
      "Raw normalized vectors and a prototype centered variant using the mean of all fixture terms. Production centering still requires a representative 30,000-clue Italian corpus.",
    latency:
      "Warm 25-term embedding latency after model load, averaged over five runs in Node. Browser timing and cold network transfer remain separate acceptance gates.",
    limitations: [
      "The fixture is deliberately small and source-created, so it is directional rather than a human gameplay benchmark.",
      "It does not test an official Italian board, a production-size clue index, or complete games.",
      "The English baseline is a control, not a suitable Italian production candidate.",
    ],
  },
  normalizationCases,
  results,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.table(
  results.map((result) => ({
    model: result.label,
    "q8 MB": round(result.q8ModelBytes / 1_000_000, 1),
    "raw recall": percent(result.raw.semantic.targetRecallAtCount),
    "raw risk": percent(result.raw.semantic.avoidWordRate),
    "centered recall": percent(result.centered.semantic.targetRecallAtCount),
    "centered risk": percent(result.centered.semantic.avoidWordRate),
    morphology: result.raw.morphology.meanSimilarity.toFixed(3),
    "25-term ms": result.warmLatency.medianMs,
  })),
);
console.log(`Wrote ${OUTPUT_PATH}`);

async function evaluateModel(definition) {
  console.log(`Loading ${definition.model}`);
  const loadStarted = performance.now();
  const extractor = await pipeline("feature-extraction", definition.model, {
    dtype: "q8",
  });
  const loadMs = round(performance.now() - loadStarted, 1);
  const vectors = await embed(extractor, terms, definition.prefix);
  const dimensions = vectors[0].length;
  const mean = meanVector(vectors, dimensions);
  const raw = new Map(
    terms.map((term, index) => [term, Float32Array.from(vectors[index])]),
  );
  const centered = new Map(
    terms.map((term, index) => [
      term,
      centerAndNormalize(vectors[index], mean),
    ]),
  );
  const latencySamples = [];
  for (let run = 0; run < LATENCY_RUNS; run += 1) {
    const started = performance.now();
    await embed(extractor, latencyTerms, definition.prefix);
    latencySamples.push(performance.now() - started);
  }
  latencySamples.sort((left, right) => left - right);
  const q8ModelBytes = (
    await stat(
      resolve(
        env.cacheDir,
        definition.model,
        "onnx/model_quantized.onnx",
      ),
    )
  ).size;
  if (typeof extractor.dispose === "function") await extractor.dispose();

  return {
    ...definition,
    dimensions,
    q8ModelBytes,
    loadMs,
    warmLatency: {
      terms: latencyTerms.length,
      runs: LATENCY_RUNS,
      medianMs: round(latencySamples[Math.floor(latencySamples.length / 2)], 1),
      samplesMs: latencySamples.map((value) => round(value, 1)),
    },
    raw: scoreTransform(raw),
    centered: scoreTransform(centered),
  };
}

async function embed(extractor, inputTerms, prefix) {
  const vectors = [];
  for (let start = 0; start < inputTerms.length; start += BATCH_SIZE) {
    const batch = inputTerms
      .slice(start, start + BATCH_SIZE)
      .map((term) => `${prefix}${term}`);
    const output = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });
    vectors.push(...output.tolist());
  }
  return vectors;
}

function scoreTransform(vectors) {
  return {
    semantic: scoreTurns(vectors),
    morphology: scoreMorphology(vectors),
  };
}

function scoreTurns(vectors) {
  let targetRecall = 0;
  let exactTargetSets = 0;
  let avoidHits = 0;

  for (const fixture of TURNS) {
    const candidates = [
      ...fixture.targets,
      ...fixture.neutral,
      ...fixture.avoid,
    ];
    const ranked = candidates
      .map((word) => ({
        word,
        similarity: cosine(vectors.get(fixture.clue), vectors.get(word)),
      }))
      .sort((left, right) => right.similarity - left.similarity);
    const predicted = ranked
      .slice(0, fixture.targets.length)
      .map(({ word }) => word);
    const targetSet = new Set(fixture.targets);
    targetRecall +=
      predicted.filter((word) => targetSet.has(word)).length /
      fixture.targets.length;
    exactTargetSets += Number(predicted.every((word) => targetSet.has(word)));
    avoidHits += Number(predicted.some((word) => fixture.avoid.includes(word)));
  }

  return {
    turns: TURNS.length,
    targetRecallAtCount: round(targetRecall / TURNS.length, 4),
    exactTargetSetAccuracy: round(exactTargetSets / TURNS.length, 4),
    avoidWordRate: round(avoidHits / TURNS.length, 4),
  };
}

function scoreMorphology(vectors) {
  const pairs = MORPHOLOGY_PAIRS.map(([left, right, category]) => ({
    left,
    right,
    category,
    similarity: round(cosine(vectors.get(left), vectors.get(right)), 4),
  }));
  const byCategory = Object.fromEntries(
    [...new Set(pairs.map(({ category }) => category))].map((category) => {
      const matches = pairs.filter((pair) => pair.category === category);
      return [
        category,
        round(
          matches.reduce((total, pair) => total + pair.similarity, 0) /
            matches.length,
          4,
        ),
      ];
    }),
  );
  return {
    pairs: pairs.length,
    meanSimilarity: round(
      pairs.reduce((total, pair) => total + pair.similarity, 0) /
        pairs.length,
      4,
    ),
    byCategory,
    observations: pairs,
  };
}

function meanVector(vectors, dimensions) {
  const mean = new Float32Array(dimensions);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      mean[index] += value / vectors.length;
    });
  }
  return mean;
}

function centerAndNormalize(vector, mean) {
  const centered = Float32Array.from(
    vector,
    (value, index) => value - mean[index],
  );
  const magnitude = Math.sqrt(
    centered.reduce((total, value) => total + value * value, 0),
  );
  if (magnitude === 0) return centered;
  return Float32Array.from(centered, (value) => value / magnitude);
}

function cosine(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

function turn(clue, targets, neutral, avoid) {
  return { clue, targets, neutral, avoid };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
