import { cpus, platform, release } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
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
import { analyzeEmbeddedBoard, isForbiddenClue, normalizeTerm } from "../src/model.js";
import {
  PLAY_CLUE_POLICY,
  chooseBotClue,
  chooseBotGuess,
  createSeededRandom,
  scorePlayClue,
} from "../src/play/bots.js";
import {
  DEFAULT_PLAY_BOT_SETTINGS,
  PLAY_BONUS_POLICY,
} from "../src/play/settings.js";
import {
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  createPlayGame,
  giveClue,
  guessCard,
  passTurn,
} from "../src/play/game-state.js";
import { WORD_SET, getWordsForSet } from "../src/word-data.js";
import { writePlayPolicySummary } from "./play-policy-summary.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_BOARD_COUNT = 100;
const DEFAULT_OUTPUT = "scripts/generated/play-policy-benchmark.json";
const DEFAULT_SUMMARY_OUTPUT = "scripts/generated/play-policy-benchmark.md";
const RESULTS_PER_SIZE = 6;
const MAX_ACTIONS_PER_GAME = 500;
const POLICIES = [PLAY_CLUE_POLICY.CURRENT, PLAY_CLUE_POLICY.HYBRID];

const options = parseOptions(process.argv.slice(2));
const outputPath = isAbsolute(options.output) ? options.output : resolve(ROOT, options.output);
const summaryOutput = options.summaryOutput ?? summaryPathFor(options.output);
const summaryOutputPath = isAbsolute(summaryOutput)
  ? summaryOutput
  : resolve(ROOT, summaryOutput);
const manifestDirectory = resolve(ROOT, `public/data/model-lab/${options.modelId}`);
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

const boardWords = getWordsForSet(options.wordSet);
console.log(`Embedding ${boardWords.length} ${options.wordSet} board words with ${manifest.model}...`);
const embeddedBoardWords = await embedTerms(boardWords, { model: manifest.model });
const centeredBoardWords = centerEmbeddings(
  embeddedBoardWords,
  clueIndex.centering.mean,
);
const vectorByWord = new Map(
  boardWords.map((word, index) => [word, centeredBoardWords[index]]),
);
const centeredClueVectors = new Map();
const resultsByPolicy = new Map(POLICIES.map((policy) => [policy, []]));
const startedAt = performance.now();

for (let boardIndex = 0; boardIndex < options.boards; boardIndex += 1) {
  const seed = boardSeed(boardIndex);
  const boardState = createGeneratedBoardState(
    seed,
    BOARD_ORDER.RANDOM,
    options.wordSet,
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

  for (const policy of POLICIES) {
    const result = await simulateGame({
      boardIndex,
      boardVectors,
      cards,
      clueIndex,
      centeredClueVectors,
      policy,
      seed,
      clueSelection: options.clueSelection,
      multiTolerance: options.multiTolerance,
      bonusGuesses: options.bonusGuesses,
      wordSet: options.wordSet,
    });
    resultsByPolicy.get(policy).push(result);
  }

  if ((boardIndex + 1) % 10 === 0 || boardIndex + 1 === options.boards) {
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    console.log(`Completed ${boardIndex + 1}/${options.boards} paired boards in ${seconds}s`);
  }
}

const policies = Object.fromEntries(
  POLICIES.map((policy) => [policy, summarizePolicy(resultsByPolicy.get(policy))]),
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
    gamesPerPolicy: options.boards,
    pairedBoards: true,
    wordSet: options.wordSet,
    modelId: options.modelId,
    model: manifest.model,
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
      "The production bot guesser sees only centered clue-to-unrevealed-word similarities.",
    rules:
      "Every simulation uses the production Play state machine and stops only at an agent or assassin win.",
    fallback:
      "If the production analyzer has no ranked suggestion, use the legal indexed clue closest to one remaining agent, number 1, and count the turn.",
    firstHalf:
      "For each completed game, take the first ceiling(total clue turns / 2) clue turns, then aggregate their clue numbers.",
    policies: {
      current:
        "Worth + current risk adjustment + state-dependent clue-number bonus + 18 x margin.",
      hybrid:
        "0.35 x Worth + 25 x expected net + 10 x success + 6 x margin + risk adjustment.",
    },
  },
  policies,
  hybridMinusCurrent: metricDeltas(policies.current, policies.hybrid),
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await writePlayPolicySummary(report, summaryOutputPath);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${summaryOutputPath}`);
printSummary(policies);

async function simulateGame({
  boardIndex,
  boardVectors,
  cards,
  clueIndex: activeClueIndex,
  centeredClueVectors: clueVectorCache,
  policy,
  seed,
  clueSelection,
  multiTolerance,
  bonusGuesses: bonusGuessPolicy,
  wordSet,
}) {
  let game = createPlayGame({
    botSettings: {
      modelId: options.modelId,
      candidateCount: options.candidates,
      cluePolicy: policy,
      multiTolerance,
      bonusGuesses: bonusGuessPolicy,
    },
    cards,
    humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
    seed,
    wordSet,
  });
  let actions = 0;
  let fallbackClues = 0;
  let bonusGuesses = 0;
  let correctBonusGuesses = 0;
  const clueDecisions = [];

  while (game.phase !== GAME_PHASE.COMPLETE && actions < MAX_ACTIONS_PER_GAME) {
    actions += 1;
    const random = createSeededRandom(
      `${game.seed}:${game.turnNumber}:${game.history.length}`,
    );

    if (game.phase === GAME_PHASE.AWAITING_CLUE) {
      const analysis = analyzeEmbeddedBoard(
        boardForSide(game.cards, game.activeSide),
        boardVectors,
        activeClueIndex,
        { limit: RESULTS_PER_SIZE },
      );
      const ownRemaining = remainingCardsForSide(game.cards, game.activeSide);
      const opponentRemaining = remainingCardsForSide(
        game.cards,
        otherSide(game.activeSide),
      );
      const scoredSuggestions = analysis.suggestions
        .map((candidate) => ({
          candidate,
          score: scorePlayClue(candidate, {
            ownRemaining,
            opponentRemaining,
            policy,
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
          random: clueSelection === "top" ? () => 0 : random,
        });
      }
      if (!suggestion) {
        suggestion = chooseFallbackClue(
          boardForSide(game.cards, game.activeSide),
          boardVectors,
          activeClueIndex,
        );
        fallbackClues += 1;
      }
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
      activeClueIndex,
      clueVectorCache,
    );
    const candidates = game.cards
      .map((card, index) => ({
        layoutId: card.layoutId,
        done: card.done,
        similarity: dotVectors(clueVector, boardVectors[index]),
      }))
      .filter((candidate) => !candidate.done)
      .map(({ layoutId, similarity }) => ({ layoutId, similarity }));
    const reachedDeclaredNumber =
      game.currentTurn.guesses.length >= game.currentTurn.number;
    const layoutId =
      bonusGuessPolicy === "pass" && reachedDeclaredNumber
        ? null
        : chooseBotGuess({
            candidates,
            guessesMade: game.currentTurn.guesses.length,
            clueNumber: game.currentTurn.number,
            random,
          });
    const actor = actorForSeat(game, game.activeSide, PLAYER_ROLE.OPERATIVE);
    if (layoutId !== null && game.currentTurn.guesses.length >= game.currentTurn.number) {
      bonusGuesses += 1;
      const guessedCard = game.cards.find((card) => card.layoutId === layoutId);
      correctBonusGuesses += Number(
        guessedCard?.team === teamForSide(game.activeSide),
      );
    }
    game =
      layoutId === null
        ? passTurn(game, { actor })
        : guessCard(game, { layoutId, actor });
  }

  if (game.phase !== GAME_PHASE.COMPLETE) {
    throw new Error(
      `${policy} game on board ${boardIndex + 1} exceeded ${MAX_ACTIONS_PER_GAME} actions.`,
    );
  }
  return summarizeGame(game, boardIndex, actions, {
    bonusGuesses,
    clueDecisions,
    correctBonusGuesses,
    fallbackClues,
  });
}

async function centeredClueVector(clue, activeClueIndex, cache) {
  const normalized = clue.toLowerCase();
  if (!cache.has(normalized)) {
    const vectors = await embedTerms([normalized], { model: manifest.model });
    cache.set(
      normalized,
      centerEmbeddings(vectors, activeClueIndex.centering.mean)[0],
    );
  }
  return cache.get(normalized);
}

function chooseFallbackClue(board, boardVectors, activeClueIndex) {
  const unrevealed = board
    .map((card, index) => ({ ...card, vector: boardVectors[index] }))
    .filter((card) => !card.done);
  const friendlies = unrevealed.filter((card) => card.team === "friendly");
  const boardWords = unrevealed.map((card) => normalizeTerm(card.word));
  let best = null;

  for (
    let candidateIndex = 0;
    candidateIndex < activeClueIndex.clues.length;
    candidateIndex += 1
  ) {
    const clue = activeClueIndex.clues[candidateIndex];
    if (isForbiddenClue(normalizeTerm(clue), boardWords)) {
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
  { bonusGuesses, clueDecisions, correctBonusGuesses, fallbackClues },
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

  return {
    board: boardIndex + 1,
    seed: game.seed,
    winner: game.winner,
    endReason: game.endReason,
    actions,
    turns: clues.length,
    fallbackClues,
    bonusGuesses,
    correctBonusGuesses,
    clueDecisions,
    clues: clueDistribution(clues),
    firstHalfClueNumbers: clues
      .slice(0, Math.ceil(clues.length / 2))
      .map(({ number }) => number),
    guesses: guesses.length,
    correctGuesses,
    wrongTeamHits,
    neutralHits,
    assassinHits,
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
      summary.passes += game.passes;
      summary.fallbackClues += game.fallbackClues;
      summary.bonusGuesses += game.bonusGuesses;
      summary.correctBonusGuesses += game.correctBonusGuesses;
      summary.clueDecisions.push(...game.clueDecisions);
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
      passes: 0,
      fallbackClues: 0,
      bonusGuesses: 0,
      correctBonusGuesses: 0,
      clueDecisions: [],
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

  return {
    gameCount,
    completedGames: gameCount,
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
    meanTurnsPerGame: ratio(totals.turns, gameCount),
    meanGuessesPerTurn: ratio(totals.guesses, totals.turns),
    passesPerGame: ratio(totals.passes, gameCount),
    fallbackClues: totals.fallbackClues,
    fallbackClueRate: ratio(totals.fallbackClues, totals.turns),
    bonusGuesses: totals.bonusGuesses,
    bonusGuessesPerGame: ratio(totals.bonusGuesses, gameCount),
    correctBonusGuessRate: ratio(
      totals.correctBonusGuesses,
      totals.bonusGuesses,
    ),
    clueNumberByOwnRemaining: summarizeClueDecisions(totals.clueDecisions),
    wins: {
      blue: totals.blueWins,
      red: totals.redWins,
    },
    gameResults: gameResults.map(({ clueDecisions, ...result }) => result),
  };
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
      "meanTurnsPerGame",
      "meanGuessesPerTurn",
      "passesPerGame",
      "fallbackClueRate",
      "bonusGuessesPerGame",
      "correctBonusGuessRate",
    ].map((metric) => [metric, rounded(hybrid[metric] - current[metric])]),
  );
}

function boardSeed(boardIndex) {
  const bytes = Buffer.alloc(8);
  bytes.write("CODE", 0, "ascii");
  bytes.writeUInt32BE(boardIndex + 1, 4);
  return bytes.toString("base64url");
}

function parseOptions(args) {
  const values = {
    boards: DEFAULT_BOARD_COUNT,
    candidates: DEFAULT_PLAY_BOT_SETTINGS.candidateCount,
    modelId: DEFAULT_PLAY_BOT_SETTINGS.modelId,
    wordSet: WORD_SET.OFFICIAL,
    clueSelection: "tempo",
    multiTolerance: DEFAULT_PLAY_BOT_SETTINGS.multiTolerance,
    bonusGuesses: PLAY_BONUS_POLICY.PASS,
    output: DEFAULT_OUTPUT,
    summaryOutput: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--boards") {
      values.boards = positiveInteger(value, option);
    } else if (option === "--candidates") {
      values.candidates = positiveInteger(value, option);
    } else if (option === "--model") {
      if (!value) throw new Error(`${option} requires a model ID.`);
      values.modelId = value;
    } else if (option === "--word-set") {
      if (!Object.values(WORD_SET).includes(value)) {
        throw new Error(`${option} must be official or extended.`);
      }
      values.wordSet = value;
    } else if (option === "--clue-selection") {
      if (!["random", "top", "tempo"].includes(value)) {
        throw new Error(`${option} must be random, top, or tempo.`);
      }
      values.clueSelection = value;
    } else if (option === "--multi-tolerance") {
      values.multiTolerance = nonNegativeNumber(value, option);
    } else if (option === "--bonus-guesses") {
      if (!["allow", "pass"].includes(value)) {
        throw new Error(`${option} must be allow or pass.`);
      }
      values.bonusGuesses = value;
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
  return values;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer.`);
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

function dotVectors(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
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

function printSummary(policyResults) {
  console.table(
    POLICIES.map((policy) => ({
      policy,
      games: policyResults[policy].gameCount,
      "multi clues": policyResults[policy].multiClueRate,
      "first-half mean": policyResults[policy].firstHalfMeanClueNumber,
      "correct/turn": policyResults[policy].correctCardsPerTurn,
      "wrong/game": policyResults[policy].wrongTeamHitsPerGame,
      "assassin rate": policyResults[policy].assassinRate,
      "turns/game": policyResults[policy].meanTurnsPerGame,
    })),
  );
}
