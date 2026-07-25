import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODEL = "gemini-embedding-2";
const PROVIDER = "google";
const PRICE_PER_MILLION_TOKENS = 0.2;
const TASK_PREFIX = "task: sentence similarity | query: ";
const BATCH_SIZE = 100;
const CHUNK_SIZE = BATCH_SIZE;
const options = parseOptions(process.argv.slice(2));
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is required.");

const experimentDirectory = resolve(ROOT, options.experimentDir);
const termsData = JSON.parse(
  await readFile(resolve(experimentDirectory, "terms.json"), "utf8"),
);
const vectorDirectory = resolve(experimentDirectory, "vectors");
await mkdir(vectorDirectory, { recursive: true });

const missingChunks = [];
for (let start = 0; start < termsData.terms.length; start += CHUNK_SIZE) {
  const end = Math.min(start + CHUNK_SIZE, termsData.terms.length);
  const path = chunkPath(vectorDirectory, start, end);
  if (!(await validChunk(path, end - start, options.dimensions))) {
    missingChunks.push({ start, end, path });
  }
}
const missingTerms = missingChunks.flatMap(({ start, end }) =>
  termsData.terms.slice(start, end),
);
const estimatedTokens = missingTerms.reduce(
  (total, term) => total + estimateTokens(`${TASK_PREFIX}${term}`),
  0,
);
const estimatedCost =
  (estimatedTokens / 1_000_000) * PRICE_PER_MILLION_TOKENS;
console.log(
  `Gemini preflight: ${missingTerms.length.toLocaleString("en-US")} uncached terms, at most ${estimatedTokens.toLocaleString("en-US")} estimated tokens and $${estimatedCost.toFixed(4)}.`,
);
if (estimatedCost > options.maxCostUsd) {
  throw new Error(
    `Estimated cost $${estimatedCost.toFixed(4)} exceeds the $${options.maxCostUsd.toFixed(2)} cap.`,
  );
}

let billedTokens = 0;
const startedAt = performance.now();
for (const chunk of missingChunks) {
  const rows = [];
  for (let start = chunk.start; start < chunk.end; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, chunk.end);
    const batch = termsData.terms.slice(start, end);
    const response = await createEmbeddings(batch);
    billedTokens +=
      response.usageMetadata?.promptTokenCount ??
      batch.reduce(
        (total, term) => total + estimateTokens(`${TASK_PREFIX}${term}`),
        0,
      );
    const billedCost =
      (billedTokens / 1_000_000) * PRICE_PER_MILLION_TOKENS;
    if (billedCost > options.maxCostUsd) {
      throw new Error(`Billed cost guard exceeded at $${billedCost.toFixed(4)}.`);
    }
    if (response.embeddings?.length !== batch.length) {
      throw new Error(
        `Gemini returned ${response.embeddings?.length ?? 0} embeddings for ${batch.length} terms.`,
      );
    }
    rows.push(...response.embeddings.map(({ values }) => values));
  }
  const buffer = Buffer.alloc(
    (chunk.end - chunk.start) * options.dimensions * 4,
  );
  rows.forEach((vector, row) => {
    if (vector.length !== options.dimensions) {
      throw new Error(
        `Gemini returned ${vector.length} dimensions, expected ${options.dimensions}.`,
      );
    }
    vector.forEach((value, dimension) => {
      buffer.writeFloatLE(
        value,
        (row * options.dimensions + dimension) * 4,
      );
    });
  });
  await writeFile(chunk.path, buffer);
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Embedded ${chunk.end.toLocaleString("en-US")}/${termsData.terms.length.toLocaleString("en-US")} terms in ${elapsed}s.`,
  );
}

const billedCost =
  (billedTokens / 1_000_000) * PRICE_PER_MILLION_TOKENS;
await writeFile(
  resolve(experimentDirectory, "vector-metadata.json"),
  `${JSON.stringify(
    {
      version: 1,
      provider: PROVIDER,
      model: MODEL,
      dimensions: options.dimensions,
      inputHash: termsData.inputHash,
      termCount: termsData.terms.length,
      availableTermCount: termsData.terms.length,
      missingTerms: [],
      runtime: "gemini-batch-embed-contents",
      taskPrefix: TASK_PREFIX,
      cost: {
        pricePerMillionTokens: PRICE_PER_MILLION_TOKENS,
        maxCostUsd: options.maxCostUsd,
        estimatedTokens,
        billedTokens,
        billedCostUsd: Number(billedCost.toFixed(6)),
      },
      elapsedSeconds: Number(
        ((performance.now() - startedAt) / 1000).toFixed(3),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Wrote Gemini embeddings to ${experimentDirectory}. This run cost approximately $${billedCost.toFixed(4)}.`,
);

async function createEmbeddings(terms) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            requests: terms.map((term) => ({
              model: `models/${MODEL}`,
              content: {
                parts: [{ text: `${TASK_PREFIX}${term}` }],
              },
              outputDimensionality: options.dimensions,
            })),
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (response.ok) return response.json();
      const text = await response.text();
      if (
        attempt === 4 ||
        ![408, 409, 429, 500, 502, 503, 504].includes(response.status)
      ) {
        throw new Error(
          `Gemini embeddings failed (${response.status}): ${text.slice(0, 500)}`,
        );
      }
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`Gemini attempt ${attempt} failed; retrying.`);
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, attempt * 1_000),
    );
  }
  throw new Error("Gemini embeddings request exhausted retries.");
}

function parseOptions(args) {
  const values = {
    experimentDir: null,
    dimensions: 768,
    maxCostUsd: 0.08,
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--experiment-dir") values.experimentDir = value;
    else if (option === "--dimensions") values.dimensions = positive(value);
    else if (option === "--max-cost-usd") {
      values.maxCostUsd = positive(value);
    } else throw new Error(`Unknown option: ${option}`);
  }
  if (!values.experimentDir) {
    throw new Error("--experiment-dir is required.");
  }
  return values;
}

function positive(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received ${value}.`);
  }
  return parsed;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3) + 1);
}

function chunkPath(directory, start, end) {
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
