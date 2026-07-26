import assert from "node:assert/strict";
import {
  comparePairedGameResults,
  createPromotionAssessment,
  wilsonInterval,
  zeroEventUpperBound,
} from "./benchmark-statistics.mjs";

const baseline = Array.from({ length: 20 }, (_, index) => ({
  board: index + 1,
  turns: 10,
  correctGuesses: 12,
  wrongTeamHits: 1,
  neutralHits: 0,
  assassinHits: 0,
  fallbackClues: 0,
  stalled: false,
}));
const candidate = baseline.map((game) => ({
  ...game,
  correctGuesses: 14,
  wrongTeamHits: 0,
}));
const comparison = comparePairedGameResults(baseline, candidate, {
  iterations: 1_000,
  seed: "smoke",
});
assert.equal(comparison.pairedBoards, 20);
assert.equal(comparison.metrics.correctCardsPerTurn.delta.estimate, 0.2);
assert.equal(comparison.metrics.wrongTeamHitsPerGame.delta.estimate, -1);
assert.ok(comparison.metrics.correctCardsPerTurn.delta.lower > 0);
assert.throws(
  () =>
    comparePairedGameResults(baseline, candidate.slice(1), {
      iterations: 10,
    }),
  /differ in length/u,
);

const assessment = createPromotionAssessment(comparison, candidate);
assert.equal(assessment.gates.zeroStalls.passed, true);
assert.equal(assessment.gates.correctSuperiority.passed, true);
assert.equal(assessment.playPromotionPassed, true);
assert.equal(wilsonInterval(0, 150).upper < 0.025, true);
assert.equal(zeroEventUpperBound(150) < 0.02, true);

console.log("Benchmark statistics smoke checks passed.");
