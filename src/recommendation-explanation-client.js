const CACHE_STORAGE_KEY = "codenames-semantic-explanations-p4-gpt-5.4-nano";
const MAX_CACHE_ENTRIES = 128;
const explanationCache = loadStoredCache();

export function recommendationExplanationKey(suggestion) {
  return [
    suggestion.clue,
    ...suggestion.targets.map(({ word }) => word),
  ]
    .map((value) => value.trim().toUpperCase())
    .join("|");
}

export function cachedSemanticExplanation(suggestion) {
  return explanationCache.get(recommendationExplanationKey(suggestion)) ?? null;
}

export async function loadSemanticExplanations(
  suggestions,
  { fetchImpl = fetch, signal } = {},
) {
  const results = new Map();
  const missing = [];

  for (const suggestion of suggestions.slice(0, 15)) {
    const key = recommendationExplanationKey(suggestion);
    const cached = explanationCache.get(key);
    if (cached) {
      results.set(key, cached);
    } else {
      missing.push({
        key,
        clue: suggestion.clue,
        targets: suggestion.targets.map(({ word }) => word),
      });
    }
  }

  if (missing.length === 0) {
    return results;
  }

  const response = await fetchImpl("/api/explain-recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recommendations: missing.map(({ key: _key, ...recommendation }, index) => ({
        id: `recommendation-${index + 1}`,
        ...recommendation,
      })),
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Semantic explanation request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  for (const [index, item] of missing.entries()) {
    const explanation = payload.explanations?.find(
      ({ id }) => id === `recommendation-${index + 1}`,
    )?.explanation;
    if (typeof explanation === "string" && explanation.trim()) {
      const normalized = explanation.replace(/\s+/g, " ").trim();
      explanationCache.set(item.key, normalized);
      results.set(item.key, normalized);
    }
  }
  storeCache();
  return results;
}

function loadStoredCache() {
  try {
    const stored = JSON.parse(globalThis.sessionStorage?.getItem(CACHE_STORAGE_KEY) ?? "[]");
    return new Map(
      Array.isArray(stored)
        ? stored.filter(
            (entry) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              typeof entry[1] === "string",
          )
        : [],
    );
  } catch {
    return new Map();
  }
}

function storeCache() {
  try {
    while (explanationCache.size > MAX_CACHE_ENTRIES) {
      explanationCache.delete(explanationCache.keys().next().value);
    }
    const entries = [...explanationCache.entries()].slice(-MAX_CACHE_ENTRIES);
    globalThis.sessionStorage?.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Session storage is optional. The in-memory cache remains available.
  }
}
