import {
  EXTENDED_WORDS,
  ITALIAN_EXTENDED_WORDS,
  LANGUAGE,
} from "./word-data.js";

export const HAZARD_POLICY = Object.freeze({
  friendly: { multiplier: 0, offset: 0 },
  neutral: { multiplier: 1, offset: 0 },
  enemy: { multiplier: 1.08, offset: 0.015 },
  assassin: { multiplier: 1.22, offset: 0.065 },
});

const SAFE_MAX_SIZE = 3;
const STRETCH_MIN_SIZE = 4;
const MAX_TARGET_SIZE = 9;
const SHORTLIST_SIZE = 40;
const ITALIAN_FALSE_FRIEND_MIN_LENGTH = 7;
const ITALIAN_FALSE_FRIEND_MIN_LENGTH_RATIO = 0.72;
const ITALIAN_FALSE_FRIEND_MIN_EDGE = 2;
const ITALIAN_FALSE_FRIEND_WORD_SIMILARITY = 0.685;
const ITALIAN_FALSE_FRIEND_CONSONANT_SIMILARITY = 0.7;
const ITALIAN_FALSE_FRIEND_SIMILARITY_PENALTY = 0.23;
const SIDE_EASE_SAFE_WEIGHT = 0.65;
const SIDE_EASE_STRETCH_WEIGHT = 0.2;
const SIDE_EASE_BREADTH_WEIGHT = 0.15;
const FULL_SAFE_BREADTH = 4;

export function analyzeEmbeddedBoard(board, boardVectors, clueIndex, options = {}) {
  const limit = options.limit ?? 8;
  const similarityCalibration = options.similarityCalibration;
  const entries = board
    .map((card, sourceIndex) => ({
      sourceIndex,
      layoutId: card.layoutId ?? sourceIndex,
      word: cleanDisplayWord(card.word),
      team: card.team,
      done: Boolean(card.done),
      vector: boardVectors[sourceIndex],
    }))
    .filter((card) => !card.done && card.word.length > 0)
    .map((card, entryIndex) => ({ ...card, entryIndex }));

  validateDimensions(entries, clueIndex.dimensions);

  const friendlies = entries.filter((card) => card.team === "friendly");
  const hazards = entries.filter((card) => card.team !== "friendly");
  const candidateIndices = buildLegalCandidateIndices(
    entries,
    clueIndex.clues,
    options.language,
  );

  if (friendlies.length < 1 || hazards.length === 0 || candidateIndices.length === 0) {
    return emptyAnalysis(friendlies.length, candidateIndices.length);
  }

  const candidateSimilarities = buildCandidateSimilarities(
    entries,
    candidateIndices,
    clueIndex,
    options.language,
    similarityCalibration,
  );
  const boardSimilarities = buildBoardSimilarities(
    entries,
    similarityCalibration,
  );
  const preparedCandidates = prepareCandidates({
    candidateIndices,
    candidateSimilarities,
    entries,
    hazards,
    clueIndex,
  });

  const safeSizes = range(1, Math.min(SAFE_MAX_SIZE, friendlies.length));
  const safe = rankSuggestionsBySize({
    friendlies,
    sizes: safeSizes,
    mode: "safe",
    limit,
    preparedCandidates,
    candidateSimilarities,
    boardSimilarities,
    entryCount: entries.length,
  });

  const stretchSizes = range(STRETCH_MIN_SIZE, Math.min(MAX_TARGET_SIZE, friendlies.length));
  const stretch = rankSuggestionsBySize({
    friendlies,
    sizes: stretchSizes,
    mode: "stretch",
    limit,
    preparedCandidates,
    candidateSimilarities,
    boardSimilarities,
    entryCount: entries.length,
  });

  const allSuggestions = [...safe, ...stretch];

  return {
    safe,
    stretch,
    suggestions: allSuggestions,
    summary: {
      friendlyTotal: friendlies.length,
      candidateTotal: candidateIndices.length,
      bestMargin: allSuggestions.length
        ? Math.max(...allSuggestions.map((suggestion) => suggestion.margin))
        : 0,
      bestNet: allSuggestions.length
        ? Math.max(...allSuggestions.map((suggestion) => suggestion.expectedNet))
        : 0,
    },
  };
}

export function applyDangerPenalty(similarity, team) {
  const policy = HAZARD_POLICY[team] ?? HAZARD_POLICY.neutral;
  return similarity + Math.max(0, similarity) * (policy.multiplier - 1) + policy.offset;
}

export function calibrateSimilarity(similarity, calibration) {
  if (!calibration) return similarity;
  return similarity * calibration.scale + calibration.offset;
}

export function calculateBoardMetrics(blueAnalysis, redAnalysis) {
  const blueEase = Math.round(calculateSideEase(blueAnalysis));
  const redEase = Math.round(calculateSideEase(redAnalysis));

  return {
    blueEase,
    redEase,
    complexity: Math.round(clamp(100 - (blueEase + redEase) / 2, 0, 100)),
    edge: blueEase - redEase,
  };
}

export function normalizeTerm(term) {
  return String(term ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function validateDimensions(entries, dimensions) {
  for (const entry of entries) {
    if (!entry.vector || entry.vector.length !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch for ${entry.word}: expected ${dimensions}, got ${entry.vector?.length ?? 0}`,
      );
    }
  }
}

function emptyAnalysis(friendlyTotal, candidateTotal) {
  return {
    safe: [],
    stretch: [],
    suggestions: [],
    summary: {
      friendlyTotal,
      candidateTotal,
      bestMargin: 0,
      bestNet: 0,
    },
  };
}

function buildLegalCandidateIndices(entries, clues, language = LANGUAGE.ENGLISH) {
  const boardWords = entries.map((entry) => normalizeTerm(entry.word));
  const candidateIndices = [];
  const isForbidden = buildClueLegalityFilter(boardWords, language);

  clues.forEach((clue, candidateIndex) => {
    const normalizedClue = normalizeTerm(clue);
    if (!isForbidden(normalizedClue)) {
      candidateIndices.push(candidateIndex);
    }
  });

  return candidateIndices;
}

const KNOWN_COMPOUND_COMPONENTS = new Map(
  [
    [LANGUAGE.ENGLISH, [...EXTENDED_WORDS, "down"]],
    [LANGUAGE.ITALIAN, ITALIAN_EXTENDED_WORDS],
  ].map(([language, words]) => [
    language,
    new Set(
      words.map((word) =>
        foldAccents(normalizeTerm(word)).replaceAll(" ", ""),
      ),
    ),
  ]),
);

export function isForbiddenClue(
  clue,
  boardWords,
  options = {},
) {
  const language = options.language ?? LANGUAGE.ENGLISH;
  return buildClueLegalityFilter(boardWords, language)(
    normalizeTerm(clue),
  );
}

export function isOrthographicFalseFriend(
  clue,
  boardWords,
  options = {},
) {
  const language = options.language ?? LANGUAGE.ENGLISH;
  return buildOrthographicFalseFriendFilter(boardWords, language)(
    normalizeTerm(clue),
  );
}

export function adjustSemanticSimilarity(
  clue,
  word,
  similarity,
  options = {},
) {
  const language = options.language ?? LANGUAGE.ENGLISH;
  if (language !== LANGUAGE.ITALIAN) {
    return similarity;
  }
  return adjustItalianOrthographicSimilarity(
    italianOrthographicForm(clue),
    italianOrthographicForm(word),
    similarity,
  );
}

function buildOrthographicFalseFriendFilter(boardWords, language) {
  if (language !== LANGUAGE.ITALIAN) {
    return () => false;
  }

  const boardForms = boardWords.map(italianOrthographicForm);

  return (clue) => {
    const clueForm = italianOrthographicForm(clue);
    return boardForms.some((wordForm) =>
      sharesItalianOrthographicShape(clueForm, wordForm),
    );
  };
}

function italianOrthographicForm(value) {
  const compact = foldAccents(normalizeTerm(value)).replaceAll(" ", "");
  return {
    compact,
    consonants: compact.replace(/[aeiou]/gu, ""),
  };
}

function sharesItalianOrthographicShape(left, right) {
  if (
    left.compact === right.compact ||
    Math.min(left.compact.length, right.compact.length) <
      ITALIAN_FALSE_FRIEND_MIN_LENGTH ||
    Math.min(left.compact.length, right.compact.length) /
        Math.max(left.compact.length, right.compact.length) <
      ITALIAN_FALSE_FRIEND_MIN_LENGTH_RATIO ||
    Math.min(left.consonants.length, right.consonants.length) < 3
  ) {
    return false;
  }

  const sharedEdge =
    commonPrefixLength(left.compact, right.compact) >=
      ITALIAN_FALSE_FRIEND_MIN_EDGE ||
    commonSuffixLength(left.compact, right.compact) >=
      ITALIAN_FALSE_FRIEND_MIN_EDGE;

  return (
    sharedEdge &&
    jaroWinklerSimilarity(left.compact, right.compact) >=
      ITALIAN_FALSE_FRIEND_WORD_SIMILARITY &&
    jaroWinklerSimilarity(left.consonants, right.consonants) >=
      ITALIAN_FALSE_FRIEND_CONSONANT_SIMILARITY
  );
}

function adjustItalianOrthographicSimilarity(clueForm, wordForm, similarity) {
  return sharesItalianOrthographicShape(clueForm, wordForm)
    ? similarity - ITALIAN_FALSE_FRIEND_SIMILARITY_PENALTY
    : similarity;
}

function buildClueLegalityFilter(boardWords, language) {
  if (language === LANGUAGE.ENGLISH) {
    const compactBoardWords = boardWords.map((word) =>
      normalizeTerm(word).replaceAll(" ", ""),
    );
    const boardWordSet = new Set(compactBoardWords);
    const boardStemSet = new Set(compactBoardWords.map(simpleStem));
    const boardInflections = new Set(
      compactBoardWords.flatMap(simpleInflections),
    );

    return (clue) => {
      const compactClue = normalizeTerm(clue).replaceAll(" ", "");
      if (
        boardWordSet.has(compactClue) ||
        boardStemSet.has(simpleStem(compactClue)) ||
        boardInflections.has(compactClue) ||
        simpleInflections(compactClue).some((form) =>
          boardWordSet.has(form),
        )
      ) {
        return true;
      }

      return compactBoardWords.some(
        (compactWord) =>
          isKnownCompoundContainment(
            compactClue,
            compactWord,
            LANGUAGE.ENGLISH,
          ) ||
          isKnownCompoundContainment(
            compactWord,
            compactClue,
            LANGUAGE.ENGLISH,
          ),
      );
    };
  }

  return (clue) => {
    const compactClue = foldAccents(normalizeTerm(clue)).replaceAll(" ", "");
    const clueStem = simpleStem(compactClue, language);

    return boardWords.some((word) => {
      const compactWord = foldAccents(normalizeTerm(word)).replaceAll(" ", "");
      const wordStem = simpleStem(compactWord, language);

      if (compactClue === compactWord || clueStem === wordStem) {
        return true;
      }
      if (
        clueStem.length >= 4 &&
        wordStem.length >= 4 &&
        (clueStem.includes(wordStem) || wordStem.includes(clueStem))
      ) {
        return true;
      }
      if (
        isKnownCompoundContainment(compactClue, compactWord, language) ||
        isKnownCompoundContainment(compactWord, compactClue, language)
      ) {
        return true;
      }
      if (compactClue.length >= 5 && compactWord.length >= 5) {
        return (
          compactClue.includes(compactWord) ||
          compactWord.includes(compactClue)
        );
      }

      return false;
    });
  };
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

function commonSuffixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (
    length < limit &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function jaroWinklerSimilarity(left, right) {
  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }

  const matchDistance = Math.max(
    0,
    Math.floor(Math.max(left.length, right.length) / 2) - 1,
  );
  const leftMatches = Array(left.length).fill(false);
  const rightMatches = Array(right.length).fill(false);
  let matches = 0;

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const start = Math.max(0, leftIndex - matchDistance);
    const end = Math.min(leftIndex + matchDistance + 1, right.length);
    for (let rightIndex = start; rightIndex < end; rightIndex += 1) {
      if (
        rightMatches[rightIndex] ||
        left[leftIndex] !== right[rightIndex]
      ) {
        continue;
      }
      leftMatches[leftIndex] = true;
      rightMatches[rightIndex] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) {
    return 0;
  }

  const leftMatched = [];
  const rightMatched = [];
  for (let index = 0; index < left.length; index += 1) {
    if (leftMatches[index]) {
      leftMatched.push(left[index]);
    }
  }
  for (let index = 0; index < right.length; index += 1) {
    if (rightMatches[index]) {
      rightMatched.push(right[index]);
    }
  }

  let transpositions = 0;
  for (let index = 0; index < leftMatched.length; index += 1) {
    transpositions += Number(leftMatched[index] !== rightMatched[index]);
  }

  const jaro =
    (matches / left.length +
      matches / right.length +
      (matches - transpositions / 2) / matches) /
    3;
  const prefix = Math.min(
    4,
    commonPrefixLength(left, right),
  );
  return jaro + prefix * 0.1 * (1 - jaro);
}

function simpleInflections(value) {
  const forms = [];
  if (!/^[a-z]{3,}$/u.test(value)) {
    return forms;
  }

  const consonantY = /[^aeiou]y$/u.test(value);
  if (consonantY) {
    forms.push(`${value.slice(0, -1)}ies`, `${value.slice(0, -1)}ied`);
  } else {
    forms.push(`${value}s`);
  }

  if (/(?:s|x|z|ch|sh)$/u.test(value)) {
    forms.push(`${value}es`);
  }
  if (/fe$/u.test(value)) {
    forms.push(`${value.slice(0, -2)}ves`);
  } else if (/f$/u.test(value)) {
    forms.push(`${value.slice(0, -1)}ves`);
  }

  if (/e$/u.test(value)) {
    forms.push(`${value}d`);
  } else if (!consonantY) {
    forms.push(`${value}ed`);
  }

  if (/ie$/u.test(value)) {
    forms.push(`${value.slice(0, -2)}ying`);
  } else if (/e$/u.test(value) && !/(?:ee|oe|ye)$/u.test(value)) {
    forms.push(`${value.slice(0, -1)}ing`);
  } else {
    forms.push(`${value}ing`);
  }

  if (shouldDoubleFinalConsonant(value)) {
    const final = value.at(-1);
    forms.push(`${value}${final}ed`, `${value}${final}ing`);
  }

  return forms;
}

function shouldDoubleFinalConsonant(value) {
  return (
    value.length >= 3 &&
    /[aeiou]/u.test(value.at(-2)) &&
    /[bcdfghjklmnpqrstvz]/u.test(value.at(-1)) &&
    /[^aeiou]/u.test(value.at(-3))
  );
}

function isKnownCompoundContainment(container, component, language) {
  if (component.length < 3 || container.length <= component.length) {
    return false;
  }

  const remainder = container.startsWith(component)
    ? container.slice(component.length)
    : container.endsWith(component)
      ? container.slice(0, -component.length)
      : "";

  return (
    remainder.length >= 3 &&
    KNOWN_COMPOUND_COMPONENTS.get(language)?.has(remainder)
  );
}

function buildCandidateSimilarities(
  entries,
  candidateIndices,
  clueIndex,
  language,
  similarityCalibration,
) {
  const similarities = new Float32Array(clueIndex.clues.length * entries.length);
  const scale = clueIndex.quantization.scale;
  const useItalianGuard = language === LANGUAGE.ITALIAN;
  const entryForms = useItalianGuard
    ? entries.map(({ word }) => italianOrthographicForm(word))
    : [];

  for (const candidateIndex of candidateIndices) {
    const vectorOffset = candidateIndex * clueIndex.dimensions;
    const rowOffset = candidateIndex * entries.length;
    const clueForm = useItalianGuard
      ? italianOrthographicForm(clueIndex.clues[candidateIndex])
      : null;

    for (const entry of entries) {
      let total = 0;
      for (let dimension = 0; dimension < clueIndex.dimensions; dimension += 1) {
        total += clueIndex.vectors[vectorOffset + dimension] * entry.vector[dimension];
      }
      const calibratedSimilarity = calibrateSimilarity(
        total / scale,
        similarityCalibration,
      );
      similarities[rowOffset + entry.entryIndex] = useItalianGuard
        ? adjustItalianOrthographicSimilarity(
            clueForm,
            entryForms[entry.entryIndex],
            calibratedSimilarity,
          )
        : calibratedSimilarity;
    }
  }

  return similarities;
}

function buildBoardSimilarities(entries, similarityCalibration) {
  const similarities = new Float32Array(entries.length * entries.length);

  for (const left of entries) {
    for (const right of entries) {
      similarities[left.entryIndex * entries.length + right.entryIndex] =
        calibrateSimilarity(
          dot(left.vector, right.vector),
          similarityCalibration,
        );
    }
  }

  return similarities;
}

function prepareCandidates({
  candidateIndices,
  candidateSimilarities,
  entries,
  hazards,
  clueIndex,
}) {
  return candidateIndices.map((candidateIndex) => {
    const rowOffset = candidateIndex * entries.length;
    let closestDanger = null;
    let assassin = null;

    for (const hazard of hazards) {
      const sim = candidateSimilarities[rowOffset + hazard.entryIndex];
      const weighted = applyDangerPenalty(sim, hazard.team);
      const scoredHazard = {
        word: hazard.word,
        team: hazard.team,
        sim,
        weighted,
      };

      if (!closestDanger || weighted > closestDanger.weighted) {
        closestDanger = scoredHazard;
      }
      if (hazard.team === "assassin") {
        assassin = scoredHazard;
      }
    }

    return {
      candidateIndex,
      clue: clueIndex.clues[candidateIndex],
      familiarity: familiarityScore(clueIndex.frequencies[candidateIndex]),
      closestDanger,
      assassin,
    };
  });
}

function rankSuggestions({
  friendlies,
  sizes,
  mode,
  limit,
  preparedCandidates,
  candidateSimilarities,
  boardSimilarities,
  entryCount,
}) {
  const suggestions = [];
  const combos = sizes.flatMap((size) => buildCombinations(friendlies, size));

  for (const targets of combos) {
    const context = buildTargetContext(targets, boardSimilarities, entryCount);
    const shortlist = shortlistCandidates(
      preparedCandidates,
      context,
      candidateSimilarities,
      entryCount,
    );
    const perTargetSuggestions = [];

    for (const candidate of shortlist) {
      const scored = scoreCandidate({
        candidate,
        context,
        candidateSimilarities,
        entryCount,
      });

      if (passesMode(scored, mode)) {
        insertRanked(perTargetSuggestions, scored, mode === "safe" ? 3 : 4);
      }
    }

    suggestions.push(...perTargetSuggestions);
  }

  suggestions.sort(compareSuggestions);
  return diversifySuggestions(suggestions, limit, mode);
}

function rankSuggestionsBySize({ sizes, ...options }) {
  return sizes.flatMap((size) =>
    rankSuggestions({
      ...options,
      sizes: [size],
    }),
  );
}

function buildTargetContext(targets, boardSimilarities, entryCount) {
  let pairwiseTotal = 0;
  let pairwiseCount = 0;

  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      pairwiseTotal +=
        boardSimilarities[targets[left].entryIndex * entryCount + targets[right].entryIndex];
      pairwiseCount += 1;
    }
  }

  const cohesion = pairwiseCount > 0 ? pairwiseTotal / pairwiseCount : 0;
  const centroidNorm = Math.sqrt(
    Math.max(0.0001, (targets.length + 2 * pairwiseTotal) / targets.length ** 2),
  );

  return {
    targets,
    cohesion,
    centroidNorm,
  };
}

function shortlistCandidates(
  preparedCandidates,
  context,
  candidateSimilarities,
  entryCount,
) {
  const shortlist = [];

  for (const candidate of preparedCandidates) {
    const rowOffset = candidate.candidateIndex * entryCount;
    let minTarget = Infinity;
    let targetTotal = 0;

    for (const target of context.targets) {
      const sim = candidateSimilarities[rowOffset + target.entryIndex];
      minTarget = Math.min(minTarget, sim);
      targetTotal += sim;
    }

    if (minTarget < 0.04) {
      continue;
    }

    const avgTarget = targetTotal / context.targets.length;
    const margin = minTarget - candidate.closestDanger.weighted;
    const quickScore =
      avgTarget + minTarget * 0.7 + margin * 1.4 + candidate.familiarity * 0.015;

    insertRanked(shortlist, { candidate, quickScore }, SHORTLIST_SIZE, (left, right) =>
      right.quickScore - left.quickScore,
    );
  }

  return shortlist.map((entry) => entry.candidate);
}

function scoreCandidate({ candidate, context, candidateSimilarities, entryCount }) {
  const rowOffset = candidate.candidateIndex * entryCount;
  const targetSims = context.targets.map((target) => ({
    layoutId: target.layoutId,
    word: target.word,
    sim: candidateSimilarities[rowOffset + target.entryIndex],
  }));
  const targetValues = targetSims.map((target) => target.sim);
  const avgTarget = average(targetValues);
  const minTarget = Math.min(...targetValues);
  const centroidFit = avgTarget / context.centroidNorm;
  const margin = minTarget - candidate.closestDanger.weighted;
  const assassinPressure = candidate.assassin
    ? Math.max(0, candidate.assassin.weighted - minTarget + 0.03)
    : 0;
  const consistency = clamp(1 - standardDeviation(targetValues) * 2, 0, 1);
  const success = clamp(
    sigmoid(
      6.6 * margin +
        5 * (minTarget - 0.22) +
        2 * (context.cohesion - 0.16) -
        0.18 * (context.targets.length - 2),
    ) -
      assassinPressure * 0.45,
    0.03,
    0.97,
  );
  const missCost =
    candidate.closestDanger.team === "assassin"
      ? 5.5
      : candidate.closestDanger.team === "enemy"
        ? 1.8
        : 0.9;
  const expectedNet = context.targets.length * success - missCost * (1 - success);
  const worth = clamp(
    Math.round(
      24 +
        expectedNet * 15 +
        margin * 30 +
        centroidFit * 24 +
        minTarget * 18 +
        context.cohesion * 18 +
        consistency * 5 +
        candidate.familiarity * 3,
    ),
    0,
    99,
  );
  const risk = classifyRisk({
    margin,
    success,
    closestDanger: candidate.closestDanger,
    targetCount: context.targets.length,
  });

  return {
    clue: candidate.clue,
    number: context.targets.length,
    targets: targetSims.sort((left, right) => right.sim - left.sim),
    closestDanger: candidate.closestDanger,
    margin,
    success,
    expectedNet,
    worth,
    risk,
    centroidFit,
    cohesion: context.cohesion,
    minTarget,
    sortScore:
      worth +
      expectedNet * 6 +
      margin * 14 +
      centroidFit * 18 +
      minTarget * 22 +
      context.cohesion * 20 +
      context.targets.length * 2 +
      (risk === "safe" ? 6 : 0) +
      (context.targets.length >= 4 ? 2 : 0),
  };
}

function passesMode(scored, mode) {
  const everyTargetConnected = scored.targets.every((target) => target.sim >= 0.13);

  if (mode === "safe") {
    return (
      scored.number <= 3 &&
      everyTargetConnected &&
      scored.margin >= 0.045 &&
      scored.success >= 0.58
    );
  }

  return (
    scored.number >= STRETCH_MIN_SIZE &&
    everyTargetConnected &&
    scored.expectedNet >= 0.35 &&
    scored.success >= 0.28 &&
    scored.margin >= -0.28
  );
}

function classifyRisk({ margin, success, closestDanger, targetCount }) {
  if (targetCount <= 3 && margin >= 0.11 && success >= 0.73) {
    return "safe";
  }

  if (closestDanger.team === "assassin" || margin < 0.025 || success < 0.56) {
    return "risky";
  }

  return "medium";
}

function diversifySuggestions(suggestions, limit, mode) {
  const selected = [];
  const usedClues = new Set();
  const usedTargetSets = new Map();
  const targetSetLimit = mode === "stretch" ? 2 : 1;

  for (const suggestion of suggestions) {
    const targetKey = suggestion.targets
      .map((target) => target.word)
      .sort()
      .join("|");

    if (usedClues.has(suggestion.clue) || (usedTargetSets.get(targetKey) ?? 0) >= targetSetLimit) {
      continue;
    }

    selected.push(suggestion);
    usedClues.add(suggestion.clue);
    usedTargetSets.set(targetKey, (usedTargetSets.get(targetKey) ?? 0) + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function buildCombinations(items, size) {
  const result = [];

  function walk(start, combo) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }

    for (let index = start; index <= items.length - (size - combo.length); index += 1) {
      combo.push(items[index]);
      walk(index + 1, combo);
      combo.pop();
    }
  }

  walk(0, []);
  return result;
}

function range(start, end) {
  if (end < start) {
    return [];
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function insertRanked(items, item, limit, compare = compareSuggestions) {
  if (items.length >= limit && compare(item, items.at(-1)) >= 0) {
    return;
  }

  items.push(item);
  items.sort(compare);
  if (items.length > limit) {
    items.pop();
  }
}

function compareSuggestions(left, right) {
  if (right.sortScore !== left.sortScore) {
    return right.sortScore - left.sortScore;
  }
  return right.margin - left.margin;
}

function calculateSideEase(analysis) {
  const safe = analysis?.safe ?? [];
  const stretch = analysis?.stretch ?? [];
  const safeWorth = averageTopWorth(safe, 3);
  const stretchWorth = averageTopWorth(stretch, 3);
  const safeBreadth = clamp(safe.length / FULL_SAFE_BREADTH, 0, 1) * 100;

  return clamp(
    safeWorth * SIDE_EASE_SAFE_WEIGHT +
      stretchWorth * SIDE_EASE_STRETCH_WEIGHT +
      safeBreadth * SIDE_EASE_BREADTH_WEIGHT,
    0,
    100,
  );
}

function averageTopWorth(suggestions, limit) {
  const worths = suggestions
    .map((suggestion) => suggestion.worth)
    .sort((left, right) => right - left)
    .slice(0, limit);

  return average(worths);
}

function simpleStem(value, language = LANGUAGE.ENGLISH) {
  if (language === LANGUAGE.ITALIAN) {
    return italianStem(value);
  }
  return value
    .replace(/(ization|ational|fulness|ousness|iveness|tional)$/u, "")
    .replace(/(ments|ment|ness|able|ible)$/u, "")
    .replace(/(ing|ers|ies|ied|ed|ly|es|s)$/u, "");
}

const ITALIAN_IRREGULAR_FAMILIES = new Map(
  [
    ["attore", "attrice"],
    ["scrivere", "scritto"],
    ["fare", "fatto"],
    ["uomo", "uomini"],
    ["bue", "buoi"],
  ].flatMap((family, index) =>
    family.map((word) => [word, `irregular-${index}`]),
  ),
);

function italianStem(value) {
  const irregular = ITALIAN_IRREGULAR_FAMILIES.get(value);
  if (irregular) {
    return irregular;
  }

  const verbStem = value
    .replace(/(erebbe|irebbe|eranno|iranno|avano|evano|ivano)$/u, "")
    .replace(/(ando|endo|ato|uto|ito|are|ere|ire)$/u, "");
  if (verbStem !== value && verbStem.length >= 3) {
    return verbStem;
  }

  return value.length >= 4 ? value.replace(/[aeio]$/u, "") : value;
}

function foldAccents(value) {
  return value.normalize("NFD").replace(/\p{M}+/gu, "");
}

function cleanDisplayWord(word) {
  return String(word ?? "").trim().toUpperCase();
}

function familiarityScore(zipf) {
  return clamp((Number(zipf ?? 3.4) - 3.2) / 2.8, 0, 1);
}

function dot(left, right) {
  let total = 0;

  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }

  return total;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values) {
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
