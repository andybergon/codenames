import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_ORDER,
  decodeBoardParam,
  encodeBoardParam,
} from "../src/board-share.js";
import { normalizeTerm } from "../src/model.js";
import { ROLE_SEQUENCE, WORD_SET } from "../src/word-data.js";

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

console.log("Italian support feasibility smoke checks passed");
