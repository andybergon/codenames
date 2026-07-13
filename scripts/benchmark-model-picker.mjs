import { cpus, freemem, platform, release, totalmem } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { hydrateClueShards } from "../src/clue-index.js";
import { boardForSide, SIDE } from "../src/gameplay.js";
import { analyzeEmbeddedBoard, calculateBoardMetrics } from "../src/model.js";
import { CANDIDATE_OPTIONS, MODEL_OPTIONS } from "../src/model-lab.js";
import { DEFAULT_BOARD } from "../src/word-data.js";

const WARMUPS = 2;
const ITERATIONS = 7;
const REPORT_PATH = "scripts/generated/model-picker-benchmark.json";

const results = [];

for (const model of MODEL_OPTIONS) {
  const directory = `public/data/model-lab/${model.id}`;
  const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
  const shards = await Promise.all(
    manifest.shards.map(async ({ file }) => JSON.parse(await readFile(`${directory}/${file}`, "utf8"))),
  );
  const boardVectors = deterministicBoardVectors(DEFAULT_BOARD.length, manifest.dimensions);

  for (const { count } of CANDIDATE_OPTIONS) {
    const clueIndex = hydrateClueShards(manifest, shards, count);
    const run = () => {
      const blue = analyzeEmbeddedBoard(DEFAULT_BOARD, boardVectors, clueIndex, { limit: 6 });
      const red = analyzeEmbeddedBoard(
        boardForSide(DEFAULT_BOARD, SIDE.RED),
        boardVectors,
        clueIndex,
        { limit: 6 },
      );
      calculateBoardMetrics(blue, red);
      return blue.summary.candidateTotal;
    };

    for (let index = 0; index < WARMUPS; index += 1) run();

    const samplesMs = [];
    let legalCandidateCount = 0;
    for (let index = 0; index < ITERATIONS; index += 1) {
      globalThis.gc?.();
      const startedAt = performance.now();
      legalCandidateCount = run();
      samplesMs.push(performance.now() - startedAt);
    }
    samplesMs.sort((left, right) => left - right);

    const result = {
      modelId: model.id,
      model: model.model,
      dimensions: manifest.dimensions,
      candidateCount: count,
      legalCandidateCount,
      medianMs: rounded(quantile(samplesMs, 0.5)),
      p25Ms: rounded(quantile(samplesMs, 0.25)),
      p75Ms: rounded(quantile(samplesMs, 0.75)),
      samplesMs: samplesMs.map(rounded),
    };
    results.push(result);
    console.log(`${model.id} ${count}: ${result.medianMs} ms median`);
  }
}

const cpu = cpus()[0];
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpu?.model ?? "unknown",
    logicalCores: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtReport: freemem(),
    garbageCollectionExposed: typeof globalThis.gc === "function",
  },
  methodology: {
    warmups: WARMUPS,
    iterations: ITERATIONS,
    statistic: "median",
    operation:
      "Score the fixed sample board for both Blue and Red, then calculate board metrics. Index/model loading and board embedding are excluded.",
    vectors:
      "Deterministic normalized synthetic board vectors keep the scoring work identical across runs while matching each model dimension.",
  },
  results,
};

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH}`);

function deterministicBoardVectors(count, dimensions) {
  let state = 0x6d2b79f5;
  return Array.from({ length: count }, () => {
    const vector = new Float32Array(dimensions);
    let magnitude = 0;
    for (let index = 0; index < dimensions; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const value = state / 0xffff_ffff - 0.5;
      vector[index] = value;
      magnitude += value * value;
    }
    magnitude = Math.sqrt(magnitude);
    for (let index = 0; index < dimensions; index += 1) vector[index] /= magnitude;
    return vector;
  });
}

function quantile(sortedValues, position) {
  const index = (sortedValues.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function rounded(value) {
  return Number(value.toFixed(1));
}
