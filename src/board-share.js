import {
  DEFAULT_BOARD,
  EXTENDED_WORDS,
  LEGACY_WORD_BANK,
  ROLE_SEQUENCE,
  TEAMS,
  WORD_SET,
  getWordsForSet,
} from "./word-data.js";

export const BOARD_ORDER = Object.freeze({
  SORTED: "sorted",
  RANDOM: "random",
});

const LEGACY_VERSION = "1";
const VERSION = "2";
const SAMPLE_RANDOM_CODE = `${LEGACY_VERSION}pr`;
const SAMPLE_LAYOUT_SEED = "Q09ERU5BTUU";
const CARD_COUNT = 25;
const WORD_BITS = 9;
const WORD_ESCAPE = 2 ** WORD_BITS - 1;
const TEAM_BITS = 2;
const LAYOUT_BITS = 5;
const MAX_LITERAL_BYTES = 1024;
const MAX_PARAM_LENGTH = 4096;
const WORD_SET_CODE = Object.freeze({
  [WORD_SET.OFFICIAL]: "o",
  [WORD_SET.EXTENDED]: "x",
});
const WORD_SET_FROM_CODE = new Map(
  Object.entries(WORD_SET_CODE).map(([wordSet, code]) => [code, wordSet]),
);
const WORD_INDEX = new Map(EXTENDED_WORDS.map((word, index) => [word, index]));
const TEAM_INDEX = new Map(TEAMS.map((team, index) => [team.id, index]));

export function createRandomSeed() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function createSampleBoardState(order = BOARD_ORDER.SORTED) {
  const random = createSeededRandom(SAMPLE_LAYOUT_SEED);
  const cards = withLayoutIds(DEFAULT_BOARD);
  return {
    cards,
    randomLayoutOrder: shuffle(
      cards.map((card) => card.layoutId),
      random,
    ),
    order,
    wordSet: WORD_SET.OFFICIAL,
    source: { type: "sample" },
  };
}

export function createGeneratedBoardState(
  seed,
  order = BOARD_ORDER.SORTED,
  wordSet = WORD_SET.OFFICIAL,
) {
  validateWordSet(wordSet);
  return createSeededBoardState({
    seed,
    order,
    wordSet,
    words: getWordsForSet(wordSet),
    source: { type: "seed", seed },
  });
}

function createLegacyGeneratedBoardState(seed, order) {
  return createSeededBoardState({
    seed,
    order,
    wordSet: WORD_SET.EXTENDED,
    words: LEGACY_WORD_BANK,
    source: { type: "legacy-seed", seed },
  });
}

function createSeededBoardState({ seed, order, wordSet, words, source }) {
  const random = createSeededRandom(seed);
  const boardWords = shuffle([...words], random).slice(0, CARD_COUNT);
  const cards = withLayoutIds(
    boardWords.map((word, index) => ({
      word,
      team: ROLE_SEQUENCE[index],
      done: false,
    })),
  );

  return {
    cards,
    randomLayoutOrder: shuffle(
      cards.map((card) => card.layoutId),
      random,
    ),
    order,
    wordSet,
    source,
  };
}

export function decodeBoardParam(value) {
  if (!value) {
    return createSampleBoardState();
  }
  if (value.length > MAX_PARAM_LENGTH) {
    throw new Error("Board code is too long.");
  }
  if (value === SAMPLE_RANDOM_CODE) {
    return createSampleBoardState(BOARD_ORDER.RANDOM);
  }

  const legacySeedMatch = value.match(/^1s([A-Za-z0-9_-]{11})([sr])$/);
  if (legacySeedMatch) {
    return createLegacyGeneratedBoardState(
      legacySeedMatch[1],
      legacySeedMatch[2] === "r" ? BOARD_ORDER.RANDOM : BOARD_ORDER.SORTED,
    );
  }

  const seedMatch = value.match(/^2s([A-Za-z0-9_-]{11})([ox])([sr])$/);
  if (seedMatch) {
    const wordSet = WORD_SET_FROM_CODE.get(seedMatch[2]);
    return createGeneratedBoardState(
      seedMatch[1],
      seedMatch[3] === "r" ? BOARD_ORDER.RANDOM : BOARD_ORDER.SORTED,
      wordSet,
    );
  }
  if (value.startsWith(`${LEGACY_VERSION}e`)) {
    return decodeExplicitBoard(
      value.slice(2),
      LEGACY_WORD_BANK,
      WORD_SET.EXTENDED,
    );
  }
  const explicitMatch = value.match(/^2e([ox])(.+)$/);
  if (explicitMatch) {
    return decodeExplicitBoard(
      explicitMatch[2],
      EXTENDED_WORDS,
      WORD_SET_FROM_CODE.get(explicitMatch[1]),
    );
  }

  throw new Error("Unsupported board code.");
}

export function encodeBoardParam({ cards, randomLayoutOrder, order, source, wordSet }) {
  validateOrder(order);
  validateWordSet(wordSet);

  if (source.type === "sample") {
    return order === BOARD_ORDER.RANDOM ? SAMPLE_RANDOM_CODE : null;
  }
  if (source.type === "seed") {
    validateSeed(source.seed);
    return `${VERSION}s${source.seed}${WORD_SET_CODE[wordSet]}${
      order === BOARD_ORDER.RANDOM ? "r" : "s"
    }`;
  }
  if (source.type === "legacy-seed") {
    validateSeed(source.seed);
    return `${LEGACY_VERSION}s${source.seed}${
      order === BOARD_ORDER.RANDOM ? "r" : "s"
    }`;
  }
  if (source.type === "explicit") {
    return `${VERSION}e${WORD_SET_CODE[wordSet]}${encodeExplicitBoard(
      cards,
      randomLayoutOrder,
      order,
      WORD_INDEX,
    )}`;
  }

  throw new Error("Unsupported board source.");
}

function encodeExplicitBoard(cards, randomLayoutOrder, order, wordIndex) {
  const canonicalCards = canonicalizeCards(cards);
  validateLayoutOrder(randomLayoutOrder);
  const writer = createBitWriter();
  writer.write(order === BOARD_ORDER.RANDOM ? 1 : 0, 1);

  for (const card of canonicalCards) {
    const wordCode = wordIndex.get(card.word);
    if (wordCode === undefined) {
      const literal = new TextEncoder().encode(card.word);
      if (literal.length > MAX_LITERAL_BYTES) {
        throw new Error("A board word is too long to share.");
      }
      writer.write(WORD_ESCAPE, WORD_BITS);
      writer.write(literal.length, 16);
      for (const byte of literal) {
        writer.write(byte, 8);
      }
    } else {
      writer.write(wordCode, WORD_BITS);
    }

    const teamIndex = TEAM_INDEX.get(card.team);
    if (teamIndex === undefined) {
      throw new Error(`Unknown card role: ${card.team}`);
    }
    writer.write(teamIndex, TEAM_BITS);
  }

  for (const layoutId of randomLayoutOrder) {
    writer.write(layoutId, LAYOUT_BITS);
  }

  return bytesToBase64Url(writer.finish());
}

function decodeExplicitBoard(value, wordBank, wordSet) {
  const reader = createBitReader(base64UrlToBytes(value));
  const order = reader.read(1) === 1 ? BOARD_ORDER.RANDOM : BOARD_ORDER.SORTED;
  const cards = [];

  for (let layoutId = 0; layoutId < CARD_COUNT; layoutId += 1) {
    const wordCode = reader.read(WORD_BITS);
    let word;
    if (wordCode === WORD_ESCAPE) {
      const length = reader.read(16);
      if (length > MAX_LITERAL_BYTES) {
        throw new Error("A shared board word is too long.");
      }
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = reader.read(8);
      }
      word = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } else {
      word = wordBank[wordCode];
      if (word === undefined) {
        throw new Error("Shared board uses an unknown word index.");
      }
    }

    const team = TEAMS[reader.read(TEAM_BITS)];
    if (!team) {
      throw new Error("Shared board uses an unknown role.");
    }
    cards.push({ word, team: team.id, done: false, layoutId });
  }

  const randomLayoutOrder = Array.from({ length: CARD_COUNT }, () =>
    reader.read(LAYOUT_BITS),
  );
  validateLayoutOrder(randomLayoutOrder);

  return {
    cards,
    randomLayoutOrder,
    order,
    wordSet,
    source: { type: "explicit" },
  };
}

function createSeededRandom(seed) {
  const bytes = base64UrlToBytes(seed);
  if (bytes.length !== 8) {
    throw new Error("Board seed must contain eight bytes.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let a = view.getUint32(0);
  let b = view.getUint32(4);
  let c = (a ^ 0x9e3779b9) >>> 0;
  let d = (b ^ 0x243f6a88) >>> 0;

  const random = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let value = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    value = (value + d) | 0;
    c = (c + value) | 0;
    return (value >>> 0) / 4294967296;
  };

  for (let index = 0; index < 12; index += 1) {
    random();
  }
  return random;
}

function withLayoutIds(cards) {
  if (cards.length !== CARD_COUNT) {
    throw new Error(`A board must contain ${CARD_COUNT} cards.`);
  }
  return cards.map((card, layoutId) => ({ ...card, done: false, layoutId }));
}

function canonicalizeCards(cards) {
  if (cards.length !== CARD_COUNT) {
    throw new Error(`A board must contain ${CARD_COUNT} cards.`);
  }
  const canonical = [...cards].sort((left, right) => left.layoutId - right.layoutId);
  if (canonical.some((card, index) => card.layoutId !== index)) {
    throw new Error("Board card identities are invalid.");
  }
  return canonical;
}

function validateLayoutOrder(order) {
  if (
    order.length !== CARD_COUNT ||
    new Set(order).size !== CARD_COUNT ||
    order.some(
      (layoutId) =>
        !Number.isInteger(layoutId) || layoutId < 0 || layoutId >= CARD_COUNT,
    )
  ) {
    throw new Error("Random board layout is invalid.");
  }
}

function validateOrder(order) {
  if (order !== BOARD_ORDER.SORTED && order !== BOARD_ORDER.RANDOM) {
    throw new Error("Board order is invalid.");
  }
}

function validateWordSet(wordSet) {
  if (wordSet !== WORD_SET.OFFICIAL && wordSet !== WORD_SET.EXTENDED) {
    throw new Error("Board word set is invalid.");
  }
}

function validateSeed(seed) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(seed) || base64UrlToBytes(seed).length !== 8) {
    throw new Error("Board seed is invalid.");
  }
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function createBitWriter() {
  const bytes = [];
  let current = 0;
  let used = 0;

  return {
    write(value, width) {
      for (let bit = width - 1; bit >= 0; bit -= 1) {
        current = (current << 1) | ((value >>> bit) & 1);
        used += 1;
        if (used === 8) {
          bytes.push(current);
          current = 0;
          used = 0;
        }
      }
    },
    finish() {
      if (used > 0) {
        bytes.push(current << (8 - used));
      }
      return Uint8Array.from(bytes);
    },
  };
}

function createBitReader(bytes) {
  let offset = 0;
  return {
    read(width) {
      if (offset + width > bytes.length * 8) {
        throw new Error("Shared board code is truncated.");
      }
      let value = 0;
      for (let index = 0; index < width; index += 1) {
        const byte = bytes[Math.floor(offset / 8)];
        value = (value << 1) | ((byte >>> (7 - (offset % 8))) & 1);
        offset += 1;
      }
      return value;
    },
  };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Board code is not valid base64url.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = globalThis.atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
