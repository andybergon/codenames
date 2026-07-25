const jsonPromises = new Map();

export async function loadShardedClueIndex(manifestUrl, candidateCount) {
  const manifest = await loadClueIndexManifest(manifestUrl);
  const selectedShards = manifest.shards.filter((shard) => shard.start < candidateCount);
  const shardResponses = await Promise.all(selectedShards.map((shard) =>
    fetchJson(new URL(shard.file, new URL(manifestUrl, location.origin)).href, "clue shard"),
  ));
  return hydrateClueShards(manifest, shardResponses, candidateCount);
}

export function loadClueIndexManifest(manifestUrl) {
  return fetchJson(manifestUrl, "clue manifest");
}

function fetchJson(url, label) {
  if (!jsonPromises.has(url)) {
    jsonPromises.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${label} (${response.status})`);
      return response.json();
    }).catch((error) => {
      jsonPromises.delete(url);
      throw error;
    }));
  }
  return jsonPromises.get(url);
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
