import {
  BOARD_ORDER,
  createGeneratedBoardState,
} from "../board-share.js";
import {
  getWordsForSet,
  LANGUAGE,
  WORD_SET_OPTIONS_BY_LANGUAGE,
} from "../word-data.js";
import { createSeededRandom } from "./bots.js";

const CARD_COUNT = 25;

export const PLAY_WORD_REUSE_STORAGE_KEY =
  "codenames-play-word-reuse-v1";
export const MAX_WORD_HISTORY_BOARDS = 32;

export const PLAY_WORD_REUSE_POLICY = Object.freeze({
  FULLY_RANDOM: "fully-random",
  AVOID_RECENT: "avoid-recent",
});

const POLICIES = new Set(Object.values(PLAY_WORD_REUSE_POLICY));

export function createDefaultWordReuseState() {
  return {
    schemaVersion: 1,
    policy: PLAY_WORD_REUSE_POLICY.FULLY_RANDOM,
    boards: [],
  };
}

export function normalizeWordReusePolicy(value) {
  return POLICIES.has(value)
    ? value
    : PLAY_WORD_REUSE_POLICY.FULLY_RANDOM;
}

export function normalizeWordReuseState(value) {
  if (!value || value.schemaVersion !== 1) {
    return createDefaultWordReuseState();
  }

  const boards = Array.isArray(value.boards)
    ? value.boards
        .map(normalizeStoredBoard)
        .filter(Boolean)
        .slice(-MAX_WORD_HISTORY_BOARDS)
    : [];

  return {
    schemaVersion: 1,
    policy: normalizeWordReusePolicy(value.policy),
    boards,
  };
}

export function loadWordReuseState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PLAY_WORD_REUSE_STORAGE_KEY);
    return raw
      ? normalizeWordReuseState(JSON.parse(raw))
      : createDefaultWordReuseState();
  } catch {
    return createDefaultWordReuseState();
  }
}

export function saveWordReuseState(
  value,
  storage = globalThis.localStorage,
) {
  try {
    storage?.setItem(
      PLAY_WORD_REUSE_STORAGE_KEY,
      JSON.stringify(normalizeWordReuseState(value)),
    );
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function setWordReusePolicy(state, policy) {
  return {
    ...normalizeWordReuseState(state),
    policy: normalizeWordReusePolicy(policy),
  };
}

export function clearWordReuseHistory(state) {
  return {
    ...normalizeWordReuseState(state),
    boards: [],
  };
}

export function recordBoardWords(state, cards) {
  const normalized = normalizeWordReuseState(state);
  const words = normalizeStoredBoard(
    cards.map((card) => card?.word),
  );
  if (!words || words.length !== CARD_COUNT) {
    return normalized;
  }

  return {
    ...normalized,
    boards: [...normalized.boards, words].slice(
      -MAX_WORD_HISTORY_BOARDS,
    ),
  };
}

export function createPlayBoardWithWordReuse({
  language = LANGUAGE.ENGLISH,
  seed,
  state,
  wordSet,
}) {
  const normalized = normalizeWordReuseState(state);
  const generated = createGeneratedBoardState(
    seed,
    BOARD_ORDER.RANDOM,
    wordSet,
    language,
  );

  if (normalized.policy === PLAY_WORD_REUSE_POLICY.FULLY_RANDOM) {
    return {
      board: generated,
      repeatsRequired: 0,
      unseenCount: countUnseenWords(normalized, wordSet, language),
    };
  }

  const plan = planAvoidRecentWords({
    seed,
    state: normalized,
    wordSet,
    language,
  });
  return {
    board: {
      ...generated,
      cards: generated.cards.map((card, index) => ({
        ...card,
        word: plan.words[index],
      })),
      source: { type: "explicit" },
    },
    repeatsRequired: plan.repeatsRequired,
    unseenCount: plan.unseenCount,
  };
}

export function planAvoidRecentWords({
  language = LANGUAGE.ENGLISH,
  seed,
  state,
  wordSet,
}) {
  const normalized = normalizeWordReuseState(state);
  const pool = getWordsForSet(wordSet, language);
  const lastSeen = lastSeenBoardByWord(normalized.boards, pool);
  const random = createSeededRandom(`${seed}:word-reuse`);
  const tieBreakers = new Map(
    pool.map((word) => [word, random()]),
  );
  const unseen = pool
    .filter((word) => !lastSeen.has(word))
    .sort(
      (left, right) =>
        tieBreakers.get(left) - tieBreakers.get(right),
    );
  const recent = pool
    .filter((word) => lastSeen.has(word))
    .sort(
      (left, right) =>
        lastSeen.get(left) - lastSeen.get(right) ||
        tieBreakers.get(left) - tieBreakers.get(right),
    );
  const words = [...unseen, ...recent].slice(0, CARD_COUNT);

  if (words.length !== CARD_COUNT) {
    throw new Error("The selected word pool cannot fill a board.");
  }

  return {
    words,
    unseenCount: unseen.length,
    repeatsRequired: Math.max(0, CARD_COUNT - unseen.length),
  };
}

export function countUnseenWords(
  state,
  wordSet,
  language = LANGUAGE.ENGLISH,
) {
  const pool = getWordsForSet(wordSet, language);
  return pool.length - lastSeenBoardByWord(
    normalizeWordReuseState(state).boards,
    pool,
  ).size;
}

export function wordReuseStatus(
  state,
  wordSet,
  language = LANGUAGE.ENGLISH,
) {
  const normalized = normalizeWordReuseState(state);
  const option = WORD_SET_OPTIONS_BY_LANGUAGE[language]?.[wordSet];
  const unseenCount = countUnseenWords(
    normalized,
    wordSet,
    language,
  );

  if (
    normalized.policy === PLAY_WORD_REUSE_POLICY.FULLY_RANDOM
  ) {
    return {
      tone: "neutral",
      text: "",
    };
  }

  if (unseenCount > CARD_COUNT) {
    return {
      tone: "neutral",
      text: "",
    };
  }

  if (unseenCount === CARD_COUNT) {
    return {
      tone: "warning",
      text:
        language === LANGUAGE.ITALIAN
          ? `Ultimo tabellone ${option.label} senza ripetizioni. Cancella la cronologia prima della partita successiva per evitare ripetizioni.`
          : `Last repeat-free ${option.label} board. Clear history before the following game to avoid repeats.`,
    };
  }

  const repeats = CARD_COUNT - unseenCount;
  return {
    tone: "warning",
    text:
      language === LANGUAGE.ITALIAN
        ? `Restano solo ${unseenCount} parole ${option.label} non usate. Il prossimo tabellone deve ripeterne almeno ${repeats}.`
        : `Only ${unseenCount} unseen ${option.label} words remain. The next board must reuse at least ${repeats}.`,
  };
}

function normalizeStoredBoard(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const words = [
    ...new Set(
      value
        .filter((word) => typeof word === "string")
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ].slice(0, CARD_COUNT);
  return words.length > 0 ? words : null;
}

function lastSeenBoardByWord(boards, pool) {
  const poolWords = new Set(pool);
  const lastSeen = new Map();
  for (const [boardIndex, board] of boards.entries()) {
    for (const word of board) {
      if (poolWords.has(word)) {
        lastSeen.set(word, boardIndex);
      }
    }
  }
  return lastSeen;
}
