import {
  BOARD_ORDER,
  decodeBoardParam,
  encodeBoardParam,
} from "../board-share.js";
import {
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  createPlayGame,
  giveClue,
  guessCard,
  passTurn,
  validateStoredGame,
} from "./game-state.js";
import { PLAY_WORD_REUSE_POLICY } from "./word-reuse.js";

const SHARE_VERSION = 1;
const MAX_SHARE_LENGTH = 16_384;
const MAX_ACTIONS = 512;
const MAX_DIAGNOSTIC_BYTES = 12_288;
const MAX_DIAGNOSTIC_DEPTH = 8;
const MAX_DIAGNOSTIC_ITEMS = 512;
const MISSED_TARGET_TIMINGS = new Set([
  "late",
  "balanced",
  "immediate",
]);
const ACTION = Object.freeze({
  CLUE: "c",
  GUESS: "g",
  PASS: "p",
});
const SEAT_CODE = Object.freeze({
  "blue:spymaster": "bs",
  "blue:operative": "bo",
  "red:spymaster": "rs",
  "red:operative": "ro",
});
const SEAT_FROM_CODE = new Map(
  Object.entries(SEAT_CODE).map(([seat, code]) => [code, seat]),
);
const WORD_REUSE_CODE = Object.freeze({
  [PLAY_WORD_REUSE_POLICY.FULLY_RANDOM]: "r",
  [PLAY_WORD_REUSE_POLICY.AVOID_RECENT]: "a",
});
const WORD_REUSE_FROM_CODE = new Map(
  Object.entries(WORD_REUSE_CODE).map(([policy, code]) => [code, policy]),
);

export function encodeCompletedGame(
  game,
  {
    includeDeveloperDiagnostics = false,
    maxLength = MAX_SHARE_LENGTH,
  } = {},
) {
  const validated = validateStoredGame(game);
  if (validated.phase !== GAME_PHASE.COMPLETE) {
    throw new Error("Only completed Play games can be shared.");
  }

  const board = encodeBoardParam({
    cards: validated.cards.map((card) => ({ ...card, done: false })),
    randomLayoutOrder: validated.cards.map((card) => card.layoutId),
    order: BOARD_ORDER.RANDOM,
    language: validated.language,
    wordSet: validated.wordSet,
    source: { type: "explicit" },
  });
  const seat = SEAT_CODE[
    `${validated.humanSeat.side}:${validated.humanSeat.role}`
  ];
  const settings = validated.botSettings;
  const missedTargetTiming = MISSED_TARGET_TIMINGS.has(
    game?.botSettings?.missedTargetTiming,
  )
    ? game.botSettings.missedTargetTiming
    : "late";
  const gameId = completedGameIdentity(validated, board);
  const actions = validated.history.flatMap((event) => {
    if (
      !validated.developerMode &&
      event.developerDiagnostics !== undefined
    ) {
      throw new Error("Normal game contains developer diagnostics.");
    }
    const developerDiagnostics =
      validated.developerMode && includeDeveloperDiagnostics
      ? validatedDeveloperDiagnostics(event.developerDiagnostics)
      : null;
    if (event.type === "clue-given") {
      return [[
        ACTION.CLUE,
        event.clue,
        event.number,
        [...(event.intendedLayoutIds ?? [])],
        ...(developerDiagnostics ? [developerDiagnostics] : []),
      ]];
    }
    if (event.type === "card-guessed") {
      return [[
        ACTION.GUESS,
        event.layoutId,
        ...(developerDiagnostics ? [developerDiagnostics] : []),
      ]];
    }
    if (event.type === "turn-passed") {
      return [[
        ACTION.PASS,
        ...(developerDiagnostics ? [developerDiagnostics] : []),
      ]];
    }
    return [];
  });
  const payload = [
    SHARE_VERSION,
    gameId,
    board,
    validated.seed,
    seat,
    [
      settings.modelId,
      settings.candidateCount,
      settings.cluePolicy,
      settings.multiTolerance,
      missedTargetTiming,
      settings.operativeAggression,
      settings.bonusGuesses,
    ],
    WORD_REUSE_CODE[validated.wordReusePolicy],
    validated.developerMode === true ? 1 : 0,
    actions,
  ];
  const code = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  if (code.length > maxLength) {
    throw new Error("Completed game is too large to share in a link.");
  }
  return code;
}

export function decodeCompletedGame(
  code,
  { maxLength = MAX_SHARE_LENGTH } = {},
) {
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    code.length > maxLength ||
    !/^[A-Za-z0-9_-]+$/u.test(code)
  ) {
    throw new Error("Invalid completed-game code.");
  }

  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64UrlToBytes(code),
      ),
    );
  } catch {
    throw new Error("Invalid completed-game code.");
  }

  if (
    !Array.isArray(payload) ||
    ![7, 8, 9].includes(payload.length) ||
    payload[0] !== SHARE_VERSION ||
    !validPayloadShape(payload)
  ) {
    throw new Error("Unsupported completed-game code.");
  }

  const current = payload.length === 9;
  const hasDeveloperMode = payload.length >= 8;
  const gameId = current ? payload[1] : null;
  const offset = current ? 1 : 0;
  const boardCode = payload[1 + offset];
  const seed = payload[2 + offset];
  const seatCode = payload[3 + offset];
  const rawSettings = payload[4 + offset];
  const reuseCode = payload[5 + offset];
  const developerMode = hasDeveloperMode
    ? payload[6 + offset] === 1
    : false;
  const actions = payload[hasDeveloperMode ? 7 + offset : 6 + offset];
  const seatValue = SEAT_FROM_CODE.get(seatCode);
  const wordReusePolicy = WORD_REUSE_FROM_CODE.get(reuseCode);
  if (!seatValue || !wordReusePolicy) {
    throw new Error("Completed game contains unsupported settings.");
  }
  const [side, role] = seatValue.split(":");
  const board = decodeBoardParam(boardCode);
  const resolvedGameId = completedGameIdentity(
    { seed, humanSeat: { side, role } },
    boardCode,
  );
  if (gameId !== null && gameId !== resolvedGameId) {
    throw new Error("Completed game identity does not match its board.");
  }
  const hasMissedTargetTiming = rawSettings.length === 7;
  const missedTargetTiming = hasMissedTargetTiming
    ? rawSettings[4]
    : "late";
  if (!MISSED_TARGET_TIMINGS.has(missedTargetTiming)) {
    throw new Error("Completed game contains unsupported settings.");
  }
  const operativeIndex = hasMissedTargetTiming ? 5 : 4;
  const bonusIndex = hasMissedTargetTiming ? 6 : 5;
  const positions = new Map(
    board.randomLayoutOrder.map((layoutId, index) => [layoutId, index]),
  );
  const cards = [...board.cards].sort(
    (left, right) =>
      positions.get(left.layoutId) - positions.get(right.layoutId),
  );
  let game = createPlayGame({
    cards,
    developerMode,
    humanSeat: { side, role },
    language: board.language,
    seed,
    wordSet: board.wordSet,
    wordReusePolicy,
    botSettings: {
      modelId: rawSettings[0],
      candidateCount: rawSettings[1],
      cluePolicy: rawSettings[2],
      multiTolerance: rawSettings[3],
      missedTargetTiming,
      operativeAggression: rawSettings[operativeIndex],
      bonusGuesses: rawSettings[bonusIndex],
    },
  });

  try {
    for (const action of actions) {
      if (!Array.isArray(action) || action.length === 0) {
        throw new Error("Invalid completed-game action.");
      }
      const developerDiagnostics = actionDeveloperDiagnostics(
        action,
        developerMode,
      );
      if (
        action[0] === ACTION.CLUE &&
        [4, 5].includes(action.length)
      ) {
        game = giveClue(game, {
          clue: action[1],
          number: action[2],
          intendedLayoutIds: action[3],
          developerDiagnostics,
          actor: actorForSeat(
            game,
            game.activeSide,
            PLAYER_ROLE.SPYMASTER,
          ),
        });
      } else if (
        action[0] === ACTION.GUESS &&
        [2, 3].includes(action.length)
      ) {
        game = guessCard(game, {
          layoutId: action[1],
          developerDiagnostics,
          actor: actorForSeat(
            game,
            game.activeSide,
            PLAYER_ROLE.OPERATIVE,
          ),
        });
      } else if (
        action[0] === ACTION.PASS &&
        [1, 2].includes(action.length)
      ) {
        game = passTurn(game, {
          developerDiagnostics,
          actor: actorForSeat(
            game,
            game.activeSide,
            PLAYER_ROLE.OPERATIVE,
          ),
        });
      } else {
        throw new Error("Invalid completed-game action.");
      }
    }
  } catch {
    throw new Error("Completed-game actions cannot be replayed.");
  }

  if (game.phase !== GAME_PHASE.COMPLETE) {
    throw new Error("Shared Play game is not complete.");
  }
  const validated = validateStoredGame(game);
  const botSettings = {
    ...validated.botSettings,
    missedTargetTiming,
  };
  const history = restoreDeveloperDiagnostics(
    validated.history,
    actions,
    developerMode,
  );
  const currentTurn =
    developerMode && validated.currentTurn
      ? restoreCurrentTurnDeveloperDiagnostics(
          validated.currentTurn,
          history,
          validated.turnNumber,
        )
      : validated.currentTurn;
  return {
    ...validated,
    gameId: resolvedGameId,
    developerMode,
    botSettings,
    currentTurn,
    history: history.map((event) =>
      event.type === "game-started"
        ? {
            ...event,
            developerMode,
            botSettings,
          }
        : event,
    ),
  };
}

export function completedGameIdentity(game, boardCode) {
  const board =
    boardCode ??
    encodeBoardParam({
      cards: game.cards.map((card) => ({ ...card, done: false })),
      randomLayoutOrder: game.cards.map((card) => card.layoutId),
      order: BOARD_ORDER.RANDOM,
      language: game.language,
      wordSet: game.wordSet,
      source: { type: "explicit" },
    });
  const seat = `${game.humanSeat.side}:${game.humanSeat.role}`;
  const identity = JSON.stringify([board, game.seed ?? "", seat]);
  return `g_${stableHash(identity)}${stableHash(
    [...identity].reverse().join(""),
  )}`;
}

function validPayloadShape(payload) {
  const current = payload.length === 9;
  const hasDeveloperMode = payload.length >= 8;
  const offset = current ? 1 : 0;
  const rawSettings = payload[4 + offset];
  const actions = payload[hasDeveloperMode ? 7 + offset : 6 + offset];
  return (
    typeof payload[2 + offset] === "string" &&
    Array.isArray(rawSettings) &&
    [6, 7].includes(rawSettings.length) &&
    Array.isArray(actions) &&
    actions.length <= MAX_ACTIONS &&
    (!hasDeveloperMode ||
      payload[6 + offset] === 0 ||
      payload[6 + offset] === 1)
  );
}

function actionDeveloperDiagnostics(action, developerMode) {
  const diagnosticIndex = {
    [ACTION.CLUE]: 4,
    [ACTION.GUESS]: 2,
    [ACTION.PASS]: 1,
  }[action[0]];
  const diagnostics = action[diagnosticIndex];
  if (diagnostics === undefined) {
    return null;
  }
  if (!developerMode) {
    throw new Error("Normal game contains developer diagnostics.");
  }
  return validatedDeveloperDiagnostics(diagnostics);
}

function validatedDeveloperDiagnostics(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.diagnosticsVersion !== 1
  ) {
    throw new Error("Unsupported developer diagnostics.");
  }
  const serialized = JSON.stringify(value);
  if (
    new TextEncoder().encode(serialized).length >
      MAX_DIAGNOSTIC_BYTES ||
    !validateDiagnosticValue(value)
  ) {
    throw new Error("Developer diagnostics are too large or deeply nested.");
  }
  return structuredClone(value);
}

function validateDiagnosticValue(
  value,
  depth = 0,
  counter = { items: 0 },
) {
  counter.items += 1;
  if (
    depth > MAX_DIAGNOSTIC_DEPTH ||
    counter.items > MAX_DIAGNOSTIC_ITEMS
  ) {
    return false;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return typeof value !== "string" || value.length <= 2_048;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return (
      value.length <= 128 &&
      value.every((item) =>
        validateDiagnosticValue(item, depth + 1, counter),
      )
    );
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length <= 64 &&
    entries.every(
      ([key, item]) =>
        key.length <= 128 &&
        key !== "__proto__" &&
        key !== "constructor" &&
        key !== "prototype" &&
        validateDiagnosticValue(item, depth + 1, counter),
    )
  );
}

function restoreDeveloperDiagnostics(history, actions, developerMode) {
  if (!developerMode) {
    return history;
  }
  let actionIndex = 0;
  return history.map((event) => {
    if (
      !["clue-given", "card-guessed", "turn-passed"].includes(
        event.type,
      )
    ) {
      return event;
    }
    const action = actions[actionIndex];
    actionIndex += 1;
    const diagnostics = actionDeveloperDiagnostics(action, true);
    return diagnostics
      ? { ...event, developerDiagnostics: diagnostics }
      : event;
  });
}

function restoreCurrentTurnDeveloperDiagnostics(
  currentTurn,
  history,
  turnNumber,
) {
  const clueEvent = history.find(
    (event) =>
      event.type === "clue-given" &&
      event.turn === turnNumber &&
      event.side === currentTurn.side,
  );
  const guesses = currentTurn.guesses.map((guess) => {
    const guessEvent = history.find(
      (event) =>
        event.type === "card-guessed" &&
        event.turn === turnNumber &&
        event.side === currentTurn.side &&
        event.layoutId === guess.layoutId,
    );
    return guessEvent?.developerDiagnostics
      ? {
          ...guess,
          developerDiagnostics: guessEvent.developerDiagnostics,
        }
      : guess;
  });
  return {
    ...currentTurn,
    guesses,
    ...(clueEvent?.developerDiagnostics
      ? { developerDiagnostics: clueEvent.developerDiagnostics }
      : {}),
  };
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (padded.length % 4 || 4)) % 4);
  const binary = atob(padded + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
