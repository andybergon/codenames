import {
  DEFAULT_BOARD,
  EXTENDED_V2_WORDS,
  EXTENDED_WORDS,
  ITALIAN_EXTENDED_WORDS,
  LANGUAGE,
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
const PREVIOUS_VERSION = "2";
const VERSION = "3";
const LANGUAGE_VERSION = "4";
const ITALIAN_ASSET_VERSION = "1";
const SAMPLE_RANDOM_CODE = `${LEGACY_VERSION}pr`;
const SAMPLE_LAYOUT_SEED = "Q09ERU5BTUU";
const CARD_COUNT = 25;
const PREVIOUS_WORD_BITS = 9;
const WORD_BITS = 10;
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
    language: LANGUAGE.ENGLISH,
    wordSet: WORD_SET.OFFICIAL,
    source: { type: "sample" },
  };
}

export function createGeneratedBoardState(
  seed,
  order = BOARD_ORDER.SORTED,
  wordSet = WORD_SET.OFFICIAL,
  language = LANGUAGE.ENGLISH,
) {
  validateLanguageWordSet(language, wordSet);
  return createSeededBoardState({
    seed,
    order,
    language,
    wordSet,
    words: getWordsForSet(wordSet, language),
    source: {
      type: "seed",
      seed,
      version: language === LANGUAGE.ITALIAN ? LANGUAGE_VERSION : VERSION,
      ...(language === LANGUAGE.ITALIAN
        ? { assetVersion: ITALIAN_ASSET_VERSION }
        : {}),
    },
  });
}

function createPreviousGeneratedBoardState(seed, order, wordSet) {
  validateWordSet(wordSet);
  return createSeededBoardState({
    seed,
    order,
    language: LANGUAGE.ENGLISH,
    wordSet,
    words:
      wordSet === WORD_SET.OFFICIAL
        ? getWordsForSet(wordSet, LANGUAGE.ENGLISH)
        : EXTENDED_V2_WORDS,
    source: { type: "seed", seed, version: PREVIOUS_VERSION },
  });
}

function createLegacyGeneratedBoardState(seed, order) {
  return createSeededBoardState({
    seed,
    order,
    language: LANGUAGE.ENGLISH,
    wordSet: WORD_SET.EXTENDED,
    words: LEGACY_WORD_BANK,
    source: { type: "legacy-seed", seed },
  });
}

function createSeededBoardState({ seed, order, language, wordSet, words, source }) {
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
    language,
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

  const seedMatch = value.match(/^([23])s([A-Za-z0-9_-]{11})([ox])([sr])$/);
  if (seedMatch) {
    const wordSet = WORD_SET_FROM_CODE.get(seedMatch[3]);
    const order = seedMatch[4] === "r" ? BOARD_ORDER.RANDOM : BOARD_ORDER.SORTED;
    return seedMatch[1] === PREVIOUS_VERSION
      ? createPreviousGeneratedBoardState(seedMatch[2], order, wordSet)
      : createGeneratedBoardState(seedMatch[2], order, wordSet);
  }
  const languageSeedMatch = value.match(
    /^4s([A-Za-z0-9_-]{11})i1x([sr])$/,
  );
  if (languageSeedMatch) {
    return createGeneratedBoardState(
      languageSeedMatch[1],
      languageSeedMatch[2] === "r"
        ? BOARD_ORDER.RANDOM
        : BOARD_ORDER.SORTED,
      WORD_SET.EXTENDED,
      LANGUAGE.ITALIAN,
    );
  }
  if (value.startsWith(`${LEGACY_VERSION}e`)) {
    return decodeExplicitBoard(
      value.slice(2),
      LEGACY_WORD_BANK,
      WORD_SET.EXTENDED,
      LEGACY_VERSION,
      PREVIOUS_WORD_BITS,
      LANGUAGE.ENGLISH,
    );
  }
  const explicitMatch = value.match(/^([23])e([ox])(.+)$/);
  if (explicitMatch) {
    const isPrevious = explicitMatch[1] === PREVIOUS_VERSION;
    return decodeExplicitBoard(
      explicitMatch[3],
      isPrevious ? EXTENDED_V2_WORDS : EXTENDED_WORDS,
      WORD_SET_FROM_CODE.get(explicitMatch[2]),
      explicitMatch[1],
      isPrevious ? PREVIOUS_WORD_BITS : WORD_BITS,
      LANGUAGE.ENGLISH,
    );
  }
  const languageExplicitMatch = value.match(/^4ei1x(.+)$/);
  if (languageExplicitMatch) {
    return decodeExplicitBoard(
      languageExplicitMatch[1],
      ITALIAN_EXTENDED_WORDS,
      WORD_SET.EXTENDED,
      LANGUAGE_VERSION,
      WORD_BITS,
      LANGUAGE.ITALIAN,
    );
  }

  throw new Error("Unsupported board code.");
}

export function encodeBoardParam({
  cards,
  randomLayoutOrder,
  order,
  source,
  wordSet,
  language = LANGUAGE.ENGLISH,
}) {
  validateOrder(order);
  validateLanguageWordSet(language, wordSet);

  if (source.type === "sample") {
    return order === BOARD_ORDER.RANDOM ? SAMPLE_RANDOM_CODE : null;
  }
  if (source.type === "seed") {
    validateSeed(source.seed);
    if (language === LANGUAGE.ITALIAN) {
      return `${LANGUAGE_VERSION}s${source.seed}i${ITALIAN_ASSET_VERSION}x${
        order === BOARD_ORDER.RANDOM ? "r" : "s"
      }`;
    }
    const version = source.version === PREVIOUS_VERSION ? PREVIOUS_VERSION : VERSION;
    return `${version}s${source.seed}${WORD_SET_CODE[wordSet]}${
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
    if (language === LANGUAGE.ITALIAN) {
      const wordIndex = new Map(
        ITALIAN_EXTENDED_WORDS.map((word, index) => [word, index]),
      );
      return `${LANGUAGE_VERSION}ei${ITALIAN_ASSET_VERSION}x${encodeExplicitBoard(
        cards,
        randomLayoutOrder,
        order,
        wordIndex,
        WORD_BITS,
      )}`;
    }
    const version = [LEGACY_VERSION, PREVIOUS_VERSION].includes(source.version)
      ? source.version
      : VERSION;
    const isLegacy = version === LEGACY_VERSION;
    const isPrevious = version === PREVIOUS_VERSION;
    const wordBank = isLegacy ? LEGACY_WORD_BANK : isPrevious ? EXTENDED_V2_WORDS : EXTENDED_WORDS;
    const wordBits = isPrevious || isLegacy ? PREVIOUS_WORD_BITS : WORD_BITS;
    const wordIndex = new Map(wordBank.map((word, index) => [word, index]));
    return `${version}e${isLegacy ? "" : WORD_SET_CODE[wordSet]}${encodeExplicitBoard(
      cards,
      randomLayoutOrder,
      order,
      wordIndex,
      wordBits,
    )}`;
  }

  throw new Error("Unsupported board source.");
}

function encodeExplicitBoard(cards, randomLayoutOrder, order, wordIndex, wordBits) {
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
      writer.write(2 ** wordBits - 1, wordBits);
      writer.write(literal.length, 16);
      for (const byte of literal) {
        writer.write(byte, 8);
      }
    } else {
      writer.write(wordCode, wordBits);
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

function decodeExplicitBoard(
  value,
  wordBank,
  wordSet,
  version,
  wordBits,
  language,
) {
  const reader = createBitReader(base64UrlToBytes(value));
  const order = reader.read(1) === 1 ? BOARD_ORDER.RANDOM : BOARD_ORDER.SORTED;
  const cards = [];

  for (let layoutId = 0; layoutId < CARD_COUNT; layoutId += 1) {
    const wordCode = reader.read(wordBits);
    let word;
    if (wordCode === 2 ** wordBits - 1) {
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
    language,
    wordSet,
    source: { type: "explicit", version },
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

function validateLanguageWordSet(language, wordSet) {
  if (language !== LANGUAGE.ENGLISH && language !== LANGUAGE.ITALIAN) {
    throw new Error("Board language is invalid.");
  }
  validateWordSet(wordSet);
  if (language === LANGUAGE.ITALIAN && wordSet !== WORD_SET.EXTENDED) {
    throw new Error("Italian Official words are not available.");
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
