import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hydrateClueIndex } from "../src/clue-index.js";
import { analyzeEmbeddedBoard, applyDangerPenalty } from "../src/model.js";
import { DEFAULT_BOARD } from "../src/word-data.js";

const rawIndex = JSON.parse(await readFile("public/data/clue-embeddings.json", "utf8"));
const fixture = JSON.parse(
  await readFile("scripts/generated/sample-board-embeddings.json", "utf8"),
);
const clueIndex = hydrateClueIndex(rawIndex);
const boardVectors = fixture.vectors.map((vector) => Float32Array.from(vector));

assert.equal(clueIndex.model, fixture.model);
assert.equal(clueIndex.dimensions, 384);
assert.ok(clueIndex.clues.length >= 3_000);
assert.deepEqual(
  fixture.words,
  DEFAULT_BOARD.map((card) => card.word.toLowerCase()),
);

assert.ok(applyDangerPenalty(0.4, "enemy") > applyDangerPenalty(0.4, "neutral"));
assert.ok(applyDangerPenalty(0.4, "assassin") > applyDangerPenalty(0.4, "enemy"));

const result = analyzeEmbeddedBoard(DEFAULT_BOARD, boardVectors, clueIndex, { limit: 8 });

assert.ok(result.summary.friendlyTotal >= 8);
assert.ok(result.summary.candidateTotal >= 2_900);
assert.ok(result.safe.length >= 1, "expected at least one safe clue");
assert.ok(result.stretch.length >= 1, "expected at least one stretch clue");
assert.ok(result.safe.every((suggestion) => suggestion.number >= 2 && suggestion.number <= 3));
assert.ok(result.stretch.every((suggestion) => suggestion.number >= 3));

console.log(
  `Smoke ok: ${result.safe.length} safe, ${result.stretch.length} stretch, ${result.summary.candidateTotal} candidates, best margin ${result.summary.bestMargin.toFixed(2)}`,
);
