import { createJsonLoader } from "../clue-index.js";
import { normalizeConceptTerm } from "./concept-ranking.js";

const fetchJson = createJsonLoader();
const conceptPromises = new Map();

export async function loadConceptDefinitions(
  clue,
  { baseUrl = defaultBaseUrl(), onRetry } = {},
) {
  const normalizedClue = normalizeConceptTerm(clue);
  const shard = shardForTerm(normalizedClue);
  const [board, clueEntries] = await Promise.all([
    loadConceptFile(new URL("board.json", baseUrl), {
      label: "board concept data",
      onRetry,
    }),
    loadConceptFile(new URL(`${shard}.json`, baseUrl), {
      label: "clue concept data",
      onRetry,
    }),
  ]);
  return new Map([
    ...Object.entries(board.entries ?? {}),
    ...Object.entries(clueEntries.entries ?? {}),
  ]);
}

function loadConceptFile(url, options) {
  const key = url.href;
  if (!conceptPromises.has(key)) {
    const promise = fetchJson(key, options).catch((error) => {
      conceptPromises.delete(key);
      throw error;
    });
    conceptPromises.set(key, promise);
  }
  return conceptPromises.get(key);
}

function defaultBaseUrl() {
  return new URL("/data/concepts/", location.origin);
}

function shardForTerm(term) {
  return /^[a-z]/u.test(term) ? term[0] : "other";
}
