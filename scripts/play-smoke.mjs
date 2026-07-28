import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  createSampleBoardState,
} from "../src/board-share.js";
import { SIDE, remainingCardsForSide } from "../src/gameplay.js";
import {
  EXTENDED_WORDS,
  ITALIAN_EXTENDED_WORDS,
  LANGUAGE,
  OFFICIAL_WORDS,
  WORD_SET,
} from "../src/word-data.js";
import {
  PLAY_CLUE_POLICY,
  chooseBotClue,
  chooseBotGuess,
  createSeededRandom,
  scoreMissedTargetPreference,
  evaluateBotClue,
  evaluateBotGuess,
  scorePlayClue,
  shouldBotTakeAnotherGuess,
} from "../src/play/bots.js";
import {
  maximumConceptBridge,
  scoreOperativeAssociation,
  shouldUseConceptRanking,
} from "../src/play/concept-ranking.js";
import {
  CONCEPT_SHARD_COUNT,
  conceptShardForTerm,
} from "../src/play/concept-shards.js";
import {
  GAME_END_REASON,
  GAME_ORIGIN,
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  canUndoPlayGame,
  createPlayGame,
  differentRandomHumanSeat,
  giveClue,
  guessCard,
  cluesForSide,
  markPlayGameAsDeveloper,
  passTurn,
  publicGameView,
  randomHumanSeat,
  recordCurrentClueDeveloperDiagnostics,
  replayPlayActionStates,
  restorePlayGame,
  undoPlayGame,
  unresolvedIntendedTargetIds,
  replayCompletedClueTurns,
  replayDeveloperClueTurns,
  validateStoredGame,
} from "../src/play/game-state.js";
import {
  decodeCompletedGame,
  decodePlayGame,
  encodeCompletedGame,
  encodePlayGame,
} from "../src/play/game-share.js";
import { savePlaySession } from "../src/play/session-store.js";
import {
  DEFAULT_PLAY_BOT_SETTINGS,
  PLAY_BONUS_POLICY,
  PLAY_CLUE_REPEAT_POLICY,
  PLAY_MISSED_TARGET_TIMING,
  PLAY_OPERATIVE_AGGRESSION,
  PLAY_CONCEPT_RANKING,
  PLAY_OPERATIVE_NOISE,
  normalizePlayBotSettings,
} from "../src/play/settings.js";
import {
  MAX_WORD_HISTORY_BOARDS,
  PLAY_WORD_REUSE_POLICY,
  clearWordReuseHistory,
  createDefaultWordReuseState,
  createPlayBoardWithWordReuse,
  loadWordReuseState,
  normalizeWordReuseState,
  recordBoardWords,
  saveWordReuseState,
  setWordReusePolicy,
  wordReuseStatus,
} from "../src/play/word-reuse.js";
import { ITALIAN_MODEL_ID } from "../src/model-lab.js";

const sample = createSampleBoardState();
const playPolicyBenchmark = JSON.parse(
  await readFile("scripts/generated/play-policy-benchmark.json", "utf8"),
);
const playPolicySummary = await readFile(
  "scripts/generated/play-policy-benchmark.md",
  "utf8",
);
const operativeCrossModelBenchmark = JSON.parse(
  await readFile(
    "scripts/generated/play-operative-aggression-cross-model.json",
    "utf8",
  ),
);
const apiEmbeddingComparison = JSON.parse(
  await readFile(
    "scripts/generated/api-embedding-comparison.json",
    "utf8",
  ),
);
const playFunExperiments = JSON.parse(
  await readFile("scripts/generated/play-fun-experiments.json", "utf8"),
);
const italianPlayBenchmark = JSON.parse(
  await readFile(
    "scripts/generated/italian-play-policy-benchmark.json",
    "utf8",
  ),
);
const italianPlayTransferBenchmark = JSON.parse(
  await readFile(
    "scripts/generated/italian-play-minilm-transfer-benchmark.json",
    "utf8",
  ),
);
const conceptRankingEvaluation = JSON.parse(
  await readFile(
    "scripts/generated/concept-ranking-evaluation.json",
    "utf8",
  ),
);
const conceptManifest = JSON.parse(
  await readFile("public/data/concepts/manifest.json", "utf8"),
);
const joustConceptShard = conceptShardForTerm("joust");
const joustConceptData = JSON.parse(
  await readFile(
    `public/data/concepts/${joustConceptShard}.json`,
    "utf8",
  ),
);
const conceptFullGameComparison = JSON.parse(
  await readFile(
    "scripts/generated/concept-ranking-full-game-comparison.json",
    "utf8",
  ),
);
const concept30kSmokeComparison = JSON.parse(
  await readFile(
    "scripts/generated/concept-ranking-30k-smoke-comparison.json",
    "utf8",
  ),
);
const conceptCrossModelComparison = JSON.parse(
  await readFile(
    "scripts/generated/concept-ranking-cross-model-comparison.json",
    "utf8",
  ),
);
const unrestrictedConceptCrossModelComparison = JSON.parse(
  await readFile(
    "scripts/generated/concept-ranking-unrestricted-cross-model-comparison.json",
    "utf8",
  ),
);
const bridgeRerankerFullGameComparison = JSON.parse(
  await readFile(
    "scripts/generated/bridge-reranker-full-game-comparison.json",
    "utf8",
  ),
);
const bridgeRerankerCrossModelComparison = JSON.parse(
  await readFile(
    "scripts/generated/bridge-reranker-cross-model-comparison.json",
    "utf8",
  ),
);

assert.equal(playPolicyBenchmark.methodology.boardCount, 100);
assert.equal(playPolicyBenchmark.methodology.pairedBoards, true);
assert.equal(playPolicyBenchmark.methodology.candidateCount, 30_000);
assert.equal(playPolicyBenchmark.methodology.funObjective.version, 1);
assert.equal(
  playPolicyBenchmark.methodology.operativeAggression.includes("dynamic"),
  true,
);
assert.equal(
  conceptRankingEvaluation.fixture,
  "JOUST → medieval tournament → MATCH / CROWN / GLOVE / BELT, where PIANO was guessed before those stronger human associations.",
);
assert.equal(conceptManifest.version, 2);
assert.deepEqual(conceptManifest.shardStrategy, {
  algorithm: "fnv1a-32",
  buckets: CONCEPT_SHARD_COUNT,
});
assert.equal(
  Object.keys(conceptManifest.shards).length,
  CONCEPT_SHARD_COUNT,
);
assert.equal(joustConceptShard.length, 2);
assert.ok(joustConceptData.entries.joust.length > 0);
assert.equal(
  Object.values(conceptManifest.shards).reduce(
    (total, shard) => total + shard.entries,
    0,
  ),
  conceptManifest.entries,
);
assert.deepEqual(
  maximumConceptBridge(
    [
      [1, 0],
      [0, 1],
    ],
    [
      [0, 1],
      [1, 0],
    ],
    ["first clue sense", "second clue sense"],
    ["first card sense", "second card sense"],
  ),
  {
    similarity: 1,
    clueSense: "first clue sense",
    cardSense: "second card sense",
  },
);
const evaluatedJoustRanking = conceptRankingEvaluation.models
  .find(({ id }) => id === "bge-small")
  .joust.offsets["0.05"]
  .map(({ word }) => word);
assert.deepEqual(
  new Set(evaluatedJoustRanking.slice(0, 4)),
  new Set(["MATCH", "CROWN", "GLOVE", "BELT"]),
);
assert.equal(evaluatedJoustRanking.at(-1), "PIANO");
assert.equal(conceptRankingEvaluation.version, 4);
assert.equal(
  conceptRankingEvaluation.rerankerEvaluation.paidCostUsd,
  0,
);
assert.equal(
  conceptRankingEvaluation.rerankerEvaluation.directReranker.joust[0]
    .word,
  "PIANO",
);
assert.ok(
  conceptRankingEvaluation.rerankerEvaluation.directReranker.datasets
    .culturalCodes.targetRecallAtCount <
    conceptRankingEvaluation.models.find(
      ({ id }) => id === "bge-small",
    ).guarded["0.05"]["0.2"].culturalCodes.targetRecallAtCount,
);
const rerankedJoust =
  conceptRankingEvaluation.rerankerEvaluation.pipelines[
    "0.04"
  ].joust.map(({ word }) => word);
assert.deepEqual(
  new Set(rerankedJoust.slice(0, 4)),
  new Set(["MATCH", "CROWN", "GLOVE", "BELT"]),
);
assert.equal(rerankedJoust.at(-1), "PIANO");
for (const comparison of [
  bridgeRerankerFullGameComparison,
  bridgeRerankerCrossModelComparison,
]) {
  const metrics = comparison.candidates[0].comparison.metrics;
  for (const metric of Object.values(metrics)) {
    assert.equal(metric.delta.estimate, 0);
  }
}
const productionConceptEvaluation =
  conceptRankingEvaluation.models.find(
    ({ id }) => id === "bge-small",
  );
assert.equal(
  Object.hasOwn(productionConceptEvaluation, "improvementExamples"),
  false,
);
assert.deepEqual(
  productionConceptEvaluation.originalFixtures.map(
    ({ clue }) => clue,
  ),
  ["PALEOGRAPHY", "HERALDRY", "SPECTER", "THESPIAN", "SEANCE"],
);
for (const fixture of productionConceptEvaluation.originalFixtures) {
  assert.equal(fixture.activated, true);
  assert.equal(fixture.directTargetHits, 0);
  assert.equal(fixture.guardedTargetHits, fixture.clueNumber);
}
assert.match(
  conceptRankingEvaluation.source.humanDatasets.licenseNote,
  /not redistributed/,
);
assert.equal(
  conceptFullGameComparison.candidates[0].promotion
    .playSafetyPassed,
  true,
);
assert.equal(
  concept30kSmokeComparison.baseline.methodology.candidateCount,
  30_000,
);
assert.equal(
  concept30kSmokeComparison.candidates[0].comparison.pairedBoards,
  20,
);
assert.equal(
  concept30kSmokeComparison.candidates[0].promotion
    .playSafetyPassed,
  true,
);
for (const metric of Object.values(
  concept30kSmokeComparison.candidates[0].comparison.metrics,
)) {
  assert.equal(metric.delta.estimate, 0);
}
assert.equal(
  conceptCrossModelComparison.candidates[0].promotion
    .playSafetyPassed,
  true,
);
for (const metric of Object.values(
  conceptCrossModelComparison.candidates[0].comparison.metrics,
)) {
  assert.equal(metric.delta.estimate, 0);
}
assert.match(
  conceptCrossModelComparison.candidates[0].methodology
    .operativeRanking,
  /unavailable.*direct clue-to-card similarity/,
);
assert.equal(
  unrestrictedConceptCrossModelComparison.candidates[0]
    .promotion.playSafetyPassed,
  false,
);
assert.deepEqual(
  Object.keys(playPolicyBenchmark.operativeAggression).sort(),
  ["aggressive", "conservative", "dynamic"],
);
assert.equal(
  playPolicyBenchmark.operativeAggression.dynamic.gameCount,
  100,
);
assert.equal(
  operativeCrossModelBenchmark.methodology.operativeModelId,
  "minilm-l6",
);
assert.equal(
  operativeCrossModelBenchmark.operativeAggression.aggressive.gameCount,
  100,
);
assert.match(playPolicySummary, /^\# Play policy benchmark/m);
assert.ok(playPolicySummary.includes(playPolicyBenchmark.generatedAt));
assert.match(playPolicySummary, /Operative aggression/);
assert.match(playPolicySummary, /retried a missed target/);
assert.equal(
  playPolicyBenchmark.policies.hybrid.missedTargetRecovery.earlyRetryRate,
  0,
);
assert.ok(
  playPolicyBenchmark.policies.hybrid.missedTargetRecovery.opportunities > 0,
);
assert.match(
  playPolicySummary,
  /\| 🎯 Policy \| 🎉 Fun \| 🔢 Multi clues \| ⏩ First-half mean \| ✅ Correct per turn \| 🤝 Close finishes \| ☠️ Assassin rate \| ⏱️ Turns per game \|/,
);
for (const policy of Object.values(PLAY_CLUE_POLICY)) {
  const result = playPolicyBenchmark.policies[policy];
  assert.equal(result.gameCount, 100);
  assert.equal(result.completedGames, result.gameCount);
  assert.equal(result.gameResults.length, result.gameCount);
  assert.equal(
    Object.values(result.clueNumberDistribution).reduce(
      (total, count) => total + count,
      0,
    ),
    result.clueCount,
  );
  assert.equal(
    result.gameResults.reduce((total, gameResult) => total + gameResult.turns, 0),
    result.clueCount,
  );
  assert.equal(
    result.gameResults.reduce(
      (total, gameResult) => total + gameResult.wrongTeamHits,
      0,
    ),
    result.wrongTeamHits,
  );
  assert.equal(
    result.gameResults.reduce(
      (total, gameResult) => total + gameResult.assassinHits,
      0,
    ),
    result.assassinHits,
  );
  assert.equal(
    result.gameResults.filter(
      (gameResult) => gameResult.losingAgentsRemaining <= 2,
    ).length / result.gameCount,
    result.closeFinishRate,
  );
  assert.ok(
    result.gameResults.every(
      (gameResult) =>
        gameResult.actions <= 500 &&
        gameResult.turns > 0 &&
        gameResult.firstHalfClueNumbers.length ===
          Math.ceil(gameResult.turns / 2) &&
        Number.isInteger(gameResult.losingAgentsRemaining) &&
        gameResult.losingAgentsRemaining >= 0 &&
        ["agents", "assassin"].includes(gameResult.endReason),
    ),
  );
  for (const metric of [
    "multiClueRate",
    "firstHalfMeanClueNumber",
    "correctCardsPerTurn",
    "wrongTeamHitsPerGame",
    "assassinRate",
    "closeFinishRate",
    "meanLosingAgentsRemaining",
    "meanTurnsPerGame",
  ]) {
    assert.equal(Number.isFinite(result[metric]), true, `${policy} ${metric} is not finite`);
  }
  assert.equal(result.fun.objectiveVersion, 1);
  assert.equal(Number.isFinite(result.fun.score), true);
  assert.equal(typeof result.fun.guardrailsPassed, "boolean");
  for (const component of ["ambition", "momentum", "suspense", "flow"]) {
    assert.equal(Number.isFinite(result.fun.components[component]), true);
  }
  assert.ok(
    playPolicySummary.includes(`${(result.multiClueRate * 100).toFixed(1)}%`),
    `${policy} summary is stale`,
  );
}

assert.equal(apiEmbeddingComparison.model, "text-embedding-3-large");
assert.equal(apiEmbeddingComparison.dimensions, 1024);
assert.equal(apiEmbeddingComparison.humanValidityGuardrails.passed, true);
assert.equal(playFunExperiments.verdict.promote, false);
assert.ok(
  playFunExperiments.promotionGates.some(
    ({ passed }) => passed === false,
  ),
);
for (const [report, operativeModelId, includesGameResults] of [
  [italianPlayBenchmark, "same", true],
  [italianPlayTransferBenchmark, "minilm-l6", false],
]) {
  assert.equal(report.methodology.language, LANGUAGE.ITALIAN);
  assert.equal(report.methodology.wordSet, WORD_SET.EXTENDED);
  assert.equal(report.methodology.modelId, ITALIAN_MODEL_ID);
  assert.equal(report.methodology.operativeModelId, operativeModelId);
  assert.equal(report.methodology.boardCount, 100);
  for (const policy of Object.values(PLAY_CLUE_POLICY)) {
    const result = report.policies[policy];
    assert.equal(result.completedGames, 100);
    if (includesGameResults) {
      assert.equal(result.gameResults.length, 100);
      assert.ok(
        result.gameResults.every(
          ({ actions, endReason }) =>
            actions <= report.methodology.maxActionsPerGame &&
            ["agents", "assassin"].includes(endReason),
        ),
      );
    } else {
      assert.equal(result.gameResults, undefined);
    }
  }
  assert.deepEqual(
    Object.keys(report.operativeAggression).sort(),
    ["aggressive", "conservative", "dynamic"],
  );
  assert.equal(report.operativeAggression.dynamic.gameCount, 100);
}
assert.ok(
  italianPlayTransferBenchmark.policies.hybrid.assassinRate >
    italianPlayBenchmark.policies.hybrid.assassinRate,
);

const randomValues = [0.2, 0.8];
const randomSeat = randomHumanSeat(() => randomValues.shift());
assert.deepEqual(randomSeat, { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE });
const currentSeat = { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER };
assert.deepEqual(differentRandomHumanSeat(currentSeat, () => 0), {
  side: SIDE.BLUE,
  role: PLAYER_ROLE.OPERATIVE,
});
assert.deepEqual(differentRandomHumanSeat(currentSeat, () => 0.999), {
  side: SIDE.RED,
  role: PLAYER_ROLE.OPERATIVE,
});
assert.deepEqual(normalizePlayBotSettings(), DEFAULT_PLAY_BOT_SETTINGS);
assert.deepEqual(
  normalizePlayBotSettings(undefined, LANGUAGE.ITALIAN),
  {
    ...DEFAULT_PLAY_BOT_SETTINGS,
    modelId: ITALIAN_MODEL_ID,
    candidateCount: 10_000,
  },
);

let game = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "play-smoke",
  wordSet: sample.wordSet,
});
assert.equal(game.activeSide, SIDE.BLUE);
assert.equal(game.phase, GAME_PHASE.AWAITING_CLUE);
assert.equal(game.language, LANGUAGE.ENGLISH);
assert.deepEqual(game.botSettings, DEFAULT_PLAY_BOT_SETTINGS);
assert.equal(actorForSeat(game, SIDE.BLUE, PLAYER_ROLE.SPYMASTER), "bot");
assert.equal(actorForSeat(game, SIDE.BLUE, PLAYER_ROLE.OPERATIVE), "human");

for (const side of [SIDE.BLUE, SIDE.RED]) {
  for (const role of [PLAYER_ROLE.SPYMASTER, PLAYER_ROLE.OPERATIVE]) {
    const seatGame = createPlayGame({
      cards: sample.cards,
      humanSeat: { side, role },
      seed: `${side}:${role}`,
      wordSet: sample.wordSet,
    });
    assert.equal(actorForSeat(seatGame, side, role), "human");
    assert.equal(
      actorForSeat(
        seatGame,
        side,
        role === PLAYER_ROLE.SPYMASTER ? PLAYER_ROLE.OPERATIVE : PLAYER_ROLE.SPYMASTER,
      ),
      "bot",
    );
  }
}

const morphologyGame = createPlayGame({
  cards: sample.cards.map((card, index) =>
    index === 0 ? { ...card, word: "LIFE" } : card,
  ),
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
  seed: "morphology",
  wordSet: sample.wordSet,
});

const ordinaryGame = createPlayGame({
  cards: sample.cards,
  developerMode: false,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
  seed: "ordinary-mode",
  wordSet: sample.wordSet,
});
const markedDeveloperGame = markPlayGameAsDeveloper(ordinaryGame);
assert.equal(markedDeveloperGame.developerMode, true);
assert.equal(markedDeveloperGame.history[0].developerMode, true);
assert.equal(markPlayGameAsDeveloper(markedDeveloperGame), markedDeveloperGame);
assert.equal(ordinaryGame.developerMode, false);
assert.equal(ordinaryGame.history[0].developerMode, false);

let developerGame = createPlayGame({
  cards: sample.cards,
  developerMode: true,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "developer-mode",
  wordSet: sample.wordSet,
});
assert.equal(developerGame.developerMode, true);
assert.equal(developerGame.history[0].developerMode, true);
developerGame = giveClue(developerGame, {
  actor: "bot",
  clue: "orbit",
  developerDiagnostics: {
    diagnosticsVersion: 1,
    spymasterDecision: {
      kind: "spymaster",
      selected: { clue: "orbit", number: 1, playScore: 72 },
    },
  },
  intendedLayoutIds: [0],
  number: 1,
});
const liveDeveloperTurns = replayDeveloperClueTurns(developerGame);
assert.equal(liveDeveloperTurns.length, 1);
assert.equal(liveDeveloperTurns[0].clue, "ORBIT");
assert.equal(
  liveDeveloperTurns[0].developerDiagnostics.spymasterDecision.kind,
  "spymaster",
);
assert.deepEqual(replayDeveloperClueTurns(morphologyGame), []);
developerGame = recordCurrentClueDeveloperDiagnostics(developerGame, {
  diagnosticsVersion: 1,
  modelId: "bge-small",
  operativeScores: [
    { layoutId: 0, similarity: 0.81 },
    { layoutId: 1, similarity: 0.62 },
  ],
});
developerGame = guessCard(developerGame, {
  actor: "human",
  developerDiagnostics: {
    diagnosticsVersion: 1,
    operativeDecision: {
      kind: "operative",
      layoutId: 0,
      reason: "guess",
    },
  },
  layoutId: 0,
});
assert.equal(
  developerGame.history.find((event) => event.type === "clue-given")
    .developerDiagnostics.operativeScores[0].similarity,
  0.81,
);
assert.equal(
  developerGame.history.find((event) => event.type === "card-guessed")
    .developerDiagnostics.operativeDecision.reason,
  "guess",
);
const developerPublicView = publicGameView(developerGame);
assert.equal(
  developerPublicView.history.some((event) =>
    Object.hasOwn(event, "developerDiagnostics"),
  ),
  false,
);
const restoredDeveloperGame = restorePlayGame(developerGame);
assert.equal(restoredDeveloperGame.developerMode, true);
assert.equal(
  restoredDeveloperGame.history.find((event) => event.type === "clue-given")
    .developerDiagnostics.operativeScores.length,
  2,
);
assert.throws(
  () =>
    giveClue(morphologyGame, {
      clue: "lives",
      number: 1,
      actor: "human",
    }),
  /stem or inflection/,
);
const derivationGame = createPlayGame({
  cards: sample.cards.map((card, index) =>
    index === 0 ? { ...card, word: "TEACHER" } : card,
  ),
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
  seed: "derivation",
  wordSet: sample.wordSet,
});
assert.throws(
  () =>
    giveClue(derivationGame, {
      clue: "teach",
      number: 1,
      actor: "human",
    }),
  /stem or inflection/,
);
const legacyDerivationGame = giveClue(derivationGame, {
  clue: "teach",
  number: 1,
  actor: "human",
  useLegacyClueRules: true,
});
const legacyDerivationPayload = JSON.parse(
  Buffer.from(
    encodePlayGame(legacyDerivationGame),
    "base64url",
  ).toString("utf8"),
);
legacyDerivationPayload[1] = 1;
const legacyDerivationCode = Buffer.from(
  JSON.stringify(legacyDerivationPayload),
).toString("base64url");
const restoredLegacyDerivationGame = decodePlayGame(
  legacyDerivationCode,
);
assert.equal(
  restoredLegacyDerivationGame.currentTurn.clue,
  "TEACH",
);
assert.equal(
  JSON.parse(
    Buffer.from(
      encodePlayGame(restoredLegacyDerivationGame),
      "base64url",
    ).toString("utf8"),
  )[1],
  1,
);

game = giveClue(game, {
  clue: "space",
  number: 2,
  actor: "bot",
  intendedLayoutIds: [0, 1],
});
assert.equal(game.phase, GAME_PHASE.AWAITING_GUESS);
assert.deepEqual(game.currentTurn.intendedLayoutIds, [0, 1]);
const operativeView = publicGameView(game);
assert.equal(operativeView.cards[0].team, null);
assert.deepEqual(operativeView.currentTurn.intendedLayoutIds, []);
assert.ok(
  operativeView.history.every((event) => !Object.hasOwn(event, "intendedLayoutIds")),
);

game = guessCard(game, { layoutId: 0, actor: "human" });
assert.equal(game.phase, GAME_PHASE.AWAITING_GUESS);
assert.equal(game.cards.find((card) => card.layoutId === 0).done, true);
game = passTurn(game, { actor: "human" });
assert.equal(game.activeSide, SIDE.RED);
assert.equal(game.phase, GAME_PHASE.AWAITING_CLUE);

let undoGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "multi-undo",
  wordSet: sample.wordSet,
});
const undoStates = [structuredClone(undoGame)];
assert.equal(canUndoPlayGame(undoGame), false);
assert.strictEqual(undoPlayGame(undoGame), undoGame);

undoGame = giveClue(undoGame, {
  clue: "space",
  number: 2,
  actor: "bot",
  intendedLayoutIds: [0, 1],
});
undoStates.push(structuredClone(undoGame));
const blueAgent = undoGame.cards.find((card) => card.team === "friendly");
undoGame = guessCard(undoGame, {
  layoutId: blueAgent.layoutId,
  actor: "human",
});
undoStates.push(structuredClone(undoGame));
undoGame = passTurn(undoGame, { actor: "human" });
undoStates.push(structuredClone(undoGame));
undoGame = giveClue(undoGame, {
  clue: "garden",
  number: 1,
  actor: "bot",
});
undoStates.push(structuredClone(undoGame));
const redAgent = undoGame.cards.find((card) => card.team === "enemy");
undoGame = guessCard(undoGame, {
  layoutId: redAgent.layoutId,
  actor: "bot",
});
undoStates.push(structuredClone(undoGame));
undoGame = passTurn(undoGame, { actor: "bot" });
undoStates.push(structuredClone(undoGame));

assert.deepEqual(restorePlayGame(undoGame), undoGame);
undoGame = undoPlayGame(undoGame);
assert.deepEqual(undoGame, undoStates[3]);

for (let index = 2; index >= 0; index -= 1) {
  assert.equal(canUndoPlayGame(undoGame), true);
  undoGame = undoPlayGame(undoGame);
  assert.deepEqual(undoGame, undoStates[index]);
}
assert.equal(canUndoPlayGame(undoGame), false);

let neutralGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "neutral",
  wordSet: sample.wordSet,
});
neutralGame = giveClue(neutralGame, { clue: "space", number: 1, actor: "bot" });
const neutral = neutralGame.cards.find((card) => card.team === "neutral");
neutralGame = guessCard(neutralGame, { layoutId: neutral.layoutId, actor: "human" });
assert.equal(neutralGame.activeSide, SIDE.RED);
assert.equal(neutralGame.phase, GAME_PHASE.AWAITING_CLUE);

let assassinGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "assassin",
  wordSet: sample.wordSet,
});
assassinGame = giveClue(assassinGame, { clue: "space", number: 1, actor: "bot" });
const assassin = assassinGame.cards.find((card) => card.team === "assassin");
assassinGame = guessCard(assassinGame, {
  layoutId: assassin.layoutId,
  actor: "human",
});
assert.equal(assassinGame.phase, GAME_PHASE.COMPLETE);
assert.equal(assassinGame.winner, SIDE.RED);
assert.equal(assassinGame.endReason, GAME_END_REASON.ASSASSIN);
const resumedAssassinGame = validateStoredGame(structuredClone(assassinGame));
const restoredAssassinGame = undoPlayGame(resumedAssassinGame);
assert.equal(restoredAssassinGame.phase, GAME_PHASE.AWAITING_GUESS);
assert.equal(restoredAssassinGame.winner, null);
assert.equal(restoredAssassinGame.endReason, null);
assert.equal(
  restoredAssassinGame.cards.find((card) => card.layoutId === assassin.layoutId).done,
  false,
);

let winningGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "winner",
  wordSet: sample.wordSet,
});
winningGame = giveClue(winningGame, {
  clue: "space",
  number: 9,
  actor: "bot",
  intendedLayoutIds: winningGame.cards
    .filter((card) => card.team === "friendly")
    .map((card) => card.layoutId),
});
const winningTargets = winningGame.cards.filter((card) => card.team === "friendly");
for (const target of winningTargets.slice(0, -1)) {
  winningGame = guessCard(winningGame, {
    layoutId: target.layoutId,
    actor: "human",
  });
}
const beforeWinningGuess = structuredClone(winningGame);
winningGame = guessCard(winningGame, {
  layoutId: winningTargets.at(-1).layoutId,
  actor: "human",
});
assert.equal(winningGame.phase, GAME_PHASE.COMPLETE);
assert.equal(winningGame.winner, SIDE.BLUE);
const completedView = publicGameView(winningGame);
assert.equal(completedView.cards.find((card) => !card.done).team !== null, true);
assert.deepEqual(
  completedView.history.find((event) => event.type === "clue-given").intendedLayoutIds,
  winningTargets.map((card) => card.layoutId),
);
assert.deepEqual(undoPlayGame(winningGame), beforeWinningGuess);

let replayGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "replay",
  wordSet: sample.wordSet,
});
const firstBlue = replayGame.cards.find((card) => card.team === "friendly");
const firstRed = replayGame.cards.find((card) => card.team === "enemy");
const replayAssassin = replayGame.cards.find((card) => card.team === "assassin");
replayGame = giveClue(replayGame, {
  clue: "orbit",
  number: 1,
  actor: "bot",
  intendedLayoutIds: [firstBlue.layoutId],
});
assert.deepEqual(replayCompletedClueTurns(replayGame), []);
replayGame = guessCard(replayGame, {
  layoutId: firstBlue.layoutId,
  actor: "human",
});
replayGame = passTurn(replayGame, { actor: "human" });
replayGame = giveClue(replayGame, {
  clue: "scarlet",
  number: 1,
  actor: "bot",
  intendedLayoutIds: [firstRed.layoutId],
});
replayGame = guessCard(replayGame, {
  layoutId: firstRed.layoutId,
  actor: "bot",
});
replayGame = passTurn(replayGame, { actor: "bot" });
replayGame = giveClue(replayGame, {
  clue: "danger",
  number: 1,
  actor: "bot",
  intendedLayoutIds: [firstBlue.layoutId],
});
replayGame = guessCard(replayGame, {
  layoutId: replayAssassin.layoutId,
  actor: "human",
});
const replayActionStates = replayPlayActionStates(replayGame);
assert.equal(replayActionStates.length, 8);
assert.equal(
  replayActionStates[0].game.cards.every((card) => !card.done),
  true,
);
assert.equal(
  replayActionStates[1].game.cards.find(
    (card) => card.layoutId === firstBlue.layoutId,
  ).done,
  true,
);
assert.equal(
  replayActionStates[2].game.phase,
  GAME_PHASE.AWAITING_CLUE,
);
assert.equal(
  replayActionStates.at(-1).game.cards.find(
    (card) => card.layoutId === replayAssassin.layoutId,
  ).done,
  true,
);
const replayTurns = replayCompletedClueTurns(replayGame);
assert.equal(replayTurns.length, 3);
assert.deepEqual(replayTurns[0].intendedLayoutIds, [firstBlue.layoutId]);
assert.equal(replayTurns[0].cards.every((card) => !card.done), true);
assert.equal(
  replayTurns[1].cards.find((card) => card.layoutId === firstBlue.layoutId).done,
  true,
);
assert.equal(
  replayTurns[1].cards.find((card) => card.layoutId === firstRed.layoutId).done,
  false,
);
assert.equal(
  replayTurns[2].cards.find((card) => card.layoutId === firstRed.layoutId).done,
  true,
);
assert.deepEqual(
  replayTurns[2].guesses.map(({ layoutId }) => layoutId),
  [replayAssassin.layoutId],
);
assert.equal(
  replayTurns[2].cards.find((card) => card.layoutId === replayAssassin.layoutId).done,
  false,
);

let missedTargetGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "missed-target",
  wordSet: sample.wordSet,
});
const missedBlueTarget = missedTargetGame.cards.find(
  (card) => card.team === "friendly",
);
missedTargetGame = giveClue(missedTargetGame, {
  clue: "missed",
  number: 1,
  actor: "bot",
  intendedLayoutIds: [missedBlueTarget.layoutId],
});
assert.deepEqual(
  unresolvedIntendedTargetIds(missedTargetGame, SIDE.BLUE),
  [missedBlueTarget.layoutId],
);
missedTargetGame = guessCard(missedTargetGame, {
  layoutId: missedBlueTarget.layoutId,
  actor: "human",
});
assert.deepEqual(
  unresolvedIntendedTargetIds(missedTargetGame, SIDE.BLUE),
  [],
);

const spyView = publicGameView(
  createPlayGame({
    cards: sample.cards,
    humanSeat: { side: SIDE.RED, role: PLAYER_ROLE.SPYMASTER },
    seed: "key",
    wordSet: sample.wordSet,
  }),
);
assert.equal(spyView.cards[0].team, "friendly");

const suggestion = chooseBotClue({
  analysis: {
    suggestions: [
      {
        clue: "one",
        worth: 80,
        risk: "safe",
        number: 2,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
      {
        clue: "two",
        worth: 70,
        risk: "risky",
        number: 4,
        margin: 0.05,
        expectedNet: 2,
        success: 0.75,
      },
    ],
  },
  ownRemaining: 7,
  opponentRemaining: 5,
  random: () => 0,
});
assert.equal(suggestion.clue, "one");
const hybridSuggestion = chooseBotClue({
  analysis: {
    suggestions: [
      {
        clue: "single",
        worth: 90,
        risk: "safe",
        number: 1,
        margin: 0.15,
        expectedNet: 0.8,
        success: 0.95,
      },
      {
        clue: "pair",
        worth: 70,
        risk: "safe",
        number: 2,
        margin: 0.1,
        expectedNet: 1.6,
        success: 0.85,
      },
    ],
  },
  ownRemaining: 7,
  opponentRemaining: 5,
  policy: PLAY_CLUE_POLICY.HYBRID,
  random: () => 0,
});
assert.equal(hybridSuggestion.clue, "pair");
const tempoSuggestion = chooseBotClue({
  analysis: {
    suggestions: [
      {
        clue: "single",
        worth: 80,
        risk: "safe",
        number: 1,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
      {
        clue: "pair",
        worth: 75,
        risk: "safe",
        number: 2,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
    ],
  },
  ownRemaining: 7,
  opponentRemaining: 5,
  policy: PLAY_CLUE_POLICY.HYBRID,
  multiTolerance: 5,
  random: () => 0,
});
assert.equal(tempoSuggestion.clue, "pair");
const missedTargetSuggestions = {
  suggestions: [
    {
      clue: "retry",
      worth: 80,
      risk: "medium",
      number: 1,
      margin: 0,
      expectedNet: 0,
      success: 0,
      targets: [{ layoutId: 4 }],
    },
    {
      clue: "fresh",
      worth: 70,
      risk: "medium",
      number: 1,
      margin: 0,
      expectedNet: 0,
      success: 0,
      targets: [{ layoutId: 8 }],
    },
  ],
};
assert.equal(
  chooseBotClue({
    analysis: missedTargetSuggestions,
    freshTargetCount: 8,
    missedTargetLayoutIds: [4],
    missedTargetTiming: PLAY_MISSED_TARGET_TIMING.LATE,
    ownRemaining: 9,
    opponentRemaining: 8,
    random: () => 0,
  }).clue,
  "fresh",
);
assert.equal(
  chooseBotClue({
    analysis: missedTargetSuggestions,
    freshTargetCount: 8,
    missedTargetLayoutIds: [4],
    missedTargetTiming: PLAY_MISSED_TARGET_TIMING.IMMEDIATE,
    ownRemaining: 9,
    opponentRemaining: 8,
    random: () => 0,
  }).clue,
  "retry",
);
assert.equal(
  chooseBotClue({
    analysis: missedTargetSuggestions,
    freshTargetCount: 1,
    missedTargetLayoutIds: [4],
    missedTargetTiming: PLAY_MISSED_TARGET_TIMING.LATE,
    ownRemaining: 2,
    opponentRemaining: 3,
    random: () => 0,
  }).clue,
  "retry",
);
assert.throws(
  () =>
    scoreMissedTargetPreference(missedTargetSuggestions.suggestions[0], {
      freshTargetCount: 8,
      missedTargetLayoutIds: [4],
      missedTargetTiming: "unknown",
    }),
  /Unknown missed-target timing/,
);
const clueDecision = evaluateBotClue({
  analysis: {
    suggestions: [
      {
        clue: "single",
        worth: 80,
        risk: "safe",
        number: 1,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
      {
        clue: "pair",
        worth: 75,
        risk: "safe",
        number: 2,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
    ],
  },
  ownRemaining: 7,
  opponentRemaining: 5,
  policy: PLAY_CLUE_POLICY.HYBRID,
  multiTolerance: 5,
  random: () => 0,
});
assert.equal(clueDecision.selected.clue, "pair");
assert.equal(clueDecision.selection, "multi-tolerance");
assert.equal(typeof clueDecision.ranked[0].playScore, "number");
let consecutiveClueGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
  seed: "consecutive-clues",
  wordSet: sample.wordSet,
});
const repeatedSide = consecutiveClueGame.activeSide;
consecutiveClueGame = giveClue(consecutiveClueGame, {
  clue: "repeat",
  number: 1,
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.SPYMASTER,
  ),
});
consecutiveClueGame = passTurn(consecutiveClueGame, {
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.OPERATIVE,
  ),
});
consecutiveClueGame = giveClue(consecutiveClueGame, {
  clue: "interlude",
  number: 1,
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.SPYMASTER,
  ),
});
consecutiveClueGame = passTurn(consecutiveClueGame, {
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.OPERATIVE,
  ),
});
assert.equal(consecutiveClueGame.activeSide, repeatedSide);
consecutiveClueGame = giveClue(consecutiveClueGame, {
  clue: "recent",
  number: 1,
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.SPYMASTER,
  ),
});
consecutiveClueGame = passTurn(consecutiveClueGame, {
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.OPERATIVE,
  ),
});
consecutiveClueGame = giveClue(consecutiveClueGame, {
  clue: "opponent",
  number: 1,
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.SPYMASTER,
  ),
});
consecutiveClueGame = passTurn(consecutiveClueGame, {
  actor: actorForSeat(
    consecutiveClueGame,
    consecutiveClueGame.activeSide,
    PLAYER_ROLE.OPERATIVE,
  ),
});
assert.equal(consecutiveClueGame.activeSide, repeatedSide);
assert.deepEqual(
  cluesForSide(consecutiveClueGame, repeatedSide),
  ["REPEAT", "RECENT"],
);
const repeatPolicyAnalysis = {
  analysis: {
    suggestions: [
      {
        clue: "repeat",
        worth: 90,
        risk: "safe",
        number: 1,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
      {
        clue: "recent",
        worth: 85,
        risk: "safe",
        number: 1,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
      {
        clue: "replacement",
        worth: 80,
        risk: "safe",
        number: 1,
        margin: 0.2,
        expectedNet: 1,
        success: 0.9,
      },
    ],
  },
  teamClues: cluesForSide(consecutiveClueGame, repeatedSide),
  ownRemaining: 7,
  opponentRemaining: 5,
  policy: PLAY_CLUE_POLICY.HYBRID,
  multiTolerance: 5,
  random: () => 0,
};
const allowRepeatDecision = evaluateBotClue({
  ...repeatPolicyAnalysis,
  clueRepeatPolicy: PLAY_CLUE_REPEAT_POLICY.ALLOW,
});
assert.equal(allowRepeatDecision.selected.clue, "repeat");
const previousRepeatDecision = evaluateBotClue({
  ...repeatPolicyAnalysis,
  clueRepeatPolicy: PLAY_CLUE_REPEAT_POLICY.PREVIOUS,
});
assert.equal(previousRepeatDecision.selected.clue, "repeat");
const neverRepeatDecision = evaluateBotClue({
  ...repeatPolicyAnalysis,
  clueRepeatPolicy: PLAY_CLUE_REPEAT_POLICY.NEVER,
});
assert.equal(neverRepeatDecision.selected.clue, "replacement");
assert.deepEqual(
  neverRepeatDecision.ranked.map(({ suggestion: { clue } }) => clue),
  ["replacement"],
);
assert.ok(
  scorePlayClue(
    {
      worth: 70,
      risk: "safe",
      number: 2,
      margin: 0.1,
      expectedNet: 1.6,
      success: 0.85,
    },
    {
      ownRemaining: 7,
      opponentRemaining: 5,
      policy: PLAY_CLUE_POLICY.HYBRID,
    },
  ) > 70,
);
assert.throws(
  () =>
    scorePlayClue(
      {
        worth: 70,
        risk: "safe",
        number: 2,
        margin: 0.1,
        expectedNet: 1.6,
        success: 0.85,
      },
      { ownRemaining: 7, opponentRemaining: 5, policy: "unknown" },
    ),
  /Unknown Play clue policy/,
);

const JOUST_CONCEPT_RANKING_FIXTURE = {
  description:
    "JOUST → medieval tournament → MATCH / CROWN / GLOVE / BELT, where PIANO was guessed before those stronger human associations.",
  candidates: [
    {
      word: "PIANO",
      directSimilarity: 0.1927,
      conceptSimilarity: 0.1837,
    },
    {
      word: "MATCH",
      directSimilarity: 0.1407,
      conceptSimilarity: 0.4148,
    },
    {
      word: "CROWN",
      directSimilarity: 0.0361,
      conceptSimilarity: 0.2729,
    },
    {
      word: "GLOVE",
      directSimilarity: -0.0017,
      conceptSimilarity: 0.2614,
    },
    {
      word: "BELT",
      directSimilarity: -0.093,
      conceptSimilarity: 0.3027,
    },
  ],
};
assert.equal(
  shouldUseConceptRanking(
    JOUST_CONCEPT_RANKING_FIXTURE.candidates.map(
      ({ directSimilarity }) => ({
        similarity: directSimilarity,
      }),
    ),
    4,
  ),
  true,
);
const joustRanking = JOUST_CONCEPT_RANKING_FIXTURE.candidates
  .map(
    ({
      conceptSimilarity,
      directSimilarity,
      word,
    }) => ({
      word,
      score: scoreOperativeAssociation(
        directSimilarity,
        conceptSimilarity,
      ),
    }),
  )
  .sort((left, right) => right.score - left.score);
assert.deepEqual(
  joustRanking.map(({ word }) => word),
  ["MATCH", "BELT", "CROWN", "GLOVE", "PIANO"],
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
    candidates: joustRanking.map((candidate, layoutId) => ({
      layoutId,
      similarity:
        JOUST_CONCEPT_RANKING_FIXTURE.candidates.find(
          ({ word }) => word === candidate.word,
        ).directSimilarity,
      rankingScore: candidate.score,
    })),
    guessesMade: 0,
    clueNumber: 4,
    random: () => 0.5,
  }),
  0,
);

assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
    candidates: [
      { layoutId: 4, similarity: 0.4 },
      { layoutId: 8, similarity: 0.1 },
    ],
    guessesMade: 0,
    clueNumber: 2,
    random: () => 0.5,
  }),
  4,
);
const guessDecision = evaluateBotGuess({
  aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
  candidates: [
    { layoutId: 4, similarity: 0.4 },
    { layoutId: 8, similarity: 0.1 },
  ],
  guessesMade: 0,
  clueNumber: 2,
  random: () => 0.5,
});
assert.equal(guessDecision.layoutId, 4);
assert.equal(guessDecision.reason, "guess");
assert.equal(guessDecision.ranked[0].botScore, 0.4);
const noNoiseDecision = evaluateBotGuess({
  aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
  candidates: [
    { layoutId: 4, similarity: 0.2 },
    { layoutId: 8, similarity: 0.19 },
  ],
  guessesMade: 0,
  clueNumber: 2,
  noise: PLAY_OPERATIVE_NOISE.NONE,
  random: () => 0,
});
assert.equal(noNoiseDecision.layoutId, 4);
assert.equal(noNoiseDecision.ranked[0].botScore, 0.2);
const standardNoiseDecision = evaluateBotGuess({
  aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
  candidates: [
    { layoutId: 4, similarity: 0.2 },
    { layoutId: 8, similarity: 0.19 },
  ],
  guessesMade: 0,
  clueNumber: 2,
  noise: PLAY_OPERATIVE_NOISE.STANDARD,
  random: (() => {
    const values = [0, 1];
    return () => values.shift();
  })(),
});
assert.equal(standardNoiseDecision.layoutId, 8);
assert.throws(
  () =>
    evaluateBotGuess({
      candidates: [{ layoutId: 4, similarity: 0.4 }],
      guessesMade: 0,
      clueNumber: 1,
      noise: "unknown",
      random: () => 0.5,
    }),
  /Unknown operative noise/,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
    candidates: [
      { layoutId: 4, similarity: 0.12 },
      { layoutId: 8, similarity: 0.11 },
    ],
    guessesMade: 2,
    clueNumber: 2,
    random: () => 0.5,
  }),
  null,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.CONSERVATIVE,
    candidates: [
      { layoutId: 4, similarity: 0.2 },
      { layoutId: 8, similarity: 0.05 },
    ],
    guessesMade: 1,
    clueNumber: 2,
    ownRemaining: 5,
    opponentRemaining: 5,
    random: () => 0.5,
  }),
  null,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE,
    candidates: [
      { layoutId: 4, similarity: 0.15 },
      { layoutId: 8, similarity: 0.05 },
    ],
    guessesMade: 0,
    clueNumber: 2,
    ownRemaining: 5,
    opponentRemaining: 5,
    random: () => 0.5,
  }),
  4,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
    candidates: [
      { layoutId: 4, similarity: 0.16 },
      { layoutId: 8, similarity: 0.05 },
    ],
    guessesMade: 1,
    clueNumber: 2,
    ownRemaining: 4,
    opponentRemaining: 4,
    random: () => 0.5,
  }),
  null,
);
const wimbledonComebackCandidates = [
  { layoutId: 8, word: "STRING", similarity: 0.021 },
  { layoutId: 20, word: "GENIUS", similarity: 0 },
  { layoutId: 4, word: "CROWN", similarity: 0.115 },
  { layoutId: 23, word: "KANGAROO", similarity: -0.032 },
  { layoutId: 19, word: "STOCK", similarity: 0.093 },
  { layoutId: 24, word: "RAY", similarity: 0.026 },
  { layoutId: 17, word: "CAP", similarity: -0.051 },
  { layoutId: 11, word: "HOOD", similarity: -0.063 },
  { layoutId: 6, word: "BELT", similarity: 0.092 },
  { layoutId: 18, word: "PANTS", similarity: -0.036 },
  { layoutId: 22, word: "BAT", similarity: 0.131 },
  { layoutId: 12, word: "SQUARE", similarity: 0.075 },
  { layoutId: 2, word: "GRASS", similarity: 0.112 },
  { layoutId: 15, word: "NAIL", similarity: 0.02 },
  { layoutId: 0, word: "BEAT", similarity: -0.041 },
  { layoutId: 21, word: "RULER", similarity: 0.045 },
  { layoutId: 1, word: "GLOVE", similarity: 0.016 },
];
const wimbledonComebackDecision = evaluateBotGuess({
  aggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
  candidates: wimbledonComebackCandidates,
  guessesMade: 1,
  clueNumber: 3,
  ownRemaining: 6,
  opponentRemaining: 3,
  random: createSeededRandom("BZEF30hnrDs:5:21"),
});
assert.equal(wimbledonComebackDecision.layoutId, 22);
assert.equal(wimbledonComebackDecision.reason, "guess");
assert.equal(wimbledonComebackDecision.thresholds.minimumSimilarity, 0.09);
assert.ok(wimbledonComebackDecision.gap >= 0.005);
const wimbledonFinalSlotDecision = evaluateBotGuess({
  aggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
  candidates: wimbledonComebackCandidates.filter(
    ({ layoutId }) => layoutId !== 2,
  ),
  guessesMade: 2,
  clueNumber: 3,
  ownRemaining: 5,
  opponentRemaining: 3,
  random: createSeededRandom("BZEF30hnrDs:5:22"),
});
assert.equal(wimbledonFinalSlotDecision.layoutId, null);
assert.equal(wimbledonFinalSlotDecision.reason, "minimum-similarity");
assert.ok(
  wimbledonFinalSlotDecision.thresholds.minimumSimilarity >
    wimbledonFinalSlotDecision.ranked[0].botScore,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
    candidates: [
      { layoutId: 4, similarity: 0.16 },
      { layoutId: 8, similarity: 0.05 },
    ],
    guessesMade: 1,
    clueNumber: 2,
    ownRemaining: 1,
    opponentRemaining: 4,
    random: () => 0.5,
  }),
  4,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
    candidates: [
      { layoutId: 4, similarity: 0.24 },
      { layoutId: 8, similarity: 0.05 },
    ],
    guessesMade: 1,
    clueNumber: 2,
    ownRemaining: 5,
    opponentRemaining: 2,
    random: () => 0.5,
  }),
  4,
);
assert.equal(
  chooseBotGuess({
    aggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
    candidates: [
      { layoutId: 4, similarity: 0.24 },
      { layoutId: 8, similarity: 0.05 },
    ],
    guessesMade: 1,
    clueNumber: 2,
    ownRemaining: 2,
    opponentRemaining: 5,
    random: () => 0.5,
  }),
  null,
);
assert.throws(
  () =>
    chooseBotGuess({
      aggression: "unknown",
      candidates: [
        { layoutId: 4, similarity: 0.4 },
        { layoutId: 8, similarity: 0.1 },
      ],
      guessesMade: 0,
      clueNumber: 1,
      ownRemaining: 1,
      opponentRemaining: 1,
      random: () => 0.5,
    }),
  /Unknown operative aggression/,
);
assert.equal(
  shouldBotTakeAnotherGuess({
    bonusGuesses: PLAY_BONUS_POLICY.PASS,
    clueNumber: 2,
    guessesMade: 2,
  }),
  false,
);
assert.equal(
  shouldBotTakeAnotherGuess({
    bonusGuesses: PLAY_BONUS_POLICY.ALLOW,
    clueNumber: 2,
    guessesMade: 2,
  }),
  true,
);

const upgradedStoredGame = validateStoredGame({
  ...game,
  botSettings: undefined,
  origin: undefined,
});
assert.equal(upgradedStoredGame.botSettings.modelId, "bge-small");
assert.equal(
  upgradedStoredGame.botSettings.operativeAggression,
  PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
);
assert.equal(
  upgradedStoredGame.botSettings.missedTargetTiming,
  PLAY_MISSED_TARGET_TIMING.LATE,
);
assert.equal(
  upgradedStoredGame.botSettings.clueRepeatPolicy,
  PLAY_CLUE_REPEAT_POLICY.NEVER,
);
assert.equal(upgradedStoredGame.origin, GAME_ORIGIN.UNKNOWN);
assert.equal(upgradedStoredGame.analyticsSequence, 0);
assert.equal(
  upgradedStoredGame.botSettings.operativeNoise,
  PLAY_OPERATIVE_NOISE.STANDARD,
);
assert.equal(
  upgradedStoredGame.botSettings.operativeConcepts,
  PLAY_CONCEPT_RANKING.DIRECT,
);
assert.equal(
  normalizePlayBotSettings({
    missedTargetTiming: "unknown",
  }).missedTargetTiming,
  PLAY_MISSED_TARGET_TIMING.LATE,
);
assert.equal(
  normalizePlayBotSettings({
    missedTargetTiming: PLAY_MISSED_TARGET_TIMING.IMMEDIATE,
  }).missedTargetTiming,
  PLAY_MISSED_TARGET_TIMING.IMMEDIATE,
);
assert.equal(
  normalizePlayBotSettings({
    clueRepeatPolicy: "unknown",
  }).clueRepeatPolicy,
  PLAY_CLUE_REPEAT_POLICY.NEVER,
);
assert.equal(
  normalizePlayBotSettings({
    clueRepeatPolicy: PLAY_CLUE_REPEAT_POLICY.ALLOW,
  }).clueRepeatPolicy,
  PLAY_CLUE_REPEAT_POLICY.ALLOW,
);
assert.equal(
  normalizePlayBotSettings({
    operativeNoise: PLAY_OPERATIVE_NOISE.STANDARD,
  }).operativeNoise,
  PLAY_OPERATIVE_NOISE.STANDARD,
);
assert.equal(
  normalizePlayBotSettings({
    operativeConcepts: PLAY_CONCEPT_RANKING.DIRECT,
  }).operativeConcepts,
  PLAY_CONCEPT_RANKING.DIRECT,
);
assert.equal(upgradedStoredGame.botSettings.bonusGuesses, PLAY_BONUS_POLICY.PASS);
assert.equal(
  upgradedStoredGame.wordReusePolicy,
  PLAY_WORD_REUSE_POLICY.FULLY_RANDOM,
);
assert.equal(upgradedStoredGame.developerMode, false);

const randomSeed = boardSeed(1);
const randomReuseBoard = createPlayBoardWithWordReuse({
  seed: randomSeed,
  state: createDefaultWordReuseState(),
  wordSet: WORD_SET.OFFICIAL,
}).board;
assert.deepEqual(
  randomReuseBoard,
  createGeneratedBoardState(
    randomSeed,
    BOARD_ORDER.RANDOM,
    WORD_SET.OFFICIAL,
  ),
);

let officialHistory = setWordReusePolicy(
  createDefaultWordReuseState(),
  PLAY_WORD_REUSE_POLICY.AVOID_RECENT,
);
const officialBoards = [];
for (let index = 0; index < OFFICIAL_WORDS.length / 25; index += 1) {
  const result = createPlayBoardWithWordReuse({
    seed: boardSeed(index + 10),
    state: officialHistory,
    wordSet: WORD_SET.OFFICIAL,
  });
  const words = result.board.cards.map(({ word }) => word);
  assert.equal(result.repeatsRequired, 0);
  assert.equal(
    words.some((word) => officialBoards.flat().includes(word)),
    false,
  );
  officialBoards.push(words);
  officialHistory = recordBoardWords(
    officialHistory,
    result.board.cards,
  );
}
assert.equal(
  new Set(officialBoards.flat()).size,
  OFFICIAL_WORDS.length,
);
assert.match(
  wordReuseStatus(
    {
      ...officialHistory,
      boards: officialHistory.boards.slice(0, -1),
    },
    WORD_SET.OFFICIAL,
  ).text,
  /Last repeat-free Official board/,
);
assert.equal(
  createPlayBoardWithWordReuse({
    seed: boardSeed(100),
    state: officialHistory,
    wordSet: WORD_SET.OFFICIAL,
  }).repeatsRequired,
  25,
);
assert.match(
  wordReuseStatus(officialHistory, WORD_SET.OFFICIAL).text,
  /must reuse at least 25/,
);

let extendedHistory = setWordReusePolicy(
  createDefaultWordReuseState(),
  PLAY_WORD_REUSE_POLICY.AVOID_RECENT,
);
const extendedWordsSeen = new Set();
for (let index = 0; index < EXTENDED_WORDS.length / 25; index += 1) {
  const result = createPlayBoardWithWordReuse({
    seed: boardSeed(index + 200),
    state: extendedHistory,
    wordSet: WORD_SET.EXTENDED,
  });
  assert.equal(result.repeatsRequired, 0);
  for (const card of result.board.cards) {
    assert.equal(extendedWordsSeen.has(card.word), false);
    extendedWordsSeen.add(card.word);
  }
  extendedHistory = recordBoardWords(
    extendedHistory,
    result.board.cards,
  );
}
assert.equal(extendedWordsSeen.size, EXTENDED_WORDS.length);
assert.equal(
  extendedHistory.boards.length,
  MAX_WORD_HISTORY_BOARDS,
);
assert.equal(
  createPlayBoardWithWordReuse({
    seed: boardSeed(300),
    state: extendedHistory,
    wordSet: WORD_SET.EXTENDED,
  }).repeatsRequired,
  25,
);

let italianHistory = setWordReusePolicy(
  createDefaultWordReuseState(),
  PLAY_WORD_REUSE_POLICY.AVOID_RECENT,
);
const italianWordsSeen = new Set();
for (let index = 0; index < ITALIAN_EXTENDED_WORDS.length / 25; index += 1) {
  const result = createPlayBoardWithWordReuse({
    seed: boardSeed(index + 400),
    state: italianHistory,
    language: LANGUAGE.ITALIAN,
    wordSet: WORD_SET.EXTENDED,
  });
  assert.equal(result.repeatsRequired, 0);
  for (const card of result.board.cards) {
    assert.equal(italianWordsSeen.has(card.word), false);
    italianWordsSeen.add(card.word);
  }
  italianHistory = recordBoardWords(italianHistory, result.board.cards);
}
assert.equal(italianWordsSeen.size, ITALIAN_EXTENDED_WORDS.length);
assert.equal(
  createPlayBoardWithWordReuse({
    seed: boardSeed(500),
    state: italianHistory,
    language: LANGUAGE.ITALIAN,
    wordSet: WORD_SET.EXTENDED,
  }).repeatsRequired,
  25,
);
assert.match(
  wordReuseStatus(
    italianHistory,
    WORD_SET.EXTENDED,
    LANGUAGE.ITALIAN,
  ).text,
  /ripeterne almeno 25/,
);

const randomAfterAvoid = setWordReusePolicy(
  officialHistory,
  PLAY_WORD_REUSE_POLICY.FULLY_RANDOM,
);
assert.equal(randomAfterAvoid.boards.length, officialHistory.boards.length);
assert.equal(
  clearWordReuseHistory(randomAfterAvoid).boards.length,
  0,
);

const storedValues = new Map();
const fakeStorage = {
  getItem(key) {
    return storedValues.get(key) ?? null;
  },
  setItem(key, value) {
    storedValues.set(key, value);
  },
};
assert.equal(saveWordReuseState(extendedHistory, fakeStorage), true);
assert.deepEqual(
  loadWordReuseState(fakeStorage),
  normalizeWordReuseState(extendedHistory),
);
storedValues.set("codenames-play-word-reuse-v1", "{invalid");
assert.deepEqual(
  loadWordReuseState(fakeStorage),
  createDefaultWordReuseState(),
);
assert.equal(upgradedStoredGame.language, LANGUAGE.ENGLISH);

const italianCards = sample.cards.map((card, index) => ({
  ...card,
  word: index === 0 ? "braccio" : `parola${index}`,
}));
let italianGame = createPlayGame({
  cards: italianCards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
  language: LANGUAGE.ITALIAN,
  seed: "italian-play",
  wordSet: WORD_SET.EXTENDED,
});
assert.equal(italianGame.language, LANGUAGE.ITALIAN);
assert.equal(italianGame.botSettings.modelId, ITALIAN_MODEL_ID);
assert.throws(
  () =>
    giveClue(italianGame, {
      clue: "abbraccia",
      number: 1,
      actor: "human",
    }),
  /unrevealed board word/,
);
italianGame = giveClue(italianGame, {
  clue: "oceano",
  number: 1,
  actor: "human",
});
assert.equal(italianGame.currentTurn.clue, "OCEANO");
const restoredItalianGame = validateStoredGame(italianGame);
assert.equal(restoredItalianGame.language, LANGUAGE.ITALIAN);
assert.equal(restoredItalianGame.botSettings.modelId, ITALIAN_MODEL_ID);
const activeGameCode = encodePlayGame(italianGame);
const sharedActiveGame = decodePlayGame(activeGameCode);
assert.equal(sharedActiveGame.phase, GAME_PHASE.AWAITING_GUESS);
assert.equal(italianGame.origin, GAME_ORIGIN.LOCAL);
assert.equal(sharedActiveGame.origin, GAME_ORIGIN.SHARED);
assert.equal(sharedActiveGame.language, LANGUAGE.ITALIAN);
assert.equal(sharedActiveGame.currentTurn.clue, "OCEANO");
assert.deepEqual(
  sharedActiveGame.history.slice(1),
  italianGame.history.slice(1),
);
assert.throws(
  () => decodeCompletedGame(activeGameCode),
  /not complete/,
);

const previousWindow = globalThis.window;
let persistedSession = null;
globalThis.window = {
  localStorage: {
    setItem(_key, value) {
      persistedSession = JSON.parse(value);
    },
  },
};
try {
  assert.equal(savePlaySession(italianGame), true);
  assert.equal(italianGame.analyticsSequence, 1);
  assert.equal(persistedSession.analyticsSequence, 1);
  const replayed = restorePlayGame(italianGame);
  assert.equal(replayed.analyticsSequence, 1);
  assert.equal(replayed.origin, GAME_ORIGIN.LOCAL);
} finally {
  globalThis.window = previousWindow;
}

const seededA = createSeededRandom("same");
const seededB = createSeededRandom("same");
assert.deepEqual(
  Array.from({ length: 5 }, () => seededA()),
  Array.from({ length: 5 }, () => seededB()),
);

let simulated = createPlayGame({
  botSettings: {
    ...DEFAULT_PLAY_BOT_SETTINGS,
    clueRepeatPolicy: PLAY_CLUE_REPEAT_POLICY.ALLOW,
  },
  cards: sample.cards,
  humanSeat: { side: SIDE.RED, role: PLAYER_ROLE.SPYMASTER },
  seed: "bounded",
  wordSet: sample.wordSet,
});
for (let action = 0; action < 200 && simulated.phase !== GAME_PHASE.COMPLETE; action += 1) {
  if (simulated.phase === GAME_PHASE.AWAITING_CLUE) {
    simulated = giveClue(simulated, {
      clue: `CLUE${simulated.turnNumber}`,
      number: 1,
      actor: actorForSeat(simulated, simulated.activeSide, PLAYER_ROLE.SPYMASTER),
    });
  } else {
    const ownTeam = simulated.activeSide === SIDE.BLUE ? "friendly" : "enemy";
    const nextOwn = simulated.cards.find((card) => !card.done && card.team === ownTeam);
    simulated = guessCard(simulated, {
      layoutId: nextOwn.layoutId,
      actor: actorForSeat(simulated, simulated.activeSide, PLAYER_ROLE.OPERATIVE),
    });
  }
}
assert.equal(simulated.phase, GAME_PHASE.COMPLETE);
assert.ok(
  remainingCardsForSide(simulated.cards, SIDE.BLUE) === 0 ||
    remainingCardsForSide(simulated.cards, SIDE.RED) === 0,
);
const completedGameCode = encodeCompletedGame(simulated);
const sharedCompletedGame = decodeCompletedGame(completedGameCode);
assert.ok(completedGameCode.length < 2_048);
assert.equal(sharedCompletedGame.phase, GAME_PHASE.COMPLETE);
assert.equal(sharedCompletedGame.winner, simulated.winner);
assert.equal(sharedCompletedGame.endReason, simulated.endReason);
assert.deepEqual(
  sharedCompletedGame.cards.map(
    ({ word, team, layoutId, done, revealedBy, revealedTurn }) => ({
      word,
      team,
      layoutId,
      done,
      revealedBy,
      revealedTurn,
    }),
  ),
  simulated.cards.map(
    ({ word, team, layoutId, done, revealedBy, revealedTurn }) => ({
      word,
      team,
      layoutId,
      done,
      revealedBy,
      revealedTurn,
    }),
  ),
);
assert.equal(
  sharedCompletedGame.botSettings.missedTargetTiming,
  "late",
);
assert.equal(
  sharedCompletedGame.botSettings.clueRepeatPolicy,
  "allow",
);
assert.equal(sharedCompletedGame.botSettings.operativeNoise, "none");
assert.equal(
  sharedCompletedGame.botSettings.operativeConcepts,
  PLAY_CONCEPT_RANKING.GUARDED,
);
assert.equal(sharedCompletedGame.developerMode, false);
assert.equal(
  sharedCompletedGame.history[0].developerMode,
  false,
);
assert.equal(
  sharedCompletedGame.history[0].botSettings.missedTargetTiming,
  "late",
);
assert.deepEqual(
  {
    formatVersion: sharedCompletedGame.shareMetadata.formatVersion,
    rulesVersion: sharedCompletedGame.shareMetadata.rulesVersion,
    settingsVersion: sharedCompletedGame.shareMetadata.settingsVersion,
    compatibility: sharedCompletedGame.reviewCompatibility,
  },
  {
    formatVersion: 3,
    rulesVersion: 2,
    settingsVersion: 4,
    compatibility: "full",
  },
);
assert.deepEqual(
  sharedCompletedGame.history.slice(1),
  simulated.history.slice(1),
);
let oversizedSharedGame = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.RED, role: PLAYER_ROLE.SPYMASTER },
  seed: "oversized-share",
  wordSet: sample.wordSet,
});
for (let turn = 0; turn < 150; turn += 1) {
  oversizedSharedGame = giveClue(oversizedSharedGame, {
    clue: `LONGCLUE${String(turn).padStart(12, "X")}`,
    number: 1,
    actor: actorForSeat(
      oversizedSharedGame,
      oversizedSharedGame.activeSide,
      PLAYER_ROLE.SPYMASTER,
    ),
  });
  oversizedSharedGame = passTurn(oversizedSharedGame, {
    actor: actorForSeat(
      oversizedSharedGame,
      oversizedSharedGame.activeSide,
      PLAYER_ROLE.OPERATIVE,
    ),
  });
}
oversizedSharedGame = giveClue(oversizedSharedGame, {
  clue: "FINALCLUE",
  number: 1,
  actor: actorForSeat(
    oversizedSharedGame,
    oversizedSharedGame.activeSide,
    PLAYER_ROLE.SPYMASTER,
  ),
});
oversizedSharedGame = guessCard(oversizedSharedGame, {
  layoutId: oversizedSharedGame.cards.find(
    (card) => !card.done && card.team === "assassin",
  ).layoutId,
  actor: actorForSeat(
    oversizedSharedGame,
    oversizedSharedGame.activeSide,
    PLAYER_ROLE.OPERATIVE,
  ),
});
const oversizedCompletedGameCode = encodeCompletedGame(oversizedSharedGame, {
  maxLength: 30_000,
});
assert.ok(oversizedCompletedGameCode.length > 12_000);
assert.throws(
  () => encodeCompletedGame(oversizedSharedGame),
  /too large to share/,
);
assert.throws(
  () => decodeCompletedGame(oversizedCompletedGameCode),
  /Invalid Play-game code/,
);
const currentPayload = JSON.parse(
  Buffer.from(completedGameCode, "base64url").toString("utf8"),
);
const versionTwoPayload = structuredClone(currentPayload);
versionTwoPayload[0] = 2;
const versionTwoGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(versionTwoPayload)).toString("base64url"),
);
assert.equal(versionTwoGame.shareMetadata.formatVersion, 2);
assert.equal(versionTwoGame.winner, simulated.winner);
const versionThreeSettingsPayload = structuredClone(currentPayload);
versionThreeSettingsPayload[2] = 3;
versionThreeSettingsPayload[7] = currentPayload[7].slice(0, 9);
const versionThreeSettingsGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(versionThreeSettingsPayload)).toString(
    "base64url",
  ),
);
assert.equal(
  versionThreeSettingsGame.botSettings.operativeConcepts,
  PLAY_CONCEPT_RANKING.DIRECT,
);
const versionTwoSettingsPayload = structuredClone(currentPayload);
versionTwoSettingsPayload[2] = 2;
versionTwoSettingsPayload[7] = currentPayload[7].slice(0, 8);
const versionTwoSettingsGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(versionTwoSettingsPayload)).toString("base64url"),
);
assert.equal(versionTwoSettingsGame.botSettings.clueRepeatPolicy, "allow");
assert.equal(
  versionTwoSettingsGame.botSettings.operativeNoise,
  PLAY_OPERATIVE_NOISE.STANDARD,
);
assert.equal(
  versionTwoSettingsGame.botSettings.operativeConcepts,
  PLAY_CONCEPT_RANKING.DIRECT,
);
const versionOneSettingsPayload = structuredClone(currentPayload);
versionOneSettingsPayload[2] = 1;
versionOneSettingsPayload[7] = currentPayload[7].slice(0, 7);
const versionOneSettingsGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(versionOneSettingsPayload)).toString(
    "base64url",
  ),
);
assert.equal(
  versionOneSettingsGame.botSettings.clueRepeatPolicy,
  PLAY_CLUE_REPEAT_POLICY.NEVER,
);
assert.equal(
  versionOneSettingsGame.botSettings.operativeNoise,
  PLAY_OPERATIVE_NOISE.STANDARD,
);
assert.equal(
  versionOneSettingsGame.botSettings.operativeConcepts,
  PLAY_CONCEPT_RANKING.DIRECT,
);
const unsupportedClueRepeatPayload = structuredClone(currentPayload);
unsupportedClueRepeatPayload[7][7] = "unknown";
assert.throws(
  () =>
    decodeCompletedGame(
      Buffer.from(JSON.stringify(unsupportedClueRepeatPayload)).toString(
        "base64url",
      ),
    ),
  /unsupported settings/,
);
const unsupportedNoisePayload = structuredClone(currentPayload);
unsupportedNoisePayload[7][8] = "unknown";
assert.throws(
  () =>
    decodeCompletedGame(
      Buffer.from(JSON.stringify(unsupportedNoisePayload)).toString(
        "base64url",
      ),
    ),
  /unsupported settings/,
);
const unsupportedConceptPayload = structuredClone(currentPayload);
unsupportedConceptPayload[7][9] = "unknown";
assert.throws(
  () =>
    decodeCompletedGame(
      Buffer.from(JSON.stringify(unsupportedConceptPayload)).toString(
        "base64url",
      ),
    ),
  /unsupported settings/,
);
const legacySettings = [
  ...currentPayload[7].slice(0, 4),
  currentPayload[7][5],
  currentPayload[7][6],
];
const legacyActions = currentPayload[11].map((action) => {
  if (action[0] === "c") {
    return [action[0], action[4], action[5], action[6]];
  }
  if (action[0] === "g") {
    return [action[0], action[4]];
  }
  return [action[0]];
});
const legacyPayload = [
  currentPayload[4],
  currentPayload[5],
  currentPayload[6],
  legacySettings,
  currentPayload[8],
  legacyActions,
];
legacyPayload.unshift(1);
const legacyCompletedGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(legacyPayload)).toString("base64url"),
);
assert.equal(legacyCompletedGame.botSettings.missedTargetTiming, "late");
assert.equal(legacyCompletedGame.botSettings.clueRepeatPolicy, "never");
assert.equal(
  legacyCompletedGame.botSettings.operativeNoise,
  PLAY_OPERATIVE_NOISE.STANDARD,
);
assert.equal(
  legacyCompletedGame.botSettings.operativeConcepts,
  PLAY_CONCEPT_RANKING.DIRECT,
);
assert.equal(legacyCompletedGame.developerMode, false);
assert.equal(legacyCompletedGame.shareMetadata.formatVersion, 1);
const unsupportedRulesPayload = structuredClone(currentPayload);
unsupportedRulesPayload[1] = 99;
const historyOnlyGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(unsupportedRulesPayload)).toString(
    "base64url",
  ),
);
assert.equal(historyOnlyGame.reviewCompatibility, "history-only");
assert.equal(historyOnlyGame.winner, simulated.winner);
assert.deepEqual(
  historyOnlyGame.history
    .filter((event) =>
      ["clue-given", "card-guessed", "turn-passed"].includes(
        event.type,
      ),
    )
    .map(({ type, turn, side, actor }) => ({
      type,
      turn,
      side,
      actor,
    })),
  simulated.history
    .filter((event) =>
      ["clue-given", "card-guessed", "turn-passed"].includes(
        event.type,
      ),
    )
    .map(({ type, turn, side, actor }) => ({
      type,
      turn,
      side,
      actor,
    })),
);
const unsupportedSettingsPayload = structuredClone(currentPayload);
unsupportedSettingsPayload[2] = 99;
const settingsHistoryOnlyGame = decodeCompletedGame(
  Buffer.from(JSON.stringify(unsupportedSettingsPayload)).toString(
    "base64url",
  ),
);
assert.equal(
  settingsHistoryOnlyGame.reviewCompatibility,
  "history-only",
);
assert.deepEqual(
  settingsHistoryOnlyGame.shareMetadata.rawSettings,
  currentPayload[7],
);
const mismatchedContextPayload = structuredClone(currentPayload);
mismatchedContextPayload[11][0][3] =
  mismatchedContextPayload[11][0][3] === "h" ? "b" : "h";
assert.throws(
  () =>
    decodeCompletedGame(
      Buffer.from(JSON.stringify(mismatchedContextPayload)).toString(
        "base64url",
      ),
    ),
  /actions cannot be replayed/,
);
const mismatchedOutcomePayload = structuredClone(currentPayload);
mismatchedOutcomePayload[10][0] =
  mismatchedOutcomePayload[10][0] === "b" ? "r" : "b";
assert.throws(
  () =>
    decodeCompletedGame(
      Buffer.from(JSON.stringify(mismatchedOutcomePayload)).toString(
        "base64url",
      ),
    ),
  /outcome does not match/,
);
const developerDiagnostics = {
  diagnosticsVersion: 1,
  modelId: "bge-small",
  operativeScores: simulated.cards.map(({ layoutId }, index) => ({
    layoutId,
    similarity: Number((0.9 - index * 0.025).toFixed(3)),
  })),
};
const completedDeveloperGame = {
  ...simulated,
  developerMode: true,
  botSettings: {
    ...simulated.botSettings,
    missedTargetTiming: "immediate",
  },
  history: simulated.history.map((event, index) => {
    if (event.type === "game-started") {
      return {
        ...event,
        developerMode: true,
        botSettings: {
          ...event.botSettings,
          missedTargetTiming: "immediate",
        },
      };
    }
    if (
      index === 1 &&
      event.type === "clue-given"
    ) {
      return { ...event, developerDiagnostics };
    }
    return event;
  }),
};
const developerGameCode = encodeCompletedGame(completedDeveloperGame);
const sharedDeveloperGame = decodeCompletedGame(developerGameCode);
assert.equal(sharedDeveloperGame.developerMode, true);
assert.equal(sharedDeveloperGame.history[0].developerMode, true);
assert.equal(
  sharedDeveloperGame.botSettings.missedTargetTiming,
  "immediate",
);
assert.equal(
  sharedDeveloperGame.history[1].developerDiagnostics,
  undefined,
);
const archivedDeveloperGameCode = encodeCompletedGame(completedDeveloperGame, {
  includeDeveloperDiagnostics: true,
  maxLength: 262_144,
});
const archivedDeveloperGame = decodeCompletedGame(
  archivedDeveloperGameCode,
  { maxLength: 262_144 },
);
assert.deepEqual(
  archivedDeveloperGame.history[1].developerDiagnostics,
  developerDiagnostics,
);
assert.throws(
  () =>
    encodeCompletedGame({
      ...completedDeveloperGame,
      developerMode: false,
    }),
  /Normal game contains developer diagnostics/,
);
assert.throws(
  () => encodeCompletedGame(italianGame),
  /Only completed Play games/,
);
assert.throws(
  () => decodeCompletedGame("not-a-completed-game"),
  /Play-game code/,
);

console.log("Play smoke passed.");

function boardSeed(index) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(index));
  return bytes.toString("base64url");
}
