export async function loadClueIndex(url = "/data/clue-embeddings.json") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load clue index (${response.status})`);
  }

  return hydrateClueIndex(await response.json());
}

export function hydrateClueIndex(rawIndex) {
  const vectors = decodeBase64(rawIndex.vectors);
  const expectedValues = rawIndex.clues.length * rawIndex.dimensions;

  if (vectors.length !== expectedValues) {
    throw new Error(`Clue index is corrupt: expected ${expectedValues} values, got ${vectors.length}`);
  }

  return {
    ...rawIndex,
    vectors,
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
