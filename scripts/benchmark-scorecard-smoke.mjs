import assert from "node:assert/strict";
import REPORT from "./generated/play-model-comparison-v3.json" with {
  type: "json",
};
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  benchmarkRows,
  humanAlignmentSlices,
  validateBenchmarkReport,
} from "../src/benchmark/scorecard.js";

assert.equal(
  validateBenchmarkReport(REPORT).schemaVersion,
  BENCHMARK_REPORT_SCHEMA_VERSION,
);
assert.equal(
  REPORT.baseline.configurationFingerprint.length,
  64,
);
assert.equal(benchmarkRows(REPORT).length, REPORT.candidates.length);
assert.deepEqual(
  REPORT.methodology.evidenceLayers.fixedBoardSelfPlay.splits.map(
    ({ id, boardCount }) => [id, boardCount],
  ),
  [
    ["smoke", 20],
    ["calibration", 100],
    ["development", 128],
    ["test", 150],
  ],
);
assert.deepEqual(
  REPORT.methodology.evidenceLayers.gameplaySafety.metrics,
  [
    "Assassin hits",
    "Wrong-team hits",
    "Neutral hits",
    "Fallback clues",
    "Stalls",
  ],
);
assert.match(
  REPORT.methodology.evidenceLayers.promotionFlow.rules.join(" "),
  /cannot promote/u,
);

const syntheticSlice = {
  candidateId: "synthetic-candidate",
  source: { name: "Synthetic source" },
};
const comparisonFixture = {
  ...REPORT,
  candidates: [
    {
      id: "synthetic-candidate",
      humanAlignmentSlices: [syntheticSlice],
    },
  ],
  summary: {
    ...REPORT.summary,
    candidateCount: 1,
    candidates: [
      {
        id: "synthetic-candidate",
        playMetrics: {
          improved: 1,
          regressed: 0,
          uncertain: 1,
          changed: 0,
          unchanged: 0,
        },
        humanAlignment: {
          slices: 1,
          tuningSlices: 1,
          heldOutSlices: 0,
          reviewedStatus: "not-attached",
        },
      },
    ],
  },
  evidenceFamilies: {
    humanAlignment: {
      slices: [syntheticSlice],
      aggregation: REPORT.evidenceFamilies.humanAlignment.aggregation,
    },
  },
};
assert.equal(benchmarkRows(comparisonFixture).length, 1);
assert.deepEqual(
  humanAlignmentSlices(
    comparisonFixture,
    "synthetic-candidate",
  ),
  [syntheticSlice],
);

console.log("Benchmark scorecard smoke checks passed.");
