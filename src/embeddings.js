import { pipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

const vectorCaches = new Map();
const extractorPromises = new Map();

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
      model,
      revision,
      configuration,
      options.onProgress,
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

function getExtractor(model, revision, configuration, onProgress) {
  if (!extractorPromises.has(configuration)) {
    extractorPromises.set(
      configuration,
      pipeline("feature-extraction", model, {
        dtype: "q8",
        revision,
        progress_callback: onProgress,
      }),
    );
  }

  return extractorPromises.get(configuration);
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
