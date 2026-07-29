import { createHash } from "node:crypto";

export const BENCHMARK_CONFIGURATION_SCHEMA_VERSION = 2;
const REQUIRED_CONFIGURATION_PATHS = Object.freeze([
  "evidence.split",
  "evidence.splitRole",
  "evidence.boardOffset",
  "evidence.boardCount",
  "implementation.contentSha256",
  "implementation.files",
  "board.language",
  "board.wordSet",
  "board.wordCount",
  "board.wordContentSha256",
  "board.cardCount",
  "board.order",
  "board.wordReusePolicy",
  "board.wordReuseHistoryBoards",
  "board.generationSeed.deterministic",
  "board.generationSeed.scheme",
  "game.startingSide",
  "game.simulationContractVersion",
  "game.simulatedHumanSeat.side",
  "game.simulatedHumanSeat.role",
  "game.maxActionsPerGame",
  "game.forcedProgressAfterConsecutivePasses",
  "game.forcedProgressChoice",
  "game.fallbackClue.enabled",
  "game.fallbackClue.number",
  "game.fallbackClue.selection",
  "spymaster.modelIndex.id",
  "spymaster.modelIndex.manifestSha256",
  "spymaster.modelIndex.selectedShards",
  "spymaster.vocabularySize",
  "spymaster.cluePolicyVariants",
  "spymaster.comparisonPolicy",
  "spymaster.clueScoring.current",
  "spymaster.clueScoring.hybrid",
  "spymaster.clueSelection",
  "spymaster.clueReranker",
  "spymaster.multiClueTolerance",
  "spymaster.clueRepeatPolicy",
  "spymaster.missedTargetTiming",
  "spymaster.resultsPerTargetSize",
  "operative.modelIndex.id",
  "operative.aggression",
  "operative.additionalAggressionVariants",
  "operative.conceptBridges.playSetting",
  "operative.conceptBridges.requested",
  "operative.conceptBridges.resolved",
  "operative.guessVariation",
  "operative.guessVariationRange.minimum",
  "operative.guessVariationRange.maximum",
  "operative.extraGuessPolicy",
  "scoring.similarityCalibration.scale",
  "scoring.similarityCalibration.offset",
  "randomness.deterministic",
  "randomness.boardSeed",
  "randomness.decisionSeed",
  "randomness.operativeVariationSeed",
  "randomness.clueSelectionRandomized",
]);

export function createBenchmarkConfiguration({
  activeAggressions,
  activePolicies,
  benchmarkReranker,
  boardWords,
  conceptAsset,
  conceptRankingEnabled,
  heldOutProtocol,
  implementationAsset,
  modelAsset,
  operativeAsset,
  options,
  resultsPerTargetSize,
  subscriptionClueReranker,
}) {
  const resolvedOperativeRanking = benchmarkReranker
    ? "guarded-wordnet-reranker"
    : conceptRankingEnabled
      ? "guarded-wordnet"
      : "direct";
  const comparisonPolicy = "hybrid";
  const wordReusePolicy = "fully-random";
  const configuration = {
    schemaVersion: BENCHMARK_CONFIGURATION_SCHEMA_VERSION,
    evidence: {
      split: options.split,
      splitRole:
        options.split === "test"
          ? "held-out"
          : options.split === "custom"
            ? "unspecified"
            : "tuning",
      boardOffset: options.boardOffset,
      boardCount: options.boards,
      heldOutProtocol,
    },
    implementation: implementationAsset,
    board: {
      language: options.language,
      wordSet: options.wordSet,
      wordCount: boardWords.length,
      wordContentSha256: stableFingerprint(boardWords),
      cardCount: 25,
      order: "random",
      wordReusePolicy,
      wordReuseHistoryBoards: 0,
      generationSeed: {
        deterministic: true,
        scheme:
          "Eight bytes: ASCII CODE followed by a big-endian 1-based board index.",
        firstBoardIndex: options.boardOffset,
        lastBoardIndex: options.boardOffset + options.boards - 1,
      },
    },
    game: {
      simulationContractVersion: 1,
      startingSide: "blue",
      simulatedHumanSeat: {
        side: "blue",
        role: "spymaster",
      },
      maxActionsPerGame: options.maxActions,
      forcedProgressAfterConsecutivePasses: 2,
      forcedProgressChoice: "highest-ranked-available-guess",
      fallbackClue: {
        enabled: true,
        number: 1,
        selection: "nearest-legal-indexed-clue-to-one-friendly-card",
      },
    },
    spymaster: {
      modelIndex: modelAsset,
      vocabularySize: options.candidates,
      cluePolicyVariants: activePolicies,
      comparisonPolicy,
      clueScoring: {
        current: "current-v1",
        hybrid: "hybrid-v1",
      },
      clueSelection: options.clueSelection,
      clueReranker: subscriptionClueReranker,
      clueRandomShortlistSize:
        options.clueSelection === "random" ? 4 : null,
      multiClueTolerance: options.multiTolerance,
      clueRepeatPolicy: options.clueRepeatPolicy,
      missedTargetTiming: options.missedTargetTiming,
      resultsPerTargetSize,
    },
    operative: {
      modelIndex: operativeAsset,
      aggression: options.operativeAggression,
      additionalAggressionVariants: activeAggressions,
      conceptBridges: {
        playSetting:
          options.operativeRanking === "direct" ? "direct" : "guarded",
        requested: options.operativeRanking,
        resolved: resolvedOperativeRanking,
        asset: conceptRankingEnabled ? conceptAsset : null,
      },
      reranker: benchmarkReranker
        ? {
            id: benchmarkReranker.id,
            model: benchmarkReranker.definition.model,
            revision: benchmarkReranker.definition.revision,
            shortlistSize: benchmarkReranker.shortlistSize,
            adjustmentCap: benchmarkReranker.adjustmentCap,
          }
        : null,
      guessVariation: options.operativeNoise,
      guessVariationRange:
        options.operativeNoise === "standard"
          ? { minimum: -0.0275, maximum: 0.0275 }
          : { minimum: 0, maximum: 0 },
      extraGuessPolicy: options.bonusGuesses,
    },
    scoring: {
      similarityCalibration: {
        scale: options.similarityScale,
        offset: options.similarityOffset,
      },
    },
    randomness: {
      deterministic: true,
      boardSeed: "board-index",
      decisionSeed:
        "game-seed, turn-number, and event-history-length",
      operativeVariationSeed: "decision-seed",
      clueSelectionRandomized: options.clueSelection === "random",
    },
  };
  validateCanonicalConfiguration(configuration);
  return {
    configuration,
    configurationFingerprint: stableFingerprint(configuration),
    configurationLabels: configurationLabels(configuration),
  };
}

export function validateCanonicalConfiguration(
  configuration,
  label = "benchmark configuration",
) {
  if (![1, BENCHMARK_CONFIGURATION_SCHEMA_VERSION].includes(
    configuration?.schemaVersion,
  )) {
    throw new Error(
      `${label} must use configuration schema 1 or ${BENCHMARK_CONFIGURATION_SCHEMA_VERSION}.`,
    );
  }
  const requiredPaths =
    configuration.schemaVersion >= 2
      ? REQUIRED_CONFIGURATION_PATHS
      : REQUIRED_CONFIGURATION_PATHS.filter(
          (path) => path !== "spymaster.clueReranker",
        );
  const missing = requiredPaths.filter(
    (path) => readPath(configuration, path) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `${label} is missing required behavior fields: ${missing.join(", ")}.`,
    );
  }
  return configuration;
}

export function stableFingerprint(value) {
  return createHash("sha256")
    .update(stableJson(value))
    .digest("hex");
}

export function configurationLabels(configuration) {
  const spymaster = configuration.spymaster;
  const operative = configuration.operative;
  const board = configuration.board;
  const evidence = configuration.evidence;
  const candidateCount = compactCount(spymaster.vocabularySize);
  const bridge = {
    direct: "direct",
    "guarded-wordnet": "concept bridges",
    "guarded-wordnet-reranker": "concept bridges + reranker",
  }[operative.conceptBridges.resolved];
  const reranker = spymaster.clueReranker
    ? `, CLI reranker ${spymaster.clueReranker.selector}`
    : "";
  return {
    modelIndex: `${spymaster.modelIndex.id} ${candidateCount}`,
    board: `${board.language} ${board.wordSet}`,
    clue: `${spymaster.comparisonPolicy}, ${spymaster.clueSelection}, tolerance ${spymaster.multiClueTolerance}, repeats ${spymaster.clueRepeatPolicy}${reranker}`,
    operative: `${operative.modelIndex.id}, ${operative.aggression}, ${bridge}, variation ${operative.guessVariation}, extra ${operative.extraGuessPolicy}`,
    split: `${evidence.split} ${evidence.boardCount} boards at ${evidence.boardOffset}`,
  };
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function compactCount(value) {
  return value >= 1_000 && value % 1_000 === 0
    ? `${value / 1_000}k`
    : String(value);
}

function readPath(value, path) {
  return path
    .split(".")
    .reduce(
      (current, part) =>
        current && Object.hasOwn(current, part)
          ? current[part]
          : undefined,
      value,
    );
}
