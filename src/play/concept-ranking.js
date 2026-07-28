import { centerEmbeddings, embedTerms } from "../embeddings.js";

export const CONCEPT_ACTIVATION_CEILING = 0.2;
export const CONCEPT_MINIMUM_CLUE_NUMBER = 2;
export const CONCEPT_RANKING_MODEL_ID = "bge-small";
export const CONCEPT_SCORE_OFFSET = 0.05;

export async function buildConceptualGuessCandidates({
  boardVectors,
  cards,
  centeringMean,
  clue,
  clueVector: providedClueVector,
  clueNumber,
  definitions,
  loadDefinitions,
  embeddingOptions,
  embed = embedTerms,
  includeRevealed = false,
  rerankCandidates,
}) {
  const clueVector =
    providedClueVector ??
    centerEmbeddings(
      await embed([clue], embeddingOptions),
      centeringMean,
    )[0];
  const directCandidates = cards.map((card, index) => ({
    layoutId: card.layoutId,
    done: card.done,
    similarity: dotVectors(clueVector, boardVectors[index]),
  }));
  const activeCandidates = directCandidates.filter(
    ({ done }) => !done,
  );
  if (!shouldUseConceptRanking(activeCandidates, clueNumber)) {
    return directCandidates.map(addDirectRankingScore);
  }
  try {
    const activeDefinitions =
      definitions ?? (await loadDefinitions?.());
    if (!activeDefinitions) {
      return directCandidates.map(addDirectRankingScore);
    }
    const clueDefinitions =
      activeDefinitions.get(normalizeConceptTerm(clue)) ?? [];
    if (clueDefinitions.length === 0) {
      return directCandidates.map(addDirectRankingScore);
    }

    const conceptTerms = [];
    const clueRange = appendConceptTerms(
      conceptTerms,
      clue,
      clueDefinitions,
    );
    const cardDefinitions = cards.map(
      (card) =>
        activeDefinitions.get(normalizeConceptTerm(card.word)) ?? [],
    );
    const cardRanges = cards.map((card, index) =>
      appendConceptTerms(
        conceptTerms,
        card.word,
        cardDefinitions[index],
      ),
    );
    const conceptRaw = await embed(conceptTerms, embeddingOptions);
    const conceptVectors = centerEmbeddings(
      conceptRaw,
      centeringMean,
    );
    const clueConceptVectors = conceptVectors.slice(
      clueRange.start,
      clueRange.end,
    );

    const evaluatedCandidates = directCandidates.map(
      (candidate, index) => {
        const range = cardRanges[index];
        const cardConceptVectors = conceptVectors.slice(
          range.start,
          range.end,
        );
        const conceptBridge = maximumConceptBridge(
          clueConceptVectors,
          cardConceptVectors,
          clueDefinitions,
          cardDefinitions[index],
        );
        const conceptSimilarity = conceptBridge?.similarity ?? null;
        const rankingScore = scoreOperativeAssociation(
          candidate.similarity,
          conceptSimilarity,
        );
        return {
          candidate: {
            ...candidate,
            conceptSimilarity,
            ...(conceptBridge &&
            rankingScore > candidate.similarity
              ? { conceptBridge }
              : {}),
            rankingScore,
          },
          conceptBridge,
        };
      },
    );
    const candidates = evaluatedCandidates.map(
      ({ candidate }) => candidate,
    );
    if (!rerankCandidates) {
      return candidates;
    }
    return await rerankCandidates({
      candidates,
      cards,
      clue,
      conceptBridges: evaluatedCandidates.map(
        ({ conceptBridge }) => conceptBridge,
      ),
    });
  } catch {
    return directCandidates.map(addDirectRankingScore);
  }
}

export function shouldUseConceptRanking(
  candidates,
  clueNumber,
  {
    activationCeiling = CONCEPT_ACTIVATION_CEILING,
    minimumClueNumber = CONCEPT_MINIMUM_CLUE_NUMBER,
  } = {},
) {
  return (
    candidates.length > 0 &&
    clueNumber >= minimumClueNumber &&
    Math.max(...candidates.map(({ similarity }) => similarity)) <
      activationCeiling
  );
}

export function scoreOperativeAssociation(
  directSimilarity,
  conceptSimilarity,
  { conceptOffset = CONCEPT_SCORE_OFFSET } = {},
) {
  if (!Number.isFinite(conceptSimilarity)) {
    return directSimilarity;
  }
  return Math.max(
    directSimilarity,
    conceptSimilarity - conceptOffset,
  );
}

export function maximumConceptSimilarity(
  clueConceptVectors,
  cardConceptVectors,
) {
  return (
    maximumConceptBridge(
      clueConceptVectors,
      cardConceptVectors,
    )?.similarity ?? null
  );
}

export function maximumConceptBridge(
  clueConceptVectors,
  cardConceptVectors,
  clueDefinitions = [],
  cardDefinitions = [],
) {
  if (
    clueConceptVectors.length === 0 ||
    cardConceptVectors.length === 0
  ) {
    return null;
  }
  let maximum = Number.NEGATIVE_INFINITY;
  let strongestClueIndex = 0;
  let strongestCardIndex = 0;
  for (
    let clueIndex = 0;
    clueIndex < clueConceptVectors.length;
    clueIndex += 1
  ) {
    for (
      let cardIndex = 0;
      cardIndex < cardConceptVectors.length;
      cardIndex += 1
    ) {
      const similarity = dotVectors(
        clueConceptVectors[clueIndex],
        cardConceptVectors[cardIndex],
      );
      if (similarity > maximum) {
        maximum = similarity;
        strongestClueIndex = clueIndex;
        strongestCardIndex = cardIndex;
      }
    }
  }
  return {
    similarity: maximum,
    clueSense: clueDefinitions[strongestClueIndex] ?? "",
    cardSense: cardDefinitions[strongestCardIndex] ?? "",
  };
}

export function conceptTexts(term, definitions) {
  const normalized = normalizeConceptTerm(term);
  return definitions.map(
    (definition) => `${normalized}: ${definition}`,
  );
}

export function normalizeConceptTerm(term) {
  return String(term ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function dotVectors(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

function appendConceptTerms(output, term, definitions) {
  const start = output.length;
  output.push(...conceptTexts(term, definitions));
  return { start, end: output.length };
}

function addDirectRankingScore(candidate) {
  return {
    ...candidate,
    conceptSimilarity: null,
    rankingScore: candidate.similarity,
  };
}
