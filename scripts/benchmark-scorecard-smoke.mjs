import SCORECARD from "./generated/benchmark-scorecard.json" with {
  type: "json",
};
import {
  DEFAULT_HUMAN_WEIGHT,
  scoreBenchmarkRow,
  scoreDelta,
} from "../src/benchmark/scorecard.js";

if (SCORECARD.schemaVersion !== 1) {
  throw new Error("Unexpected benchmark scorecard schema.");
}
if (SCORECARD.rows.length !== 5) {
  throw new Error(
    `Expected five benchmark configurations, found ${SCORECARD.rows.length}.`,
  );
}
const baseline = SCORECARD.rows.find(
  ({ id }) => id === SCORECARD.baselineId,
);
const voyage = SCORECARD.rows.find(
  ({ id }) => id === "voyage-hybrid-dynamic",
);
if (!baseline || !voyage) {
  throw new Error("Required benchmark configurations are missing.");
}
if (
  scoreBenchmarkRow(baseline, DEFAULT_HUMAN_WEIGHT) !== 67.7
) {
  throw new Error("Default baseline score drifted.");
}
if (
  scoreBenchmarkRow(voyage, 100) !==
  Number(voyage.scores.humanAlignment.toFixed(1))
) {
  throw new Error("Human-only weighting is inconsistent.");
}
if (
  scoreDelta(
    voyage.transfer.correctCardsPerTurn,
    baseline.transfer.correctCardsPerTurn,
  ) >= 0
) {
  throw new Error("Voyage transfer regression is not represented.");
}

console.log("Benchmark scorecard smoke checks passed.");
