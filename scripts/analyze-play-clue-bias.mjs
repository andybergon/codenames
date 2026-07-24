import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_ORDER, createGeneratedBoardState } from "../src/board-share.js";
import { hydrateClueShards } from "../src/clue-index.js";
import { centerEmbeddings, embedTerms } from "../src/embeddings.js";
import { SIDE, boardForSide, otherSide, remainingCardsForSide } from "../src/gameplay.js";
import { analyzeEmbeddedBoard } from "../src/model.js";
import { PLAY_CLUE_POLICY, scorePlayClue } from "../src/play/bots.js";
import { WORD_SET, getWordsForSet } from "../src/word-data.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPORT_PATH = resolve(ROOT, "scripts/generated/play-clue-bias-analysis.json");
const BOARD_COUNT = 40;
const RESULTS_PER_SIZE = 6;
const BASELINE_ID = "minilm-l6:official:10000";
const CONFIGS = [
  config("candidate-depth", "MiniLM-L6, 3k", "minilm-l6", WORD_SET.OFFICIAL, 3_000),
  config("candidate-depth", "MiniLM-L6, 10k", "minilm-l6", WORD_SET.OFFICIAL, 10_000),
  config("candidate-depth", "MiniLM-L6, 30k", "minilm-l6", WORD_SET.OFFICIAL, 30_000),
  config("candidate-depth", "MiniLM-L6, 100k", "minilm-l6", WORD_SET.OFFICIAL, 100_000),
  config("word-set", "MiniLM-L6, Extended", "minilm-l6", WORD_SET.EXTENDED, 10_000),
  config("embedding", "MiniLM-L3", "minilm-l3", WORD_SET.OFFICIAL, 10_000),
  config("embedding", "BGE-small", "bge-small", WORD_SET.OFFICIAL, 10_000),
  config("embedding", "MiniLM-L12", "minilm-l12", WORD_SET.OFFICIAL, 10_000),
  config("embedding", "MPNet-base", "mpnet-base", WORD_SET.OFFICIAL, 10_000),
];

const loadedModels = new Map();
const results = [];

for (const activeConfig of CONFIGS) {
  const model = await loadModel(activeConfig.modelId);
  const clueIndex = hydrateClueShards(
    model.manifest,
    model.shards,
    activeConfig.candidateCount,
  );
  const words = getWordsForSet(activeConfig.wordSet);
  const rawVectors = await embedTerms(words, { model: model.manifest.model });
  const centeredVectors = centerEmbeddings(rawVectors, clueIndex.centering.mean);
  const vectorByWord = new Map(
    words.map((word, index) => [word, centeredVectors[index]]),
  );
  const states = [];

  for (let boardIndex = 0; boardIndex < BOARD_COUNT; boardIndex += 1) {
    const seed = boardSeed(boardIndex);
    const boardState = createGeneratedBoardState(
      seed,
      BOARD_ORDER.RANDOM,
      activeConfig.wordSet,
    );
    const boardVectors = boardState.cards.map((card) => vectorByWord.get(card.word));

    for (const side of [SIDE.BLUE, SIDE.RED]) {
      const analysis = analyzeEmbeddedBoard(
        boardForSide(boardState.cards, side),
        boardVectors,
        clueIndex,
        { limit: RESULTS_PER_SIZE },
      );
      states.push(
        summarizeState({
          analysis,
          ownRemaining: remainingCardsForSide(boardState.cards, side),
          opponentRemaining: remainingCardsForSide(
            boardState.cards,
            otherSide(side),
          ),
        }),
      );
    }
  }

  const result = summarizeConfig(activeConfig, model.manifest, states);
  results.push(result);
  console.log(
    `${activeConfig.label}: mean ${result.meanSelectedNumber}, ` +
      `${asPercent(result.selectedMultiRate)} multi, ` +
      `${asPercent(result.viableMultiRate)} viable`,
  );
}

const baseline = results.find(({ id }) => id === BASELINE_ID);
const report = {
  generatedAt: new Date().toISOString(),
  methodology: {
    boardCount: BOARD_COUNT,
    perspectivesPerBoard: 2,
    stateCountPerConfiguration: BOARD_COUNT * 2,
    boardSeeds:
      "The same deterministic 40 board seeds are used for every configuration.",
    state:
      "Opening board only, before any cards are revealed, to isolate candidate vocabulary, board word set, and embedding choice from turn progression.",
    selection:
      "Rank every generated suggestion with the candidate hybrid Play score and select its highest-scoring clue. The production top-four randomness is excluded.",
    baseline: BASELINE_ID,
  },
  results: results.map((result) => ({
    ...result,
    deltaVsBaseline:
      result.id === BASELINE_ID
        ? null
        : {
            meanSelectedNumber: rounded(
              result.meanSelectedNumber - baseline.meanSelectedNumber,
            ),
            selectedMultiRate: rounded(
              result.selectedMultiRate - baseline.selectedMultiRate,
            ),
            shortlistMultiRate: rounded(
              result.shortlistMultiRate - baseline.shortlistMultiRate,
            ),
            meanBestMultiAdvantage: rounded(
              result.meanBestMultiAdvantage - baseline.meanBestMultiAdvantage,
            ),
          },
  })),
};

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.table(
  report.results.map((result) => ({
    dimension: result.dimension,
    configuration: result.label,
    candidates: result.candidateCount,
    "mean number": result.meanSelectedNumber,
    "multi selected": asPercent(result.selectedMultiRate),
    "multi in top 4": asPercent(result.shortlistMultiRate),
    "multi viable": asPercent(result.viableMultiRate),
    "multi score edge": result.meanBestMultiAdvantage,
  })),
);
console.log(`Wrote ${REPORT_PATH}`);

function summarizeState({ analysis, ownRemaining, opponentRemaining }) {
  const ranked = analysis.suggestions
    .map((suggestion) => ({
      suggestion,
      score: scorePlayClue(suggestion, {
        ownRemaining,
        opponentRemaining,
        policy: PLAY_CLUE_POLICY.HYBRID,
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const single = ranked.find(({ suggestion }) => suggestion.number === 1);
  const multi = ranked.find(({ suggestion }) => suggestion.number >= 2);
  const selected = ranked[0];
  const shortlist = ranked.slice(0, 4);

  return {
    selectedNumber: selected?.suggestion.number ?? 0,
    viableMulti: Boolean(multi),
    bestMultiAdvantage:
      single && multi ? multi.score - single.score : Number.NaN,
    shortlistMultiCount: shortlist.filter(
      ({ suggestion }) => suggestion.number >= 2,
    ).length,
    shortlistCount: shortlist.length,
  };
}

function summarizeConfig(activeConfig, manifest, states) {
  const selected = states.filter(({ selectedNumber }) => selectedNumber > 0);
  const shortlistCount = states.reduce(
    (total, state) => total + state.shortlistCount,
    0,
  );
  return {
    ...activeConfig,
    model: manifest.model,
    stateCount: states.length,
    statesWithSuggestion: selected.length,
    viableMultiRate: ratio(
      states.filter(({ viableMulti }) => viableMulti).length,
      states.length,
    ),
    selectedNumberDistribution: distribution(
      selected.map(({ selectedNumber }) => selectedNumber),
    ),
    meanSelectedNumber: mean(selected.map(({ selectedNumber }) => selectedNumber)),
    selectedMultiRate: ratio(
      selected.filter(({ selectedNumber }) => selectedNumber >= 2).length,
      selected.length,
    ),
    shortlistMultiRate: ratio(
      states.reduce(
        (total, state) => total + state.shortlistMultiCount,
        0,
      ),
      shortlistCount,
    ),
    meanBestMultiAdvantage: mean(
      states.map(({ bestMultiAdvantage }) => bestMultiAdvantage),
    ),
  };
}

async function loadModel(modelId) {
  if (!loadedModels.has(modelId)) {
    const directory = resolve(ROOT, `public/data/model-lab/${modelId}`);
    const manifest = JSON.parse(
      await readFile(resolve(directory, "manifest.json"), "utf8"),
    );
    const shards = await Promise.all(
      manifest.shards.map(async ({ file }) =>
        JSON.parse(await readFile(resolve(directory, file), "utf8")),
      ),
    );
    loadedModels.set(modelId, { manifest, shards });
  }
  return loadedModels.get(modelId);
}

function config(dimension, label, modelId, wordSet, candidateCount) {
  return {
    id: `${modelId}:${wordSet}:${candidateCount}`,
    dimension,
    label,
    modelId,
    wordSet,
    candidateCount,
  };
}

function boardSeed(boardIndex) {
  const bytes = Buffer.alloc(8);
  bytes.write("BIAS", 0, "ascii");
  bytes.writeUInt32BE(boardIndex + 1, 4);
  return bytes.toString("base64url");
}

function distribution(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? rounded(finite.reduce((total, value) => total + value, 0) / finite.length)
    : 0;
}

function ratio(numerator, denominator) {
  return denominator ? rounded(numerator / denominator) : 0;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function asPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
