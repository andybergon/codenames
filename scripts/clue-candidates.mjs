export function buildClueCandidates(frequencyWords, seedWords, limit = 30_000) {
  const seen = new Set();
  const merged = [];
  for (const seed of seedWords) {
    const word = seed.toLowerCase();
    if (/^[a-z]+$/u.test(word) && !seen.has(word)) {
      seen.add(word);
      merged.push({ word, zipf: 3.4 });
    }
  }
  for (const candidate of frequencyWords) {
    if (!seen.has(candidate.word)) {
      seen.add(candidate.word);
      merged.push(candidate);
    }
    if (merged.length === limit) break;
  }
  return merged;
}
