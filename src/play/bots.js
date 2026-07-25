import {
  PLAY_BONUS_POLICY,
  PLAY_CLUE_POLICY,
} from "./settings.js";

export { PLAY_CLUE_POLICY } from "./settings.js";

const RISK_VALUE = Object.freeze({
  safe: 8,
  medium: 0,
  risky: -14,
});

const HYBRID_RISK_VALUE = Object.freeze({
  safe: 3,
  medium: 0,
  risky: -18,
});

export function chooseBotClue({
  analysis,
  ownRemaining,
  opponentRemaining,
  random,
  policy = PLAY_CLUE_POLICY.CURRENT,
  multiTolerance = null,
}) {
  const suggestions = analysis?.suggestions ?? [];
  if (suggestions.length === 0) {
    return null;
  }

  const ranked = suggestions
    .map((suggestion) => ({
      suggestion,
      score: scorePlayClue(suggestion, { ownRemaining, opponentRemaining, policy }),
    }))
    .sort((left, right) => right.score - left.score);

  if (Number.isFinite(multiTolerance)) {
    const best = ranked[0];
    const bestMulti = ranked.find(({ suggestion }) => suggestion.number >= 2);
    return bestMulti && bestMulti.score >= best.score - multiTolerance
      ? bestMulti.suggestion
      : best.suggestion;
  }

  const shortlist = ranked.slice(0, Math.min(4, ranked.length));
  const pick = Math.min(shortlist.length - 1, Math.floor(random() * shortlist.length));
  return shortlist[pick].suggestion;
}

export function scorePlayClue(
  suggestion,
  { ownRemaining, opponentRemaining, policy = PLAY_CLUE_POLICY.CURRENT },
) {
  if (policy === PLAY_CLUE_POLICY.HYBRID) {
    return (
      suggestion.worth * 0.35 +
      suggestion.expectedNet * 25 +
      suggestion.success * 10 +
      suggestion.margin * 6 +
      HYBRID_RISK_VALUE[suggestion.risk]
    );
  }
  if (policy !== PLAY_CLUE_POLICY.CURRENT) {
    throw new Error(`Unknown Play clue policy: ${policy}`);
  }

  const trailing = ownRemaining > opponentRemaining;
  const urgency = Math.max(0, ownRemaining - opponentRemaining);
  return (
    suggestion.worth +
    RISK_VALUE[suggestion.risk] +
    suggestion.number * (trailing ? 2.2 + urgency * 0.35 : 0.65) +
    suggestion.margin * 18
  );
}

export function chooseBotGuess({ candidates, guessesMade, clueNumber, random }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      botScore: candidate.similarity + (random() - 0.5) * 0.055,
    }))
    .sort((left, right) => right.botScore - left.botScore);
  const best = ranked[0];
  const gap = best.botScore - (ranked[1]?.botScore ?? -1);
  const isBonusGuess = guessesMade >= clueNumber;
  const minimumSimilarity = isBonusGuess ? 0.2 : guessesMade === 0 ? 0.055 : 0.09;
  const minimumGap = isBonusGuess ? 0.035 : -0.02;

  if (best.botScore < minimumSimilarity || gap < minimumGap) {
    return null;
  }
  return best.layoutId;
}

export function shouldBotTakeAnotherGuess({
  bonusGuesses,
  clueNumber,
  guessesMade,
}) {
  return (
    guessesMade < clueNumber ||
    bonusGuesses === PLAY_BONUS_POLICY.ALLOW
  );
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
