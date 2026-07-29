import REPORT from "./generated/play-model-comparison-v3.json" with {
  type: "json",
};
import { validateBenchmarkReport } from "../src/benchmark/scorecard.js";

validateBenchmarkReport(REPORT);
console.log(
  "Canonical v3 benchmark report is ready for the scorecard view.",
);
