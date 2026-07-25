import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  decodeBoardParam,
  encodeBoardParam,
} from "../src/board-share.js";
import { isForbiddenClue, normalizeTerm } from "../src/model.js";
import {
  ITALIAN_EXTENDED_WORDS,
  ITALIAN_WORD_REPORT,
  LANGUAGE,
  ROLE_SEQUENCE,
  WORD_SET,
} from "../src/word-data.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const report = JSON.parse(
  await readFile(
    resolve(ROOT, "scripts/generated/italian-embedding-feasibility.json"),
    "utf8",
  ),
);

assert.match(report.methodology.fixture, /no official Codenames vocabulary/i);
assert.equal(report.results.length, 3);
assert.deepEqual(
  report.results.map(({ id }) => id),
  [
    "bge-small-en",
    "multilingual-e5-small",
    "paraphrase-multilingual-minilm-l12",
  ],
);
assert.ok(
  report.results.every(
    ({ raw, centered }) =>
      raw.semantic.turns === 16 &&
      centered.semantic.turns === 16 &&
      raw.morphology.pairs === 15 &&
      centered.morphology.pairs === 15,
  ),
);
assert.equal(ITALIAN_EXTENDED_WORDS.length, 800);
assert.equal(new Set(ITALIAN_EXTENDED_WORDS).size, 800);
assert.equal(ITALIAN_WORD_REPORT.id, "it:extended-v1");
assert.equal(ITALIAN_WORD_REPORT.license, "CC0 1.0");
assert.match(ITALIAN_WORD_REPORT.method, /not copied from.*official/i);
assert.equal(normalizeTerm("CITTÀ"), "città");
assert.equal(normalizeTerm("CAFFÈ"), "caffè");
assert.equal(normalizeTerm("L’ACQUA"), "l acqua");
assert.equal(
  isForbiddenClue("cani", ["cane"], { language: LANGUAGE.ITALIAN }),
  true,
);
assert.equal(
  isForbiddenClue("citta", ["città"], { language: LANGUAGE.ITALIAN }),
  true,
);
assert.equal(
  isForbiddenClue("attrice", ["attore"], { language: LANGUAGE.ITALIAN }),
  true,
);
assert.equal(
  isForbiddenClue("abbraccia", ["braccio"], {
    language: LANGUAGE.ITALIAN,
  }),
  true,
);
assert.equal(
  isForbiddenClue("scritto", ["scrivere"], { language: LANGUAGE.ITALIAN }),
  true,
);

for (const { term, current } of report.normalizationCases) {
  assert.equal(
    normalizeTerm(term),
    current,
    `Refresh the Italian feasibility report after changing normalization for ${term}`,
  );
}

const cards = Array.from({ length: 25 }, (_, layoutId) => ({
  word: layoutId === 0 ? "CITTÀ" : `PAROLA ${layoutId}`,
  team: ROLE_SEQUENCE[layoutId],
  done: false,
  layoutId,
}));
const randomLayoutOrder = cards.map(({ layoutId }) => layoutId).reverse();
const encoded = encodeBoardParam({
  cards,
  randomLayoutOrder,
  order: BOARD_ORDER.RANDOM,
  source: { type: "explicit", version: "3" },
  wordSet: WORD_SET.OFFICIAL,
});
const decoded = decodeBoardParam(encoded);

assert.equal(decoded.cards[0].word, "CITTÀ");
assert.deepEqual(decoded.randomLayoutOrder, randomLayoutOrder);
assert.equal(decoded.order, BOARD_ORDER.RANDOM);

const italianBoard = createGeneratedBoardState(
  "AQIDBAUGBwg",
  BOARD_ORDER.RANDOM,
  WORD_SET.EXTENDED,
  LANGUAGE.ITALIAN,
);
const italianSeedCode = encodeBoardParam(italianBoard);
assert.equal(italianSeedCode, "4sAQIDBAUGBwgi1xr");
assert.deepEqual(decodeBoardParam(italianSeedCode), italianBoard);
assert.ok(
  italianBoard.cards.every(({ word }) => ITALIAN_EXTENDED_WORDS.includes(word)),
);
assert.equal(italianBoard.language, LANGUAGE.ITALIAN);

const italianExplicit = structuredClone(italianBoard);
italianExplicit.cards[0].word = "CITTÀ";
italianExplicit.source = { type: "explicit", version: "4" };
const italianExplicitCode = encodeBoardParam(italianExplicit);
assert.ok(italianExplicitCode.startsWith("4ei1x"));
assert.equal(
  decodeBoardParam(italianExplicitCode).cards[0].word,
  "CITTÀ",
);
assert.throws(
  () => decodeBoardParam("4sAQIDBAUGBwgi2xr"),
  /Unsupported board code/,
);
assert.throws(
  () =>
    createGeneratedBoardState(
      "AQIDBAUGBwg",
      BOARD_ORDER.RANDOM,
      WORD_SET.OFFICIAL,
      LANGUAGE.ITALIAN,
    ),
  /Official words are not available/,
);

const manifest = JSON.parse(
  await readFile(
    resolve(
      ROOT,
      "public/data/model-lab/it/multilingual-e5-small/manifest.json",
    ),
    "utf8",
  ),
);
assert.equal(manifest.language, LANGUAGE.ITALIAN);
assert.equal(manifest.wordSet, "it:extended-v1");
assert.equal(manifest.modelRevision.length, 40);
assert.equal(manifest.taskPrefix, "query: ");
assert.equal(manifest.centering.count, 30_000);
assert.deepEqual(
  manifest.shards.map(({ start, end }) => [start, end]),
  [
    [0, 3_000],
    [3_000, 10_000],
  ],
);

console.log("Italian support implementation smoke checks passed");
