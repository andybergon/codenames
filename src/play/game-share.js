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
import { PLAY_CLUE_REPEAT_POLICY } from "./settings.js";
import { PLAY_WORD_REUSE_POLICY } from "./word-reuse.js";

const SHARE_VERSION = 3;
const COMPLETED_SHARE_VERSION = 2;
const LEGACY_SHARE_VERSION = 1;
const PLAY_RULES_VERSION = 2;
const LEGACY_PLAY_RULES_VERSION = 1;
const REPLAYABLE_RULES_VERSIONS = new Set([
  LEGACY_PLAY_RULES_VERSION,
  PLAY_RULES_VERSION,
]);
const SETTINGS_VERSION = 2;
const MAX_SHARE_LENGTH = 12_000;
const MAX_ACTIONS = 512;
const MAX_DIAGNOSTIC_BYTES = 12_288;
const MAX_DIAGNOSTIC_DEPTH = 8;
const MAX_DIAGNOSTIC_ITEMS = 512;
const MISSED_TARGET_TIMINGS = new Set([
  "late",
  "balanced",
  "immediate",
]);
const CLUE_REPEAT_POLICIES = new Set(
  Object.values(PLAY_CLUE_REPEAT_POLICY),
);
const ACTION = Object.freeze({
  CLUE: "c",
  GUESS: "g",
  PASS: "p",
});
const SIDE_CODE = Object.freeze({
  blue: "b",
  red: "r",
});
const SIDE_FROM_CODE = new Map(
  Object.entries(SIDE_CODE).map(([side, code]) => [code, side]),
);
const ACTOR_CODE = Object.freeze({
  human: "h",
  bot: "b",
});
const ACTOR_FROM_CODE = new Map(
  Object.entries(ACTOR_CODE).map(([actor, code]) => [code, actor]),
);
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
  options = {},
) {
  const validated = validateStoredGame(game);
  if (validated.phase !== GAME_PHASE.COMPLETE) {
    throw new Error("Only completed Play games can be shared.");
  }
  return encodePlayGame(validated, options);
}

export function encodePlayGame(
  game,
  {
    includeDeveloperDiagnostics = false,
    maxLength = MAX_SHARE_LENGTH,
  } = {},
) {
  const validated = validateStoredGame(game);

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
  const rulesVersion = REPLAYABLE_RULES_VERSIONS.has(
    validated.shareMetadata?.rulesVersion,
  )
    ? validated.shareMetadata.rulesVersion
    : PLAY_RULES_VERSION;
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
        event.turn,
        SIDE_CODE[event.side],
        ACTOR_CODE[event.actor],
        event.clue,
        event.number,
        [...(event.intendedLayoutIds ?? [])],
        ...(developerDiagnostics ? [developerDiagnostics] : []),
      ]];
    }
    if (event.type === "card-guessed") {
      return [[
        ACTION.GUESS,
        event.turn,
        SIDE_CODE[event.side],
        ACTOR_CODE[event.actor],
        event.layoutId,
        ...(developerDiagnostics ? [developerDiagnostics] : []),
      ]];
    }
    if (event.type === "turn-passed") {
      return [[
        ACTION.PASS,
        event.turn,
        SIDE_CODE[event.side],
        ACTOR_CODE[event.actor],
        ...(developerDiagnostics ? [developerDiagnostics] : []),
      ]];
    }
    return [];
  });
  const payload = [
    SHARE_VERSION,
    rulesVersion,
    SETTINGS_VERSION,
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
      settings.clueRepeatPolicy,
    ],
    WORD_REUSE_CODE[validated.wordReusePolicy],
    validated.developerMode === true ? 1 : 0,
    validated.phase === GAME_PHASE.COMPLETE
      ? [SIDE_CODE[validated.winner], validated.endReason]
      : null,
    actions,
  ];
  const code = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  if (code.length > maxLength) {
    throw new Error("Play game is too large to share in a link.");
  }
  return code;
}

export function decodeCompletedGame(
  code,
  options = {},
) {
  const game = decodePlayGame(code, options);
  if (game.phase !== GAME_PHASE.COMPLETE) {
    throw new Error("Shared Play game is not complete.");
  }
  return game;
}

export function decodePlayGame(
  code,
  { maxLength = MAX_SHARE_LENGTH } = {},
) {
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    code.length > maxLength ||
    !/^[A-Za-z0-9_-]+$/u.test(code)
  ) {
    throw new Error("Invalid Play-game code.");
  }

  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64UrlToBytes(code),
      ),
    );
  } catch {
    throw new Error("Invalid Play-game code.");
  }

  return decodeParsedCompletedGame(parseCompletedPayload(payload));
}

function decodeParsedCompletedGame(parsed) {
  const {
    actions: rawActions,
    boardCode,
    developerMode,
    gameId,
    outcome,
    rawSettings,
    reuseCode,
    seed,
    seatCode,
  } = parsed;
  const seatValue = SEAT_FROM_CODE.get(seatCode);
  const wordReusePolicy = WORD_REUSE_FROM_CODE.get(reuseCode);
  if (!seatValue || !wordReusePolicy) {
    throw new Error("Play game contains unsupported settings.");
  }
  const [side, role] = seatValue.split(":");
  const board = decodeBoardParam(boardCode);
  const resolvedGameId = completedGameIdentity(
    { seed, humanSeat: { side, role } },
    boardCode,
  );
  if (gameId !== null && gameId !== resolvedGameId) {
    throw new Error("Play game identity does not match its board.");
  }
  const positions = new Map(
    board.randomLayoutOrder.map((layoutId, index) => [layoutId, index]),
  );
  const cards = [...board.cards].sort(
    (left, right) =>
      positions.get(left.layoutId) - positions.get(right.layoutId),
  );
  const botSettings = decodeSettings(
    rawSettings,
    parsed.settingsVersion,
  );
  const actions = rawActions.map((action) =>
    decodeAction(action, parsed.actionVersion, developerMode),
  );
  if (
    !REPLAYABLE_RULES_VERSIONS.has(parsed.rulesVersion) ||
    botSettings === null
  ) {
    return reconstructHistoricalGame({
      actions,
      board,
      botSettings,
      cards,
      parsed,
      resolvedGameId,
      role,
      side,
      wordReusePolicy,
    });
  }

  let game = createPlayGame({
    cards,
    developerMode,
    humanSeat: { side, role },
    language: board.language,
    seed,
    wordSet: board.wordSet,
    wordReusePolicy,
    botSettings,
  });

  try {
    for (const action of actions) {
      if (action.type === ACTION.CLUE) {
        validateReplayContext(
          action,
          game,
          PLAYER_ROLE.SPYMASTER,
        );
        game = giveClue(game, {
          clue: action.clue,
          number: action.number,
          intendedLayoutIds: action.intendedLayoutIds,
          developerDiagnostics: action.developerDiagnostics,
          useLegacyClueRules:
            parsed.rulesVersion === LEGACY_PLAY_RULES_VERSION,
          actor: actorForSeat(
            game,
            game.activeSide,
            PLAYER_ROLE.SPYMASTER,
          ),
        });
      } else if (action.type === ACTION.GUESS) {
        validateReplayContext(
          action,
          game,
          PLAYER_ROLE.OPERATIVE,
        );
        game = guessCard(game, {
          layoutId: action.layoutId,
          developerDiagnostics: action.developerDiagnostics,
          actor: actorForSeat(
            game,
            game.activeSide,
            PLAYER_ROLE.OPERATIVE,
          ),
        });
      } else if (action.type === ACTION.PASS) {
        validateReplayContext(
          action,
          game,
          PLAYER_ROLE.OPERATIVE,
        );
        game = passTurn(game, {
          developerDiagnostics: action.developerDiagnostics,
          actor: actorForSeat(
            game,
            game.activeSide,
            PLAYER_ROLE.OPERATIVE,
          ),
        });
      } else {
        throw new Error("Invalid Play-game action.");
      }
    }
  } catch {
    throw new Error("Play-game actions cannot be replayed.");
  }

  if (
    parsed.supportsActive &&
    ((outcome === null && game.phase === GAME_PHASE.COMPLETE) ||
      (outcome !== null && game.phase !== GAME_PHASE.COMPLETE))
  ) {
    throw new Error("Shared Play game phase does not match its outcome.");
  }
  if (!parsed.supportsActive && game.phase !== GAME_PHASE.COMPLETE) {
    throw new Error("Shared Play game is not complete.");
  }
  if (
    outcome &&
    (game.winner !== outcome.winner ||
      game.endReason !== outcome.endReason)
  ) {
    throw new Error("Play-game outcome does not match its actions.");
  }
  const validated = validateStoredGame(game);
  const normalizedBotSettings = {
    ...validated.botSettings,
    missedTargetTiming: botSettings.missedTargetTiming,
    clueRepeatPolicy: botSettings.clueRepeatPolicy,
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
    botSettings: normalizedBotSettings,
    reviewCompatibility: "full",
    shareMetadata: completedGameMetadata(parsed, "full"),
    currentTurn,
    history: history.map((event) =>
      event.type === "game-started"
        ? {
            ...event,
            developerMode,
            botSettings: normalizedBotSettings,
          }
        : event,
    ),
  };
}

function parseCompletedPayload(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Unsupported Play-game code.");
  }
  if (
    payload[0] === SHARE_VERSION ||
    payload[0] === COMPLETED_SHARE_VERSION
  ) {
    const supportsActive = payload[0] === SHARE_VERSION;
    if (!validCurrentPayloadShape(payload, supportsActive)) {
      throw new Error("Unsupported Play-game code.");
    }
    return {
      formatVersion: payload[0],
      rulesVersion: payload[1],
      settingsVersion: payload[2],
      gameId: payload[3],
      boardCode: payload[4],
      seed: payload[5],
      seatCode: payload[6],
      rawSettings: payload[7],
      reuseCode: payload[8],
      developerMode: payload[9] === 1,
      outcome:
        payload[10] === null
          ? null
          : {
              winner: SIDE_FROM_CODE.get(payload[10][0]),
              endReason: payload[10][1],
            },
      actions: payload[11],
      actionVersion: 2,
      supportsActive,
    };
  }
  if (
    payload[0] !== LEGACY_SHARE_VERSION ||
    !validLegacyPayloadShape(payload)
  ) {
    throw new Error("Unsupported Play-game code.");
  }
  const currentLegacy = payload.length === 9;
  const hasDeveloperMode = payload.length >= 8;
  const offset = currentLegacy ? 1 : 0;
  const rawSettings = payload[4 + offset];
  return {
    formatVersion: LEGACY_SHARE_VERSION,
    rulesVersion: LEGACY_PLAY_RULES_VERSION,
    settingsVersion: rawSettings.length === 7 ? 1 : 0,
    gameId: currentLegacy ? payload[1] : null,
    boardCode: payload[1 + offset],
    seed: payload[2 + offset],
    seatCode: payload[3 + offset],
    rawSettings,
    reuseCode: payload[5 + offset],
    developerMode: hasDeveloperMode
      ? payload[6 + offset] === 1
      : false,
    outcome: null,
    actions: payload[hasDeveloperMode ? 7 + offset : 6 + offset],
    actionVersion: 1,
    supportsActive: false,
  };
}

function validCurrentPayloadShape(payload, supportsActive) {
  const outcome = payload[10];
  const validOutcome =
    supportsActive && outcome === null
      ? true
      : Array.isArray(outcome) &&
        outcome.length === 2 &&
        SIDE_FROM_CODE.has(outcome[0]) &&
        ["agents", "assassin"].includes(outcome[1]);
  return (
    payload.length === 12 &&
    Number.isInteger(payload[1]) &&
    payload[1] >= 1 &&
    Number.isInteger(payload[2]) &&
    payload[2] >= 1 &&
    typeof payload[3] === "string" &&
    typeof payload[4] === "string" &&
    typeof payload[5] === "string" &&
    typeof payload[6] === "string" &&
    Array.isArray(payload[7]) &&
    payload[7].length <= 32 &&
    typeof payload[8] === "string" &&
    (payload[9] === 0 || payload[9] === 1) &&
    validOutcome &&
    Array.isArray(payload[11]) &&
    payload[11].length <= MAX_ACTIONS
  );
}

function validLegacyPayloadShape(payload) {
  if (![7, 8, 9].includes(payload.length)) {
    return false;
  }
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

function decodeSettings(rawSettings, settingsVersion) {
  const currentSettings =
    settingsVersion === SETTINGS_VERSION && rawSettings.length === 8;
  const previousSettings =
    settingsVersion === 1 && rawSettings.length === 7;
  const legacySettings =
    settingsVersion === 0 && [6, 7].includes(rawSettings.length);
  if (!currentSettings && !previousSettings && !legacySettings) {
    return null;
  }
  const includesTiming = rawSettings.length >= 7;
  const missedTargetTiming = includesTiming
    ? rawSettings[4]
    : "late";
  if (!MISSED_TARGET_TIMINGS.has(missedTargetTiming)) {
    throw new Error("Play game contains unsupported settings.");
  }
  const clueRepeatPolicy = currentSettings
    ? rawSettings[7]
    : PLAY_CLUE_REPEAT_POLICY.NEVER;
  if (!CLUE_REPEAT_POLICIES.has(clueRepeatPolicy)) {
    throw new Error("Play game contains unsupported settings.");
  }
  return {
    modelId: rawSettings[0],
    candidateCount: rawSettings[1],
    cluePolicy: rawSettings[2],
    multiTolerance: rawSettings[3],
    missedTargetTiming,
    operativeAggression: rawSettings[includesTiming ? 5 : 4],
    bonusGuesses: rawSettings[includesTiming ? 6 : 5],
    clueRepeatPolicy,
  };
}

function decodeAction(action, actionVersion, developerMode) {
  if (!Array.isArray(action) || action.length === 0) {
    throw new Error("Invalid Play-game action.");
  }
  if (actionVersion === 1) {
    return decodeLegacyAction(action, developerMode);
  }
  const context = decodeActionContext(action);
  if (
    action[0] === ACTION.CLUE &&
    [7, 8].includes(action.length) &&
    typeof action[4] === "string" &&
    Number.isInteger(action[5]) &&
    Array.isArray(action[6])
  ) {
    return {
      ...context,
      type: ACTION.CLUE,
      clue: action[4],
      number: action[5],
      intendedLayoutIds: action[6],
      developerDiagnostics: decodeActionDiagnostics(
        action[7],
        developerMode,
      ),
    };
  }
  if (
    action[0] === ACTION.GUESS &&
    [5, 6].includes(action.length) &&
    Number.isInteger(action[4])
  ) {
    return {
      ...context,
      type: ACTION.GUESS,
      layoutId: action[4],
      developerDiagnostics: decodeActionDiagnostics(
        action[5],
        developerMode,
      ),
    };
  }
  if (
    action[0] === ACTION.PASS &&
    [4, 5].includes(action.length)
  ) {
    return {
      ...context,
      type: ACTION.PASS,
      developerDiagnostics: decodeActionDiagnostics(
        action[4],
        developerMode,
      ),
    };
  }
  throw new Error("Invalid Play-game action.");
}

function decodeActionContext(action) {
  const side = SIDE_FROM_CODE.get(action[2]);
  const actor = ACTOR_FROM_CODE.get(action[3]);
  if (
    !Number.isInteger(action[1]) ||
    action[1] < 1 ||
    !side ||
    !actor
  ) {
    throw new Error("Invalid Play-game action context.");
  }
  return { turn: action[1], side, actor };
}

function decodeLegacyAction(action, developerMode) {
  if (
    action[0] === ACTION.CLUE &&
    [4, 5].includes(action.length)
  ) {
    return {
      type: ACTION.CLUE,
      clue: action[1],
      number: action[2],
      intendedLayoutIds: action[3],
      developerDiagnostics: decodeActionDiagnostics(
        action[4],
        developerMode,
      ),
    };
  }
  if (
    action[0] === ACTION.GUESS &&
    [2, 3].includes(action.length)
  ) {
    return {
      type: ACTION.GUESS,
      layoutId: action[1],
      developerDiagnostics: decodeActionDiagnostics(
        action[2],
        developerMode,
      ),
    };
  }
  if (
    action[0] === ACTION.PASS &&
    [1, 2].includes(action.length)
  ) {
    return {
      type: ACTION.PASS,
      developerDiagnostics: decodeActionDiagnostics(
        action[1],
        developerMode,
      ),
    };
  }
  throw new Error("Invalid Play-game action.");
}

function decodeActionDiagnostics(value, developerMode) {
  if (value === undefined) {
    return null;
  }
  if (!developerMode) {
    throw new Error("Normal game contains developer diagnostics.");
  }
  return validatedDeveloperDiagnostics(value);
}

function validateReplayContext(action, game, role) {
  if (action.turn === undefined) {
    return;
  }
  const expectedActor = actorForSeat(game, game.activeSide, role);
  if (
    action.turn !== game.turnNumber ||
    action.side !== game.activeSide ||
    action.actor !== expectedActor
  ) {
    throw new Error("Play-game action context cannot be replayed.");
  }
}

function reconstructHistoricalGame({
  actions,
  board,
  botSettings,
  cards,
  parsed,
  resolvedGameId,
  role,
  side,
  wordReusePolicy,
}) {
  if (!parsed.outcome) {
    throw new Error("Historical completed game has no explicit outcome.");
  }
  const base = createPlayGame({
    cards,
    developerMode: parsed.developerMode,
    humanSeat: { side, role },
    language: board.language,
    seed: parsed.seed,
    wordSet: board.wordSet,
    wordReusePolicy,
    botSettings: botSettings ?? {},
  });
  const restoredCards = base.cards.map((card) => ({ ...card }));
  const history = [
    {
      ...base.history[0],
      developerMode: parsed.developerMode,
    },
  ];
  for (const action of actions) {
    if (action.type === ACTION.CLUE) {
      history.push({
        type: "clue-given",
        turn: action.turn,
        side: action.side,
        actor: action.actor,
        clue: action.clue,
        number: action.number,
        intendedLayoutIds: [...action.intendedLayoutIds],
        ...(action.developerDiagnostics
          ? { developerDiagnostics: action.developerDiagnostics }
          : {}),
      });
      continue;
    }
    if (action.type === ACTION.GUESS) {
      const card = restoredCards.find(
        (candidate) => candidate.layoutId === action.layoutId,
      );
      if (!card || card.done) {
        throw new Error("Historical completed game contains an invalid guess.");
      }
      card.done = true;
      card.revealedBy = action.side;
      card.revealedTurn = action.turn;
      history.push({
        type: "card-guessed",
        turn: action.turn,
        side: action.side,
        actor: action.actor,
        layoutId: action.layoutId,
        word: card.word,
        team: card.team,
        ...(action.developerDiagnostics
          ? { developerDiagnostics: action.developerDiagnostics }
          : {}),
      });
      continue;
    }
    history.push({
      type: "turn-passed",
      turn: action.turn,
      side: action.side,
      actor: action.actor,
      ...(action.developerDiagnostics
        ? { developerDiagnostics: action.developerDiagnostics }
        : {}),
    });
  }
  const finalAction = actions.at(-1);
  const turnNumber = Math.max(
    1,
    ...actions.map((action) => action.turn ?? 1),
  );
  history.push({
    type: "game-ended",
    turn: turnNumber,
    winner: parsed.outcome.winner,
    reason: parsed.outcome.endReason,
  });
  const historical = validateStoredGame({
    ...base,
    cards: restoredCards,
    activeSide: finalAction?.side ?? "blue",
    phase: GAME_PHASE.COMPLETE,
    turnNumber,
    currentTurn: reconstructHistoricalCurrentTurn(
      history,
      turnNumber,
      finalAction?.side,
    ),
    winner: parsed.outcome.winner,
    endReason: parsed.outcome.endReason,
    history,
  });
  return {
    ...historical,
    gameId: resolvedGameId,
    developerMode: parsed.developerMode,
    reviewCompatibility: "history-only",
    shareMetadata: completedGameMetadata(parsed, "history-only"),
  };
}

function reconstructHistoricalCurrentTurn(history, turn, side) {
  const clue = history
    .filter(
      (event) =>
        event.type === "clue-given" &&
        event.turn === turn &&
        event.side === side,
    )
    .at(-1);
  if (!clue) {
    return null;
  }
  return {
    side,
    clue: clue.clue,
    number: clue.number,
    actor: clue.actor,
    intendedLayoutIds: [...clue.intendedLayoutIds],
    guesses: history
      .filter(
        (event) =>
          event.type === "card-guessed" &&
          event.turn === turn &&
          event.side === side,
      )
      .map((event) => ({
        layoutId: event.layoutId,
        word: event.word,
        team: event.team,
        actor: event.actor,
      })),
  };
}

function completedGameMetadata(parsed, compatibility) {
  return {
    formatVersion: parsed.formatVersion,
    rulesVersion: parsed.rulesVersion,
    settingsVersion: parsed.settingsVersion,
    compatibility,
    rawSettings: structuredClone(parsed.rawSettings),
    actions: structuredClone(parsed.actions),
    outcome: parsed.outcome ? { ...parsed.outcome } : null,
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
    const diagnostics = action?.developerDiagnostics;
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
