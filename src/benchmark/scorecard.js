export const DEFAULT_HUMAN_WEIGHT = 60;

export function scoreBenchmarkRow(
  row,
  humanWeight = DEFAULT_HUMAN_WEIGHT,
) {
  const human = Number(row?.scores?.humanAlignment);
  const fun = Number(row?.scores?.selfPlayFun);
  if (!Number.isFinite(human) || !Number.isFinite(fun)) {
    return null;
  }
  const normalizedHumanWeight = clampWeight(humanWeight) / 100;
  return round(
    human * normalizedHumanWeight +
      fun * (1 - normalizedHumanWeight),
  );
}

export function scoreDelta(value, baseline, invert = false) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) {
    return null;
  }
  return round((value - baseline) * (invert ? -1 : 1));
}

export function clampWeight(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function round(value) {
  return Number(value.toFixed(1));
}
