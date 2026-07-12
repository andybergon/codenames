import { pipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

const vectorCaches = new Map();
const extractorPromises = new Map();

export async function embedTerms(terms, options = {}) {
  const model = options.model ?? EMBEDDING_MODEL;
  const vectorCache = getVectorCache(model);
  const normalizedTerms = terms.map(normalizeEmbeddingTerm);
  const missingTerms = [...new Set(normalizedTerms.filter((term) => term && !vectorCache.has(term)))];

  if (missingTerms.length > 0) {
    const extractor = await getExtractor(model, options.onProgress);
    const output = await extractor(missingTerms, {
      pooling: "mean",
      normalize: true,
    });
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

function getExtractor(model, onProgress) {
  if (!extractorPromises.has(model)) {
    extractorPromises.set(model, pipeline("feature-extraction", model, {
      dtype: "q8",
      progress_callback: onProgress,
    }));
  }

  return extractorPromises.get(model);
}

function getVectorCache(model) {
  if (!vectorCaches.has(model)) vectorCaches.set(model, new Map());
  return vectorCaches.get(model);
}

function normalizeEmbeddingTerm(term) {
  return String(term ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
