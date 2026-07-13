import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUE_BANK } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(ROOT, ".cache/evaluations/cultural-codes");
const CULTURAL_URL = "https://raw.githubusercontent.com/SALT-NLP/codenames/9bf4550e681f7a42ac406439b00b0c717f59f13c/data/clue_generation_task/all.csv";
const CONNECTOR_URL = "https://raw.githubusercontent.com/hawkrobe/lexical-search-and-pragmatics/8d824794d623adf4dd19cbff13d987d539b19c5e/data/exp1/cleaned.csv";
const wordSource = JSON.parse(await readFile(resolve(ROOT, "scripts/generated/clue-words.json"), "utf8"));
const words = buildClueCandidates(wordSource.words, CLUE_BANK, 100_000).map(({ word }) => word);
const [culturalRaw, connectorRaw] = await Promise.all([
  load(CULTURAL_URL, resolve(CACHE, "clue_generation_task/all.csv")),
  load(CONNECTOR_URL, resolve(CACHE, "connector/cleaned.csv")),
]);
const clues = [
  ...parseCsv(culturalRaw).map((row) => row.output),
  ...parseCsv(connectorRaw).map((row) => row.correctedClue),
].map(normalize).filter(Boolean);
const uniqueClues = [...new Set(clues)];
const results = [3_000, 10_000, 30_000, 100_000].map((candidateCount) => {
  const vocabulary = new Set(words.slice(0, candidateCount));
  const coveredObservations = clues.filter((clue) => vocabulary.has(clue)).length;
  const coveredUniqueClues = uniqueClues.filter((clue) => vocabulary.has(clue)).length;
  return { candidateCount, observations: clues.length, coveredObservations, observationCoverage: round(coveredObservations / clues.length), uniqueClues: uniqueClues.length, coveredUniqueClues, uniqueCoverage: round(coveredUniqueClues / uniqueClues.length) };
});
const report = {
  generatedAt: new Date().toISOString(),
  metric: "Exact normalized single-word human clue presence in the generated candidate prefix. This measures vocabulary coverage, not end-to-end ranking quality.",
  datasets: { culturalCodes: 7_703, connector: 2_250, licenseNote: "Upstream data is fetched to the gitignored cache and not redistributed because neither repository declares a license." },
  results,
};
await writeFile(resolve(ROOT, "scripts/generated/candidate-coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
console.table(results);

async function load(url, path) { try { return await readFile(path, "utf8"); } catch { const response = await fetch(url); if (!response.ok) throw new Error(`Dataset download failed: ${response.status}`); const raw = await response.text(); await mkdir(dirname(path), { recursive: true }); await writeFile(path, raw); return raw; } }
function normalize(value) { return String(value ?? "").toLowerCase().replace(/[^a-z]/gu, ""); }
function round(value) { return Number(value.toFixed(4)); }
function parseCsv(raw) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < raw.length; i += 1) { const c = raw[i]; if (quoted) { if (c === '"' && raw[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c; } else if (c === '"') quoted = true; else if (c === ",") { row.push(field); field = ""; } else if (c === "\n") { row.push(field.replace(/\r$/u, "")); rows.push(row); row = []; field = ""; } else field += c; }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift(); return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}
