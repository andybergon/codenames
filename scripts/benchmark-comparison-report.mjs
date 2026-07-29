import { createHash } from "node:crypto";
import {
  configurationLabels,
  stableFingerprint,
  validateCanonicalConfiguration,
} from "./benchmark-configuration.mjs";

const SPLIT_ROLES = Object.freeze({
  smoke: "tuning",
  calibration: "tuning",
  development: "tuning",
  test: "held-out",
  custom: "unspecified",
});

const REQUIRED_MATCHING_METHODOLOGY = Object.freeze([
  "boardCount",
  "boardOffset",
  "split",
  "pairedBoards",
  "wordSet",
  "language",
  "operativeModelId",
  "boardSeed",
]);

export function validateComparableReports(baseline, candidate, label) {
  for (const field of REQUIRED_MATCHING_METHODOLOGY) {
    if (
      stableJson(baseline.methodology?.[field]) !==
      stableJson(candidate.methodology?.[field])
    ) {
      throw new Error(
        `${label} methodology.${field} does not match the baseline.`,
      );
    }
  }
}

export function artifactRecord({
  id,
  path,
  bytes,
  report,
  role,
}) {
  const methodology = report.methodology ?? {};
  const configuration = report.configuration ?? null;
  if (configuration) {
    validateCanonicalConfiguration(configuration, `${path} configuration`);
    for (const [configurationPath, methodologyField] of [
      ["evidence.split", "split"],
      ["evidence.boardOffset", "boardOffset"],
      ["evidence.boardCount", "boardCount"],
      ["board.language", "language"],
      ["board.wordSet", "wordSet"],
    ]) {
      const configurationValue = readPath(
        configuration,
        configurationPath,
      );
      if (
        stableJson(configurationValue) !==
        stableJson(methodology[methodologyField])
      ) {
        throw new Error(
          `${path} ${configurationPath} does not match methodology.${methodologyField}.`,
        );
      }
    }
  }
  const calculatedFingerprint = configuration
    ? stableFingerprint(configuration)
    : null;
  if (
    calculatedFingerprint &&
    report.configurationFingerprint !== calculatedFingerprint
  ) {
    throw new Error(
      `${path} configurationFingerprint does not match its configuration.`,
    );
  }
  return {
    id,
    role,
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    generatedAt: report.generatedAt ?? null,
    configuration,
    configurationFingerprint: calculatedFingerprint,
    configurationLabels:
      report.configurationLabels ??
      (configuration ? configurationLabels(configuration) : null),
    configurationContract: configuration ? "canonical-v1" : "legacy",
    evidence: {
      source: "Deterministic Play full-game simulation",
      unit: "board",
      sampleSize: methodology.boardCount ?? null,
      split: methodology.split ?? "custom",
      splitRole: splitRole(methodology.split),
      boardOffset: methodology.boardOffset ?? null,
      pairedBoards: methodology.pairedBoards === true,
      humanRealismClaim: false,
    },
  };
}

export function configurationChanges(
  baselineReport,
  candidateReport,
) {
  if (baselineReport.configuration && candidateReport.configuration) {
    const baselineValues = flattenConfiguration(
      baselineReport.configuration,
    );
    const candidateValues = flattenConfiguration(
      candidateReport.configuration,
    );
    const fields = new Set([
      ...baselineValues.keys(),
      ...candidateValues.keys(),
    ]);
    return Object.fromEntries(
      [...fields]
        .sort()
        .filter(
          (field) =>
            stableJson(baselineValues.get(field)) !==
            stableJson(candidateValues.get(field)),
        )
        .map((field) => [
          field,
          {
            baseline: baselineValues.get(field) ?? null,
            candidate: candidateValues.get(field) ?? null,
          },
        ]),
    );
  }
  return legacyConfigurationChanges(
    baselineReport.methodology,
    candidateReport.methodology,
  );
}

export function createFinalVerdict({
  promotion,
  split,
  heldOutProtocol,
  humanEvidence,
  canonicalConfiguration = true,
}) {
  const reasons = [];
  const requiredEvidence = [];
  if (promotion.playGateStatus === "block") {
    reasons.push("At least one Play promotion gate conclusively failed.");
  } else if (promotion.playGateStatus === "needs-more-data") {
    requiredEvidence.push(
      "More paired boards are needed to resolve at least one Play gate.",
    );
  }
  if (humanEvidence?.verdict === "fail") {
    reasons.push("The reviewed blinded human calibration was a gross failure.");
  }
  if (promotion.playGateStatus === "block" || humanEvidence?.verdict === "fail") {
    return {
      status: "block",
      reasons,
      requiredEvidence,
    };
  }
  if (split !== "test") {
    requiredEvidence.push(
      splitRole(split) === "tuning"
        ? "Run the authorized held-out test split once after candidate selection."
        : "Use a named frozen split before making a promotion decision.",
    );
  } else if (!heldOutProtocol) {
    requiredEvidence.push(
      "Regenerate the held-out artifact with recorded protocol authorization.",
    );
  }
  if (!canonicalConfiguration) {
    requiredEvidence.push(
      "Regenerate baseline and candidate artifacts with the canonical configuration contract.",
    );
  }
  if (!humanEvidence) {
    requiredEvidence.push(
      "Attach a blinded human calibration report and reviewed pass or fail verdict.",
    );
  } else if (humanEvidence.verdict === "unreviewed") {
    requiredEvidence.push(
      "Record the reviewed gross-failure verdict for the blinded human calibration.",
    );
  }
  if (
    promotion.playGateStatus === "pass" &&
    split === "test" &&
    heldOutProtocol &&
    canonicalConfiguration &&
    humanEvidence?.verdict === "pass"
  ) {
    return {
      status: "promote",
      reasons: [
        "Play gates passed on authorized held-out boards.",
        "Reviewed blinded human calibration passed its gross-failure screen.",
      ],
      requiredEvidence: [],
    };
  }
  return {
    status: "needs-more-data",
    reasons,
    requiredEvidence,
  };
}

export function humanEvidenceRecord({
  candidateId,
  path,
  bytes,
  report,
  verdict = "unreviewed",
}) {
  const model = report.models?.[candidateId];
  if (!model) {
    throw new Error(
      `Human evidence ${path} has no model result for ${candidateId}.`,
    );
  }
  if (!["pass", "fail", "unreviewed"].includes(verdict)) {
    throw new Error(`Invalid human verdict for ${candidateId}: ${verdict}.`);
  }
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    verdict,
    source: report.methodology?.unit ?? "answered blinded clue task",
    sampleSize: model.answeredTasks ?? null,
    metrics: model,
    reportGeneratedAt: report.generatedAt ?? null,
    automaticThreshold: null,
    note:
      "The comparator records the reviewed gross-failure decision but does not invent a human threshold.",
  };
}

export function comparisonFingerprint({
  baseline,
  candidates,
  methodology,
}) {
  return createHash("sha256")
    .update(
      stableJson({
        baseline: baseline.sha256,
        candidates: candidates.map(
          ({ id, artifact, humanEvidence }) => ({
            id,
            artifact: artifact.sha256,
            humanEvidence: humanEvidence
              ? {
                  sha256: humanEvidence.sha256,
                  verdict: humanEvidence.verdict,
                }
              : null,
          }),
        ),
        methodology,
      }),
    )
    .digest("hex");
}

export function deterministicGeneratedAt(reports) {
  const timestamps = reports
    .map((report) => report?.generatedAt)
    .filter((value) => typeof value === "string")
    .sort();
  return timestamps.at(-1) ?? null;
}

export function renderBenchmarkComparisonSummary(report) {
  const rows = report.candidates
    .map((candidate) => {
      const statuses = Object.values(candidate.metrics);
      return `| 🧠 ${escapeCell(candidate.id)} | ${verdictLabel(candidate.verdict.status)} | ${escapeCell(report.evidence.split)} (${escapeCell(report.evidence.splitRole)}) | ${report.evidence.pairedBoards} boards | ${countStatus(statuses, "improved")} | ${countStatus(statuses, "regressed")} | ${countStatus(statuses, "uncertain")} |`;
    })
    .join("\n");
  const details = report.candidates
    .map((candidate) => renderCandidate(candidate, report))
    .join("\n\n");
  return `# Play benchmark comparison

| 🧪 Candidate | 📌 Verdict | 🧾 Evidence | 📏 Sample | ✅ Improved | ⚠️ Regressed | ❓ Uncertain |
| --- | --- | --- | ---: | ---: | ---: | ---: |
${rows}

The baseline and candidates use paired deterministic boards. Same-model self-play and cross-model transfer are regression signals, not human-realism estimates.

${details}

## 📐 Decision contract

- A Play gate passes only when its existing confidence-bound threshold passes.
- A point estimate beyond a threshold blocks. A point estimate inside the threshold with a confidence bound outside it needs more data.
- Tuning splits cannot promote a candidate. Promotion requires an authorized one-time held-out artifact and a reviewed blinded human calibration pass.
- Human calibration remains a gross-failure screen, not a model ranker. The comparator records the reviewed decision without inventing a numeric threshold.
- Artifact SHA-256 hashes and the comparison fingerprint make the machine report reproducible from the same inputs.
`;
}

function renderCandidate(candidate, report) {
  const metricRows = Object.entries(candidate.metrics)
    .map(
      ([name, metric]) =>
        `| ${metricIcon(metric.status)} ${escapeCell(metric.label)} | ${formatNumber(metric.baseline)} | ${formatNumber(metric.candidate)} | ${formatSigned(metric.delta.estimate)} | ${formatInterval(metric.delta)} | ${statusLabel(metric.status)} |`,
    )
    .join("\n");
  const changes = Object.entries(candidate.configurationChanges);
  const labels = candidate.artifact.configurationLabels;
  const labelLines = labels
    ? Object.entries(labels)
        .map(([name, value]) => `- ${name}: ${value}`)
        .join("\n")
    : "- Legacy artifact without canonical configuration labels.";
  const visibleChanges = changes.slice(0, 12);
  const changeLines =
    changes.length === 0
      ? "- No reported configuration fields differ."
      : visibleChanges
          .map(
            ([field, values]) =>
              `- \`${field}\`: \`${compactValue(values.baseline)}\` to \`${compactValue(values.candidate)}\``,
          )
          .join("\n") +
        (changes.length > visibleChanges.length
          ? `\n- ${changes.length - visibleChanges.length} more exact changes are retained in the machine report.`
          : "");
  const regressions = candidate.perExampleRegressions.items;
  const regressionLines =
    regressions.length === 0
      ? "- No numeric board-level regressions were found."
      : regressions
          .map((item) => {
            const metrics = Object.values(item.metrics)
              .map(
                (metric) =>
                  `${metric.label} ${formatSigned(metric.delta)}`,
              )
              .join(", ");
            return `- Board ${item.board}: ${metrics}`;
          })
          .join("\n");
  const evidence = candidate.humanEvidence
    ? `${candidate.humanEvidence.sampleSize} blinded tasks, reviewed ${candidate.humanEvidence.verdict}`
    : "No human calibration attached";
  const reasonLines = [
    ...candidate.verdict.reasons,
    ...candidate.verdict.requiredEvidence,
  ]
    .map((reason) => `- ${reason}`)
    .join("\n");
  return `## ${verdictEmoji(candidate.verdict.status)} ${escapeHeading(candidate.id)}

- 📌 Verdict: ${candidate.verdict.status}
- 🧾 Evidence: ${report.evidence.pairedBoards} paired ${report.evidence.split} boards, 95% paired bootstrap intervals, ${report.methodology.bootstrapIterations.toLocaleString("en-US")} iterations
- 👥 Human evidence: ${evidence}
- 🔐 Candidate artifact: \`${candidate.artifact.sha256}\`

| 📏 Metric | 📍 Baseline | 🧪 Candidate | Δ Candidate | 📐 95% interval | 📌 Status |
| --- | ---: | ---: | ---: | --- | --- |
${metricRows}

### 🔧 Configuration changes

${labelLines}

${changeLines}

### ⚠️ Board-level regressions

Showing ${candidate.perExampleRegressions.displayed} of ${candidate.perExampleRegressions.totalWithRegression} boards with at least one numeric regression.

${regressionLines}

### 📌 Decision evidence

${reasonLines || "- All required evidence passed."}`;
}

function splitRole(split) {
  return SPLIT_ROLES[split] ?? "unspecified";
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function flattenConfiguration(value, path = "", result = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenConfiguration(item, `${path}[${index}]`, result);
    });
    if (value.length === 0) result.set(path, []);
    return result;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    for (const [key, item] of entries) {
      flattenConfiguration(
        item,
        path ? `${path}.${key}` : key,
        result,
      );
    }
    if (entries.length === 0) result.set(path, {});
    return result;
  }
  result.set(path, value);
  return result;
}

function legacyConfigurationChanges(
  baselineMethodology,
  candidateMethodology,
) {
  const fields = [
    "modelId",
    "model",
    "provider",
    "candidateCount",
    "clueSelection",
    "bonusGuesses",
    "operativeModelId",
    "operativeModel",
    "operativeAggression",
    "operativeNoise",
    "missedTargetTiming",
    "repeatedClues",
    "operativeRanking",
    "reranker",
  ];
  const changes = {};
  for (const field of fields) {
    const baseline = baselineMethodology?.[field] ?? null;
    const candidate = candidateMethodology?.[field] ?? null;
    if (stableJson(baseline) !== stableJson(candidate)) {
      changes[field] = { baseline, candidate };
    }
  }
  return changes;
}

function countStatus(metrics, status) {
  return metrics.filter((metric) => metric.status === status).length;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

function formatInterval(delta) {
  return `[${formatSigned(delta.lower)}, ${formatSigned(delta.upper)}]`;
}

function metricIcon(status) {
  return {
    improved: "✅",
    regressed: "⚠️",
    unchanged: "⏸️",
    changed: "↕️",
    uncertain: "❓",
  }[status];
}

function statusLabel(status) {
  return {
    improved: "🟢 Improved",
    regressed: "🔴 Regressed",
    unchanged: "⚪ Unchanged",
    changed: "🔵 Changed",
    uncertain: "🟡 Uncertain",
  }[status];
}

function verdictEmoji(status) {
  return {
    promote: "✅",
    block: "🚫",
    "needs-more-data": "⬜",
  }[status];
}

function verdictLabel(status) {
  return `${verdictEmoji(status)} ${status}`;
}

function compactValue(value) {
  const text = stableJson(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function readPath(value, path) {
  return path
    .split(".")
    .reduce(
      (current, part) =>
        current && Object.hasOwn(current, part)
          ? current[part]
          : undefined,
      value,
    );
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function escapeHeading(value) {
  return String(value).replaceAll("#", "\\#");
}
