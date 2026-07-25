import { SIDE, otherSide, remainingCardsForSide } from "../gameplay.js";
import { normalizePlayBotSettings } from "./settings.js";

export const PLAYER_ROLE = Object.freeze({
  SPYMASTER: "spymaster",
  OPERATIVE: "operative",
});

export const GAME_PHASE = Object.freeze({
  AWAITING_CLUE: "awaiting-clue",
  AWAITING_GUESS: "awaiting-guess",
  COMPLETE: "complete",
});

export const GAME_END_REASON = Object.freeze({
  AGENTS: "agents",
  ASSASSIN: "assassin",
});

const SIDES = new Set(Object.values(SIDE));
const PLAYER_ROLES = new Set(Object.values(PLAYER_ROLE));
const ACTORS = new Set(["human", "bot"]);

export function randomHumanSeat(random = Math.random) {
  return {
    side: random() < 0.5 ? SIDE.BLUE : SIDE.RED,
    role: random() < 0.5 ? PLAYER_ROLE.SPYMASTER : PLAYER_ROLE.OPERATIVE,
  };
}

export function createPlayGame({
  botSettings,
  cards,
  humanSeat,
  seed,
  wordSet,
}) {
  validateSeat(humanSeat);
  if (!Array.isArray(cards) || cards.length !== 25) {
    throw new Error("A Play game requires exactly 25 cards.");
  }

  const normalizedBotSettings = normalizePlayBotSettings(botSettings);
  return {
    schemaVersion: 1,
    seed: String(seed ?? ""),
    wordSet,
    botSettings: normalizedBotSettings,
    humanSeat: { ...humanSeat },
    cards: cards.map((card) => ({
      ...card,
      done: false,
      revealedBy: null,
      revealedTurn: null,
    })),
    activeSide: SIDE.BLUE,
    phase: GAME_PHASE.AWAITING_CLUE,
    turnNumber: 1,
    currentTurn: null,
    winner: null,
    endReason: null,
    history: [
      {
        type: "game-started",
        humanSeat: { ...humanSeat },
        botSettings: normalizedBotSettings,
        activeSide: SIDE.BLUE,
      },
    ],
  };
}

export function actorForSeat(game, side, role) {
  validateSide(side);
  validateRole(role);
  return game.humanSeat.side === side && game.humanSeat.role === role ? "human" : "bot";
}

export function giveClue(game, { clue, number, actor, intendedLayoutIds = [] }) {
  assertActive(game, GAME_PHASE.AWAITING_CLUE);
  assertActor(game, PLAYER_ROLE.SPYMASTER, actor);

  const normalizedClue = validateClue(clue, game.cards);
  const normalizedNumber = Number(number);
  const maximum = remainingCardsForSide(game.cards, game.activeSide);
  if (!Number.isInteger(normalizedNumber) || normalizedNumber < 1 || normalizedNumber > maximum) {
    throw new Error(`Clue number must be between 1 and ${maximum}.`);
  }

  const intended = [...new Set(intendedLayoutIds)]
    .filter(Number.isInteger)
    .filter((layoutId) => game.cards.some((card) => card.layoutId === layoutId));
  const event = {
    type: "clue-given",
    turn: game.turnNumber,
    side: game.activeSide,
    actor,
    clue: normalizedClue,
    number: normalizedNumber,
    intendedLayoutIds: intended,
  };

  return {
    ...game,
    phase: GAME_PHASE.AWAITING_GUESS,
    currentTurn: {
      side: game.activeSide,
      clue: normalizedClue,
      number: normalizedNumber,
      actor,
      intendedLayoutIds: intended,
      guesses: [],
    },
    history: [...game.history, event],
  };
}

export function guessCard(game, { layoutId, actor }) {
  assertActive(game, GAME_PHASE.AWAITING_GUESS);
  assertActor(game, PLAYER_ROLE.OPERATIVE, actor);

  const cardIndex = game.cards.findIndex((card) => card.layoutId === layoutId);
  if (cardIndex < 0 || game.cards[cardIndex].done) {
    throw new Error("That card is not available to guess.");
  }

  const guessedCard = game.cards[cardIndex];
  const cards = game.cards.map((card, index) =>
    index === cardIndex
      ? {
          ...card,
          done: true,
          revealedBy: game.activeSide,
          revealedTurn: game.turnNumber,
        }
      : card,
  );
  const guess = {
    layoutId,
    word: guessedCard.word,
    team: guessedCard.team,
    actor,
  };
  const currentTurn = {
    ...game.currentTurn,
    guesses: [...game.currentTurn.guesses, guess],
  };
  const history = [
    ...game.history,
    {
      type: "card-guessed",
      turn: game.turnNumber,
      side: game.activeSide,
      ...guess,
    },
  ];
  const afterGuess = { ...game, cards, currentTurn, history };

  if (guessedCard.team === "assassin") {
    return completeGame(afterGuess, otherSide(game.activeSide), GAME_END_REASON.ASSASSIN);
  }

  for (const side of [SIDE.BLUE, SIDE.RED]) {
    if (remainingCardsForSide(cards, side) === 0) {
      return completeGame(afterGuess, side, GAME_END_REASON.AGENTS);
    }
  }

  const guessedSide = sideForTeam(guessedCard.team);
  const reachedGuessLimit = currentTurn.guesses.length >= currentTurn.number + 1;
  if (guessedSide !== game.activeSide || reachedGuessLimit) {
    return endTurn(afterGuess, reachedGuessLimit ? "limit" : guessedCard.team);
  }

  return afterGuess;
}

export function passTurn(game, { actor }) {
  assertActive(game, GAME_PHASE.AWAITING_GUESS);
  assertActor(game, PLAYER_ROLE.OPERATIVE, actor);
  return endTurn(
    {
      ...game,
      history: [
        ...game.history,
        {
          type: "turn-passed",
          turn: game.turnNumber,
          side: game.activeSide,
          actor,
        },
      ],
    },
    "pass",
  );
}

export function publicGameView(game) {
  const showKey =
    game.humanSeat.role === PLAYER_ROLE.SPYMASTER || game.phase === GAME_PHASE.COMPLETE;
  return {
    ...game,
    cards: game.cards.map((card) => ({
      ...card,
      team: showKey || card.done ? card.team : null,
    })),
    currentTurn: game.currentTurn
      ? {
          ...game.currentTurn,
          intendedLayoutIds: [],
        }
      : null,
    history: game.history.map((event) => {
      if (showKey || !Object.hasOwn(event, "intendedLayoutIds")) {
        return { ...event };
      }
      const { intendedLayoutIds: _privateTargets, ...publicEvent } = event;
      return publicEvent;
    }),
  };
}

export function validateStoredGame(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.cards) ||
    value.cards.length !== 25 ||
    !SIDES.has(value.activeSide) ||
    !Object.values(GAME_PHASE).includes(value.phase)
  ) {
    throw new Error("Unsupported saved Play session.");
  }
  validateSeat(value.humanSeat);
  return {
    ...value,
    botSettings: normalizePlayBotSettings(value.botSettings),
  };
}

function endTurn(game, reason) {
  const completedTurn = {
    type: "turn-ended",
    turn: game.turnNumber,
    side: game.activeSide,
    reason,
    clue: game.currentTurn.clue,
    number: game.currentTurn.number,
    guesses: [...game.currentTurn.guesses],
  };

  return {
    ...game,
    activeSide: otherSide(game.activeSide),
    phase: GAME_PHASE.AWAITING_CLUE,
    turnNumber: game.turnNumber + 1,
    currentTurn: null,
    history: [...game.history, completedTurn],
  };
}

function completeGame(game, winner, endReason) {
  return {
    ...game,
    phase: GAME_PHASE.COMPLETE,
    winner,
    endReason,
    history: [
      ...game.history,
      {
        type: "game-ended",
        turn: game.turnNumber,
        winner,
        reason: endReason,
      },
    ],
  };
}

function validateClue(clue, cards) {
  const normalized = String(clue ?? "").trim();
  if (!normalized || /\s/u.test(normalized)) {
    throw new Error("A clue must be one word.");
  }
  if (cards.some((card) => !card.done && card.word.toLowerCase() === normalized.toLowerCase())) {
    throw new Error("A clue cannot be an unrevealed board word.");
  }
  return normalized.toUpperCase();
}

function assertActive(game, phase) {
  if (game.phase === GAME_PHASE.COMPLETE) {
    throw new Error("The game is already complete.");
  }
  if (game.phase !== phase) {
    throw new Error(`Expected ${phase}, received ${game.phase}.`);
  }
}

function assertActor(game, role, actor) {
  if (!ACTORS.has(actor)) {
    throw new Error(`Unknown actor: ${actor}.`);
  }
  if (actorForSeat(game, game.activeSide, role) !== actor) {
    throw new Error(`${actor} does not control the active ${role} seat.`);
  }
}

function sideForTeam(team) {
  if (team === "friendly") {
    return SIDE.BLUE;
  }
  if (team === "enemy") {
    return SIDE.RED;
  }
  return null;
}

function validateSeat(seat) {
  if (!seat || !SIDES.has(seat.side) || !PLAYER_ROLES.has(seat.role)) {
    throw new Error("Unknown human seat.");
  }
}

function validateSide(side) {
  if (!SIDES.has(side)) {
    throw new Error(`Unknown side: ${side}.`);
  }
}

function validateRole(role) {
  if (!PLAYER_ROLES.has(role)) {
    throw new Error(`Unknown player role: ${role}.`);
  }
}
