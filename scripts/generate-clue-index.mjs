import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { CLUE_BANK, DEFAULT_BOARD } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const MODEL_DEFINITIONS = {
  "minilm-l3": "Xenova/paraphrase-MiniLM-L3-v2",
  "minilm-l6": "Xenova/all-MiniLM-L6-v2",
  "bge-small": "Xenova/bge-small-en-v1.5",
  "minilm-l12": "Xenova/all-MiniLM-L12-v2",
  "mpnet-base": "Xenova/all-mpnet-base-v2",
};
const modelIds = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODEL_DEFINITIONS);
const CUTS = [3_000, 10_000, 30_000];
const SCALE = 127;
const BATCH_SIZE = 128;

env.cacheDir = resolve(ROOT, ".cache/huggingface");
env.allowLocalModels = false;

const wordSource = JSON.parse(await readFile(WORDS_PATH, "utf8"));
const candidates = buildClueCandidates(wordSource.words, CLUE_BANK, CUTS.at(-1));
if (candidates.length < CUTS.at(-1)) throw new Error(`Need ${CUTS.at(-1)} candidates, found ${candidates.length}`);

for (const id of modelIds) {
  const modelName = MODEL_DEFINITIONS[id];
  if (!modelName) throw new Error(`Unknown model id: ${id}`);
  console.log(`Loading ${modelName}`);
  const extractor = await pipeline("feature-extraction", modelName, { dtype: "q8" });
  const raw = await embedInBatches(extractor, candidates.map(({ word }) => word), id);
  const dimensions = raw[0].length;
  const mean = meanVector(raw, dimensions);
  const quantized = new Int8Array(raw.length * dimensions);
  raw.forEach((vector, row) => {
    const centered = centerAndNormalize(vector, mean);
    centered.forEach((value, column) => { quantized[row * dimensions + column] = Math.round(Math.max(-1, Math.min(1, value)) * SCALE); });
  });

  const outputDir = resolve(ROOT, `public/data/model-lab/${id}`);
  await mkdir(outputDir, { recursive: true });
  const shards = [];
  let start = 0;
  for (const end of CUTS) {
    const payload = {
      clues: candidates.slice(start, end).map(({ word }) => word),
      frequencies: candidates.slice(start, end).map(({ zipf }) => zipf),
      vectors: Buffer.from(quantized.subarray(start * dimensions, end * dimensions)).toString("base64"),
    };
    const file = `clues-${start}-${end}.json`;
    const content = `${JSON.stringify(payload)}\n`;
    await writeFile(resolve(outputDir, file), content);
    shards.push({ start, end, file, bytes: Buffer.byteLength(content) });
    start = end;
  }
  const modelBytes = (await stat(resolve(env.cacheDir, modelName, "onnx/model_quantized.onnx"))).size;
  const manifest = {
    version: 2, model: modelName, dimensions,
    quantization: { type: "symmetric-int8", scale: SCALE },
    centering: { method: "30000-clue-corpus-mean", mean: mean.map((v) => Number(v.toFixed(8))) },
    vocabulary: { source: wordSource.source, sourceVersion: wordSource.sourceVersion, language: wordSource.language, filters: wordSource.filters, curatedSeedCount: CLUE_BANK.length },
    modelBytes, shards,
  };
  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (id === "minilm-l6") {
    const boardWords = DEFAULT_BOARD.map(({ word }) => word.toLowerCase());
    const boardRaw = await embedInBatches(extractor, boardWords, "sample board");
    const fixture = { model: modelName, dimensions, words: boardWords, vectors: boardRaw.map((vector) => centerAndNormalize(vector, mean).map((value) => Number(value.toFixed(7)))) };
    await writeFile(resolve(ROOT, "scripts/generated/sample-board-embeddings.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  }
  console.log(`Wrote ${id}: ${candidates.length} x ${dimensions}`);
  if (typeof extractor.dispose === "function") await extractor.dispose();
}

async function embedInBatches(model, terms, label) {
  const vectors = [];
  for (let start = 0; start < terms.length; start += BATCH_SIZE) {
    const batch = terms.slice(start, start + BATCH_SIZE);
    vectors.push(...(await model(batch, { pooling: "mean", normalize: true })).tolist());
    if (start % (BATCH_SIZE * 10) === 0) console.log(`${label}: ${Math.min(start + batch.length, terms.length)}/${terms.length}`);
  }
  return vectors;
}
function meanVector(vectors, dimensions) { const mean = new Array(dimensions).fill(0); for (const vector of vectors) vector.forEach((value, i) => { mean[i] += value / vectors.length; }); return mean; }
function centerAndNormalize(vector, mean) { const centered = vector.map((v, i) => v - mean[i]); const magnitude = Math.sqrt(centered.reduce((n, v) => n + v * v, 0)); return centered.map((v) => v / magnitude); }
