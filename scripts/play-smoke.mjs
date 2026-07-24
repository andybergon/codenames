import assert from "node:assert/strict";
import { createSampleBoardState } from "../src/board-share.js";
import { SIDE, remainingCardsForSide } from "../src/gameplay.js";
import { chooseBotClue, chooseBotGuess, createSeededRandom } from "../src/play/bots.js";
import {
  GAME_END_REASON,
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  createPlayGame,
  giveClue,
  guessCard,
  passTurn,
  publicGameView,
  randomHumanSeat,
} from "../src/play/game-state.js";

const sample = createSampleBoardState();

const randomValues = [0.2, 0.8];
const randomSeat = randomHumanSeat(() => randomValues.shift());
assert.deepEqual(randomSeat, { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE });

let game = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "play-smoke",
  wordSet: sample.wordSet,
});
assert.equal(game.activeSide, SIDE.BLUE);
assert.equal(game.phase, GAME_PHASE.AWAITING_CLUE);
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

let winningGame = createPlayGame({
  cards: sample.cards.map((card) => ({
    ...card,
    done: card.team === "friendly" && card.layoutId !== 0,
  })),
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.OPERATIVE },
  seed: "winner",
  wordSet: sample.wordSet,
});
winningGame.cards = winningGame.cards.map((card) => ({
  ...card,
  done: card.team === "friendly" && card.layoutId !== 0,
}));
winningGame = giveClue(winningGame, {
  clue: "space",
  number: 1,
  actor: "bot",
  intendedLayoutIds: [0],
});
winningGame = guessCard(winningGame, { layoutId: 0, actor: "human" });
assert.equal(winningGame.phase, GAME_PHASE.COMPLETE);
assert.equal(winningGame.winner, SIDE.BLUE);
const completedView = publicGameView(winningGame);
assert.equal(completedView.cards.find((card) => !card.done).team !== null, true);
assert.deepEqual(
  completedView.history.find((event) => event.type === "clue-given").intendedLayoutIds,
  [0],
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
      { clue: "one", worth: 80, risk: "safe", number: 2, margin: 0.2 },
      { clue: "two", worth: 70, risk: "risky", number: 4, margin: 0.05 },
    ],
  },
  ownRemaining: 7,
  opponentRemaining: 5,
  random: () => 0,
});
assert.equal(suggestion.clue, "one");

assert.equal(
  chooseBotGuess({
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
