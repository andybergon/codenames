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
const SIDE_EASE_SAFE_WEIGHT = 0.65;
const SIDE_EASE_STRETCH_WEIGHT = 0.2;
const SIDE_EASE_BREADTH_WEIGHT = 0.15;
const FULL_SAFE_BREADTH = 4;

export function analyzeEmbeddedBoard(board, boardVectors, clueIndex, options = {}) {
  const limit = options.limit ?? 8;
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
  const candidateIndices = buildLegalCandidateIndices(entries, clueIndex.clues);

  if (friendlies.length < 1 || hazards.length === 0 || candidateIndices.length === 0) {
    return emptyAnalysis(friendlies.length, candidateIndices.length);
  }

  const candidateSimilarities = buildCandidateSimilarities(
    entries,
    candidateIndices,
    clueIndex,
  );
  const boardSimilarities = buildBoardSimilarities(entries);
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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

function buildLegalCandidateIndices(entries, clues) {
  const boardWords = entries.map((entry) => normalizeTerm(entry.word));
  const candidateIndices = [];

  clues.forEach((clue, candidateIndex) => {
    if (!isForbiddenClue(normalizeTerm(clue), boardWords)) {
      candidateIndices.push(candidateIndex);
    }
  });

  return candidateIndices;
}

function isForbiddenClue(clue, boardWords) {
  const compactClue = clue.replaceAll(" ", "");
  const clueStem = simpleStem(compactClue);

  return boardWords.some((word) => {
    const compactWord = word.replaceAll(" ", "");
    const wordStem = simpleStem(compactWord);

    if (compactClue === compactWord || clueStem === wordStem) {
      return true;
    }

    if (compactClue.length >= 5 && compactWord.length >= 5) {
      return compactClue.includes(compactWord) || compactWord.includes(compactClue);
    }

    return false;
  });
}

function buildCandidateSimilarities(entries, candidateIndices, clueIndex) {
  const similarities = new Float32Array(clueIndex.clues.length * entries.length);
  const scale = clueIndex.quantization.scale;

  for (const candidateIndex of candidateIndices) {
    const vectorOffset = candidateIndex * clueIndex.dimensions;
    const rowOffset = candidateIndex * entries.length;

    for (const entry of entries) {
      let total = 0;
      for (let dimension = 0; dimension < clueIndex.dimensions; dimension += 1) {
        total += clueIndex.vectors[vectorOffset + dimension] * entry.vector[dimension];
      }
      similarities[rowOffset + entry.entryIndex] = total / scale;
    }
  }

  return similarities;
}

function buildBoardSimilarities(entries) {
  const similarities = new Float32Array(entries.length * entries.length);

  for (const left of entries) {
    for (const right of entries) {
      similarities[left.entryIndex * entries.length + right.entryIndex] = dot(
        left.vector,
        right.vector,
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

function simpleStem(value) {
  return value
    .replace(/(ization|ational|fulness|ousness|iveness|tional)$/u, "")
    .replace(/(ments|ment|ness|able|ible)$/u, "")
    .replace(/(ing|ers|ies|ied|ed|ly|es|s)$/u, "");
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
