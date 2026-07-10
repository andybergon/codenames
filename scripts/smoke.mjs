import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hydrateClueIndex } from "../src/clue-index.js";
import {
  analyzeEmbeddedBoard,
  applyDangerPenalty,
  calculateBoardMetrics,
} from "../src/model.js";
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
const boardWithDoneCards = DEFAULT_BOARD.map((card, index) => ({
  ...card,
  done: index === 0 || index === 9,
}));
const doneResult = analyzeEmbeddedBoard(boardWithDoneCards, boardVectors, clueIndex, { limit: 8 });
const redBoard = DEFAULT_BOARD.map((card) => ({
  ...card,
  team: card.team === "friendly" ? "enemy" : card.team === "enemy" ? "friendly" : card.team,
}));
const redResult = analyzeEmbeddedBoard(redBoard, boardVectors, clueIndex, { limit: 8 });
const boardMetrics = calculateBoardMetrics(result, redResult);

assert.ok(result.summary.friendlyTotal >= 8);
assert.ok(result.summary.candidateTotal >= 2_900);
assert.ok(result.safe.length >= 1, "expected at least one safe clue");
assert.ok(result.stretch.length >= 1, "expected at least one stretch clue");
assert.ok(result.safe.every((suggestion) => suggestion.number >= 1 && suggestion.number <= 3));
assert.ok(result.stretch.every((suggestion) => suggestion.number >= 4));
assert.deepEqual(result.suggestions, [...result.safe, ...result.stretch]);
const targetSizes = new Set(result.suggestions.map((suggestion) => suggestion.number));
assert.ok([1, 2, 3, 4].every((size) => targetSizes.has(size)));
assert.ok(Math.max(...targetSizes) <= 9);
assert.equal(doneResult.summary.friendlyTotal, result.summary.friendlyTotal - 1);
assert.ok(
  doneResult.suggestions.every((suggestion) =>
    suggestion.targets.every((target) => target.word !== "MOON"),
  ),
);
assert.ok(
  doneResult.suggestions.every((suggestion) => suggestion.closestDanger.word !== "MARS"),
);
assert.ok(boardMetrics.complexity >= 0 && boardMetrics.complexity <= 100);
assert.ok(boardMetrics.blueEase >= 0 && boardMetrics.blueEase <= 100);
assert.ok(boardMetrics.redEase >= 0 && boardMetrics.redEase <= 100);
assert.equal(boardMetrics.edge, boardMetrics.blueEase - boardMetrics.redEase);

console.log(
  `Smoke ok: ${result.safe.length} safe, ${result.stretch.length} stretch, ${result.summary.candidateTotal} candidates, complexity ${boardMetrics.complexity}, edge ${boardMetrics.edge}`,
);
