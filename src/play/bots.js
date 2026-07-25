import {
  PLAY_BONUS_POLICY,
  PLAY_CLUE_POLICY,
  PLAY_OPERATIVE_AGGRESSION,
} from "./settings.js";

export {
  PLAY_CLUE_POLICY,
  PLAY_OPERATIVE_AGGRESSION,
} from "./settings.js";

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

export function chooseBotGuess({
  aggression = PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
  candidates,
  clueNumber,
  guessesMade,
  opponentRemaining,
  ownRemaining,
  random,
}) {
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
  const { minimumGap, minimumSimilarity } = operativeGuessThresholds({
    aggression,
    clueNumber,
    guessesMade,
    opponentRemaining,
    ownRemaining,
  });

  if (best.botScore < minimumSimilarity || gap < minimumGap) {
    return null;
  }
  return best.layoutId;
}

export function operativeGuessThresholds({
  aggression,
  clueNumber,
  guessesMade,
  opponentRemaining,
  ownRemaining,
}) {
  const isBonusGuess = guessesMade >= clueNumber;
  if (aggression === PLAY_OPERATIVE_AGGRESSION.CONSERVATIVE) {
    return isBonusGuess
      ? { minimumSimilarity: 0.36, minimumGap: 0.05 }
      : {
          minimumSimilarity: guessesMade === 0 ? 0.1 : 0.32,
          minimumGap: guessesMade === 0 ? -0.005 : 0.02,
        };
  }
  if (aggression === PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE) {
    return isBonusGuess
      ? { minimumSimilarity: 0.2, minimumGap: 0.035 }
      : {
          minimumSimilarity: guessesMade === 0 ? 0.055 : 0.09,
          minimumGap: -0.02,
        };
  }
  if (aggression !== PLAY_OPERATIVE_AGGRESSION.DYNAMIC) {
    throw new Error(`Unknown operative aggression: ${aggression}`);
  }

  const knownOwnRemaining = Number.isFinite(ownRemaining);
  const knownOpponentRemaining = Number.isFinite(opponentRemaining);
  const guessesLeftForClue = Math.max(0, clueNumber - guessesMade);
  const guessesStillAvailable = isBonusGuess ? 1 : guessesLeftForClue;
  const canWinThisTurn =
    knownOwnRemaining && ownRemaining <= guessesStillAvailable;
  const opponentCanWinSoon =
    knownOpponentRemaining && opponentRemaining <= 2;
  const trailing =
    knownOwnRemaining &&
    knownOpponentRemaining &&
    ownRemaining > opponentRemaining;
  const comfortablyAhead =
    knownOwnRemaining &&
    knownOpponentRemaining &&
    ownRemaining + 2 < opponentRemaining;

  if (isBonusGuess) {
    return canWinThisTurn || (opponentCanWinSoon && trailing)
      ? { minimumSimilarity: 0.24, minimumGap: 0.025 }
      : { minimumSimilarity: 0.34, minimumGap: 0.045 };
  }
  if (canWinThisTurn) {
    return {
      minimumSimilarity: guessesMade === 0 ? 0.07 : 0.16,
      minimumGap: -0.01,
    };
  }
  if (opponentCanWinSoon && trailing) {
    return {
      minimumSimilarity: guessesMade === 0 ? 0.08 : 0.22,
      minimumGap: guessesMade === 0 ? -0.015 : 0,
    };
  }
  if (comfortablyAhead) {
    return {
      minimumSimilarity: guessesMade === 0 ? 0.12 : 0.3,
      minimumGap: guessesMade === 0 ? -0.005 : 0.015,
    };
  }
  return {
    minimumSimilarity: guessesMade === 0 ? 0.1 : 0.26,
    minimumGap: guessesMade === 0 ? -0.01 : 0.005,
  };
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
