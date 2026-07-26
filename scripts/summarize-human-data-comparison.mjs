import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_REPORT_PATH = resolve(
  ROOT,
  "scripts/generated/embedding-model-comparison.json",
);
const HOSTED_REPORT_PATH = resolve(
  ROOT,
  optionValue(
    process.argv.slice(2),
    "--hosted-report",
    ".cache/embedding-experiments/voyage-4-large-1024-expanded/human-report.json",
  ),
);
const OUTPUT_PATH = resolve(
  ROOT,
  "scripts/generated/human-data-embedding-comparison.json",
);

const localReport = JSON.parse(await readFile(LOCAL_REPORT_PATH, "utf8"));
const hostedReport = JSON.parse(await readFile(HOSTED_REPORT_PATH, "utf8"));
const bge = localReport.results.find(
  (result) =>
    result.model === "Xenova/bge-small-en-v1.5" &&
    result.transform === "centered",
);
if (!bge) throw new Error("Centered BGE-small result is missing.");

const coverage = hostedReport.vocabularyCoverage.humanTurns;
const incomplete = Object.entries(coverage).filter(
  ([, result]) =>
    result.rate !== 1 ||
    (result.totalResponses > 0 && result.responseRate !== 1),
);
if (incomplete.length > 0) {
  throw new Error(
    `Hosted human-data coverage is incomplete: ${incomplete
      .map(([name]) => name)
      .join(", ")}`,
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  datasets: localReport.dataset,
  models: {
    bgeSmall: {
      model: bge.model,
      runtime: "local-q8",
      centered: bge.datasets,
    },
    voyage4Large: {
      model: hostedReport.model,
      runtime: hostedReport.vectorSource.runtime,
      centered: hostedReport.transforms.centered,
      coverage,
      cost: hostedReport.vectorSource.cost,
    },
  },
  centeredDeltaVoyageVsBge: metricDeltas(
    hostedReport.transforms.centered,
    bge.datasets,
  ),
  conclusion: {
    humanAlignmentLeader: hostedReport.model,
    productionEmbedding: bge.model,
    reason:
      "Voyage leads the expanded human-data benchmark, but it remains ineligible because the checked development cross-model transfer gate failed.",
    crossModelReport:
      "scripts/generated/play-embedding-finalist-development-cross-model.json",
  },
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH}`);

function metricDeltas(result, baseline) {
  return Object.fromEntries(
    Object.entries(result).map(([dataset, metrics]) => [
      dataset,
      Object.fromEntries(
        Object.entries(metrics)
          .filter(
            ([metric, value]) =>
              !metric.startsWith("scored") &&
              Number.isFinite(value) &&
              Number.isFinite(baseline[dataset][metric]),
          )
          .map(([metric, value]) => [
            metric,
            round(value - baseline[dataset][metric]),
          ]),
      ),
    ]),
  );
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function round(value) {
  return Number(value.toFixed(4));
}
