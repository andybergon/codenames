import { cpus, platform, release } from "node:os";
import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { env } from "@huggingface/transformers";
import { BOARD_ORDER, createGeneratedBoardState } from "../src/board-share.js";
import { hydrateClueShards } from "../src/clue-index.js";
import { centerEmbeddings, embedTerms } from "../src/embeddings.js";
import {
  SIDE,
  boardForSide,
  otherSide,
  remainingCardsForSide,
  teamForSide,
} from "../src/gameplay.js";
import {
  analyzeEmbeddedBoard,
  calibrateSimilarity,
  isForbiddenClue,
  normalizeTerm,
} from "../src/model.js";
import { ITALIAN_MODEL_ID } from "../src/model-lab.js";
import {
  PLAY_CLUE_POLICY,
  botClueExclusions,
  chooseBotClue,
  chooseBotGuess,
  createSeededRandom,
  scoreMissedTargetPreference,
  scorePlayClue,
} from "../src/play/bots.js";
import {
  DEFAULT_PLAY_BOT_SETTINGS,
  PLAY_BONUS_POLICY,
  PLAY_CLUE_REPEAT_POLICY,
  PLAY_MISSED_TARGET_TIMING,
  PLAY_OPERATIVE_AGGRESSION,
} from "../src/play/settings.js";
import {
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  createPlayGame,
  giveClue,
  guessCard,
  cluesForSide,
  passTurn,
  unresolvedIntendedTargetIds,
} from "../src/play/game-state.js";
import {
  LANGUAGE,
  WORD_SET,
  getWordsForSet,
} from "../src/word-data.js";
import { PLAY_FUN_OBJECTIVE, scorePlayFun } from "./play-fun-score.mjs";
import { writePlayPolicySummary } from "./play-policy-summary.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
env.cacheDir = resolve(ROOT, ".cache/huggingface");
const DEFAULT_BOARD_COUNT = 100;
const DEFAULT_OUTPUT = "scripts/generated/play-policy-benchmark.json";
const DEFAULT_SUMMARY_OUTPUT = "scripts/generated/play-policy-benchmark.md";
const RESULTS_PER_SIZE = 6;
const DEFAULT_MAX_ACTIONS_PER_GAME = 100;
const POLICIES = [PLAY_CLUE_POLICY.CURRENT, PLAY_CLUE_POLICY.HYBRID];
const OPERATIVE_AGGRESSIONS = Object.values(PLAY_OPERATIVE_AGGRESSION);
const MISSED_TARGET_TIMINGS = Object.values(PLAY_MISSED_TARGET_TIMING);
const CLUE_REPEAT_POLICIES = Object.values(PLAY_CLUE_REPEAT_POLICY);
const BENCHMARK_SPLITS = Object.freeze({
  smoke: { boardOffset: 0, boards: 20 },
  calibration: { boardOffset: 20, boards: 100 },
  development: { boardOffset: 120, boards: 128 },
  test: { boardOffset: 248, boards: 150 },
});

const options = parseOptions(process.argv.slice(2));
const outputPath = isAbsolute(options.output) ? options.output : resolve(ROOT, options.output);
await validateHeldOutTestRun(options, outputPath);
const summaryOutput = options.summaryOutput ?? summaryPathFor(options.output);
const summaryOutputPath = isAbsolute(summaryOutput)
  ? summaryOutput
  : resolve(ROOT, summaryOutput);
const manifestDirectory = options.indexDir
  ? resolve(ROOT, options.indexDir)
  : resolve(
      ROOT,
      options.language === LANGUAGE.ITALIAN
        ? `public/data/model-lab/it/${options.modelId}`
        : `public/data/model-lab/${options.modelId}`,
    );
const manifest = JSON.parse(
  await readFile(resolve(manifestDirectory, "manifest.json"), "utf8"),
);
const selectedShards = manifest.shards.filter((shard) => shard.start < options.candidates);
if (selectedShards.length === 0 || options.candidates > manifest.shards.at(-1).end) {
  throw new Error(`Candidate count must be between 1 and ${manifest.shards.at(-1).end}.`);
}
const shards = await Promise.all(
  selectedShards.map(async ({ file }) =>
    JSON.parse(await readFile(resolve(manifestDirectory, file), "utf8")),
  ),
);
const clueIndex = hydrateClueShards(manifest, shards, options.candidates);

const boardWords = getWordsForSet(options.wordSet, options.language);
const centeredBoardWords =
  manifest.embeddingRuntime === "precomputed"
    ? await loadPrecomputedBoardVectors(
        manifestDirectory,
        manifest,
        boardWords,
      )
    : await embedLocalBoardWords(boardWords, manifest, clueIndex);
const similarityCalibration = {
  scale: options.similarityScale,
  offset: options.similarityOffset,
};
const similarityGeometry = measureSimilarityGeometry(
  clueIndex,
  centeredBoardWords,
);
const activePolicies = options.comparisonOnly
  ? [PLAY_CLUE_POLICY.HYBRID]
  : POLICIES;
const activeAggressions = options.comparisonOnly
  ? [options.operativeAggression]
  : OPERATIVE_AGGRESSIONS;
const vectorByWord = new Map(
  boardWords.map((word, index) => [word, centeredBoardWords[index]]),
);
const centeredClueVectors = buildPrecomputedClueVectorCache(clueIndex);
const operativeContext = await loadOperativeContext({
  boardWords,
  clueIndex,
  centeredBoardWords,
  centeredClueVectors,
  manifest,
  modelId: options.operativeModel,
});
const resultsByPolicy = new Map(
  activePolicies.map((policy) => [policy, []]),
);
const resultsByAggression = new Map(
  activeAggressions.map((aggression) => [aggression, []]),
);
const startedAt = performance.now();

for (let boardIndex = 0; boardIndex < options.boards; boardIndex += 1) {
  const benchmarkBoardIndex = options.boardOffset + boardIndex;
  const seed = boardSeed(benchmarkBoardIndex);
  const boardState = createGeneratedBoardState(
    seed,
    BOARD_ORDER.RANDOM,
    options.wordSet,
    options.language,
  );
  const positions = new Map(
    boardState.randomLayoutOrder.map((layoutId, index) => [layoutId, index]),
  );
  const cards = [...boardState.cards].sort(
    (left, right) => positions.get(left.layoutId) - positions.get(right.layoutId),
  );
  const boardVectors = cards.map((card) => {
    const vector = vectorByWord.get(card.word);
    if (!vector) {
      throw new Error(`No embedding found for board word ${card.word}.`);
    }
    return vector;
  });
  const operativeGameContext = {
    ...operativeContext,
    boardVectors: cards.map((card) => {
      const vector = operativeContext.vectorByWord.get(card.word);
      if (!vector) {
        throw new Error(
          `No operative embedding found for board word ${card.word}.`,
        );
      }
      return vector;
    }),
  };

  for (const policy of activePolicies) {
    const result = await simulateGame({
      boardIndex: benchmarkBoardIndex,
      boardVectors,
      operativeContext: operativeGameContext,
      cards,
      clueIndex,
      centeredClueVectors,
      policy,
      seed,
      clueSelection: options.clueSelection,
      multiTolerance: options.multiTolerance,
      missedTargetTiming: options.missedTargetTiming,
      clueRepeatPolicy: options.clueRepeatPolicy,
      bonusGuesses: options.bonusGuesses,
      operativeAggression: options.operativeAggression,
      language: options.language,
      wordSet: options.wordSet,
      maxActions: options.maxActions,
      similarityCalibration,
    });
    resultsByPolicy.get(policy).push(result);
    if (policy === PLAY_CLUE_POLICY.HYBRID) {
      resultsByAggression.get(options.operativeAggression).push(result);
    }
  }

  for (const operativeAggression of activeAggressions) {
    if (operativeAggression === options.operativeAggression) {
      continue;
    }
    resultsByAggression.get(operativeAggression).push(
      await simulateGame({
        boardIndex: benchmarkBoardIndex,
        boardVectors,
        operativeContext: operativeGameContext,
        cards,
        clueIndex,
        centeredClueVectors,
        policy: PLAY_CLUE_POLICY.HYBRID,
        seed,
        clueSelection: options.clueSelection,
        multiTolerance: options.multiTolerance,
        missedTargetTiming: options.missedTargetTiming,
        clueRepeatPolicy: options.clueRepeatPolicy,
        bonusGuesses: options.bonusGuesses,
        operativeAggression,
        language: options.language,
        wordSet: options.wordSet,
        maxActions: options.maxActions,
        similarityCalibration,
      }),
    );
  }

  if ((boardIndex + 1) % 10 === 0 || boardIndex + 1 === options.boards) {
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Completed ${boardIndex + 1}/${options.boards} controlled boards in ${seconds}s`,
    );
  }
}

const policies = Object.fromEntries(
  activePolicies.map((policy) => [
    policy,
    summarizePolicy(resultsByPolicy.get(policy)),
  ]),
);
const operativeAggression = Object.fromEntries(
  activeAggressions.map((aggression) => [
    aggression,
    compactOperativeSummary(
      summarizePolicy(resultsByAggression.get(aggression)),
    ),
  ]),
);
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCores: cpus().length,
  },
  methodology: {
    boardCount: options.boards,
    boardOffset: options.boardOffset,
    split: options.split,
    gamesPerPolicy: options.boards,
    pairedBoards: true,
    comparisonOnly: options.comparisonOnly,
    wordSet: options.wordSet,
    language: options.language,
    modelId: options.modelId,
    model: manifest.model,
    provider: manifest.provider ?? "local",
    dimensions: manifest.dimensions,
    indexDirectory:
      options.indexDir ??
      (options.language === LANGUAGE.ITALIAN
        ? `public/data/model-lab/it/${options.modelId}`
        : `public/data/model-lab/${options.modelId}`),
    candidateCount: options.candidates,
    resultsPerTargetSize: RESULTS_PER_SIZE,
    boardSeed:
      "Eight deterministic bytes: ASCII CODE followed by a big-endian 1-based board index.",
    decisionSeed:
      "Matches Play runtime: board seed, turn number, and history length for each action.",
    clueSelection: {
      random:
        "Match Play runtime by choosing uniformly from the four highest-scoring policy clues.",
      top: "Always choose the highest-scoring policy clue.",
      tempo:
        `Prefer the highest-scoring multi clue when it is within ${options.multiTolerance} points of the best clue; otherwise choose the best clue.`,
    }[options.clueSelection],
    bonusGuesses:
      options.bonusGuesses === "pass"
        ? "Pass after reaching the declared clue number."
        : "Match Play runtime by allowing a number-plus-one guess.",
    operative:
      `The bot guesser sees only centered clue-to-unrevealed-word similarities from ${operativeContext.model}.`,
    operativeAggression:
      `Policy comparison uses ${options.operativeAggression} for the clue-policy rows and holds hybrid clue scoring fixed across all three operative modes.`,
    missedTargetTiming:
      `Clue ranking uses ${options.missedTargetTiming} missed-target timing. The fresh-target bias is based on unresolved intended targets from prior clues and fades as never-targeted friendly cards run out.`,
    repeatedClues:
      {
        [PLAY_CLUE_REPEAT_POLICY.NEVER]:
          "The spymaster excludes every clue previously given by the same team before analysis, ranking, and fallback selection.",
        [PLAY_CLUE_REPEAT_POLICY.PREVIOUS]:
          "The spymaster excludes the same team's immediately previous clue before analysis, ranking, and fallback selection.",
        [PLAY_CLUE_REPEAT_POLICY.ALLOW]:
          "The spymaster may reuse earlier clues.",
      }[options.clueRepeatPolicy],
    stalledGameResolution:
      "After two consecutive passes, the next operative takes its highest-similarity available guess. This keeps cross-model simulations bounded and is counted separately.",
    operativeAggressionModes: {
      conservative:
        "Uses the highest similarity and separation thresholds and does not adapt to score.",
      aggressive:
        "Uses the former production thresholds and pursues the declared clue number unless confidence is extremely low.",
      dynamic:
        "Uses public remaining-agent counts to lower thresholds for a possible win or urgent comeback and raise them with a comfortable lead.",
    },
    operativeModelId: options.operativeModel,
    operativeModel: operativeContext.model,
    maxActionsPerGame: options.maxActions,
    similarityCalibration: {
      ...similarityCalibration,
      rawGeometry: similarityGeometry,
      calibratedGeometry: transformSimilarityGeometry(
        similarityGeometry,
        similarityCalibration,
      ),
      note:
        "Scale and offset are applied to clue-board and board-board similarities before scoring. Cross-model operative runs retain the operative model's native scale.",
    },
    rules:
      "Every simulation uses the production Play state machine. Games that exceed the action bound remain in the report as stalls.",
    fallback:
      "If the production analyzer has no ranked suggestion, use the legal indexed clue closest to one remaining agent, number 1, and count the turn.",
    firstHalf:
      "For each completed game, take the first ceiling(total clue turns / 2) clue turns, then aggregate their clue numbers.",
    funObjective: {
      definition:
        "A 0-100 proxy balancing ambitious clues, productive guesses, close finishes, and a playable game length.",
      caution:
        "The Fun Index ranks deterministic self-play experiments. Human embedding agreement remains a separate validity guardrail.",
      ...PLAY_FUN_OBJECTIVE,
    },
    policies: {
      current:
        "Worth + current risk adjustment + state-dependent clue-number bonus + 18 x margin.",
      hybrid:
        "0.35 x Worth + 25 x expected net + 10 x success + 6 x margin + risk adjustment.",
    },
  },
  policies,
  operativeAggression,
  operativeAggressionVsDynamic: Object.fromEntries(
    activeAggressions.filter(
      (aggression) => aggression !== PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
    ).map((aggression) => [
      aggression,
      operativeMetricDeltas(
        operativeAggression.dynamic,
        operativeAggression[aggression],
      ),
    ]),
  ),
  hybridMinusCurrent: policies.current
    ? metricDeltas(policies.current, policies.hybrid)
    : null,
};

const outputReport =
  options.reportDetail === "compact" ? compactReport(report) : report;
await writeFile(outputPath, `${JSON.stringify(outputReport, null, 2)}\n`);
if (!options.comparisonOnly) {
  await writePlayPolicySummary(report, summaryOutputPath);
}
console.log(`Wrote ${outputPath}`);
if (!options.comparisonOnly) {
  console.log(`Wrote ${summaryOutputPath}`);
}
printSummary(policies, activePolicies);

async function simulateGame({
  boardIndex,
  boardVectors,
  operativeContext,
  cards,
  clueIndex: activeClueIndex,
  centeredClueVectors: clueVectorCache,
  policy,
  seed,
  clueSelection,
  multiTolerance,
  missedTargetTiming,
  clueRepeatPolicy,
  bonusGuesses: bonusGuessPolicy,
  operativeAggression,
  language,
  wordSet,
  maxActions,
  similarityCalibration,
}) {
  let game = createPlayGame({
    botSettings: {
      modelId: options.modelId,
      candidateCount: options.candidates,
      cluePolicy: policy,
      multiTolerance,
      missedTargetTiming,
      clueRepeatPolicy,
      operativeAggression,
      bonusGuesses: bonusGuessPolicy,
    },
    cards,
    humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
    language,
    seed,
    wordSet,
  });
  let actions = 0;
  let fallbackClues = 0;
  let bonusGuesses = 0;
  let correctBonusGuesses = 0;
  let consecutivePasses = 0;
  let forcedProgressGuesses = 0;
  const clueDecisions = [];
  const guessDecisions = [];

  while (game.phase !== GAME_PHASE.COMPLETE && actions < maxActions) {
    actions += 1;
    const random = createSeededRandom(
      `${game.seed}:${game.turnNumber}:${game.history.length}`,
    );

    if (game.phase === GAME_PHASE.AWAITING_CLUE) {
      const teamClues = cluesForSide(game, game.activeSide);
      const excludedClues = botClueExclusions(
        teamClues,
        clueRepeatPolicy,
      );
      const analysis = analyzeEmbeddedBoard(
        boardForSide(game.cards, game.activeSide),
        boardVectors,
        activeClueIndex,
        {
          excludedClues,
          limit: RESULTS_PER_SIZE,
          language,
          similarityCalibration,
        },
      );
      const ownRemaining = remainingCardsForSide(game.cards, game.activeSide);
      const opponentRemaining = remainingCardsForSide(
        game.cards,
        otherSide(game.activeSide),
      );
      const missedTargetLayoutIds = unresolvedIntendedTargetIds(
        game,
        game.activeSide,
      );
      const freshTargetCount =
        ownRemaining - missedTargetLayoutIds.length;
      const scoredSuggestions = analysis.suggestions
        .map((candidate) => ({
          candidate,
          score:
            scorePlayClue(candidate, {
              ownRemaining,
              opponentRemaining,
              policy,
            }) +
            scoreMissedTargetPreference(candidate, {
              freshTargetCount,
              missedTargetLayoutIds,
              missedTargetTiming,
            }),
        }))
        .sort((left, right) => right.score - left.score);
      const bestSingle = scoredSuggestions.find(
        ({ candidate }) => candidate.number === 1,
      );
      const bestMulti = scoredSuggestions.find(
        ({ candidate }) => candidate.number >= 2,
      );
      let suggestion;
      if (clueSelection === "tempo") {
        const best = scoredSuggestions[0];
        suggestion =
          bestMulti && bestMulti.score >= best.score - multiTolerance
            ? bestMulti.candidate
            : best?.candidate;
      } else {
        suggestion = chooseBotClue({
          analysis,
          ownRemaining,
          opponentRemaining,
          policy,
          freshTargetCount,
          missedTargetLayoutIds,
          missedTargetTiming,
          teamClues,
          clueRepeatPolicy,
          random: clueSelection === "top" ? () => 0 : random,
        });
      }
      if (!suggestion) {
        suggestion = chooseFallbackClue(
          boardForSide(game.cards, game.activeSide),
          boardVectors,
          activeClueIndex,
          language,
          excludedClues,
        );
        fallbackClues += 1;
      }
      const intendedLayoutIds = suggestion.targets.map(
        ({ layoutId }) => layoutId,
      );
      clueDecisions.push({
        turn: game.turnNumber,
        side: game.activeSide,
        ownRemaining,
        opponentRemaining,
        clue: suggestion.clue,
        number: suggestion.number,
        worth: suggestion.worth ?? null,
        expectedNet: rounded(suggestion.expectedNet ?? 0),
        success: rounded(suggestion.success ?? 0),
        margin: rounded(suggestion.margin ?? 0),
        risk: suggestion.risk ?? "fallback",
        suggestionCount: scoredSuggestions.length,
        multiSuggestionCount: scoredSuggestions.filter(
          ({ candidate }) => candidate.number >= 2,
        ).length,
        bestMultiAdvantage:
          bestSingle && bestMulti
            ? rounded(bestMulti.score - bestSingle.score)
            : null,
        freshTargetCount,
        missedTargetCount: missedTargetLayoutIds.length,
        retriedMissedTargetCount: intendedLayoutIds.filter((layoutId) =>
          missedTargetLayoutIds.includes(layoutId),
        ).length,
        words: game.cards
          .filter((card) => !card.done)
          .map(({ layoutId, word, team }) => ({ layoutId, word, team })),
        intendedLayoutIds,
      });
      game = giveClue(game, {
        clue: suggestion.clue,
        number: suggestion.number,
        actor: actorForSeat(game, game.activeSide, PLAYER_ROLE.SPYMASTER),
        intendedLayoutIds: suggestion.targets.map((target) => target.layoutId),
      });
      continue;
    }

    const clueVector = await centeredClueVector(
      game.currentTurn.clue,
      operativeContext,
    );
    const candidates = game.cards
      .map((card, index) => ({
        layoutId: card.layoutId,
        done: card.done,
        similarity:
          options.operativeModel === "same"
            ? calibrateSimilarity(
                dotVectors(
                  clueVector,
                  operativeContext.boardVectors[index],
                ),
                similarityCalibration,
              )
            : dotVectors(
                clueVector,
                operativeContext.boardVectors[index],
              ),
      }))
      .filter((candidate) => !candidate.done)
      .map(({ layoutId, similarity }) => ({ layoutId, similarity }));
    const reachedDeclaredNumber =
      game.currentTurn.guesses.length >= game.currentTurn.number;
    const guessesMade = game.currentTurn.guesses.length;
    const ownRemaining = remainingCardsForSide(game.cards, game.activeSide);
    const opponentRemaining = remainingCardsForSide(
      game.cards,
      otherSide(game.activeSide),
    );
    let layoutId =
      bonusGuessPolicy === "pass" && reachedDeclaredNumber
        ? null
        : chooseBotGuess({
            aggression: operativeAggression,
            candidates,
            guessesMade,
            clueNumber: game.currentTurn.number,
            ownRemaining,
            opponentRemaining,
            random,
          });
    const forcedProgress = layoutId === null && consecutivePasses >= 2;
    if (forcedProgress) {
      layoutId = candidates.reduce((best, candidate) =>
        !best || candidate.similarity > best.similarity ? candidate : best,
      ).layoutId;
      forcedProgressGuesses += 1;
    }
    const actor = actorForSeat(game, game.activeSide, PLAYER_ROLE.OPERATIVE);
    const selectedCandidate = candidates.find(
      (candidate) => candidate.layoutId === layoutId,
    );
    const selectedCard = game.cards.find((card) => card.layoutId === layoutId);
    guessDecisions.push({
      accepted: layoutId !== null,
      forcedProgress,
      similarity: selectedCandidate?.similarity ?? null,
      bestSimilarity: Math.max(...candidates.map(({ similarity }) => similarity)),
      guessesMade,
      clueNumber: game.currentTurn.number,
      fillsDeclaredNumber: guessesMade + 1 === game.currentTurn.number,
      ownRemaining,
      opponentRemaining,
      outcome: selectedCard?.team ?? "pass",
    });
    if (layoutId !== null && game.currentTurn.guesses.length >= game.currentTurn.number) {
      bonusGuesses += 1;
      correctBonusGuesses += Number(
        selectedCard?.team === teamForSide(game.activeSide),
      );
    }
    consecutivePasses = layoutId === null ? consecutivePasses + 1 : 0;
    game =
      layoutId === null
        ? passTurn(game, { actor })
        : guessCard(game, { layoutId, actor });
  }

  return summarizeGame(game, boardIndex, actions, {
    bonusGuesses,
    clueDecisions,
    correctBonusGuesses,
    fallbackClues,
    forcedProgressGuesses,
    guessDecisions,
    stalled: game.phase !== GAME_PHASE.COMPLETE,
  });
}

async function centeredClueVector(clue, context) {
  const { cache, centeringMean, embeddingOptions } = context;
  const normalized = clue.toLowerCase();
  if (!cache.has(normalized)) {
    const vectors = await embedTerms([normalized], embeddingOptions);
    cache.set(
      normalized,
      centerEmbeddings(vectors, centeringMean)[0],
    );
  }
  return cache.get(normalized);
}

function chooseFallbackClue(
  board,
  boardVectors,
  activeClueIndex,
  language,
  excludedClues,
) {
  const unrevealed = board
    .map((card, index) => ({ ...card, vector: boardVectors[index] }))
    .filter((card) => !card.done);
  const friendlies = unrevealed.filter((card) => card.team === "friendly");
  const boardWords = unrevealed.map((card) => normalizeTerm(card.word));
  const excluded = new Set(excludedClues.map((clue) => normalizeTerm(clue)));
  let best = null;

  for (
    let candidateIndex = 0;
    candidateIndex < activeClueIndex.clues.length;
    candidateIndex += 1
  ) {
    const clue = activeClueIndex.clues[candidateIndex];
    if (
      excluded.has(normalizeTerm(clue)) ||
      isForbiddenClue(normalizeTerm(clue), boardWords, { language })
    ) {
      continue;
    }
    const vectorOffset = candidateIndex * activeClueIndex.dimensions;
    for (const target of friendlies) {
      let similarity = 0;
      for (
        let dimension = 0;
        dimension < activeClueIndex.dimensions;
        dimension += 1
      ) {
        similarity +=
          activeClueIndex.vectors[vectorOffset + dimension] *
          target.vector[dimension];
      }
      similarity /= activeClueIndex.quantization.scale;
      if (!best || similarity > best.similarity) {
        best = { clue, similarity, target };
      }
    }
  }
  if (!best) {
    throw new Error("The benchmark could not find a legal fallback clue.");
  }
  return {
    clue: best.clue,
    number: 1,
    targets: [
      {
        layoutId: best.target.layoutId,
        word: best.target.word,
        sim: best.similarity,
      },
    ],
  };
}

function summarizeGame(
  game,
  boardIndex,
  actions,
  {
    bonusGuesses,
    clueDecisions,
    correctBonusGuesses,
    fallbackClues,
    forcedProgressGuesses,
    guessDecisions,
    stalled,
  },
) {
  const clues = game.history.filter((event) => event.type === "clue-given");
  const guesses = game.history.filter((event) => event.type === "card-guessed");
  const passes = game.history.filter((event) => event.type === "turn-passed");
  const correctGuesses = guesses.filter(
    (event) => event.team === teamForSide(event.side),
  ).length;
  const wrongTeamHits = guesses.filter(
    (event) => event.team === teamForSide(otherSide(event.side)),
  ).length;
  const neutralHits = guesses.filter((event) => event.team === "neutral").length;
  const assassinHits = guesses.filter((event) => event.team === "assassin").length;
  const losingSide =
    game.winner === SIDE.BLUE
      ? SIDE.RED
      : game.winner === SIDE.RED
        ? SIDE.BLUE
        : null;
  const losingAgentsRemaining = losingSide
    ? remainingCardsForSide(game.cards, losingSide)
    : null;

  return {
    board: boardIndex + 1,
    seed: game.seed,
    winner: game.winner,
    endReason: game.endReason,
    stalled,
    actions,
    turns: clues.length,
    fallbackClues,
    forcedProgressGuesses,
    bonusGuesses,
    correctBonusGuesses,
    clueDecisions,
    guessDecisions,
    clues: clueDistribution(clues),
    firstHalfClueNumbers: clues
      .slice(0, Math.ceil(clues.length / 2))
      .map(({ number }) => number),
    guesses: guesses.length,
    correctGuesses,
    wrongTeamHits,
    neutralHits,
    assassinHits,
    losingAgentsRemaining,
    passes: passes.length,
  };
}

function summarizePolicy(gameResults) {
  const totals = gameResults.reduce(
    (summary, game) => {
      summary.turns += game.turns;
      summary.guesses += game.guesses;
      summary.correctGuesses += game.correctGuesses;
      summary.wrongTeamHits += game.wrongTeamHits;
      summary.neutralHits += game.neutralHits;
      summary.assassinHits += game.assassinHits;
      summary.completedGames += Number(!game.stalled);
      summary.stalledGames += Number(game.stalled);
      summary.closeFinishes += Number(
        !game.stalled && game.losingAgentsRemaining <= 2,
      );
      summary.losingAgentsRemaining += Number.isFinite(
        game.losingAgentsRemaining,
      )
        ? game.losingAgentsRemaining
        : 0;
      summary.passes += game.passes;
      summary.fallbackClues += game.fallbackClues;
      summary.forcedProgressGuesses += game.forcedProgressGuesses;
      summary.bonusGuesses += game.bonusGuesses;
      summary.correctBonusGuesses += game.correctBonusGuesses;
      summary.clueDecisions.push(...game.clueDecisions);
      summary.guessDecisions.push(...game.guessDecisions);
      summary.firstHalfClueNumbers.push(...game.firstHalfClueNumbers);
      summary.blueWins += Number(game.winner === SIDE.BLUE);
      summary.redWins += Number(game.winner === SIDE.RED);
      for (const [number, count] of Object.entries(game.clues)) {
        summary.clues[number] = (summary.clues[number] ?? 0) + count;
      }
      return summary;
    },
    {
      turns: 0,
      guesses: 0,
      correctGuesses: 0,
      wrongTeamHits: 0,
      neutralHits: 0,
      assassinHits: 0,
      completedGames: 0,
      stalledGames: 0,
      closeFinishes: 0,
      losingAgentsRemaining: 0,
      passes: 0,
      fallbackClues: 0,
      forcedProgressGuesses: 0,
      bonusGuesses: 0,
      correctBonusGuesses: 0,
      clueDecisions: [],
      guessDecisions: [],
      firstHalfClueNumbers: [],
      blueWins: 0,
      redWins: 0,
      clues: {},
    },
  );
  const clueNumberTotal = Object.entries(totals.clues).reduce(
    (sum, [number, count]) => sum + Number(number) * count,
    0,
  );
  const multiClues = Object.entries(totals.clues).reduce(
    (sum, [number, count]) => sum + (Number(number) > 1 ? count : 0),
    0,
  );
  const gameCount = gameResults.length;

  const policy = {
    gameCount,
    completedGames: totals.completedGames,
    stalledGames: totals.stalledGames,
    stallRate: ratio(totals.stalledGames, gameCount),
    clueCount: totals.turns,
    clueNumberDistribution: totals.clues,
    multiClueRate: ratio(multiClues, totals.turns),
    meanClueNumber: ratio(clueNumberTotal, totals.turns),
    firstHalfMeanClueNumber: mean(totals.firstHalfClueNumbers),
    correctCardsPerTurn: ratio(totals.correctGuesses, totals.turns),
    wrongTeamHits: totals.wrongTeamHits,
    wrongTeamHitsPerGame: ratio(totals.wrongTeamHits, gameCount),
    wrongTeamGuessRate: ratio(totals.wrongTeamHits, totals.guesses),
    neutralHits: totals.neutralHits,
    neutralHitsPerGame: ratio(totals.neutralHits, gameCount),
    assassinHits: totals.assassinHits,
    assassinRate: ratio(totals.assassinHits, gameCount),
    closeFinishRate: ratio(totals.closeFinishes, totals.completedGames),
    meanLosingAgentsRemaining: ratio(
      totals.losingAgentsRemaining,
      totals.completedGames,
    ),
    meanTurnsPerGame: ratio(totals.turns, gameCount),
    meanGuessesPerTurn: ratio(totals.guesses, totals.turns),
    passesPerGame: ratio(totals.passes, gameCount),
    fallbackClues: totals.fallbackClues,
    fallbackClueRate: ratio(totals.fallbackClues, totals.turns),
    forcedProgressGuesses: totals.forcedProgressGuesses,
    forcedProgressGuessesPerGame: ratio(
      totals.forcedProgressGuesses,
      gameCount,
    ),
    bonusGuesses: totals.bonusGuesses,
    bonusGuessesPerGame: ratio(totals.bonusGuesses, gameCount),
    correctBonusGuessRate: ratio(
      totals.correctBonusGuesses,
      totals.bonusGuesses,
    ),
    operativeGuessQuality: summarizeGuessDecisions(totals.guessDecisions),
    missedTargetRecovery: summarizeMissedTargetDecisions(
      totals.clueDecisions,
    ),
    clueNumberByOwnRemaining: summarizeClueDecisions(totals.clueDecisions),
    wins: {
      blue: totals.blueWins,
      red: totals.redWins,
    },
    gameResults: gameResults.map(
      ({ clueDecisions, guessDecisions, ...result }) => ({
        ...result,
        calibrationTurns: clueDecisions.slice(0, 1).map((decision) => ({
          turn: decision.turn,
          side: decision.side,
          clue: decision.clue,
          number: decision.number,
          words: decision.words,
          intendedLayoutIds: decision.intendedLayoutIds,
        })),
      }),
    ),
  };
  return {
    ...policy,
    fun: scorePlayFun(policy),
  };
}

function summarizeMissedTargetDecisions(decisions) {
  const opportunities = decisions.filter(
    ({ missedTargetCount }) => missedTargetCount > 0,
  );
  const retries = opportunities.filter(
    ({ retriedMissedTargetCount }) => retriedMissedTargetCount > 0,
  );
  const earlyOpportunities = opportunities.filter(
    ({ freshTargetCount }) => freshTargetCount >= 4,
  );
  const earlyRetries = earlyOpportunities.filter(
    ({ retriedMissedTargetCount }) => retriedMissedTargetCount > 0,
  );
  return {
    opportunities: opportunities.length,
    retries: retries.length,
    retryRate: ratio(retries.length, opportunities.length),
    earlyOpportunities: earlyOpportunities.length,
    earlyRetries: earlyRetries.length,
    earlyRetryRate: ratio(
      earlyRetries.length,
      earlyOpportunities.length,
    ),
  };
}

function summarizeGuessDecisions(decisions) {
  const accepted = decisions.filter(({ accepted }) => accepted);
  const declaredFill = accepted.filter(({ fillsDeclaredNumber }) => fillsDeclaredNumber);
  const preDeclared = decisions.filter(
    ({ clueNumber, guessesMade }) => guessesMade < clueNumber,
  );
  const preDeclaredPasses = preDeclared.filter(({ accepted }) => !accepted);
  const weakSimilarityThreshold = 0.25;
  const weak = accepted.filter(
    ({ similarity }) => similarity < weakSimilarityThreshold,
  );
  const weakDeclaredFill = declaredFill.filter(
    ({ similarity }) => similarity < weakSimilarityThreshold,
  );
  return {
    acceptedGuesses: accepted.length,
    meanAcceptedSimilarity: mean(accepted.map(({ similarity }) => similarity)),
    tenthPercentileAcceptedSimilarity: percentile(
      accepted.map(({ similarity }) => similarity),
      0.1,
    ),
    minimumAcceptedSimilarity:
      accepted.length > 0
        ? Math.min(...accepted.map(({ similarity }) => similarity))
        : null,
    weakSimilarityThreshold,
    weakGuesses: weak.length,
    weakGuessRate: ratio(weak.length, accepted.length),
    declaredFillGuesses: declaredFill.length,
    weakDeclaredFillGuesses: weakDeclaredFill.length,
    weakDeclaredFillRate: ratio(weakDeclaredFill.length, declaredFill.length),
    preDeclaredDecisions: preDeclared.length,
    preDeclaredPasses: preDeclaredPasses.length,
    preDeclaredPassRate: ratio(
      preDeclaredPasses.length,
      preDeclared.length,
    ),
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function clueDistribution(clues) {
  return clues.reduce((distribution, clue) => {
    distribution[clue.number] = (distribution[clue.number] ?? 0) + 1;
    return distribution;
  }, {});
}

function metricDeltas(current, hybrid) {
  return Object.fromEntries(
    [
      "multiClueRate",
      "meanClueNumber",
      "firstHalfMeanClueNumber",
      "correctCardsPerTurn",
      "wrongTeamHitsPerGame",
      "wrongTeamGuessRate",
      "neutralHitsPerGame",
      "assassinRate",
      "closeFinishRate",
      "meanLosingAgentsRemaining",
      "meanTurnsPerGame",
      "meanGuessesPerTurn",
      "passesPerGame",
      "fallbackClueRate",
      "stallRate",
      "bonusGuessesPerGame",
      "correctBonusGuessRate",
    ].map((metric) => [metric, rounded(hybrid[metric] - current[metric])]),
  );
}

function compactOperativeSummary(policy) {
  return {
    gameCount: policy.gameCount,
    correctCardsPerTurn: policy.correctCardsPerTurn,
    wrongTeamHitsPerGame: policy.wrongTeamHitsPerGame,
    neutralHitsPerGame: policy.neutralHitsPerGame,
    assassinRate: policy.assassinRate,
    stallRate: policy.stallRate,
    meanTurnsPerGame: policy.meanTurnsPerGame,
    passesPerGame: policy.passesPerGame,
    forcedProgressGuessesPerGame: policy.forcedProgressGuessesPerGame,
    operativeGuessQuality: policy.operativeGuessQuality,
    fun: policy.fun,
    wins: policy.wins,
  };
}

function operativeMetricDeltas(dynamic, candidate) {
  return Object.fromEntries(
    [
      "correctCardsPerTurn",
      "wrongTeamHitsPerGame",
      "neutralHitsPerGame",
      "assassinRate",
      "stallRate",
      "meanTurnsPerGame",
      "passesPerGame",
      "forcedProgressGuessesPerGame",
    ].map((metric) => [metric, rounded(candidate[metric] - dynamic[metric])]),
  );
}

function compactReport(report) {
  return {
    ...report,
    policies: Object.fromEntries(
      Object.entries(report.policies).map(([name, policy]) => {
        const { gameResults, ...summary } = policy;
        return [name, summary];
      }),
    ),
  };
}

function boardSeed(boardIndex) {
  const bytes = Buffer.alloc(8);
  bytes.write("CODE", 0, "ascii");
  bytes.writeUInt32BE(boardIndex + 1, 4);
  return bytes.toString("base64url");
}

function parseOptions(args) {
  const splitIndex = args.indexOf("--split");
  const requestedSplit = splitIndex >= 0 ? args[splitIndex + 1] : "custom";
  if (
    requestedSplit !== "custom" &&
    !Object.hasOwn(BENCHMARK_SPLITS, requestedSplit)
  ) {
    throw new Error(
      `--split must be ${Object.keys(BENCHMARK_SPLITS).join(", ")}, or custom.`,
    );
  }
  const splitDefaults = BENCHMARK_SPLITS[requestedSplit] ?? {
    boardOffset: 0,
    boards: DEFAULT_BOARD_COUNT,
  };
  const values = {
    boards: splitDefaults.boards,
    boardOffset: splitDefaults.boardOffset,
    split: requestedSplit,
    maxActions: DEFAULT_MAX_ACTIONS_PER_GAME,
    candidates: DEFAULT_PLAY_BOT_SETTINGS.candidateCount,
    language: LANGUAGE.ENGLISH,
    modelId: DEFAULT_PLAY_BOT_SETTINGS.modelId,
    wordSet: WORD_SET.OFFICIAL,
    clueSelection: "tempo",
    multiTolerance: DEFAULT_PLAY_BOT_SETTINGS.multiTolerance,
    missedTargetTiming: DEFAULT_PLAY_BOT_SETTINGS.missedTargetTiming,
    clueRepeatPolicy: DEFAULT_PLAY_BOT_SETTINGS.clueRepeatPolicy,
    bonusGuesses: PLAY_BONUS_POLICY.PASS,
    operativeAggression: DEFAULT_PLAY_BOT_SETTINGS.operativeAggression,
    reportDetail: "full",
    output: DEFAULT_OUTPUT,
    summaryOutput: null,
    indexDir: null,
    operativeModel: "same",
    similarityScale: 1,
    similarityOffset: 0,
    comparisonOnly: false,
    testProtocol: null,
  };
  const explicit = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--boards") {
      values.boards = positiveInteger(value, option);
    } else if (option === "--board-offset") {
      values.boardOffset = nonNegativeInteger(value, option);
    } else if (option === "--split") {
      values.split = requestedSplit;
    } else if (option === "--max-actions") {
      values.maxActions = positiveInteger(value, option);
    } else if (option === "--candidates") {
      values.candidates = positiveInteger(value, option);
      explicit.add("candidates");
    } else if (option === "--language") {
      if (!Object.values(LANGUAGE).includes(value)) {
        throw new Error(`${option} must be en or it.`);
      }
      values.language = value;
    } else if (option === "--model") {
      if (!value) throw new Error(`${option} requires a model ID.`);
      values.modelId = value;
      explicit.add("model");
    } else if (option === "--index-dir") {
      if (!value) throw new Error(`${option} requires a directory.`);
      values.indexDir = value;
    } else if (option === "--operative-model") {
      if (!value) throw new Error(`${option} requires a model ID or same.`);
      values.operativeModel = value;
    } else if (option === "--word-set") {
      if (!Object.values(WORD_SET).includes(value)) {
        throw new Error(`${option} must be official or extended.`);
      }
      values.wordSet = value;
      explicit.add("wordSet");
    } else if (option === "--clue-selection") {
      if (!["random", "top", "tempo"].includes(value)) {
        throw new Error(`${option} must be random, top, or tempo.`);
      }
      values.clueSelection = value;
    } else if (option === "--multi-tolerance") {
      values.multiTolerance = nonNegativeNumber(value, option);
    } else if (option === "--missed-target-timing") {
      if (!MISSED_TARGET_TIMINGS.includes(value)) {
        throw new Error(
          `${option} must be late, balanced, or immediate.`,
        );
      }
      values.missedTargetTiming = value;
    } else if (option === "--clue-repeat-policy") {
      if (!CLUE_REPEAT_POLICIES.includes(value)) {
        throw new Error(
          `${option} must be allow, previous, or never.`,
        );
      }
      values.clueRepeatPolicy = value;
    } else if (option === "--similarity-scale") {
      values.similarityScale = positiveNumber(value, option);
    } else if (option === "--similarity-offset") {
      values.similarityOffset = finiteNumber(value, option);
    } else if (option === "--comparison-only") {
      values.comparisonOnly = true;
      index -= 1;
    } else if (option === "--test-protocol") {
      values.testProtocol = requiredValue(value, option);
    } else if (option === "--bonus-guesses") {
      if (!["allow", "pass"].includes(value)) {
        throw new Error(`${option} must be allow or pass.`);
      }
      values.bonusGuesses = value;
    } else if (option === "--operative-aggression") {
      if (!OPERATIVE_AGGRESSIONS.includes(value)) {
        throw new Error(
          `${option} must be conservative, aggressive, or dynamic.`,
        );
      }
      values.operativeAggression = value;
    } else if (option === "--report-detail") {
      if (!["compact", "full"].includes(value)) {
        throw new Error(`${option} must be compact or full.`);
      }
      values.reportDetail = value;
    } else if (option === "--output") {
      if (!value) throw new Error(`${option} requires a path.`);
      values.output = value;
    } else if (option === "--summary-output") {
      if (!value) throw new Error(`${option} requires a path.`);
      values.summaryOutput = value;
    } else {
      throw new Error(`Unknown benchmark option: ${option}`);
    }
    index += 1;
  }
  if (values.language === LANGUAGE.ITALIAN) {
    if (!explicit.has("model")) {
      values.modelId = ITALIAN_MODEL_ID;
    }
    if (!explicit.has("wordSet")) {
      values.wordSet = WORD_SET.EXTENDED;
    }
    if (values.wordSet !== WORD_SET.EXTENDED) {
      throw new Error("Italian Play requires the Extended word set.");
    }
  }
  return values;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} requires a non-negative integer.`);
  }
  return parsed;
}

function nonNegativeNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${option} requires a non-negative number.`);
  }
  return parsed;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive number.`);
  }
  return parsed;
}

function finiteNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${option} requires a finite number.`);
  }
  return parsed;
}

function requiredValue(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

async function validateHeldOutTestRun(values, output) {
  if (values.split !== "test") return;
  if (!values.testProtocol) {
    throw new Error(
      "--split test requires --test-protocol so held-out eligibility is explicit.",
    );
  }
  const protocol = JSON.parse(
    await readFile(resolve(ROOT, values.testProtocol), "utf8"),
  );
  if (
    protocol.heldOutTest?.status !== "authorized" ||
    !protocol.heldOutTest.eligibleModelIds?.includes(values.modelId)
  ) {
    throw new Error(
      `${values.modelId} is not authorized by the held-out test protocol.`,
    );
  }
  try {
    await access(output);
  } catch {
    return;
  }
  throw new Error(
    `Held-out result already exists at ${output}. Refusing a repeat run.`,
  );
}

function summaryPathFor(reportPath) {
  if (reportPath === DEFAULT_OUTPUT) {
    return DEFAULT_SUMMARY_OUTPUT;
  }
  return reportPath.endsWith(".json")
    ? `${reportPath.slice(0, -".json".length)}.md`
    : `${reportPath}.md`;
}

function summarizeClueDecisions(decisions) {
  const grouped = new Map();
  for (const decision of decisions) {
    if (!grouped.has(decision.ownRemaining)) {
      grouped.set(decision.ownRemaining, []);
    }
    grouped.get(decision.ownRemaining).push(decision);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([ownRemaining, group]) => {
        const multiAdvantages = group
          .map(({ bestMultiAdvantage }) => bestMultiAdvantage)
          .filter(Number.isFinite);
        return [
          ownRemaining,
          {
            clues: group.length,
            meanNumber: ratio(
              group.reduce((total, { number }) => total + number, 0),
              group.length,
            ),
            multiClueRate: ratio(
              group.filter(({ number }) => number >= 2).length,
              group.length,
            ),
            multiAvailableRate: ratio(
              group.filter(({ multiSuggestionCount }) => multiSuggestionCount > 0)
                .length,
              group.length,
            ),
            meanBestMultiAdvantage: ratio(
              multiAdvantages.reduce((total, value) => total + value, 0),
              multiAdvantages.length,
            ),
          },
        ];
      }),
  );
}

function measureSimilarityGeometry(activeClueIndex, boardVectors) {
  const clueRows = sampledIndices(activeClueIndex.clues.length, 128);
  const boardRows = sampledIndices(boardVectors.length, 128);
  const values = new Float64Array(clueRows.length * boardRows.length);
  let valueIndex = 0;
  for (const clueRow of clueRows) {
    const vectorOffset = clueRow * activeClueIndex.dimensions;
    for (const boardRow of boardRows) {
      const boardVector = boardVectors[boardRow];
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
      values[valueIndex] = total / activeClueIndex.quantization.scale;
      valueIndex += 1;
    }
  }
  values.sort();
  const average =
    values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce(
      (total, value) => total + (value - average) ** 2,
      0,
    ) / values.length;
  return {
    clueSamples: clueRows.length,
    boardWordSamples: boardRows.length,
    pairSamples: values.length,
    mean: rounded(average),
    standardDeviation: rounded(Math.sqrt(variance)),
    minimum: rounded(values[0]),
    p05: rounded(quantile(values, 0.05)),
    median: rounded(quantile(values, 0.5)),
    p95: rounded(quantile(values, 0.95)),
    maximum: rounded(values.at(-1)),
  };
}

function sampledIndices(length, maximum) {
  const count = Math.min(length, maximum);
  if (count === length) return Array.from({ length }, (_, index) => index);
  return Array.from({ length: count }, (_, index) =>
    Math.round((index * (length - 1)) / (count - 1)),
  );
}

function quantile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return (
    sorted[lower] * (upper - position) +
    sorted[upper] * (position - lower)
  );
}

function transformSimilarityGeometry(geometry, calibration) {
  const transform = (value) =>
    rounded(calibrateSimilarity(value, calibration));
  return {
    ...geometry,
    mean: transform(geometry.mean),
    standardDeviation: rounded(
      geometry.standardDeviation * calibration.scale,
    ),
    minimum: transform(geometry.minimum),
    p05: transform(geometry.p05),
    median: transform(geometry.median),
    p95: transform(geometry.p95),
    maximum: transform(geometry.maximum),
  };
}

function dotVectors(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

async function embedLocalBoardWords(words, activeManifest, activeClueIndex) {
  console.log(
    `Embedding ${words.length} ${options.wordSet} board words with ${activeManifest.model}...`,
  );
  const vectors = await embedTerms(
    words,
    embeddingOptionsForManifest(activeManifest),
  );
  return centerEmbeddings(vectors, activeClueIndex.centering.mean);
}

async function loadOperativeContext({
  boardWords: words,
  clueIndex: activeClueIndex,
  centeredBoardWords: spymasterBoardVectors,
  centeredClueVectors: spymasterClueVectors,
  manifest: activeManifest,
  modelId,
}) {
  if (modelId === "same") {
    return {
      vectorByWord: new Map(
        words.map((word, index) => [word, spymasterBoardVectors[index]]),
      ),
      cache: spymasterClueVectors,
      centeringMean: activeClueIndex.centering.mean,
      embeddingOptions: embeddingOptionsForManifest(activeManifest),
      model: activeManifest.model,
    };
  }
  const operativeManifest = JSON.parse(
    await readFile(
      resolve(ROOT, `public/data/model-lab/${modelId}/manifest.json`),
      "utf8",
    ),
  );
  const operativeEmbeddingOptions =
    embeddingOptionsForManifest(operativeManifest);
  if (activeManifest.language === LANGUAGE.ITALIAN) {
    const raw = await embedTerms(words, operativeEmbeddingOptions);
    const centered = centerEmbeddings(raw, operativeManifest.centering.mean);
    return {
      vectorByWord: new Map(
        words.map((word, index) => [word, centered[index]]),
      ),
      cache: new Map(),
      centeringMean: operativeManifest.centering.mean,
      embeddingOptions: operativeEmbeddingOptions,
      model: operativeManifest.model,
    };
  }

  const operativeDirectory = resolve(
    ROOT,
    `public/data/model-lab/${modelId}`,
  );
  const operativeShards = await Promise.all(
    operativeManifest.shards
      .filter((shard) => shard.start < activeClueIndex.clues.length)
      .map(async ({ file }) =>
        JSON.parse(
          await readFile(resolve(operativeDirectory, file), "utf8"),
        ),
      ),
  );
  const operativeClueIndex = hydrateClueShards(
    operativeManifest,
    operativeShards,
    activeClueIndex.clues.length,
  );
  if (
    operativeClueIndex.clues.some(
      (clue, index) => clue !== activeClueIndex.clues[index],
    )
  ) {
    throw new Error(
      "The operative and spymaster clue vocabularies do not match.",
    );
  }
  const raw = await embedTerms(words, { model: operativeManifest.model });
  const centered = centerEmbeddings(
    raw,
    operativeClueIndex.centering.mean,
  );
  return {
    vectorByWord: new Map(
      words.map((word, index) => [word, centered[index]]),
    ),
    cache: buildPrecomputedClueVectorCache(operativeClueIndex),
    centeringMean: operativeClueIndex.centering.mean,
    embeddingOptions: operativeEmbeddingOptions,
    model: operativeManifest.model,
  };
}

function embeddingOptionsForManifest(activeManifest) {
  return {
    model: activeManifest.model,
    revision: activeManifest.modelRevision,
    inputPrefix: activeManifest.taskPrefix,
  };
}

async function loadPrecomputedBoardVectors(directory, activeManifest, words) {
  const definition = activeManifest.boardVectors;
  if (!definition?.file) {
    throw new Error("Precomputed embedding index is missing boardVectors.file.");
  }
  const payload = JSON.parse(
    await readFile(resolve(directory, definition.file), "utf8"),
  );
  if (
    payload.dimensions !== activeManifest.dimensions ||
    payload.quantization?.scale !== activeManifest.quantization.scale
  ) {
    throw new Error("Precomputed board vectors do not match the clue index.");
  }
  const available = new Map();
  const bytes = Buffer.from(payload.vectors, "base64");
  const quantized = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  payload.words.forEach((word, row) => {
    const start = row * payload.dimensions;
    available.set(
      word,
      Float32Array.from(
        quantized.subarray(start, start + payload.dimensions),
        (value) => value / payload.quantization.scale,
      ),
    );
  });
  return words.map((word) => {
    const vector = available.get(word);
    if (!vector) {
      throw new Error(`Precomputed index has no board embedding for ${word}.`);
    }
    return vector;
  });
}

function buildPrecomputedClueVectorCache(activeClueIndex) {
  const cache = new Map();
  activeClueIndex.clues.forEach((clue, row) => {
    const start = row * activeClueIndex.dimensions;
    cache.set(
      clue.toLowerCase(),
      Float32Array.from(
        activeClueIndex.vectors.subarray(
          start,
          start + activeClueIndex.dimensions,
        ),
        (value) => value / activeClueIndex.quantization.scale,
      ),
    );
  });
  return cache;
}

function ratio(numerator, denominator) {
  return denominator ? rounded(numerator / denominator) : 0;
}

function mean(values) {
  return ratio(
    values.reduce((total, value) => total + value, 0),
    values.length,
  );
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function printSummary(policyResults, policyNames = POLICIES) {
  console.table(
    policyNames.map((policy) => ({
      policy,
      games: policyResults[policy].gameCount,
      "multi clues": policyResults[policy].multiClueRate,
      "first-half mean": policyResults[policy].firstHalfMeanClueNumber,
      "correct/turn": policyResults[policy].correctCardsPerTurn,
      "wrong/game": policyResults[policy].wrongTeamHitsPerGame,
      "assassin rate": policyResults[policy].assassinRate,
      "turns/game": policyResults[policy].meanTurnsPerGame,
      "close finishes": policyResults[policy].closeFinishRate,
      "fun index": policyResults[policy].fun.score,
    })),
  );
}
