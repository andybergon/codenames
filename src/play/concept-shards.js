export const CONCEPT_SHARD_COUNT = 256;

export function conceptShardForTerm(term) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < term.length; index += 1) {
    hash ^= term.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0)
    .toString(16)
    .slice(-2)
    .padStart(2, "0");
}
