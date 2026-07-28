import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONCEPT_SHARD_COUNT,
  conceptShardForTerm,
} from "../src/play/concept-shards.js";
import { CLUE_BANK, EXTENDED_WORDS } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARCHIVE = resolve(
  ROOT,
  ".cache/nltk_data/corpora/wordnet.zip",
);
const ARCHIVE_PATH = resolve(
  process.env.WORDNET_ARCHIVE ?? DEFAULT_ARCHIVE,
);
const OUTPUT_DIRECTORY = resolve(ROOT, "public/data/concepts");
const CLUE_WORDS_PATH = resolve(
  ROOT,
  "scripts/generated/clue-words.json",
);
const EXPECTED_SHA256 =
  "cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59";
const PARTS_OF_SPEECH = [
  { file: "noun", limit: 4 },
  { file: "verb", limit: 2 },
  { file: "adj", limit: 1 },
  { file: "adv", limit: 1 },
];
const MAX_DEFINITIONS = 6;

const archive = await readFile(ARCHIVE_PATH);
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
if (archiveSha256 !== EXPECTED_SHA256) {
  throw new Error(
    `WordNet archive SHA-256 mismatch: expected ${EXPECTED_SHA256}, got ${archiveSha256}`,
  );
}

const clueWordSource = JSON.parse(
  await readFile(CLUE_WORDS_PATH, "utf8"),
);
const selectableClues = buildClueCandidates(
  clueWordSource.words,
  CLUE_BANK,
  100_000,
).map(({ word }) => normalizeTerm(word));
const includedTerms = new Set([
  ...selectableClues,
  ...EXTENDED_WORDS.map((word) => normalizeTerm(word)),
]);
const entries = new Map();
for (const part of PARTS_OF_SPEECH) {
  const index = parseIndex(
    readArchiveEntry(`wordnet/index.${part.file}`),
  );
  const definitions = parseDefinitions(
    readArchiveEntry(`wordnet/data.${part.file}`),
  );
  for (const [lemma, offsets] of index) {
    const term = normalizeTerm(lemma);
    if (!term || !includedTerms.has(term)) continue;
    const current = entries.get(term) ?? [];
    for (const offset of offsets.slice(0, part.limit)) {
      const definition = definitions.get(offset);
      if (
        definition &&
        !current.includes(definition) &&
        current.length < MAX_DEFINITIONS
      ) {
        current.push(definition);
      }
    }
    if (current.length > 0) {
      entries.set(term, current);
    }
  }
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await clearGeneratedShards();
const boardEntries = Object.fromEntries(
  EXTENDED_WORDS.map((word) => normalizeTerm(word))
    .filter((word) => entries.has(word))
    .map((word) => [word, entries.get(word)]),
);
await writeJson(resolve(OUTPUT_DIRECTORY, "board.json"), {
  entries: boardEntries,
});

const shardEntries = new Map();
for (const [term, definitions] of entries) {
  const shard = conceptShardForTerm(term);
  if (!shardEntries.has(shard)) {
    shardEntries.set(shard, {});
  }
  shardEntries.get(shard)[term] = definitions;
}

const shards = {};
for (const [shard, shardPayload] of [...shardEntries].sort()) {
  const file = `${shard}.json`;
  const path = resolve(OUTPUT_DIRECTORY, file);
  await writeJson(path, { entries: shardPayload });
  shards[shard] = {
    file,
    entries: Object.keys(shardPayload).length,
    bytes: (await stat(path)).size,
  };
}

await writeJson(resolve(OUTPUT_DIRECTORY, "manifest.json"), {
  version: 2,
  source: {
    name: "Princeton WordNet 3.0",
    archiveSha256,
    license: "WordNet 3.0",
  },
  method:
    "Selectable English clue and board terms with up to six ordered sense definitions per normalized lemma: four noun, two verb, then adjective or adverb when capacity remains. Usage examples are removed. Clue entries use 256 deterministic FNV-1a hash shards.",
  selectableClues: selectableClues.length,
  boardFile: "board.json",
  boardEntries: Object.keys(boardEntries).length,
  entries: entries.size,
  shardStrategy: {
    algorithm: "fnv1a-32",
    buckets: CONCEPT_SHARD_COUNT,
  },
  shards,
});

console.log(
  `Wrote ${entries.size} WordNet concept entries and ${Object.keys(boardEntries).length} English board entries.`,
);

function readArchiveEntry(entry) {
  return execFileSync("unzip", ["-p", ARCHIVE_PATH, entry], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseIndex(raw) {
  const index = new Map();
  for (const line of raw.split(/\r?\n/u)) {
    if (!line || line.startsWith(" ")) continue;
    const fields = line.trim().split(/\s+/u);
    const synsetCount = Number(fields[2]);
    const pointerCount = Number(fields[3]);
    const offsetStart = 6 + pointerCount;
    index.set(
      fields[0],
      fields.slice(offsetStart, offsetStart + synsetCount),
    );
  }
  return index;
}

function parseDefinitions(raw) {
  const definitions = new Map();
  for (const line of raw.split(/\r?\n/u)) {
    if (!/^\d{8}\s/u.test(line)) continue;
    const separator = line.indexOf(" | ");
    if (separator < 0) continue;
    const definition = line
      .slice(separator + 3)
      .replace(/;\s*"[\s\S]*$/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (definition) {
      definitions.set(line.slice(0, 8), definition);
    }
  }
  return definitions;
}

function normalizeTerm(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/_/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

async function clearGeneratedShards() {
  const retained = new Set(["board.json", "manifest.json"]);
  const files = await readdir(OUTPUT_DIRECTORY);
  await Promise.all(
    files
      .filter(
        (file) => file.endsWith(".json") && !retained.has(file),
      )
      .map((file) => unlink(resolve(OUTPUT_DIRECTORY, file))),
  );
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}
