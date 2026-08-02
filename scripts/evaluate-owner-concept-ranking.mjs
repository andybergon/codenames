import { env } from "@huggingface/transformers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createGeneratedBoardState, BOARD_ORDER } from "../src/board-share.js";
import { hydrateClueShards } from "../src/clue-index.js";
import { centerEmbeddings, embedTerms } from "../src/embeddings.js";
import { boardForSide, SIDE } from "../src/gameplay.js";
import { analyzeEmbeddedBoard, isForbiddenClue } from "../src/model.js";
import { evaluateBotClue, PLAY_CLUE_POLICY } from "../src/play/bots.js";
import {
  CONCEPT_ACTIVATION_CEILING,
  CONCEPT_SCORE_OFFSET,
  conceptTexts,
  dotVectors,
  maximumConceptSimilarity,
  normalizeConceptTerm,
  scoreOperativeAssociation,
} from "../src/play/concept-ranking.js";
import { LANGUAGE, WORD_SET } from "../src/word-data.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = resolve(
  ROOT,
  "docs/evaluations/owner-clue-ranking/owner-concept-reranker-smoke.json",
);
const MODEL_DIRECTORY = resolve(ROOT, "public/data/model-lab/bge-small");
const CONCEPT_DIRECTORY = resolve(ROOT, "public/data/concepts");
const CANDIDATE_COUNT = 30_000;
const CANDIDATE_POOL_SIZE = 64;
const BOARD_COUNT = 8;
const RESULTS_PER_SIZE = 6;
const MULTI_TOLERANCE = 5;
const JOUST_WORDS = ["match", "crown", "glove", "belt", "piano"];

env.cacheDir =
  process.env.HF_CACHE_DIR ?? resolve(ROOT, ".cache/huggingface");
env.allowRemoteModels = process.env.ALLOW_REMOTE_MODELS === "1";

const manifest = JSON.parse(
  await readFile(resolve(MODEL_DIRECTORY, "manifest.json"), "utf8"),
);
const shardPayloads = await Promise.all(
  manifest.shards
    .filter(({ start }) => start < CANDIDATE_COUNT)
    .map(({ file }) =>
      readFile(resolve(MODEL_DIRECTORY, file), "utf8").then(JSON.parse),
    ),
);
const clueIndex = hydrateClueShards(
  manifest,
  shardPayloads,
  CANDIDATE_COUNT,
);
const definitions = await loadConceptDefinitions();
const embeddingOptions = {
  model: manifest.model,
  revision: manifest.revision,
  inputPrefix: manifest.inputPrefix,
};

const openingCases = [];
for (let boardIndex = 0; boardIndex < BOARD_COUNT; boardIndex += 1) {
  const seed = boardSeed(boardIndex);
  const board = createGeneratedBoardState(
    seed,
    BOARD_ORDER.RANDOM,
    WORD_SET.OFFICIAL,
    LANGUAGE.ENGLISH,
  ).cards;
  const boardVectors = centerEmbeddings(
    await embedTerms(
      board.map(({ word }) => word),
      embeddingOptions,
    ),
    manifest.centering.mean,
  );

  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const perspectiveBoard = boardForSide(board, side);
    const directStartedAt = performance.now();
    const directAnalysis = analyzeEmbeddedBoard(
      perspectiveBoard,
      boardVectors,
      clueIndex,
      {
        language: LANGUAGE.ENGLISH,
        limit: RESULTS_PER_SIZE,
      },
    );
    const directAnalysisMs = performance.now() - directStartedAt;
    const retrievalStartedAt = performance.now();
    const candidateIndices = selectBridgeCandidateIndices({
      board: perspectiveBoard,
      boardVectors,
      clueIndex,
      definitions,
      limit: CANDIDATE_POOL_SIZE,
    });
    const candidateRetrievalMs = performance.now() - retrievalStartedAt;
    const conceptStartedAt = performance.now();
    const conceptScores = await buildConceptOverrides({
      board: perspectiveBoard,
      boardVectors,
      candidateIndices,
      clueIndex,
      definitions,
      embeddingOptions,
      centeringMean: manifest.centering.mean,
    });
    const conceptPreparationMs = performance.now() - conceptStartedAt;
    const rerankStartedAt = performance.now();
    const conceptAnalysis = analyzeEmbeddedBoard(
      perspectiveBoard,
      boardVectors,
      clueIndex,
      {
        candidateSimilarityOverrides: {
          minimumTargetSize: 2,
          rows: conceptScores.rows,
        },
        language: LANGUAGE.ENGLISH,
        limit: RESULTS_PER_SIZE,
      },
    );
    const rerankAnalysisMs = performance.now() - rerankStartedAt;
    const ownRemaining = perspectiveBoard.filter(
      ({ team }) => team === "friendly",
    ).length;
    const opponentRemaining = perspectiveBoard.filter(
      ({ team }) => team === "enemy",
    ).length;
    const decisionOptions = {
      ownRemaining,
      opponentRemaining,
      policy: PLAY_CLUE_POLICY.HYBRID,
      multiTolerance: MULTI_TOLERANCE,
      random: () => 0,
    };
    const directDecision = evaluateBotClue({
      ...decisionOptions,
      analysis: directAnalysis,
    }).selected;
    const conceptDecision = evaluateBotClue({
      ...decisionOptions,
      analysis: conceptAnalysis,
    }).selected;
    openingCases.push({
      boardIndex,
      seed,
      side,
      board: perspectiveBoard.map(({ word, team }) => ({
        word: normalizeConceptTerm(word),
        team,
      })),
      candidatePoolSize: candidateIndices.length,
      candidatesWithDefinitions: conceptScores.candidatesWithDefinitions,
      activatedCandidates: conceptScores.activatedCandidates,
      conceptTexts: conceptScores.conceptTextCount,
      direct: summarizeSuggestion(directDecision),
      concept: summarizeSuggestion(conceptDecision),
      conceptSelectedCardScores:
        conceptScores.diagnostics.find(
          ({ clue }) =>
            normalizeConceptTerm(clue) ===
            normalizeConceptTerm(conceptDecision?.clue),
        )?.cards ?? null,
      changed: suggestionIdentity(directDecision) !== suggestionIdentity(conceptDecision),
      timingMs: {
        directAnalysis: round(directAnalysisMs),
        candidateRetrieval: round(candidateRetrievalMs),
        conceptPreparation: round(conceptPreparationMs),
        rerankAnalysis: round(rerankAnalysisMs),
      },
    });
  }
}

const fixture = await evaluateJoustFixture();
const changedCases = openingCases.filter(({ changed }) => changed);
const activatedCases = openingCases.filter(
  ({ activatedCandidates }) => activatedCandidates > 0,
);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "evaluation-only",
  conclusion:
    changedCases.length > 0
      ? "Concept rescoring changes at least one opening Owner decision. Human and cross-model evidence are required before runtime use."
      : "The bounded concept-aware vocabulary reranker does not change these opening Owner decisions. Broader evaluation is required before judging generation quality.",
  configuration: {
    language: LANGUAGE.ENGLISH,
    modelId: "bge-small",
    model: manifest.model,
    candidateCount: CANDIDATE_COUNT,
    candidatePoolLimit: CANDIDATE_POOL_SIZE,
    boardCount: BOARD_COUNT,
    sideCount: openingCases.length,
    candidatePool:
      "Up to 64 legal clues with WordNet definitions, weak direct similarity to every active card, and the strongest two-friendly direct support.",
    conceptOffset: CONCEPT_SCORE_OFFSET,
    activationCeiling: CONCEPT_ACTIVATION_CEILING,
    minimumTargetSize: 2,
    cluePolicy: PLAY_CLUE_POLICY.HYBRID,
    multiTolerance: MULTI_TOLERANCE,
    fallback:
      "Missing definitions, inactive candidates, and incomplete override rows retain exact direct similarities.",
  },
  joustFixture: fixture,
  summary: {
    cases: openingCases.length,
    activatedCases: activatedCases.length,
    changedCases: changedCases.length,
    changedRate: ratio(changedCases.length, openingCases.length),
    candidatePoolMedian: median(
      openingCases.map(({ candidatePoolSize }) => candidatePoolSize),
    ),
    activatedCandidatesMedian: median(
      openingCases.map(({ activatedCandidates }) => activatedCandidates),
    ),
    timingMs: {
      directAnalysisMedian: median(
        openingCases.map(({ timingMs }) => timingMs.directAnalysis),
      ),
      candidateRetrievalMedian: median(
        openingCases.map(({ timingMs }) => timingMs.candidateRetrieval),
      ),
      conceptPreparationMedian: median(
        openingCases.map(({ timingMs }) => timingMs.conceptPreparation),
      ),
      rerankAnalysisMedian: median(
        openingCases.map(({ timingMs }) => timingMs.rerankAnalysis),
      ),
    },
  },
  cases: openingCases,
};

await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Wrote ${REPORT_PATH}. ${changedCases.length}/${openingCases.length} opening decisions changed.`,
);

async function evaluateJoustFixture() {
  const cards = JOUST_WORDS.map((word, index) => ({
    word,
    layoutId: index,
    team: word === "piano" ? "neutral" : "friendly",
    done: false,
  }));
  const vectors = centerEmbeddings(
    await embedTerms(cards.map(({ word }) => word), embeddingOptions),
    manifest.centering.mean,
  );
  const [clueVector] = centerEmbeddings(
    await embedTerms(["joust"], embeddingOptions),
    manifest.centering.mean,
  );
  const fixtureIndex = {
    clues: ["joust"],
    dimensions: manifest.dimensions,
    frequencies: [2.47],
    quantization: { scale: 127 },
    vectors: Int8Array.from(clueVector, (value) =>
      Math.max(-127, Math.min(127, Math.round(value * 127))),
    ),
  };
  const conceptScores = await buildConceptOverrides({
    board: cards,
    boardVectors: vectors,
    candidateIndices: [0],
    clueIndex: fixtureIndex,
    definitions,
    embeddingOptions,
    centeringMean: manifest.centering.mean,
  });
  const direct = analyzeEmbeddedBoard(cards, vectors, fixtureIndex, {
    language: LANGUAGE.ENGLISH,
    limit: RESULTS_PER_SIZE,
  });
  const concept = analyzeEmbeddedBoard(cards, vectors, fixtureIndex, {
    candidateSimilarityOverrides: {
      minimumTargetSize: 2,
      rows: conceptScores.rows,
    },
    language: LANGUAGE.ENGLISH,
    limit: RESULTS_PER_SIZE,
  });
  const directSuggestion = direct.suggestions.find(
    ({ clue, number }) => clue === "joust" && number === 4,
  );
  const conceptSuggestion = concept.suggestions.find(
    ({ clue, number }) => clue === "joust" && number === 4,
  );
  const scores = conceptScores.diagnostics[0]?.cards ?? [];
  const pianoScore = scores.find(({ word }) => word === "piano")?.association;
  const intendedScores = scores
    .filter(({ word }) => word !== "piano")
    .map(({ association }) => association);
  return {
    candidateVocabularyPosition: 39_742,
    inProductionPrefix: false,
    directGenerated: Boolean(directSuggestion),
    conceptGenerated: Boolean(conceptSuggestion),
    allIntendedAbovePiano:
      Number.isFinite(pianoScore) &&
      intendedScores.every((score) => score > pianoScore),
    direct: summarizeSuggestion(directSuggestion),
    concept: summarizeSuggestion(conceptSuggestion),
    cardScores: scores,
  };
}

function selectBridgeCandidateIndices({
  board,
  boardVectors,
  clueIndex: activeClueIndex,
  definitions: activeDefinitions,
  limit,
}) {
  const activeCards = board
    .map((card, sourceIndex) => ({ ...card, sourceIndex }))
    .filter(({ done }) => !done)
    .map((card, activeIndex) => ({ ...card, activeIndex }));
  const friendlies = activeCards.filter(({ team }) => team === "friendly");
  if (friendlies.length < 2) return [];

  const boardWords = activeCards.map(({ word }) => word);
  const ranked = [];
  for (
    let candidateIndex = 0;
    candidateIndex < activeClueIndex.clues.length;
    candidateIndex += 1
  ) {
    const clue = activeClueIndex.clues[candidateIndex];
    if (
      !activeDefinitions.has(normalizeConceptTerm(clue)) ||
      isForbiddenClue(clue, boardWords, { language: LANGUAGE.ENGLISH })
    ) {
      continue;
    }

    const scores = activeCards.map(({ sourceIndex }) =>
      directCandidateSimilarity(
        activeClueIndex,
        candidateIndex,
        boardVectors[sourceIndex],
      ),
    );
    if (Math.max(...scores) >= CONCEPT_ACTIVATION_CEILING) continue;

    const friendlyScores = friendlies
      .map(({ activeIndex }) => scores[activeIndex])
      .sort((left, right) => right - left);
    ranked.push({
      candidateIndex,
      support: friendlyScores[0] + friendlyScores[1],
      floor: friendlyScores[1],
    });
  }

  return ranked
    .sort(
      (left, right) =>
        right.support - left.support ||
        right.floor - left.floor ||
        left.candidateIndex - right.candidateIndex,
    )
    .slice(0, limit)
    .map(({ candidateIndex }) => candidateIndex);
}

async function buildConceptOverrides({
  board,
  boardVectors,
  candidateIndices,
  clueIndex: activeClueIndex,
  definitions: activeDefinitions,
  embeddingOptions: activeEmbeddingOptions,
  centeringMean,
}) {
  const activeCards = board
    .map((card, sourceIndex) => ({
      ...card,
      sourceIndex,
    }))
    .filter(({ done }) => !done);
  const eligible = candidateIndices
    .map((candidateIndex) => {
      const clue = activeClueIndex.clues[candidateIndex];
      const clueDefinitions =
        activeDefinitions.get(normalizeConceptTerm(clue)) ?? [];
      const directScores = activeCards.map(({ sourceIndex }) =>
        directCandidateSimilarity(
          activeClueIndex,
          candidateIndex,
          boardVectors[sourceIndex],
        ),
      );
      return {
        candidateIndex,
        clue,
        clueDefinitions,
        directScores,
        activated:
          clueDefinitions.length > 0 &&
          Math.max(...directScores) < CONCEPT_ACTIVATION_CEILING,
      };
    });
  const activated = eligible.filter(({ activated }) => activated);
  if (activated.length === 0) {
    return {
      rows: new Map(),
      diagnostics: [],
      candidatesWithDefinitions: eligible.filter(
        ({ clueDefinitions }) => clueDefinitions.length > 0,
      ).length,
      activatedCandidates: 0,
      conceptTextCount: 0,
    };
  }

  const terms = [];
  const cardRanges = new Map();
  for (const card of activeCards) {
    cardRanges.set(
      card.layoutId,
      appendConceptTerms(
        terms,
        card.word,
        activeDefinitions.get(normalizeConceptTerm(card.word)) ?? [],
      ),
    );
  }
  const clueRanges = new Map();
  for (const candidate of activated) {
    clueRanges.set(
      candidate.candidateIndex,
      appendConceptTerms(
        terms,
        candidate.clue,
        candidate.clueDefinitions,
      ),
    );
  }
  const conceptVectors = centerEmbeddings(
    await embedTerms(terms, activeEmbeddingOptions),
    centeringMean,
  );
  const rows = new Map();
  const diagnostics = [];
  for (const candidate of activated) {
    const clueVectors = vectorsForRange(
      conceptVectors,
      clueRanges.get(candidate.candidateIndex),
    );
    const row = new Map();
    const cardScores = activeCards.map((card, index) => {
      const cardVectors = vectorsForRange(
        conceptVectors,
        cardRanges.get(card.layoutId),
      );
      const concept = maximumConceptSimilarity(clueVectors, cardVectors);
      const direct = candidate.directScores[index];
      const association = scoreOperativeAssociation(direct, concept);
      row.set(card.layoutId, association);
      return {
        word: normalizeConceptTerm(card.word),
        direct: round(direct),
        concept: Number.isFinite(concept) ? round(concept) : null,
        association: round(association),
      };
    });
    rows.set(candidate.candidateIndex, row);
    diagnostics.push({
      clue: candidate.clue,
      candidateIndex: candidate.candidateIndex,
      cards: cardScores.sort(
        (left, right) => right.association - left.association,
      ),
    });
  }
  return {
    rows,
    diagnostics,
    candidatesWithDefinitions: eligible.filter(
      ({ clueDefinitions }) => clueDefinitions.length > 0,
    ).length,
    activatedCandidates: activated.length,
    conceptTextCount: terms.length,
  };
}

function directCandidateSimilarity(
  activeClueIndex,
  candidateIndex,
  boardVector,
) {
  const vectorOffset = candidateIndex * activeClueIndex.dimensions;
  let total = 0;
  for (
    let dimension = 0;
    dimension < activeClueIndex.dimensions;
    dimension += 1
  ) {
    total +=
      activeClueIndex.vectors[vectorOffset + dimension] *
      boardVector[dimension];
  }
  return total / activeClueIndex.quantization.scale;
}

async function loadConceptDefinitions() {
  const conceptManifest = JSON.parse(
    await readFile(resolve(CONCEPT_DIRECTORY, "manifest.json"), "utf8"),
  );
  const payloads = await Promise.all([
    readFile(resolve(CONCEPT_DIRECTORY, conceptManifest.boardFile), "utf8").then(
      JSON.parse,
    ),
    ...Object.values(conceptManifest.shards).map(({ file }) =>
      readFile(resolve(CONCEPT_DIRECTORY, file), "utf8").then(JSON.parse),
    ),
  ]);
  return new Map(
    payloads.flatMap(({ entries }) => Object.entries(entries)),
  );
}

function appendConceptTerms(output, term, termDefinitions) {
  const start = output.length;
  output.push(...conceptTexts(term, termDefinitions));
  return { start, end: output.length };
}

function vectorsForRange(vectors, range) {
  return range ? vectors.slice(range.start, range.end) : [];
}

function summarizeSuggestion(suggestion) {
  if (!suggestion) return null;
  return {
    clue: suggestion.clue,
    number: suggestion.number,
    targets: suggestion.targets.map(({ word }) => normalizeConceptTerm(word)),
    closestDanger: normalizeConceptTerm(suggestion.closestDanger.word),
    closestDangerTeam: suggestion.closestDanger.team,
    margin: round(suggestion.margin),
    expectedNet: round(suggestion.expectedNet),
    worth: suggestion.worth,
    risk: suggestion.risk,
  };
}

function suggestionIdentity(suggestion) {
  return suggestion
    ? `${normalizeConceptTerm(suggestion.clue)}:${suggestion.number}`
    : "none";
}

function boardSeed(boardIndex) {
  const bytes = Buffer.alloc(8);
  bytes.write("CODE", 0, "ascii");
  bytes.writeUInt32BE(boardIndex + 1, 4);
  return bytes.toString("base64url");
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : null;
}

function round(value) {
  return Number(value.toFixed(4));
}
