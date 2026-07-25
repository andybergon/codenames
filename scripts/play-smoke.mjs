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
  OFFICIAL_WORDS,
  WORD_SET,
} from "../src/word-data.js";
import {
  PLAY_CLUE_POLICY,
  chooseBotClue,
  chooseBotGuess,
  createSeededRandom,
  scorePlayClue,
  shouldBotTakeAnotherGuess,
} from "../src/play/bots.js";
import {
  GAME_END_REASON,
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  canUndoPlayGame,
  createPlayGame,
  giveClue,
  guessCard,
  passTurn,
  publicGameView,
  randomHumanSeat,
  restorePlayGame,
  undoPlayGame,
  validateStoredGame,
} from "../src/play/game-state.js";
import {
  DEFAULT_PLAY_BOT_SETTINGS,
  PLAY_BONUS_POLICY,
  PLAY_OPERATIVE_AGGRESSION,
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

assert.equal(playPolicyBenchmark.methodology.boardCount, 100);
assert.equal(playPolicyBenchmark.methodology.pairedBoards, true);
assert.equal(playPolicyBenchmark.methodology.candidateCount, 10_000);
assert.equal(playPolicyBenchmark.methodology.funObjective.version, 1);
assert.equal(
  playPolicyBenchmark.methodology.operativeAggression.includes("dynamic"),
  true,
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

const randomValues = [0.2, 0.8];
const randomSeat = randomHumanSeat(() => randomValues.shift());
assert.deepEqual(randomSeat, { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE });
assert.deepEqual(normalizePlayBotSettings(), DEFAULT_PLAY_BOT_SETTINGS);

let game = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "play-smoke",
  wordSet: sample.wordSet,
});
assert.equal(game.activeSide, SIDE.BLUE);
assert.equal(game.phase, GAME_PHASE.AWAITING_CLUE);
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
assert.throws(
  () =>
    giveClue(morphologyGame, {
      clue: "lives",
      number: 1,
      actor: "human",
    }),
  /stem or inflection/,
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
});
assert.equal(upgradedStoredGame.botSettings.modelId, "bge-small");
assert.equal(
  upgradedStoredGame.botSettings.operativeAggression,
  PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
);
assert.equal(upgradedStoredGame.botSettings.bonusGuesses, PLAY_BONUS_POLICY.PASS);
assert.equal(
  upgradedStoredGame.wordReusePolicy,
  PLAY_WORD_REUSE_POLICY.FULLY_RANDOM,
);

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

const seededA = createSeededRandom("same");
const seededB = createSeededRandom("same");
assert.deepEqual(
  Array.from({ length: 5 }, () => seededA()),
  Array.from({ length: 5 }, () => seededB()),
);

let simulated = createPlayGame({
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

console.log("Play smoke passed.");

function boardSeed(index) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(index));
  return bytes.toString("base64url");
}
