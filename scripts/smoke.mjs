import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  createSampleBoardState,
  decodeBoardParam,
  encodeBoardParam,
} from "../src/board-share.js";
import { hydrateClueShards } from "../src/clue-index.js";
import { CANDIDATE_OPTIONS, MODEL_OPTIONS, PICKER_MODEL_OPTIONS } from "../src/model-lab.js";
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
  calibrateSimilarity,
  calculateBoardMetrics,
  isForbiddenClue,
} from "../src/model.js";
import { explainRecommendation } from "../src/recommendation-explanation.js";
import {
  DEFAULT_BOARD,
  EXTENDED_ADDITIONS,
  EXTENDED_V2_WORDS,
  EXTENDED_WORD_REPORT,
  EXTENDED_WORDS,
  LEGACY_WORD_BANK,
  OFFICIAL_WORDS,
  WORD_SET,
} from "../src/word-data.js";

const fixture = JSON.parse(
  await readFile("scripts/generated/sample-board-embeddings.json", "utf8"),
);
const pickerBenchmark = JSON.parse(
  await readFile("scripts/generated/model-picker-benchmark.json", "utf8"),
);
const embeddingReport = JSON.parse(
  await readFile("scripts/generated/embedding-model-comparison.json", "utf8"),
);
const candidateCoverageReport = JSON.parse(
  await readFile("scripts/generated/candidate-coverage.json", "utf8"),
);
const defaultManifest = JSON.parse(await readFile("public/data/model-lab/minilm-l6/manifest.json", "utf8"));
const defaultShard = JSON.parse(await readFile("public/data/model-lab/minilm-l6/clues-0-3000.json", "utf8"));
const clueIndex = hydrateClueShards(defaultManifest, [defaultShard], 3000);
const boardVectors = fixture.vectors.map((vector) => Float32Array.from(vector));

for (const option of MODEL_OPTIONS) {
  const manifest = JSON.parse(await readFile(`public/data/model-lab/${option.id}/manifest.json`, "utf8"));
  const embeddingResult = embeddingReport.results.find(
    ({ model, transform }) => model === option.model && transform === "centered",
  );
  assert.equal(manifest.model, option.model);
  assert.equal(manifest.dimensions, option.dimensions);
  assert.equal(manifest.modelBytes, option.modelBytes);
  assert.equal(embeddingResult?.q8ModelBytes, option.modelBytes);
  assert.equal(embeddingResult?.datasets.culturalCodes.targetRecallAtCount, option.humanQuality);
  assert.equal(embeddingResult?.datasets.culturalCodes.avoidWordRate, option.avoidRate);
  const expectedCuts = PICKER_MODEL_OPTIONS.some(({ id }) => id === option.id)
    ? [[0, 3000], [3000, 10000], [10000, 30000], [30000, 100000]]
    : [[0, 3000], [3000, 10000], [10000, 30000]];
  assert.deepEqual(manifest.shards.map(({ start, end }) => [start, end]), expectedCuts);
  for (const shard of manifest.shards) {
    assert.equal(
      (await stat(`public/data/model-lab/${option.id}/${shard.file}`)).size,
      shard.bytes,
      `manifest byte count differs for ${option.id}/${shard.file}`,
    );
  }
  if (PICKER_MODEL_OPTIONS.some(({ id }) => id === option.id)) {
    for (const candidate of CANDIDATE_OPTIONS) {
      const cumulativeBytes = manifest.shards
        .filter(({ start }) => start < candidate.count)
        .reduce((total, { bytes }) => total + bytes, 0);
      assert.equal(cumulativeBytes, candidate.indexBytes, `index bytes differ at ${candidate.count}`);
    }
  }
  const firstShard = JSON.parse(await readFile(`public/data/model-lab/${option.id}/${manifest.shards[0].file}`, "utf8"));
  const hydrated = hydrateClueShards(manifest, [firstShard], 3000);
  assert.equal(hydrated.clues.length, 3000);
  assert.equal(hydrated.vectors.length, 3000 * option.dimensions);
}
assert.deepEqual(CANDIDATE_OPTIONS.map(({ count }) => count), [3000, 10000, 30000, 100000]);
for (const candidate of CANDIDATE_OPTIONS) {
  const coverageResult = candidateCoverageReport.results.find(
    ({ candidateCount }) => candidateCount === candidate.count,
  );
  assert.equal(
    coverageResult?.observationCoverage,
    candidate.humanClueCoverage,
    `human clue coverage differs at ${candidate.count}`,
  );
}
assert.equal(pickerBenchmark.results.length, PICKER_MODEL_OPTIONS.length * CANDIDATE_OPTIONS.length);
for (const option of PICKER_MODEL_OPTIONS) {
  for (const { count } of CANDIDATE_OPTIONS) {
    const benchmark = pickerBenchmark.results.find(
      ({ modelId, candidateCount }) => modelId === option.id && candidateCount === count,
    );
    assert.ok(benchmark?.medianMs > 0, `missing benchmark for ${option.id}:${count}`);
    assert.equal(benchmark.dimensions, option.dimensions);
  }
}

assert.equal(clueIndex.model, fixture.model);
assert.equal(clueIndex.dimensions, 384);
assert.ok(clueIndex.clues.length >= 3_000);
assert.deepEqual(
  fixture.words,
  DEFAULT_BOARD.map((card) => card.word.toLowerCase()),
);

assert.ok(applyDangerPenalty(0.4, "enemy") > applyDangerPenalty(0.4, "neutral"));
assert.ok(applyDangerPenalty(0.4, "assassin") > applyDangerPenalty(0.4, "enemy"));
assert.equal(
  calibrateSimilarity(0.25, { scale: 2, offset: -0.1 }),
  0.4,
);
assert.equal(isForbiddenClue("pinball", ["pin"]), true);
assert.equal(isForbiddenClue("pinball", ["ball"]), true);
assert.equal(isForbiddenClue("pinball", ["pin", "ball"]), true);
assert.equal(isForbiddenClue("breakdown", ["break"]), true);
assert.equal(isForbiddenClue("horse", ["horseshoe"]), true);
assert.equal(isForbiddenClue("sparrow", ["row"]), false);
assert.equal(isForbiddenClue("lives", ["life"]), true);
assert.equal(isForbiddenClue("life", ["lives"]), true);
assert.equal(isForbiddenClue("stories", ["story"]), true);
assert.equal(isForbiddenClue("knives", ["knife"]), true);
assert.equal(isForbiddenClue("running", ["run"]), true);
assert.equal(isForbiddenClue("stopped", ["stop"]), true);
assert.equal(isForbiddenClue("making", ["make"]), true);
assert.equal(isForbiddenClue("carried", ["carry"]), true);
assert.equal(isForbiddenClue("teach", ["teacher"]), true);
assert.equal(isForbiddenClue("teacher", ["teach"]), true);
assert.equal(isForbiddenClue("write", ["writer"]), true);
assert.equal(isForbiddenClue("run", ["runner"]), true);
assert.equal(isForbiddenClue("planet", ["plane"]), false);

assert.deepEqual(
  explainRecommendation({
    targets: [
      { word: "MOON", sim: 0.61 },
      { word: "STAR", sim: 0.42 },
    ],
    closestDanger: { word: "MARS", team: "enemy", sim: 0.2 },
    margin: 0.14,
  }),
  {
    targetSummary: "Connects MOON and STAR, with STAR as the weakest match.",
    riskSummary:
      "MARS is the closest danger, but the opposing agent stays clearly behind every target.",
  },
);
assert.equal(
  explainRecommendation({
    targets: [
      { word: "MOON", sim: 0.61 },
      { word: "STAR", sim: 0.2 },
    ],
    closestDanger: { word: "MARS", team: "enemy", sim: 0.24 },
    margin: -0.04,
  }).riskSummary,
  "MARS is the main risk: the opposing agent matches at least as strongly as STAR.",
);
assert.equal(
  explainRecommendation({
    targets: [{ word: "MOON", sim: 0.61 }],
    closestDanger: { word: "BOMB", team: "assassin", sim: 0.12 },
    margin: 0.2,
  }).riskSummary,
  "BOMB is the main risk: the assassin is also drawn to this clue.",
);

const morphologyBoard = [
  { word: "LIFE", team: "friendly", layoutId: 0 },
  { word: "BOMB", team: "assassin", layoutId: 1 },
];
const morphologyVectors = [
  Float32Array.from([1, 0]),
  Float32Array.from([0, 1]),
];
const morphologyClueIndex = {
  clues: ["lives", "garden"],
  dimensions: 2,
  frequencies: [5, 5],
  quantization: { scale: 127 },
  vectors: Int8Array.from([127, 0, 127, 0]),
};
const morphologyResult = analyzeEmbeddedBoard(
  morphologyBoard,
  morphologyVectors,
  morphologyClueIndex,
);
assert.equal(morphologyResult.summary.candidateTotal, 1);
assert.ok(morphologyResult.suggestions.every(({ clue }) => clue !== "lives"));

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
assert.equal(EXTENDED_ADDITIONS.length, 400);
assert.equal(
  createHash("sha256").update(EXTENDED_ADDITIONS.join("\n")).digest("hex"),
  "ee535c549c409303a4169b5a802ff170487ada1803f97b9cab0a8d057df2e382",
);
assert.equal(EXTENDED_WORDS.length, 800);
assert.equal(new Set(EXTENDED_WORDS).size, 800);
assert.equal(EXTENDED_V2_WORDS.length, 407);
assert.equal(EXTENDED_WORD_REPORT.totalCount, 800);
assert.ok(EXTENDED_ADDITIONS.every((word) => !OFFICIAL_WORDS.includes(word)));
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
assert.equal(seedCode, `3s${sharedSeed}or`);
assert.equal(seedCode.length, 15);
assert.deepEqual(decodeBoardParam(seedCode), generatedBoard);
assert.equal(encodeBoardParam(extendedBoard), `3s${sharedSeed}xr`);
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

const previousSeedCode = `2s${sharedSeed}xr`;
const previousBoard = decodeBoardParam(previousSeedCode);
assert.ok(previousBoard.cards.every((card) => EXTENDED_V2_WORDS.includes(card.word)));
assert.equal(encodeBoardParam(previousBoard), previousSeedCode);

const legacyExplicitBoard = decodeBoardParam(
  "1e_8AC0NVU1RPTSBXT1JESUN4tgZiFEOBQOMOqH2DpyWekFjqJUMQdnPSOLcOKQQe1pMesQ3mVEKWeBuHDZJRBAA",
);
assert.equal(legacyExplicitBoard.cards[0].word, "CUSTOM WORD");
assert.equal(legacyExplicitBoard.cards[0].team, "enemy");
assert.equal(legacyExplicitBoard.wordSet, WORD_SET.EXTENDED);

const previousExplicitCode = "2ex_8AC0NVU1RPTSBXT1JEUOU4SgiAUDwKOLsyiLEZI-X2lNrCtW3T_kTLiP9kI5UU8KQ2dHjK6q4pYcQAmvaRIAA";
const previousExplicitBoard = decodeBoardParam(previousExplicitCode);
assert.equal(encodeBoardParam(previousExplicitBoard), previousExplicitCode);

const customizedBoard = structuredClone(generatedBoard);
customizedBoard.cards[0].word = "CUSTOM WORD";
customizedBoard.cards[0].team = "enemy";
customizedBoard.cards[0].done = true;
customizedBoard.source = { type: "explicit" };
const explicitCode = encodeBoardParam(customizedBoard);
const decodedCustomBoard = decodeBoardParam(explicitCode);
assert.ok(explicitCode.startsWith("3eo"));
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
