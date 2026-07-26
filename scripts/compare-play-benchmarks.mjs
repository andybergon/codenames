import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  comparePairedGameResults,
  createPromotionAssessment,
} from "./benchmark-statistics.mjs";

const options = parseOptions(process.argv.slice(2));
const baseline = await readReport(options.baseline);
const candidates = await Promise.all(
  options.candidates.map(async ({ id, path }) => ({
    id,
    report: await readReport(path),
  })),
);
const baselineGames = fullHybridGames(baseline, options.baseline);
const results = candidates.map(({ id, report }) => {
  const candidateGames = fullHybridGames(report, id);
  const comparison = comparePairedGameResults(baselineGames, candidateGames, {
    iterations: options.iterations,
    seed: `${options.seed}:${id}`,
  });
  return {
    id,
    methodology: report.methodology,
    comparison,
    promotion: createPromotionAssessment(comparison, candidateGames),
  };
});
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseline: {
    path: options.baseline,
    methodology: baseline.methodology,
  },
  methodology: {
    pairedByBoard: true,
    bootstrapUnit: "board",
    bootstrapIterations: options.iterations,
    confidence: 0.95,
    seed: options.seed,
  },
  candidates: results,
};

await writeFile(resolve(options.output), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${resolve(options.output)}`);

function fullHybridGames(report, label) {
  const games = report?.policies?.hybrid?.gameResults;
  if (!Array.isArray(games) || games.length < 2) {
    throw new Error(`${label} must be a full Play benchmark report.`);
  }
  return games;
}

async function readReport(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function parseOptions(args) {
  const values = {
    baseline: null,
    candidates: [],
    output: "scripts/generated/play-model-comparison-v2.json",
    iterations: 10_000,
    seed: "CODE-STATS",
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--baseline") values.baseline = required(value, option);
    else if (option === "--candidate") {
      const separator = value?.indexOf("=");
      if (!value || separator < 1) {
        throw new Error(`${option} must use id=path.`);
      }
      values.candidates.push({
        id: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
    } else if (option === "--output") values.output = required(value, option);
    else if (option === "--iterations") {
      values.iterations = positiveInteger(value, option);
    } else if (option === "--seed") values.seed = required(value, option);
    else throw new Error(`Unknown comparison option: ${option}`);
    index += 1;
  }
  if (!values.baseline) throw new Error("--baseline is required.");
  if (values.candidates.length === 0) {
    throw new Error("At least one --candidate id=path is required.");
  }
  return values;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return number;
}
