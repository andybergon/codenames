import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { CLUE_BANK, DEFAULT_BOARD } from "../src/word-data.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const INDEX_PATH = resolve(ROOT, "public/data/clue-embeddings.json");
const FIXTURE_PATH = resolve(ROOT, "scripts/generated/sample-board-embeddings.json");
const MODEL = "Xenova/all-MiniLM-L6-v2";
const QUANTIZATION_SCALE = 127;
const BATCH_SIZE = 64;

env.cacheDir = resolve(ROOT, ".cache/huggingface");
env.allowLocalModels = false;

const wordSource = JSON.parse(await readFile(WORDS_PATH, "utf8"));
const candidates = mergeCandidates(wordSource.words, CLUE_BANK);

let lastDownloadPercent = -1;
const extractor = await pipeline("feature-extraction", MODEL, {
  dtype: "q8",
  progress_callback: (event) => {
    if (event.status !== "progress" || typeof event.progress !== "number") {
      return;
    }
    const percent = Math.floor(event.progress / 10) * 10;
    if (percent > lastDownloadPercent) {
      lastDownloadPercent = percent;
      console.log(`Model download ${percent}%`);
    }
  },
});

const clueVectors = await embedInBatches(
  extractor,
  candidates.map((candidate) => candidate.word),
  "clues",
);
const boardWords = DEFAULT_BOARD.map((card) => card.word.toLowerCase());
const rawBoardVectors = await embedInBatches(extractor, boardWords, "sample board");
const dimensions = clueVectors[0].length;
const embeddingMean = meanVector(clueVectors, dimensions);
const centeredClueVectors = clueVectors.map((vector) => centerAndNormalize(vector, embeddingMean));
const boardVectors = rawBoardVectors.map((vector) => centerAndNormalize(vector, embeddingMean));
const quantizedVectors = new Int8Array(centeredClueVectors.length * dimensions);

centeredClueVectors.forEach((vector, vectorIndex) => {
  vector.forEach((value, dimension) => {
    quantizedVectors[vectorIndex * dimensions + dimension] = Math.round(
      Math.max(-1, Math.min(1, value)) * QUANTIZATION_SCALE,
    );
  });
});

const index = {
  version: 1,
  model: MODEL,
  dimensions,
  quantization: {
    type: "symmetric-int8",
    scale: QUANTIZATION_SCALE,
  },
  centering: {
    method: "clue-corpus-mean",
    mean: embeddingMean.map((value) => Number(value.toFixed(8))),
  },
  vocabulary: {
    source: wordSource.source,
    sourceVersion: wordSource.sourceVersion,
    language: wordSource.language,
    filters: wordSource.filters,
    curatedSeedCount: CLUE_BANK.length,
  },
  clues: candidates.map((candidate) => candidate.word),
  frequencies: candidates.map((candidate) => candidate.zipf),
  vectors: Buffer.from(quantizedVectors.buffer).toString("base64"),
};

const fixture = {
  model: MODEL,
  dimensions,
  words: boardWords,
  vectors: boardVectors.map((vector) => vector.map((value) => Number(value.toFixed(7)))),
};

await mkdir(dirname(INDEX_PATH), { recursive: true });
await mkdir(dirname(FIXTURE_PATH), { recursive: true });
await writeFile(INDEX_PATH, `${JSON.stringify(index)}\n`, "utf8");
await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

console.log(
  `Wrote ${candidates.length} ${dimensions}-dimensional clue embeddings to ${INDEX_PATH}`,
);

async function embedInBatches(model, terms, label) {
  const vectors = [];

  for (let start = 0; start < terms.length; start += BATCH_SIZE) {
    const batch = terms.slice(start, start + BATCH_SIZE);
    const output = await model(batch, { pooling: "mean", normalize: true });
    vectors.push(...output.tolist());
    console.log(`${label}: ${Math.min(start + batch.length, terms.length)}/${terms.length}`);
  }

  return vectors;
}

function mergeCandidates(frequencyWords, seedWords) {
  const seen = new Set();
  const merged = [];

  for (const candidate of frequencyWords) {
    if (!seen.has(candidate.word)) {
      seen.add(candidate.word);
      merged.push(candidate);
    }
  }

  for (const seed of seedWords) {
    const word = seed.toLowerCase();
    if (/^[a-z]+$/u.test(word) && !seen.has(word)) {
      seen.add(word);
      merged.push({ word, zipf: 3.4 });
    }
  }

  return merged;
}

function meanVector(vectors, dimensions) {
  const mean = new Array(dimensions).fill(0);

  for (const vector of vectors) {
    vector.forEach((value, index) => {
      mean[index] += value / vectors.length;
    });
  }

  return mean;
}

function centerAndNormalize(vector, mean) {
  const centered = vector.map((value, index) => value - mean[index]);
  const magnitude = Math.sqrt(centered.reduce((total, value) => total + value * value, 0));
  return centered.map((value) => value / magnitude);
}
