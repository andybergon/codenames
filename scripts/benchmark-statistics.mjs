const DEFAULT_ITERATIONS = 10_000;

export const PLAY_METRICS = Object.freeze({
  correctCardsPerTurn: {
    numerator: (game) => game.correctGuesses,
    denominator: (game) => game.turns,
  },
  wrongTeamHitsPerGame: {
    numerator: (game) => game.wrongTeamHits,
    denominator: () => 1,
  },
  neutralHitsPerGame: {
    numerator: (game) => game.neutralHits,
    denominator: () => 1,
  },
  assassinRate: {
    numerator: (game) => Number(game.assassinHits > 0),
    denominator: () => 1,
  },
  fallbackClueRate: {
    numerator: (game) => game.fallbackClues,
    denominator: (game) => game.turns,
  },
  stallRate: {
    numerator: (game) => Number(game.stalled),
    denominator: () => 1,
  },
  meanTurnsPerGame: {
    numerator: (game) => game.turns,
    denominator: () => 1,
  },
});

export const PLAY_METRIC_METADATA = Object.freeze({
  correctCardsPerTurn: {
    label: "Correct cards per turn",
    preferredDirection: "higher",
    evidence: "Paired deterministic full-game boards",
  },
  wrongTeamHitsPerGame: {
    label: "Wrong-team hits per game",
    preferredDirection: "lower",
    evidence: "Paired deterministic full-game boards",
  },
  neutralHitsPerGame: {
    label: "Neutral hits per game",
    preferredDirection: "lower",
    evidence: "Paired deterministic full-game boards",
  },
  assassinRate: {
    label: "Assassin loss rate",
    preferredDirection: "lower",
    evidence: "Paired deterministic full-game boards",
  },
  fallbackClueRate: {
    label: "Fallback clue rate",
    preferredDirection: "lower",
    evidence: "Paired deterministic full-game boards",
  },
  stallRate: {
    label: "Stall rate",
    preferredDirection: "lower",
    evidence: "Paired deterministic full-game boards",
  },
  meanTurnsPerGame: {
    label: "Turns per game",
    preferredDirection: "context",
    evidence: "Paired deterministic full-game boards",
  },
});

export function comparePairedGameResults(
  baselineGames,
  candidateGames,
  options = {},
) {
  const pairs = pairGamesByBoard(baselineGames, candidateGames);
  if (pairs.length < 2) {
    throw new Error("At least two paired board results are required.");
  }
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const random = createDeterministicRandom(options.seed ?? "CODE-STATS");
  return {
    pairedBoards: pairs.length,
    bootstrapIterations: iterations,
    metrics: Object.fromEntries(
      Object.entries(PLAY_METRICS).map(([name, metric]) => [
        name,
        pairedBootstrap(pairs, metric, iterations, random),
      ]),
    ),
  };
}

export function wilsonInterval(successes, total, confidence = 0.95) {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) {
    return { estimate: null, lower: null, upper: null };
  }
  const z =
    confidence === 0.95
      ? 1.959963984540054
      : inverseNormalCdf(0.5 + confidence / 2);
  const estimate = successes / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (estimate + (z ** 2) / (2 * total)) / denominator;
  const halfWidth =
    (z / denominator) *
    Math.sqrt(
      (estimate * (1 - estimate)) / total +
        (z ** 2) / (4 * total ** 2),
    );
  return {
    estimate: rounded(estimate),
    lower: rounded(Math.max(0, center - halfWidth)),
    upper: rounded(Math.min(1, center + halfWidth)),
  };
}

export function zeroEventUpperBound(total, alpha = 0.05) {
  return total > 0 ? rounded(1 - alpha ** (1 / total)) : null;
}

export function createPromotionAssessment(
  comparison,
  candidateGames,
  options = {},
) {
  const thresholds = {
    assassinDeltaUpper: options.assassinDeltaUpper ?? 0.05,
    wrongTeamDeltaUpper: options.wrongTeamDeltaUpper ?? 0.15,
    neutralDeltaUpper: options.neutralDeltaUpper ?? 0.15,
    fallbackRate: options.fallbackRate ?? 0.01,
    correctNonInferiority: options.correctNonInferiority ?? -0.05,
  };
  const assassinGames = candidateGames.filter(
    (game) => game.assassinHits > 0,
  ).length;
  const assassin = wilsonInterval(assassinGames, candidateGames.length);
  const wrongTeamPerGame = ratio(
    candidateGames.reduce((sum, game) => sum + game.wrongTeamHits, 0),
    candidateGames.length,
  );
  const fallbackRate = ratio(
    candidateGames.reduce((sum, game) => sum + game.fallbackClues, 0),
    candidateGames.reduce((sum, game) => sum + game.turns, 0),
  );
  const stalls = candidateGames.filter((game) => game.stalled).length;
  const correct = comparison.metrics.correctCardsPerTurn.delta;
  const gates = {
    zeroStalls: {
      passed: stalls === 0,
      actual: stalls,
      maximum: 0,
    },
    assassinNonInferiority: {
      passed:
        comparison.metrics.assassinRate.delta.upper <=
        thresholds.assassinDeltaUpper,
      actual: comparison.metrics.assassinRate.delta,
      maximumUpperBound: thresholds.assassinDeltaUpper,
      candidateRate: assassin,
    },
    wrongTeamNonInferiority: {
      passed:
        comparison.metrics.wrongTeamHitsPerGame.delta.upper <=
        thresholds.wrongTeamDeltaUpper,
      actual: comparison.metrics.wrongTeamHitsPerGame.delta,
      maximumUpperBound: thresholds.wrongTeamDeltaUpper,
      candidateRate: rounded(wrongTeamPerGame),
    },
    neutralNonInferiority: {
      passed:
        comparison.metrics.neutralHitsPerGame.delta.upper <=
        thresholds.neutralDeltaUpper,
      actual: comparison.metrics.neutralHitsPerGame.delta,
      maximumUpperBound: thresholds.neutralDeltaUpper,
    },
    fallback: {
      passed: fallbackRate <= thresholds.fallbackRate,
      actual: rounded(fallbackRate),
      maximum: thresholds.fallbackRate,
    },
    correctNonInferiority: {
      passed: correct.lower > thresholds.correctNonInferiority,
      actual: correct,
      minimumLowerBound: thresholds.correctNonInferiority,
    },
    correctSuperiority: {
      passed: correct.lower > 0,
      actual: correct,
      minimumLowerBound: 0,
    },
  };
  for (const gate of Object.values(gates)) {
    gate.status = classifyPromotionGate(gate);
  }
  const requiredGates = [
    gates.zeroStalls,
    gates.assassinNonInferiority,
    gates.wrongTeamNonInferiority,
    gates.neutralNonInferiority,
    gates.fallback,
    gates.correctNonInferiority,
  ];
  return {
    thresholds,
    gates,
    playSafetyPassed: [
      gates.zeroStalls,
      gates.assassinNonInferiority,
      gates.wrongTeamNonInferiority,
      gates.neutralNonInferiority,
      gates.fallback,
    ].every(({ passed }) => passed),
    playPromotionPassed: [
      gates.zeroStalls,
      gates.assassinNonInferiority,
      gates.wrongTeamNonInferiority,
      gates.neutralNonInferiority,
      gates.fallback,
      gates.correctNonInferiority,
    ].every(({ passed }) => passed),
    playGateStatus: requiredGates.some(({ status }) => status === "block")
      ? "block"
      : requiredGates.some(({ status }) => status === "needs-more-data")
        ? "needs-more-data"
        : "pass",
    correctSuperiorityObserved: gates.correctSuperiority.passed,
    candidateSafetyEvidence: {
      games: candidateGames.length,
      assassin: eventEvidence(candidateGames, "assassinHits"),
      wrongTeam: eventEvidence(candidateGames, "wrongTeamHits"),
      neutral: eventEvidence(candidateGames, "neutralHits"),
    },
    humanCalibrationRequired: true,
  };
}

export function classifyMetricChanges(comparison) {
  return Object.fromEntries(
    Object.entries(comparison.metrics).map(([name, metric]) => {
      const metadata = PLAY_METRIC_METADATA[name];
      if (!metadata) {
        throw new Error(`Missing metadata for Play metric ${name}.`);
      }
      return [
        name,
        {
          ...metadata,
          ...metric,
          status: metricStatus(metric.delta, metadata.preferredDirection),
        },
      ];
    }),
  );
}

export function findPairedGameRegressions(
  baselineGames,
  candidateGames,
  { limit = 10 } = {},
) {
  const pairs = pairGamesByBoard(baselineGames, candidateGames);
  const regressions = pairs
    .map(({ baseline, candidate }) => {
      const metrics = Object.fromEntries(
        Object.entries(PLAY_METRICS)
          .map(([name, metric]) => {
            if (
              PLAY_METRIC_METADATA[name].preferredDirection === "context"
            ) {
              return null;
            }
            const baselineValue = ratio(
              metric.numerator(baseline),
              metric.denominator(baseline),
            );
            const candidateValue = ratio(
              metric.numerator(candidate),
              metric.denominator(candidate),
            );
            const delta = candidateValue - baselineValue;
            const direction = PLAY_METRIC_METADATA[name].preferredDirection;
            const regressed =
              direction === "higher" ? delta < 0 : delta > 0;
            return regressed
              ? [
                  name,
                  {
                    label: PLAY_METRIC_METADATA[name].label,
                    baseline: rounded(baselineValue),
                    candidate: rounded(candidateValue),
                    delta: rounded(delta),
                  },
                ]
              : null;
          })
          .filter(Boolean),
      );
      return {
        board: candidate.board,
        regressedMetricCount: Object.keys(metrics).length,
        metrics,
      };
    })
    .filter(({ regressedMetricCount }) => regressedMetricCount > 0)
    .sort(
      (left, right) =>
        right.regressedMetricCount - left.regressedMetricCount ||
        left.board - right.board,
    );
  return {
    available: true,
    unit: "deterministic board",
    totalWithRegression: regressions.length,
    displayed: Math.min(limit, regressions.length),
    items: regressions.slice(0, limit),
  };
}

function classifyPromotionGate(gate) {
  if (gate.passed) return "pass";
  if (Object.hasOwn(gate, "maximum")) {
    return gate.actual > gate.maximum ? "block" : "needs-more-data";
  }
  if (Object.hasOwn(gate, "maximumUpperBound")) {
    return gate.actual.estimate > gate.maximumUpperBound
      ? "block"
      : "needs-more-data";
  }
  if (Object.hasOwn(gate, "minimumLowerBound")) {
    return gate.actual.estimate <= gate.minimumLowerBound
      ? "block"
      : "needs-more-data";
  }
  return "needs-more-data";
}

function metricStatus(delta, preferredDirection) {
  if (delta.lower === 0 && delta.upper === 0) return "unchanged";
  if (preferredDirection === "context") {
    return delta.upper < 0 || delta.lower > 0 ? "changed" : "uncertain";
  }
  const improvement =
    preferredDirection === "higher"
      ? delta.lower > 0
      : delta.upper < 0;
  if (improvement) return "improved";
  const regression =
    preferredDirection === "higher"
      ? delta.upper < 0
      : delta.lower > 0;
  return regression ? "regressed" : "uncertain";
}

function eventEvidence(games, field) {
  const eventCount = games.reduce(
    (total, game) => total + game[field],
    0,
  );
  const gamesWithEvent = games.filter((game) => game[field] > 0).length;
  return {
    eventCount,
    eventsPerGame: rounded(ratio(eventCount, games.length)),
    gamesWithEvent,
    gameRateInterval: wilsonInterval(gamesWithEvent, games.length),
    zeroEventUpperBound:
      gamesWithEvent === 0
        ? zeroEventUpperBound(games.length)
        : null,
  };
}

function pairedBootstrap(pairs, metric, iterations, random) {
  const baseline = aggregateMetric(
    pairs.map(({ baseline: game }) => game),
    metric,
  );
  const candidate = aggregateMetric(
    pairs.map(({ candidate: game }) => game),
    metric,
  );
  const samples = new Float64Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let baselineNumerator = 0;
    let baselineDenominator = 0;
    let candidateNumerator = 0;
    let candidateDenominator = 0;
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[Math.floor(random() * pairs.length)];
      baselineNumerator += metric.numerator(pair.baseline);
      baselineDenominator += metric.denominator(pair.baseline);
      candidateNumerator += metric.numerator(pair.candidate);
      candidateDenominator += metric.denominator(pair.candidate);
    }
    samples[iteration] =
      ratio(candidateNumerator, candidateDenominator) -
      ratio(baselineNumerator, baselineDenominator);
  }
  samples.sort();
  return {
    baseline: rounded(baseline),
    candidate: rounded(candidate),
    delta: {
      estimate: rounded(candidate - baseline),
      lower: rounded(quantile(samples, 0.025)),
      upper: rounded(quantile(samples, 0.975)),
    },
  };
}

function pairGamesByBoard(baselineGames, candidateGames) {
  if (baselineGames.length !== candidateGames.length) {
    throw new Error(
      `Paired reports differ in length: ${baselineGames.length} vs ${candidateGames.length}.`,
    );
  }
  const baselineByBoard = new Map(
    baselineGames.map((game) => [game.board, game]),
  );
  const candidateBoards = new Set(
    candidateGames.map((game) => game.board),
  );
  if (
    baselineByBoard.size !== baselineGames.length ||
    candidateBoards.size !== candidateGames.length
  ) {
    throw new Error("Paired reports contain duplicate board IDs.");
  }
  const missing = [
    ...baselineByBoard.keys(),
  ].filter((board) => !candidateBoards.has(board));
  const unexpected = [
    ...candidateBoards,
  ].filter((board) => !baselineByBoard.has(board));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Paired board coverage differs. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }
  return candidateGames
    .map((candidate) => ({
      baseline: baselineByBoard.get(candidate.board),
      candidate,
    }))
    .sort((left, right) => left.candidate.board - right.candidate.board);
}

function aggregateMetric(games, metric) {
  return ratio(
    games.reduce((sum, game) => sum + metric.numerator(game), 0),
    games.reduce((sum, game) => sum + metric.denominator(game), 0),
  );
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function createDeterministicRandom(seed) {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function inverseNormalCdf(probability) {
  if (probability <= 0 || probability >= 1) {
    throw new Error("Probability must be between zero and one.");
  }
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878,
  ];
  const d = [
    0.00778469570904146, 0.32246712907004, 2.445134137143,
    3.75440866190742,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return polynomial(c, q) / polynomial([1, ...d], q);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -polynomial(c, q) / polynomial([1, ...d], q);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (polynomial(a, r) * q) / polynomial([1, ...b], r);
}

function polynomial(coefficients, value) {
  return coefficients.reduce(
    (result, coefficient) => result * value + coefficient,
    0,
  );
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}
