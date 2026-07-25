import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUE_BANK, WORD_SET, getWordsForSet } from "../src/word-data.js";
import { buildClueCandidates } from "./clue-candidates.mjs";
import { loadHumanEmbeddingBenchmark } from "./human-embedding-benchmark.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORDS_PATH = resolve(ROOT, "scripts/generated/clue-words.json");
const CENTERING_COUNT = 30_000;

const outputDirectory = resolve(
  ROOT,
  optionValue(process.argv.slice(2), "--output"),
);
const wordSource = JSON.parse(await readFile(WORDS_PATH, "utf8"));
const clueCandidates = buildClueCandidates(
  wordSource.words,
  CLUE_BANK,
  CENTERING_COUNT,
);
if (clueCandidates.length < CENTERING_COUNT) {
  throw new Error(
    `Need ${CENTERING_COUNT} centering candidates, found ${clueCandidates.length}.`,
  );
}
const boardWords = [
  ...new Set([
    ...getWordsForSet(WORD_SET.OFFICIAL),
    ...getWordsForSet(WORD_SET.EXTENDED),
  ]),
];
const benchmark = await loadHumanEmbeddingBenchmark(ROOT);
const clueCorpus = clueCandidates
  .slice(0, CENTERING_COUNT)
  .map(({ word }) => word);
const terms = [
  ...new Set([...clueCorpus, ...boardWords, ...benchmark.terms]),
];
const inputHash = createHash("sha256")
  .update(JSON.stringify(terms))
  .digest("hex");

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "terms.json"),
  `${JSON.stringify(
    {
      version: 1,
      inputHash,
      terms,
      clueCorpus,
      clueCandidates: clueCandidates.map(({ word, zipf }) => ({
        word,
        zipf,
      })),
      boardWords,
      humanTerms: benchmark.terms,
      vocabulary: {
        source: wordSource.source,
        sourceVersion: wordSource.sourceVersion,
        language: wordSource.language,
        filters: wordSource.filters,
        wordnetCount: wordSource.wordnetCount,
        fallbackCount: wordSource.fallbackCount,
        curatedSeedCount: CLUE_BANK.length,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Prepared ${terms.length.toLocaleString("en-US")} unique terms in ${outputDirectory}.`,
);

function optionValue(args, name) {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value) throw new Error(`${name} is required.`);
  return value;
}
