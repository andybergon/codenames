import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

export const BOARD_VECTOR_CACHE_VERSION = 1;

export function boardVectorCacheIdentity({
  language,
  wordSet,
  words,
  manifestBytes,
  manifest,
}) {
  const descriptor = {
    cacheVersion: BOARD_VECTOR_CACHE_VERSION,
    encoding: "float32-le",
    language,
    wordSet,
    wordsSha256: sha256(
      Buffer.from(JSON.stringify(words), "utf8"),
    ),
    wordCount: words.length,
    model: manifest.model,
    modelRevision: manifest.modelRevision ?? "main",
    taskPrefix: manifest.taskPrefix ?? "",
    dimensions: manifest.dimensions,
    manifestSha256: sha256(manifestBytes),
    centeringMethod: manifest.centering?.method ?? null,
    centeringMeanSha256: sha256(
      Buffer.from(
        JSON.stringify(manifest.centering?.mean ?? null),
        "utf8",
      ),
    ),
  };
  return {
    key: sha256(Buffer.from(stableJson(descriptor), "utf8")),
    descriptor,
  };
}

export async function loadOrCreateBoardVectors({
  cacheDirectory,
  identity,
  create,
}) {
  const metadataPath = resolve(
    cacheDirectory,
    `${identity.key}.json`,
  );
  const vectorsPath = resolve(
    cacheDirectory,
    `${identity.key}.f32`,
  );
  const cached = await readCachedVectors({
    identity,
    metadataPath,
    vectorsPath,
  });
  if (cached) {
    return {
      cache: "hit",
      vectors: cached,
      metadataPath,
      vectorsPath,
    };
  }

  const vectors = await create();
  validateVectors(vectors, identity.descriptor);
  const bytes = encodeVectors(vectors, identity.descriptor.dimensions);
  const metadata = {
    ...identity.descriptor,
    key: identity.key,
    vectorSha256: sha256(bytes),
  };
  await mkdir(cacheDirectory, { recursive: true });
  await atomicWrite(
    vectorsPath,
    bytes,
  );
  await atomicWrite(
    metadataPath,
    Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
  );
  return {
    cache: "miss",
    vectors,
    metadataPath,
    vectorsPath,
  };
}

async function readCachedVectors({
  identity,
  metadataPath,
  vectorsPath,
}) {
  try {
    const [metadataBytes, vectorBytes] = await Promise.all([
      readFile(metadataPath),
      readFile(vectorsPath),
    ]);
    const metadata = JSON.parse(metadataBytes.toString("utf8"));
    if (
      metadata.key !== identity.key ||
      metadata.cacheVersion !== BOARD_VECTOR_CACHE_VERSION ||
      metadata.vectorSha256 !== sha256(vectorBytes) ||
      stableJson(stripRuntimeMetadata(metadata)) !==
        stableJson(identity.descriptor)
    ) {
      return null;
    }
    return decodeVectors(
      vectorBytes,
      identity.descriptor.wordCount,
      identity.descriptor.dimensions,
    );
  } catch (error) {
    if (
      error?.code === "ENOENT" ||
      error instanceof SyntaxError ||
      error instanceof RangeError
    ) {
      return null;
    }
    throw error;
  }
}

function stripRuntimeMetadata(metadata) {
  const { key: _key, vectorSha256: _vectorSha256, ...descriptor } =
    metadata;
  return descriptor;
}

function validateVectors(vectors, descriptor) {
  if (
    !Array.isArray(vectors) ||
    vectors.length !== descriptor.wordCount ||
    vectors.some(
      (vector) =>
        !(vector instanceof Float32Array) ||
        vector.length !== descriptor.dimensions,
    )
  ) {
    throw new Error(
      "Generated board vectors do not match the cache identity.",
    );
  }
}

function encodeVectors(vectors, dimensions) {
  const bytes = Buffer.allocUnsafe(
    vectors.length * dimensions * Float32Array.BYTES_PER_ELEMENT,
  );
  let offset = 0;
  for (const vector of vectors) {
    for (const value of vector) {
      bytes.writeFloatLE(value, offset);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
  }
  return bytes;
}

function decodeVectors(bytes, wordCount, dimensions) {
  const expectedBytes =
    wordCount * dimensions * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.length !== expectedBytes) {
    throw new RangeError(
      `Board-vector cache has ${bytes.length} bytes, expected ${expectedBytes}.`,
    );
  }
  return Array.from({ length: wordCount }, (_, row) => {
    const vector = new Float32Array(dimensions);
    for (let column = 0; column < dimensions; column += 1) {
      vector[column] = bytes.readFloatLE(
        (row * dimensions + column) *
          Float32Array.BYTES_PER_ELEMENT,
      );
    }
    return vector;
  });
}

async function atomicWrite(path, bytes) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, path);
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
