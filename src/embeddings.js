import { pipeline } from "@huggingface/transformers";
import { createSingleFlightRetryLoader } from "./load-retry.js";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

const vectorCaches = new Map();
const getExtractor = createExtractorLoader();

export async function embedTerms(terms, options = {}) {
  const model = options.model ?? EMBEDDING_MODEL;
  const revision = options.revision ?? "main";
  const inputPrefix = options.inputPrefix ?? "";
  const configuration = `${model}@${revision}:${inputPrefix}`;
  const vectorCache = getVectorCache(configuration);
  const normalizedTerms = terms.map(normalizeEmbeddingTerm);
  const missingTerms = [...new Set(normalizedTerms.filter((term) => term && !vectorCache.has(term)))];

  if (missingTerms.length > 0) {
    const extractor = await getExtractor(
      configuration,
      {
        model,
        revision,
        onProgress: options.onProgress,
        onRetry(event) {
          options.onRetry?.({ ...event, resource: "model" });
          options.onProgress?.({ ...event, status: "retry", resource: "model" });
        },
      },
    );
    const output = await extractor(
      missingTerms.map((term) => `${inputPrefix}${term}`),
      {
        pooling: "mean",
        normalize: true,
      },
    );
    const vectors = output.tolist();

    missingTerms.forEach((term, index) => {
      vectorCache.set(term, Float32Array.from(vectors[index]));
    });
  }

  const dimensions = vectorCache.values().next().value?.length ?? 384;
  return normalizedTerms.map((term) => vectorCache.get(term) ?? new Float32Array(dimensions));
}

export function centerEmbeddings(vectors, mean) {
  return vectors.map((vector) => {
    if (vector.length !== mean.length) {
      throw new Error(`Embedding center has ${mean.length} dimensions, vector has ${vector.length}`);
    }

    const centered = Float32Array.from(vector, (value, index) => value - mean[index]);
    const magnitude = Math.sqrt(centered.reduce((total, value) => total + value * value, 0));

    if (magnitude === 0) {
      return centered;
    }

    for (let index = 0; index < centered.length; index += 1) {
      centered[index] /= magnitude;
    }

    return centered;
  });
}

export function createExtractorLoader(
  loadPipeline = pipeline,
  retryOptions = {},
) {
  return createSingleFlightRetryLoader(
    (_configuration, options) =>
      loadPipeline("feature-extraction", options.model, {
        dtype: "q8",
        revision: options.revision,
        progress_callback: options.onProgress,
      }),
    retryOptions,
  );
}

function getVectorCache(configuration) {
  if (!vectorCaches.has(configuration)) {
    vectorCaches.set(configuration, new Map());
  }
  return vectorCaches.get(configuration);
}

export function normalizeEmbeddingTerm(term) {
  return String(term ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
