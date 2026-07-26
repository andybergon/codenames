import { createSingleFlightRetryLoader } from "./load-retry.js";

const fetchJson = createJsonLoader();

export async function loadShardedClueIndex(
  manifestUrl,
  candidateCount,
  options = {},
) {
  const manifest = await loadClueIndexManifest(manifestUrl, options);
  const selectedShards = manifest.shards.filter((shard) => shard.start < candidateCount);
  const shardResponses = await Promise.all(selectedShards.map((shard) =>
    fetchJson(
      new URL(shard.file, new URL(manifestUrl, location.origin)).href,
      { ...options, label: "clue shard" },
    ),
  ));
  return hydrateClueShards(manifest, shardResponses, candidateCount);
}

export function loadClueIndexManifest(manifestUrl, options = {}) {
  return fetchJson(manifestUrl, { ...options, label: "clue manifest" });
}

export function createJsonLoader(fetchImplementation = fetch, retryOptions = {}) {
  const loadJson = createSingleFlightRetryLoader(
    async (url, options) => {
      const response = await fetchImplementation(url);
      if (!response.ok) {
        const error = new Error(
          `Could not load ${options.label} (${response.status})`,
        );
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    retryOptions,
  );

  return (url, options = {}) =>
    loadJson(url, {
      ...options,
      onRetry: options.onRetry
        ? (event) => options.onRetry({ ...event, resource: "index" })
        : undefined,
    });
}

export function hydrateClueShards(manifest, shardResponses, candidateCount) {
  for (const shard of shardResponses) {
    if (shard.clues.length !== shard.frequencies.length) {
      throw new Error("Clue index is corrupt: clue and frequency counts differ");
    }
  }
  const clues = shardResponses.flatMap((shard) => shard.clues).slice(0, candidateCount);
  const frequencies = shardResponses.flatMap((shard) => shard.frequencies).slice(0, candidateCount);
  const values = shardResponses.map((shard) => decodeBase64(shard.vectors));
  const vectorLength = clues.length * manifest.dimensions;
  const vectors = new Int8Array(vectorLength);
  let offset = 0;
  for (const value of values) {
    const remaining = vectorLength - offset;
    if (remaining <= 0) break;
    vectors.set(value.subarray(0, remaining), offset);
    offset += Math.min(value.length, remaining);
  }
  if (offset !== vectorLength) {
    throw new Error(`Clue index is corrupt: expected ${vectorLength} values, got ${offset}`);
  }
  return {
    ...manifest,
    clues,
    frequencies,
    vectors,
    loadedBytes: manifest.shards.filter((shard) => shard.start < candidateCount).reduce((total, shard) => total + shard.bytes, 0),
  };
}

function decodeBase64(encoded) {
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Int8Array(bytes.buffer);
}
