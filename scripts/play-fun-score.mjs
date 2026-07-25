const OBJECTIVE_VERSION = 1;

export const PLAY_FUN_OBJECTIVE = Object.freeze({
  version: OBJECTIVE_VERSION,
  weights: {
    ambition: 0.3,
    momentum: 0.3,
    suspense: 0.25,
    flow: 0.15,
  },
  targets: {
    multiClueRate: [0.2, 0.6],
    firstHalfMeanClueNumber: [1.2, 2.2],
    correctCardsPerTurn: [1, 1.65],
    closeFinishRate: [0.35, 0.75],
    idealTurnsPerGame: [8, 12],
    playableTurnsPerGame: [6, 16],
  },
  guardrails: {
    assassinRate: 0.02,
    wrongTeamHitsPerGame: 0.15,
    neutralHitsPerGame: 0.35,
    fallbackClueRate: 0.01,
  },
});

export function scorePlayFun(policy) {
  const targets = PLAY_FUN_OBJECTIVE.targets;
  const components = {
    ambition: average([
      ramp(policy.multiClueRate, ...targets.multiClueRate),
      ramp(policy.firstHalfMeanClueNumber, ...targets.firstHalfMeanClueNumber),
    ]),
    momentum: ramp(
      policy.correctCardsPerTurn,
      ...targets.correctCardsPerTurn,
    ),
    suspense: average([
      ramp(policy.closeFinishRate, ...targets.closeFinishRate),
      winBalance(policy),
    ]),
    flow: band(
      policy.meanTurnsPerGame,
      targets.idealTurnsPerGame,
      targets.playableTurnsPerGame,
    ),
  };
  const weightedScore = Object.entries(PLAY_FUN_OBJECTIVE.weights).reduce(
    (total, [component, weight]) => total + components[component] * weight,
    0,
  );
  const violations = Object.entries(PLAY_FUN_OBJECTIVE.guardrails)
    .filter(([metric, limit]) => Number(policy[metric] ?? 0) > limit)
    .map(([metric, limit]) => ({
      metric,
      actual: rounded(policy[metric]),
      limit,
    }));

  return {
    objectiveVersion: OBJECTIVE_VERSION,
    score: rounded(weightedScore * 100),
    selectionScore:
      violations.length === 0 ? rounded(weightedScore * 100) : null,
    components: Object.fromEntries(
      Object.entries(components).map(([name, value]) => [
        name,
        rounded(value * 100),
      ]),
    ),
    guardrailsPassed: violations.length === 0,
    violations,
  };
}

function ramp(value, low, high) {
  return clamp((Number(value) - low) / (high - low));
}

function band(value, ideal, playable) {
  if (value >= ideal[0] && value <= ideal[1]) return 1;
  if (value < ideal[0]) {
    return clamp((value - playable[0]) / (ideal[0] - playable[0]));
  }
  return clamp((playable[1] - value) / (playable[1] - ideal[1]));
}

function winBalance(policy) {
  const games = Number(policy.gameCount) || 0;
  if (games === 0) return 0;
  const blueShare = Number(policy.wins?.blue ?? 0) / games;
  return clamp(1 - Math.abs(blueShare - 0.5) * 2);
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function rounded(value) {
  return Number(Number(value ?? 0).toFixed(4));
}
