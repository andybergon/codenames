import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TASK_PREFIX = "task: sentence similarity | query: ";
const DEFAULT_BATCH_SIZE = 96;
const options = parseOptions(process.argv.slice(2));
const gateway = gatewayConfiguration(options.gateway);
const credential = gateway.credential();
if (!credential) throw new Error(gateway.credentialError);

const experimentDirectory = resolve(ROOT, options.experimentDir);
const termsData = JSON.parse(
  await readFile(resolve(experimentDirectory, "terms.json"), "utf8"),
);
const vectorDirectory = resolve(experimentDirectory, "vectors");
const progressPath = resolve(experimentDirectory, "gateway-progress.json");
await mkdir(vectorDirectory, { recursive: true });

const modelMetadata = await loadModelMetadata(options.model);
const pricePerMillionTokens = gateway.pricePerMillionTokens(modelMetadata);
if (!Number.isFinite(pricePerMillionTokens) || pricePerMillionTokens <= 0) {
  throw new Error(`No input-token price is available for ${options.model}.`);
}
const progress = await loadProgress();

const missingChunks = [];
for (
  let start = 0;
  start < termsData.terms.length;
  start += options.batchSize
) {
  const end = Math.min(start + options.batchSize, termsData.terms.length);
  const path = chunkPath(vectorDirectory, start, end);
  if (!(await validChunk(path, end - start, options.dimensions))) {
    missingChunks.push({ start, end, path });
  }
}
const missingTerms = missingChunks.flatMap(({ start, end }) =>
  termsData.terms.slice(start, end),
);
const estimatedMissingTokens = missingTerms.reduce(
  (total, term) => total + estimateTokens(`${TASK_PREFIX}${term}`),
  0,
);
const estimatedTotalTokens = termsData.terms.reduce(
  (total, term) => total + estimateTokens(`${TASK_PREFIX}${term}`),
  0,
);
const estimatedMissingCost =
  (estimatedMissingTokens / 1_000_000) * pricePerMillionTokens;
const projectedCost =
  (progress.billedTokens / 1_000_000) * pricePerMillionTokens +
  estimatedMissingCost;
console.log(
  `${options.model} preflight: ${missingTerms.length.toLocaleString("en-US")} uncached terms, at most ${estimatedMissingTokens.toLocaleString("en-US")} additional estimated tokens and $${projectedCost.toFixed(4)} total projected cost.`,
);
if (projectedCost > options.maxCostUsd) {
  throw new Error(
    `Projected cost $${projectedCost.toFixed(4)} exceeds the $${options.maxCostUsd.toFixed(2)} cap.`,
  );
}

let billedTokens = progress.billedTokens;
let requestCount = progress.requestCount;
let completedTerms = termsData.terms.length - missingTerms.length;
let progressWrite = Promise.resolve();
const startedAt = performance.now();
let nextChunkIndex = 0;
await Promise.all(
  Array.from(
    {
      length: Math.min(options.concurrency, missingChunks.length),
    },
    async () => {
      while (nextChunkIndex < missingChunks.length) {
        const chunk = missingChunks[nextChunkIndex];
        nextChunkIndex += 1;
        await embedChunk(chunk);
      }
    },
  ),
);

async function embedChunk(chunk) {
  const batch = termsData.terms.slice(chunk.start, chunk.end);
  const response = await createEmbeddings(batch);
  requestCount += 1;
  billedTokens +=
    response.usage?.prompt_tokens ??
    batch.reduce(
      (total, term) => total + estimateTokens(`${TASK_PREFIX}${term}`),
      0,
    );
  const billedCost =
    (billedTokens / 1_000_000) * pricePerMillionTokens;
  if (billedCost > options.maxCostUsd) {
    throw new Error(`Billed cost guard exceeded at $${billedCost.toFixed(4)}.`);
  }
  const rows = [...(response.data ?? [])]
    .sort((left, right) => left.index - right.index)
    .map(({ embedding }) => embedding);
  if (rows.length !== batch.length) {
    throw new Error(
      `${options.model} returned ${rows.length} embeddings for ${batch.length} terms.`,
    );
  }
  const buffer = Buffer.alloc(batch.length * options.dimensions * 4);
  rows.forEach((vector, row) => {
    if (vector.length !== options.dimensions) {
      throw new Error(
        `${options.model} returned ${vector.length} dimensions, expected ${options.dimensions}.`,
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
  completedTerms += batch.length;
  const progressSnapshot = { billedTokens, requestCount };
  progressWrite = progressWrite.then(() => writeProgress(progressSnapshot));
  await progressWrite;
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Embedded ${completedTerms.toLocaleString("en-US")}/${termsData.terms.length.toLocaleString("en-US")} terms in ${elapsed}s.`,
  );
}

const billedCost =
  (billedTokens / 1_000_000) * pricePerMillionTokens;
await writeFile(
  resolve(experimentDirectory, "vector-metadata.json"),
  `${JSON.stringify(
    {
      version: 1,
      provider: gateway.provider,
      model: options.model,
      dimensions: options.dimensions,
      inputHash: termsData.inputHash,
      termCount: termsData.terms.length,
      availableTermCount: termsData.terms.length,
      missingTerms: [],
      runtime: `${gateway.provider}-embeddings`,
      taskPrefix: TASK_PREFIX,
      batchSize: options.batchSize,
      concurrency: options.concurrency,
      requestCount,
      cost: {
        pricePerMillionTokens,
        maxCostUsd: options.maxCostUsd,
        estimatedTokens: estimatedTotalTokens,
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
  `Wrote ${options.model} embeddings to ${experimentDirectory}. This run cost approximately $${billedCost.toFixed(4)}.`,
);

async function loadModelMetadata(model) {
  const response = await fetch(`${gateway.baseUrl}${gateway.modelsPath}`);
  if (!response.ok) {
    throw new Error(
      `Could not load ${gateway.label} models (${response.status}).`,
    );
  }
  const payload = await response.json();
  const metadata = payload.data?.find(({ id }) => id === model);
  if (!metadata || !gateway.isEmbeddingModel(metadata)) {
    throw new Error(
      `${model} is not an available ${gateway.label} embedding model.`,
    );
  }
  return metadata;
}

async function loadProgress() {
  try {
    const saved = JSON.parse(await readFile(progressPath, "utf8"));
    if (
      saved.inputHash !== termsData.inputHash ||
      saved.gateway !== options.gateway ||
      saved.model !== options.model ||
      saved.dimensions !== options.dimensions ||
      saved.batchSize !== options.batchSize
    ) {
      throw new Error("Saved AI Gateway progress does not match this run.");
    }
    return {
      billedTokens: saved.billedTokens,
      requestCount: saved.requestCount,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { billedTokens: 0, requestCount: 0 };
    }
    throw error;
  }
}

async function writeProgress(snapshot) {
  await writeFile(
    progressPath,
    `${JSON.stringify(
      {
        inputHash: termsData.inputHash,
        gateway: options.gateway,
        model: options.model,
        dimensions: options.dimensions,
        batchSize: options.batchSize,
        billedTokens: snapshot.billedTokens,
        requestCount: snapshot.requestCount,
        billedCostUsd: Number(
          (
            (snapshot.billedTokens / 1_000_000) *
            pricePerMillionTokens
          ).toFixed(6),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

async function createEmbeddings(terms) {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${gateway.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
          ...gateway.requestHeaders,
        },
        body: JSON.stringify({
          model: options.model,
          input: terms.map((term) => `${TASK_PREFIX}${term}`),
          dimensions: options.dimensions,
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return await response.json();
      const text = await response.text();
      if (
        attempt === options.maxAttempts ||
        ![408, 409, 429, 500, 502, 503, 504, 529].includes(response.status)
      ) {
        throw new Error(
          `${gateway.label} embeddings failed (${response.status}): ${text.slice(0, 500)}`,
        );
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const delaySeconds = Number.isFinite(retryAfter)
        ? retryAfter
        : Math.min(60, 2 ** attempt);
      console.log(
        `${options.model} attempt ${attempt} failed with ${response.status}; retrying in ${delaySeconds}s.`,
      );
      await delay(delaySeconds * 1_000);
    } catch (error) {
      if (attempt === options.maxAttempts) throw error;
      const delaySeconds = Math.min(60, 2 ** attempt);
      console.log(
        `${options.model} attempt ${attempt} failed; retrying in ${delaySeconds}s.`,
      );
      await delay(delaySeconds * 1_000);
    }
  }
  throw new Error(`${gateway.label} embeddings request exhausted retries.`);
}

function parseOptions(args) {
  const values = {
    experimentDir: null,
    gateway: "vercel",
    model: null,
    dimensions: 768,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: 1,
    maxCostUsd: null,
    maxAttempts: 8,
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--experiment-dir") values.experimentDir = value;
    else if (option === "--gateway") values.gateway = value;
    else if (option === "--model") values.model = value;
    else if (option === "--dimensions") values.dimensions = positive(value);
    else if (option === "--batch-size") values.batchSize = positive(value);
    else if (option === "--concurrency") {
      values.concurrency = positiveInteger(value);
    }
    else if (option === "--max-cost-usd") values.maxCostUsd = positive(value);
    else if (option === "--max-attempts") values.maxAttempts = positive(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!values.experimentDir) {
    throw new Error("--experiment-dir is required.");
  }
  if (!["openrouter", "vercel"].includes(values.gateway)) {
    throw new Error("--gateway must be openrouter or vercel.");
  }
  if (!values.model) throw new Error("--model is required.");
  if (!values.maxCostUsd) throw new Error("--max-cost-usd is required.");
  return values;
}

function gatewayConfiguration(name) {
  if (name === "openrouter") {
    return {
      label: "OpenRouter",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      modelsPath: "/embeddings/models",
      credential: () => process.env.OPENROUTER_API_KEY,
      credentialError: "OPENROUTER_API_KEY is required.",
      isEmbeddingModel: () => true,
      pricePerMillionTokens: (metadata) =>
        Number(metadata.pricing?.prompt) * 1_000_000,
      requestHeaders: {
        "HTTP-Referer": "https://codenames.andybergon.me",
        "X-OpenRouter-Title": "Codenames embedding experiments",
      },
    };
  }
  return {
    label: "Vercel AI Gateway",
    provider: "vercel-ai-gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    modelsPath: "/models",
    credential: () =>
      process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN,
    credentialError:
      "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is required.",
    isEmbeddingModel: (metadata) => metadata.type === "embedding",
    pricePerMillionTokens: (metadata) =>
      Number(metadata.pricing?.input) * 1_000_000,
    requestHeaders: {},
  };
}

function positive(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received ${value}.`);
  }
  return parsed;
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
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

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
