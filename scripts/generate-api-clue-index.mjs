import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUE_BANK } from "../src/word-data.js";
import { getWordsForSet, WORD_SET } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const CENTERING_COUNT = 30_000;
const SCALE = 127;
const BATCH_SIZE = 512;
const MODEL_PRICES_PER_MILLION = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
};

const options = parseOptions(process.argv.slice(2));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required.");
}

const wordSource = JSON.parse(await readFile(WORDS_PATH, "utf8"));
const clueCandidates = buildClueCandidates(
  wordSource.words,
  CLUE_BANK,
  CENTERING_COUNT,
);
if (clueCandidates.length < CENTERING_COUNT) {
  throw new Error(
    `Need ${CENTERING_COUNT} centering candidates, found ${clueCandidates.length}.`,
  );
}
const boardWords = [
  ...new Set([
    ...getWordsForSet(WORD_SET.OFFICIAL),
    ...getWordsForSet(WORD_SET.EXTENDED),
  ]),
];
const clueWords = clueCandidates
  .slice(0, CENTERING_COUNT)
  .map(({ word }) => word);
const allTerms = [...new Set([...clueWords, ...boardWords])];
const inputHash = createHash("sha256")
  .update(JSON.stringify(allTerms))
  .digest("hex");
const experimentId = safeSlug(
  `openai-${options.model}-${options.dimensions}`,
);
const experimentDirectory = resolve(
  ROOT,
  options.output ?? `.cache/embedding-experiments/${experimentId}`,
);
const rawDirectory = resolve(experimentDirectory, "raw");
const indexDirectory = resolve(experimentDirectory, "index");
await mkdir(rawDirectory, { recursive: true });
await mkdir(indexDirectory, { recursive: true });

const metadataPath = resolve(experimentDirectory, "metadata.json");
const existingMetadata = await readJson(metadataPath);
if (
  existingMetadata &&
  (existingMetadata.inputHash !== inputHash ||
    existingMetadata.model !== options.model ||
    existingMetadata.dimensions !== options.dimensions)
) {
  throw new Error(
    `Cached experiment metadata does not match ${experimentDirectory}. Choose another --output directory.`,
  );
}
const cacheMetadata = {
  provider: "openai",
  model: options.model,
  dimensions: options.dimensions,
  inputHash,
  termCount: allTerms.length,
  pricePerMillionTokens: options.pricePerMillion,
  cumulativeKnownBilledTokens:
    existingMetadata?.cumulativeKnownBilledTokens ?? 0,
};
await writeCacheMetadata(metadataPath, cacheMetadata);

const missingRanges = [];
for (let start = 0; start < allTerms.length; start += BATCH_SIZE) {
  const end = Math.min(start + BATCH_SIZE, allTerms.length);
  const path = rawChunkPath(rawDirectory, start, end);
  if (!(await validChunk(path, end - start, options.dimensions))) {
    missingRanges.push({ start, end, path });
  }
}
const missingTerms = missingRanges.flatMap(({ start, end }) =>
  allTerms.slice(start, end),
);
const estimatedTokens = estimateTokens(missingTerms);
const estimatedCost =
  (estimatedTokens / 1_000_000) * options.pricePerMillion;
console.log(
  `Preflight: ${allTerms.length.toLocaleString("en-US")} terms, ${missingTerms.length.toLocaleString("en-US")} uncached, at most ${estimatedTokens.toLocaleString("en-US")} estimated tokens and $${estimatedCost.toFixed(4)}.`,
);
if (estimatedCost > options.maxCostUsd) {
  throw new Error(
    `Estimated cost $${estimatedCost.toFixed(4)} exceeds --max-cost-usd ${options.maxCostUsd}.`,
  );
}

let billedTokens = 0;
for (const [rangeIndex, range] of missingRanges.entries()) {
  const batch = allTerms.slice(range.start, range.end);
  const response = await createOpenAiEmbeddings(batch, options);
  billedTokens += response.usage?.total_tokens ?? estimateTokens(batch);
  cacheMetadata.cumulativeKnownBilledTokens +=
    response.usage?.total_tokens ?? estimateTokens(batch);
  await writeCacheMetadata(metadataPath, cacheMetadata);
  const billedCost =
    (billedTokens / 1_000_000) * options.pricePerMillion;
  if (billedCost > options.maxCostUsd) {
    throw new Error(
      `Billed cost guard exceeded after ${range.end} terms: $${billedCost.toFixed(4)}.`,
    );
  }
  const buffer = Buffer.alloc(batch.length * options.dimensions * 4);
  response.data
    .sort((left, right) => left.index - right.index)
    .forEach((item, row) => {
      const decoded = Buffer.from(item.embedding, "base64");
      const expectedBytes = options.dimensions * 4;
      if (decoded.byteLength !== expectedBytes) {
        throw new Error(
          `Embedding ${range.start + row} has ${decoded.byteLength} bytes, expected ${expectedBytes}.`,
        );
      }
      decoded.copy(buffer, row * expectedBytes);
    });
  await writeFile(range.path, buffer);
  console.log(
    `API ${rangeIndex + 1}/${missingRanges.length}: ${range.end}/${allTerms.length}, ${billedTokens.toLocaleString("en-US")} billed tokens, $${billedCost.toFixed(4)}.`,
  );
}

const vectorsByTerm = new Map();
for (let start = 0; start < allTerms.length; start += BATCH_SIZE) {
  const end = Math.min(start + BATCH_SIZE, allTerms.length);
  const buffer = await readFile(rawChunkPath(rawDirectory, start, end));
  for (let row = 0; row < end - start; row += 1) {
    const byteOffset = row * options.dimensions * 4;
    const vector = new Float32Array(options.dimensions);
    for (let dimension = 0; dimension < options.dimensions; dimension += 1) {
      vector[dimension] = buffer.readFloatLE(byteOffset + dimension * 4);
    }
    vectorsByTerm.set(allTerms[start + row], vector);
  }
}

const mean = meanVector(
  clueWords.map((word) => vectorsByTerm.get(word)),
  options.dimensions,
);
const selectedCandidates = clueCandidates.slice(0, options.candidates);
const cluePayload = quantizedPayload(
  selectedCandidates.map(({ word }) => word),
  selectedCandidates.map(({ zipf }) => zipf),
  vectorsByTerm,
  mean,
  options.dimensions,
);
const clueFile = `clues-0-${options.candidates}.json`;
const clueContent = `${JSON.stringify(cluePayload)}\n`;
await writeFile(resolve(indexDirectory, clueFile), clueContent);

const boardPayload = quantizedPayload(
  boardWords,
  null,
  vectorsByTerm,
  mean,
  options.dimensions,
);
const boardFile = "board-vectors.json";
await writeFile(
  resolve(indexDirectory, boardFile),
  `${JSON.stringify(boardPayload)}\n`,
);

const actualCost =
  (billedTokens / 1_000_000) * options.pricePerMillion;
const manifest = {
  version: 2,
  provider: "openai",
  embeddingRuntime: "precomputed",
  model: options.model,
  dimensions: options.dimensions,
  quantization: { type: "symmetric-int8", scale: SCALE },
  centering: {
    method: "30000-clue-corpus-mean",
    mean: Array.from(mean, (value) => Number(value.toFixed(8))),
  },
  vocabulary: {
    source: wordSource.source,
    sourceVersion: wordSource.sourceVersion,
    language: wordSource.language,
    filters: wordSource.filters,
    wordnetCount: wordSource.wordnetCount,
    fallbackCount: wordSource.fallbackCount,
    curatedSeedCount: CLUE_BANK.length,
  },
  apiExperiment: {
    generatedAt: new Date().toISOString(),
    maxCostUsd: options.maxCostUsd,
    pricePerMillionTokens: options.pricePerMillion,
    estimatedTokens,
    billedTokens,
    billedCostUsd: Number(actualCost.toFixed(6)),
    cumulativeKnownBilledTokens: cacheMetadata.cumulativeKnownBilledTokens,
    cumulativeKnownCostUsd: Number(
      (
        (cacheMetadata.cumulativeKnownBilledTokens / 1_000_000) *
        options.pricePerMillion
      ).toFixed(6),
    ),
    cachedTerms: allTerms.length - missingTerms.length,
    requestedTerms: missingTerms.length,
  },
  modelBytes: 0,
  boardVectors: {
    file: boardFile,
    wordSets: [WORD_SET.OFFICIAL, WORD_SET.EXTENDED],
    words: boardWords.length,
  },
  shards: [
    {
      start: 0,
      end: options.candidates,
      file: clueFile,
      bytes: Buffer.byteLength(clueContent),
    },
  ],
};
await writeFile(
  resolve(indexDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Wrote cost-capped experiment index to ${indexDirectory}`);
console.log(
  `This run billed ${billedTokens.toLocaleString("en-US")} tokens, approximately $${actualCost.toFixed(4)}.`,
);

async function createOpenAiEmbeddings(input, activeOptions) {
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
          model: activeOptions.model,
          dimensions: activeOptions.dimensions,
          encoding_format: "base64",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response.json();
      const text = await response.text();
      if (attempt === 3 || ![408, 409, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(
          `OpenAI embeddings failed (${response.status}): ${text.slice(0, 500)}`,
        );
      }
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`API request attempt ${attempt} failed; retrying.`);
    }
    await delay(attempt * 1_000);
  }
  throw new Error("OpenAI embeddings request exhausted retries.");
}

function quantizedPayload(
  words,
  frequencies,
  vectors,
  mean,
  dimensions,
) {
  const quantized = new Int8Array(words.length * dimensions);
  words.forEach((word, row) => {
    const centered = centerAndNormalize(vectors.get(word), mean);
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

function estimateTokens(terms) {
  return terms.reduce(
    (total, term) =>
      total + Math.max(1, Math.ceil(Buffer.byteLength(term, "utf8") / 3) + 1),
    0,
  );
}

function rawChunkPath(directory, start, end) {
  return resolve(
    directory,
    `${String(start).padStart(6, "0")}-${String(end).padStart(6, "0")}.f32`,
  );
}

async function validChunk(path, rows, dimensions) {
  try {
    return (await stat(path)).size === rows * dimensions * 4;
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

async function writeCacheMetadata(path, metadata) {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

function parseOptions(args) {
  const values = {
    model: "text-embedding-3-large",
    dimensions: 1024,
    candidates: 10_000,
    maxCostUsd: 0.05,
    pricePerMillion: null,
    output: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--model") {
      if (!value) throw new Error(`${option} requires a model.`);
      values.model = value;
    } else if (option === "--dimensions") {
      values.dimensions = positiveInteger(value, option);
    } else if (option === "--candidates") {
      values.candidates = positiveInteger(value, option);
    } else if (option === "--max-cost-usd") {
      values.maxCostUsd = positiveNumber(value, option);
    } else if (option === "--price-per-million") {
      values.pricePerMillion = positiveNumber(value, option);
    } else if (option === "--output") {
      if (!value) throw new Error(`${option} requires a directory.`);
      values.output = value;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
    index += 1;
  }
  values.pricePerMillion ??= MODEL_PRICES_PER_MILLION[values.model];
  if (!values.pricePerMillion) {
    throw new Error(
      `No checked price for ${values.model}; pass --price-per-million.`,
    );
  }
  if (values.candidates > CENTERING_COUNT) {
    throw new Error(
      `API experiments currently support at most ${CENTERING_COUNT} candidates.`,
    );
  }
  return values;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive number.`);
  }
  return parsed;
}

function safeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^-|-$)/gu, "");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
