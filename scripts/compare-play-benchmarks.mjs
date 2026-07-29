import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactRecord,
  comparisonFingerprint,
  configurationChanges,
  createComparisonSummary,
  createEmbeddingAlignmentSlices,
  createFinalVerdict,
  deterministicGeneratedAt,
  humanEvidenceRecord,
  renderBenchmarkComparisonSummary,
  validateComparableReports,
} from "./benchmark-comparison-report.mjs";
import {
  classifyMetricChanges,
  comparePairedGameResults,
  createPromotionAssessment,
  findPairedGameRegressions,
} from "./benchmark-statistics.mjs";

const options = parseOptions(process.argv.slice(2));
const baselineSource = await readArtifact(options.baseline);
const candidateSources = await Promise.all(
  options.candidates.map(async ({ id, path }) => ({
    id,
    path,
    ...(await readArtifact(path)),
  })),
);
const candidateIds = new Set(candidateSources.map(({ id }) => id));
validateHumanOptions(options, candidateIds);
const humanSources = new Map(
  await Promise.all(
    [...options.humanEvidence].map(async ([id, path]) => [
      id,
      { path, ...(await readArtifact(path)) },
    ]),
  ),
);
const humanAlignmentSources = new Map(
  await Promise.all(
    [...options.humanAlignment].map(async ([id, path]) => [
      id,
      { path, ...(await readArtifact(path)) },
    ]),
  ),
);
const baselineGames = fullHybridGames(
  baselineSource.report,
  options.baseline,
);
const baselineArtifact = artifactRecord({
  id: options.baselineId,
  path: options.baseline,
  bytes: baselineSource.bytes,
  report: baselineSource.report,
  role: "accepted-baseline",
});
const results = candidateSources.map(({ id, path, bytes, report }) => {
  validateComparableReports(baselineSource.report, report, id);
  const candidateGames = fullHybridGames(report, id);
  const comparison = comparePairedGameResults(baselineGames, candidateGames, {
    iterations: options.iterations,
    seed: `${options.seed}:${id}`,
  });
  const promotion = createPromotionAssessment(comparison, candidateGames);
  const artifact = artifactRecord({
    id,
    path,
    bytes,
    report,
    role: "candidate",
  });
  const humanSource = humanSources.get(id);
  const humanEvidence = humanSource
    ? humanEvidenceRecord({
        baselineId:
          baselineSource.report.configuration?.spymaster?.modelIndex
            ?.id ??
          baselineSource.report.methodology?.modelId ??
          options.baselineId,
        candidateId: id,
        path: humanSource.path,
        bytes: humanSource.bytes,
        report: humanSource.report,
        verdict: options.humanVerdicts.get(id) ?? "unreviewed",
      })
    : null;
  const humanAlignmentSource = humanAlignmentSources.get(id);
  const humanAlignmentSlices = [
    ...(humanEvidence?.alignmentSlices ?? []),
    ...(humanAlignmentSource
      ? createEmbeddingAlignmentSlices({
          candidateId: id,
          path: humanAlignmentSource.path,
          bytes: humanAlignmentSource.bytes,
          report: humanAlignmentSource.report,
          baselineSelector:
            options.humanAlignmentBaselines.get(id),
          candidateSelector:
            options.humanAlignmentCandidates.get(id),
          role:
            options.humanAlignmentRoles.get(id) ?? "tuning",
        })
      : []),
  ];
  const verdict = createFinalVerdict({
    promotion,
    split: report.methodology?.split,
    heldOutProtocol: report.methodology?.heldOutProtocol ?? null,
    humanEvidence,
    canonicalConfiguration:
      baselineArtifact.configurationContract === "canonical-v1" &&
      artifact.configurationContract === "canonical-v1",
  });
  return {
    id,
    methodology: report.methodology,
    artifact,
    configurationChanges: configurationChanges(
      baselineSource.report,
      report,
    ),
    comparison,
    metrics: classifyMetricChanges(comparison),
    promotion,
    humanEvidence,
    humanAlignmentSlices,
    perExampleRegressions: findPairedGameRegressions(
      baselineGames,
      candidateGames,
      { limit: options.maxRegressions },
    ),
    verdict,
  };
});
const methodology = {
  pairedByBoard: true,
  bootstrapUnit: "board",
  bootstrapIterations: options.iterations,
  confidence: 0.95,
  seed: options.seed,
  perExampleRegressionLimit: options.maxRegressions,
  metricStatus:
    "Improved or regressed requires the full paired 95% interval to clear zero. Otherwise the result is uncertain.",
  gateStatus:
    "A point estimate beyond an existing promotion threshold blocks. A point estimate within the threshold with a confidence bound outside it needs more data.",
};
const output = {
  schemaVersion: 3,
  generatedAt: deterministicGeneratedAt([
    baselineSource.report,
    ...candidateSources.map(({ report }) => report),
    ...[...humanSources.values()].map(({ report }) => report),
    ...[...humanAlignmentSources.values()].map(
      ({ report }) => report,
    ),
  ]),
  baseline: {
    path: options.baseline,
    methodology: baselineSource.report.methodology,
    ...baselineArtifact,
  },
  evidence: {
    source: baselineArtifact.evidence.source,
    unit: baselineArtifact.evidence.unit,
    split: baselineArtifact.evidence.split,
    splitRole: baselineArtifact.evidence.splitRole,
    pairedBoards: results[0].comparison.pairedBoards,
    humanRealismClaim: false,
  },
  methodology,
  candidates: results,
  summary: createComparisonSummary(results),
  evidenceFamilies: {
    humanAlignment: {
      slices: results.flatMap(
        ({ humanAlignmentSlices }) => humanAlignmentSlices,
      ),
      aggregation:
        "None. Each source and game or task format remains a separate slice.",
    },
  },
};
output.comparisonFingerprint = comparisonFingerprint({
  baseline: output.baseline,
  candidates: results,
  methodology,
});

const outputPath = resolve(options.output);
const summaryOutputPath = resolve(
  options.summaryOutput ?? summaryPathFor(options.output),
);
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(
  summaryOutputPath,
  renderBenchmarkComparisonSummary(output),
);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${summaryOutputPath}`);

function fullHybridGames(report, label) {
  const games = report?.policies?.hybrid?.gameResults;
  if (!Array.isArray(games) || games.length < 2) {
    throw new Error(`${label} must be a full Play benchmark report.`);
  }
  return games;
}

async function readArtifact(path) {
  const bytes = await readFile(resolve(path));
  return {
    bytes,
    report: JSON.parse(bytes.toString("utf8")),
  };
}

function parseOptions(args) {
  const values = {
    baseline: null,
    baselineId: "accepted-baseline",
    candidates: [],
    output: "scripts/generated/play-model-comparison-v3.json",
    summaryOutput: null,
    iterations: 10_000,
    seed: "CODE-STATS",
    maxRegressions: 10,
    humanEvidence: new Map(),
    humanVerdicts: new Map(),
    humanAlignment: new Map(),
    humanAlignmentBaselines: new Map(),
    humanAlignmentCandidates: new Map(),
    humanAlignmentRoles: new Map(),
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--baseline") values.baseline = required(value, option);
    else if (option === "--baseline-id") {
      values.baselineId = required(value, option);
    } else if (option === "--candidate") {
      values.candidates.push(parseAssignment(value, option));
    } else if (option === "--human-evidence") {
      const assignment = parseAssignment(value, option);
      values.humanEvidence.set(assignment.id, assignment.path);
    } else if (option === "--human-verdict") {
      const assignment = parseAssignment(value, option);
      if (!["pass", "fail", "unreviewed"].includes(assignment.path)) {
        throw new Error(
          `${option} verdict must be pass, fail, or unreviewed.`,
        );
      }
      values.humanVerdicts.set(assignment.id, assignment.path);
    } else if (option === "--human-alignment") {
      const assignment = parseAssignment(value, option);
      values.humanAlignment.set(assignment.id, assignment.path);
    } else if (option === "--human-alignment-baseline") {
      const assignment = parseAssignment(value, option);
      values.humanAlignmentBaselines.set(
        assignment.id,
        assignment.path,
      );
    } else if (option === "--human-alignment-candidate") {
      const assignment = parseAssignment(value, option);
      values.humanAlignmentCandidates.set(
        assignment.id,
        assignment.path,
      );
    } else if (option === "--human-alignment-role") {
      const assignment = parseAssignment(value, option);
      if (!["tuning", "held-out"].includes(assignment.path)) {
        throw new Error(
          `${option} role must be tuning or held-out.`,
        );
      }
      values.humanAlignmentRoles.set(
        assignment.id,
        assignment.path,
      );
    } else if (option === "--output") {
      values.output = required(value, option);
    } else if (option === "--summary-output") {
      values.summaryOutput = required(value, option);
    } else if (option === "--iterations") {
      values.iterations = positiveInteger(value, option);
    } else if (option === "--seed") values.seed = required(value, option);
    else if (option === "--max-regressions") {
      values.maxRegressions = nonNegativeInteger(value, option);
    } else throw new Error(`Unknown comparison option: ${option}`);
    index += 1;
  }
  if (!values.baseline) throw new Error("--baseline is required.");
  if (values.candidates.length === 0) {
    throw new Error("At least one --candidate id=path is required.");
  }
  const candidateIds = values.candidates.map(({ id }) => id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Candidate IDs must be unique.");
  }
  return values;
}

function parseAssignment(value, option) {
  const separator = value?.indexOf("=");
  if (!value || separator < 1 || separator === value.length - 1) {
    throw new Error(`${option} must use id=value.`);
  }
  return {
    id: value.slice(0, separator),
    path: value.slice(separator + 1),
  };
}

function validateHumanOptions(values, candidateIds) {
  for (const id of values.humanEvidence.keys()) {
    if (!candidateIds.has(id)) {
      throw new Error(`Human evidence references unknown candidate ${id}.`);
    }
  }
  for (const id of values.humanVerdicts.keys()) {
    if (!values.humanEvidence.has(id)) {
      throw new Error(
        `Human verdict for ${id} requires --human-evidence ${id}=path.`,
      );
    }
  }
  for (const [option, assignments] of [
    ["--human-alignment", values.humanAlignment],
    [
      "--human-alignment-baseline",
      values.humanAlignmentBaselines,
    ],
    [
      "--human-alignment-candidate",
      values.humanAlignmentCandidates,
    ],
    ["--human-alignment-role", values.humanAlignmentRoles],
  ]) {
    for (const id of assignments.keys()) {
      if (!candidateIds.has(id)) {
        throw new Error(`${option} references unknown candidate ${id}.`);
      }
    }
  }
  for (const id of values.humanAlignment.keys()) {
    if (
      !values.humanAlignmentBaselines.has(id) ||
      !values.humanAlignmentCandidates.has(id)
    ) {
      throw new Error(
        `Human alignment for ${id} requires baseline and candidate result selectors.`,
      );
    }
  }
  for (const assignments of [
    values.humanAlignmentBaselines,
    values.humanAlignmentCandidates,
    values.humanAlignmentRoles,
  ]) {
    for (const id of assignments.keys()) {
      if (!values.humanAlignment.has(id)) {
        throw new Error(
          `Human-alignment options for ${id} require --human-alignment ${id}=path.`,
        );
      }
    }
  }
}

function summaryPathFor(reportPath) {
  return reportPath.endsWith(".json")
    ? `${reportPath.slice(0, -".json".length)}.md`
    : `${reportPath}.md`;
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

function nonNegativeInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${option} must be a non-negative integer.`);
  }
  return number;
}
