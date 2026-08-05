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
const WORD_RELATIONS_PATH = resolve(
  ROOT,
  "src/generated/english-word-relations.js",
);
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

const wordRelationTerms = new Set(
  EXTENDED_WORDS.map((word) => normalizeTerm(word)),
);
const wordRelations = buildWordRelations(wordRelationTerms);
validateWordRelations(wordRelations);
await writeWordRelations(WORD_RELATIONS_PATH, wordRelations, {
  archiveSha256,
});

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
  `Wrote ${entries.size} WordNet concept entries, ${Object.keys(boardEntries).length} English board entries, and ${wordRelations.size} word-relation entries.`,
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

function buildWordRelations(includedTerms) {
  const synsets = new Map();
  for (const part of PARTS_OF_SPEECH) {
    for (const synset of parseSynsets(
      readArchiveEntry(`wordnet/data.${part.file}`),
    )) {
      synsets.set(synsetKey(synset.partOfSpeech, synset.offset), synset);
    }
  }

  const relations = new Map();
  for (const synset of synsets.values()) {
    for (const pointer of synset.pointers) {
      if (
        !["+", "\\"].includes(pointer.symbol) ||
        pointer.sourceWord === 0 ||
        pointer.targetWord === 0
      ) {
        continue;
      }
      const targetSynset = synsets.get(
        synsetKey(pointer.targetPartOfSpeech, pointer.targetOffset),
      );
      addWordRelation(
        relations,
        includedTerms,
        synset.lemmas[pointer.sourceWord - 1],
        targetSynset?.lemmas[pointer.targetWord - 1],
        { requireMorphologicalShape: true },
      );
    }
  }

  for (const part of PARTS_OF_SPEECH) {
    const exceptions = readArchiveEntry(`wordnet/${part.file}.exc`);
    for (const line of exceptions.split(/\r?\n/u)) {
      const [inflected, ...lemmas] = line.trim().split(/\s+/u);
      for (const lemma of lemmas) {
        addWordRelation(
          relations,
          includedTerms,
          inflected,
          lemma,
        );
      }
    }
  }

  return new Map(
    [...relations]
      .map(([term, related]) => [
        term,
        [...related].sort(compareCodeUnits),
      ])
      .sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

function validateWordRelations(relations) {
  const requiredRelations = [
    ["mouse", "mice"],
    ["rome", "roman"],
    ["spine", "spinal"],
    ["foot", "feet"],
    ["tooth", "teeth"],
  ];
  const excludedRelations = [
    ["eye", "optical"],
    ["tooth", "dental"],
    ["plane", "planet"],
  ];
  const relationCount = [...relations.values()].reduce(
    (total, related) => total + related.length,
    0,
  );
  if (relations.size < 500 || relationCount < 900) {
    throw new Error(
      `WordNet relation output is unexpectedly small: ${relations.size} terms and ${relationCount} relations.`,
    );
  }
  for (const [term, related] of requiredRelations) {
    if (!relations.get(term)?.includes(related)) {
      throw new Error(`Missing required WordNet relation ${term}/${related}.`);
    }
  }
  for (const [term, related] of excludedRelations) {
    if (relations.get(term)?.includes(related)) {
      throw new Error(`Unexpected semantic relation ${term}/${related}.`);
    }
  }
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseSynsets(raw) {
  const synsets = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (!/^\d{8}\s/u.test(line)) continue;
    const definitionSeparator = line.indexOf(" | ");
    const fields = line
      .slice(0, definitionSeparator < 0 ? undefined : definitionSeparator)
      .trim()
      .split(/\s+/u);
    const wordCount = Number.parseInt(fields[3], 16);
    const lemmas = [];
    let cursor = 4;
    for (let index = 0; index < wordCount; index += 1) {
      lemmas.push(fields[cursor]);
      cursor += 2;
    }
    const pointerCount = Number(fields[cursor]);
    cursor += 1;
    const pointers = [];
    for (let index = 0; index < pointerCount; index += 1) {
      const sourceTarget = fields[cursor + 3];
      pointers.push({
        symbol: fields[cursor],
        targetOffset: fields[cursor + 1],
        targetPartOfSpeech: fields[cursor + 2],
        sourceWord: Number.parseInt(sourceTarget.slice(0, 2), 16),
        targetWord: Number.parseInt(sourceTarget.slice(2), 16),
      });
      cursor += 4;
    }
    synsets.push({
      offset: fields[0],
      partOfSpeech: fields[2],
      lemmas,
      pointers,
    });
  }
  return synsets;
}

function synsetKey(partOfSpeech, offset) {
  return `${partOfSpeech === "s" ? "a" : partOfSpeech}:${offset}`;
}

function addWordRelation(
  relations,
  includedTerms,
  leftValue,
  rightValue,
  { requireMorphologicalShape = false } = {},
) {
  const left = normalizeWordRelationTerm(leftValue);
  const right = normalizeWordRelationTerm(rightValue);
  if (
    !left ||
    !right ||
    left === right ||
    (requireMorphologicalShape &&
      !sharesMorphologicalShape(left, right)) ||
    (!includedTerms.has(left) && !includedTerms.has(right))
  ) {
    return;
  }
  if (includedTerms.has(left)) {
    addRelatedTerm(relations, left, right);
  }
  if (includedTerms.has(right)) {
    addRelatedTerm(relations, right, left);
  }
}

function sharesMorphologicalShape(left, right) {
  const minimumLength = Math.min(left.length, right.length);
  const requiredOverlap = Math.max(
    3,
    Math.ceil(minimumLength * 0.6),
  );
  return longestCommonSubstringLength(left, right) >= requiredOverlap;
}

function longestCommonSubstringLength(left, right) {
  let previous = Array(right.length + 1).fill(0);
  let longest = 0;
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = Array(right.length + 1).fill(0);
    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        current[rightIndex] = previous[rightIndex - 1] + 1;
        longest = Math.max(longest, current[rightIndex]);
      }
    }
    previous = current;
  }
  return longest;
}

function normalizeWordRelationTerm(value) {
  const normalized = normalizeTerm(value);
  return /^[a-z]+$/u.test(normalized) ? normalized : "";
}

function addRelatedTerm(relations, term, related) {
  if (!relations.has(term)) {
    relations.set(term, new Set());
  }
  relations.get(term).add(related);
}

async function writeWordRelations(path, relations, { archiveSha256 }) {
  const entries = JSON.stringify([...relations], null, 2);
  const contents = [
    "// Generated by npm run generate:concepts. Do not edit manually.",
    `// Princeton WordNet 3.0 archive SHA-256: ${archiveSha256}`,
    "export const ENGLISH_WORD_RELATIONS = new Map(",
    entries,
    ");",
    "",
  ].join("\n");
  await writeFile(path, contents);
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
