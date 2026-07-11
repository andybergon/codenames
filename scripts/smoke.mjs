import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  createSampleBoardState,
  decodeBoardParam,
  encodeBoardParam,
} from "../src/board-share.js";
import { hydrateClueIndex } from "../src/clue-index.js";
import {
  SIDE,
  applySuggestionTurn,
  applySuggestionToBoard,
  boardForSide,
  boardTeamFromPerspective,
  otherSide,
  remainingCardsForSide,
  winningSide,
} from "../src/gameplay.js";
import {
  analyzeEmbeddedBoard,
  applyDangerPenalty,
  calculateBoardMetrics,
} from "../src/model.js";
import {
  DEFAULT_BOARD,
  EXTENDED_WORDS,
  LEGACY_WORD_BANK,
  OFFICIAL_WORDS,
  WORD_SET,
} from "../src/word-data.js";

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
assert.ok(
  result.suggestions.every((suggestion) =>
    suggestion.targets.every((target) => Number.isInteger(target.layoutId)),
  ),
);
assert.ok(boardMetrics.complexity >= 0 && boardMetrics.complexity <= 100);
assert.ok(boardMetrics.blueEase >= 0 && boardMetrics.blueEase <= 100);
assert.ok(boardMetrics.redEase >= 0 && boardMetrics.redEase <= 100);
assert.equal(boardMetrics.edge, boardMetrics.blueEase - boardMetrics.redEase);

assert.equal(otherSide(SIDE.BLUE), SIDE.RED);
assert.equal(boardForSide(DEFAULT_BOARD, SIDE.RED)[0].team, "enemy");
assert.equal(boardForSide(DEFAULT_BOARD, SIDE.RED)[9].team, "friendly");
assert.equal(boardTeamFromPerspective("enemy", SIDE.RED), "friendly");
assert.equal(remainingCardsForSide(DEFAULT_BOARD, SIDE.BLUE), 9);
assert.equal(remainingCardsForSide(DEFAULT_BOARD, SIDE.RED), 8);
const appliedSuggestion = {
  targets: [
    { layoutId: 0 },
    { layoutId: 1 },
  ],
};
const appliedBoard = applySuggestionToBoard(
  DEFAULT_BOARD.map((card, layoutId) => ({ ...card, layoutId, done: false })),
  appliedSuggestion,
);
assert.deepEqual(appliedBoard.appliedLayoutIds, [0, 1]);
assert.ok(appliedBoard.cards[0].done && appliedBoard.cards[1].done);
assert.equal(DEFAULT_BOARD[0].done, undefined);
assert.equal(winningSide(appliedBoard.cards), null);
const autoTurn = applySuggestionTurn(
  DEFAULT_BOARD.map((card, layoutId) => ({ ...card, layoutId, done: false })),
  appliedSuggestion,
  SIDE.BLUE,
);
assert.equal(autoTurn.nextSide, SIDE.RED);
const manualTurn = applySuggestionTurn(
  DEFAULT_BOARD.map((card, layoutId) => ({ ...card, layoutId, done: false })),
  appliedSuggestion,
  SIDE.BLUE,
  false,
);
assert.equal(manualTurn.nextSide, SIDE.BLUE);
const winningTurn = applySuggestionTurn(
  DEFAULT_BOARD.map((card, layoutId) => ({
    ...card,
    layoutId,
    done: card.team === "friendly" && layoutId !== 0,
  })),
  { targets: [{ layoutId: 0 }] },
  SIDE.BLUE,
);
assert.equal(winningTurn.winner, SIDE.BLUE);
assert.equal(winningTurn.nextSide, SIDE.BLUE);

const sharedSeed = "AQIDBAUGBwg";
const generatedBoard = createGeneratedBoardState(sharedSeed, BOARD_ORDER.RANDOM);
const repeatedGeneratedBoard = createGeneratedBoardState(sharedSeed, BOARD_ORDER.RANDOM);
assert.deepEqual(generatedBoard, repeatedGeneratedBoard);
assert.equal(OFFICIAL_WORDS.length, 400);
assert.equal(new Set(OFFICIAL_WORDS).size, 400);
assert.equal(
  createHash("sha256").update(OFFICIAL_WORDS.join("\n")).digest("hex"),
  "1bfb51f84543c5253f838e678b683dad56c7251ae5693428311faa378d5e8d54",
);
assert.ok(
  ["ICE CREAM", "LOCH NESS", "NEW YORK", "SCUBA DIVER"].every((word) =>
    OFFICIAL_WORDS.includes(word),
  ),
);
assert.ok(!OFFICIAL_WORDS.includes("CASTLE"));
assert.equal(EXTENDED_WORDS.length, 407);
assert.equal(new Set(EXTENDED_WORDS).size, 407);
assert.equal(LEGACY_WORD_BANK.length, 366);
assert.ok(generatedBoard.cards.every((card) => OFFICIAL_WORDS.includes(card.word)));
assert.equal(generatedBoard.wordSet, WORD_SET.OFFICIAL);

const extendedBoard = createGeneratedBoardState(
  sharedSeed,
  BOARD_ORDER.RANDOM,
  WORD_SET.EXTENDED,
);
assert.equal(extendedBoard.wordSet, WORD_SET.EXTENDED);
assert.ok(extendedBoard.cards.every((card) => EXTENDED_WORDS.includes(card.word)));

const seedCode = encodeBoardParam(generatedBoard);
assert.equal(seedCode, `2s${sharedSeed}or`);
assert.equal(seedCode.length, 15);
assert.deepEqual(decodeBoardParam(seedCode), generatedBoard);
assert.equal(encodeBoardParam(extendedBoard), `2s${sharedSeed}xr`);
assert.equal(encodeBoardParam(createSampleBoardState()), null);
assert.equal(
  encodeBoardParam(createSampleBoardState(BOARD_ORDER.RANDOM)),
  "1pr",
);

const legacySeedCode = `1s${sharedSeed}r`;
const legacyBoard = decodeBoardParam(legacySeedCode);
assert.deepEqual(
  legacyBoard.cards.slice(0, 3).map((card) => card.word),
  ["HOOD", "CRASH", "PANTS"],
);
assert.equal(legacyBoard.source.type, "legacy-seed");
assert.equal(encodeBoardParam(legacyBoard), legacySeedCode);

const legacyExplicitBoard = decodeBoardParam(
  "1e_8AC0NVU1RPTSBXT1JESUN4tgZiFEOBQOMOqH2DpyWekFjqJUMQdnPSOLcOKQQe1pMesQ3mVEKWeBuHDZJRBAA",
);
assert.equal(legacyExplicitBoard.cards[0].word, "CUSTOM WORD");
assert.equal(legacyExplicitBoard.cards[0].team, "enemy");
assert.equal(legacyExplicitBoard.wordSet, WORD_SET.EXTENDED);

const customizedBoard = structuredClone(generatedBoard);
customizedBoard.cards[0].word = "CUSTOM WORD";
customizedBoard.cards[0].team = "enemy";
customizedBoard.cards[0].done = true;
customizedBoard.source = { type: "explicit" };
const explicitCode = encodeBoardParam(customizedBoard);
const decodedCustomBoard = decodeBoardParam(explicitCode);
assert.ok(explicitCode.startsWith("2eo"));
assert.equal(decodedCustomBoard.cards[0].word, "CUSTOM WORD");
assert.equal(decodedCustomBoard.cards[0].team, "enemy");
assert.equal(decodedCustomBoard.cards[0].done, false);
assert.deepEqual(decodedCustomBoard.randomLayoutOrder, customizedBoard.randomLayoutOrder);
assert.equal(decodedCustomBoard.order, customizedBoard.order);
assert.equal(decodedCustomBoard.wordSet, WORD_SET.OFFICIAL);
assert.throws(() => decodeBoardParam("not-a-board"), /Unsupported board code/);

console.log(
  `Smoke ok: ${result.safe.length} safe, ${result.stretch.length} stretch, ${result.summary.candidateTotal} candidates, complexity ${boardMetrics.complexity}, edge ${boardMetrics.edge}`,
);
