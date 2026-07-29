import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(ROOT, ".cache/benchmark-audit");
const OUTPUT = resolve(
  ROOT,
  "docs/evaluations/play-default-audit/play-default-audit.json",
);
const MARKDOWN = OUTPUT.replace(/\.json$/u, ".md");
const CANDIDATES = [
  candidate("model-minilm-l6", "Embedding model", "MiniLM-L6", "human"),
  candidate("model-minilm-l3", "Embedding model", "MiniLM-L3", "human"),
  candidate("vocabulary-3k", "Clue vocabulary", "3,000", "coverage"),
  candidate("vocabulary-10k", "Clue vocabulary", "10,000", "coverage"),
  candidate("vocabulary-100k", "Clue vocabulary", "100,000", "coverage"),
  candidate("clue-policy-current", "Clue scoring", "Conservative"),
  candidate("clue-repeat-previous", "Clue reuse", "Previous only"),
  candidate("clue-repeat-allow", "Clue reuse", "Allow repeats"),
  candidate("multi-tolerance-0", "Prefer multi-card clues", "Off"),
  candidate("multi-tolerance-10", "Prefer multi-card clues", "Strong"),
  candidate("missed-target-balanced", "Retry missed targets", "Mid-game"),
  candidate("missed-target-immediate", "Retry missed targets", "Immediately"),
  candidate(
    "aggression-conservative",
    "Operative aggression",
    "Conservative",
  ),
  candidate("aggression-aggressive", "Operative aggression", "Aggressive"),
  candidate("concept-bridges-off", "Concept bridges", "Off", "gold"),
  candidate("operative-noise-standard", "Guess variation", "Standard"),
  candidate("bonus-guesses-allow", "Extra guess", "Allow"),
];

const rows = [];
for (const definition of CANDIDATES) {
  const development = await optionalJson(
    resolve(CACHE, definition.id, "development-comparison.json"),
  );
  const smoke = await optionalJson(
    resolve(CACHE, definition.id, "smoke-comparison.json"),
  );
  const comparison = development ?? smoke;
  if (!comparison) {
    throw new Error(`Missing audit comparison for ${definition.id}.`);
  }
  const candidateReport = comparison.candidates[0];
  const summary = comparison.summary.candidates[0];
  const phase = development ? "development" : "smoke";
  const log = await readFile(
    resolve(CACHE, "logs", `${definition.id}-${phase}.log`),
    "utf8",
  );
  const humanScreen = humanScreenFor(definition);
  const assessment = assess({
    definition,
    humanScreen,
    phase,
    summary,
  });
  rows.push({
    ...definition,
    phase,
    boardCount: comparison.evidence.pairedBoards,
    verdict: candidateReport.verdict.status,
    metricStatus: summary.playMetrics,
    gateStatus: Object.fromEntries(
      Object.entries(candidateReport.promotion.gates).map(([id, gate]) => [
        id,
        gate.status,
      ]),
    ),
    humanScreen,
    assessment,
    timing: timingFromLog(log),
    artifacts: {
      candidate: candidateReport.artifact,
      comparisonFingerprint: comparison.comparisonFingerprint,
    },
  });
}

const report = {
  schemaVersion: 1,
  generatedAt: rows
    .map(({ artifacts }) => artifacts.candidate.generatedAt)
    .sort()
    .at(-1),
  title: "English Play default one-factor audit",
  baseline: {
    id: "accepted-production-development",
    artifact:
      "scripts/generated/play-accepted-baseline-development.json",
    sha256:
      "4d4bf6e12354c865f4db933925fe207fff816bc3f689e0f4fb6e908d1857085e",
    configurationFingerprint:
      "cf888693ae7567c012460f8b697231911be13352d88a7e122d4cb19879c3633b",
  },
  methodology: {
    design:
      "One alternative at a time against the frozen accepted English production configuration.",
    screening:
      "Use existing compatible human or gold evidence, then fixed smoke. Smoke gate failures do not consume development boards.",
    developmentBoards: 128,
    heldOutBoardsUsed: 0,
    promotionClaim: false,
    interactionLimitation:
      "This audit tests local alternatives only. It cannot establish global optimality because setting interactions and Cartesian combinations remain untested.",
  },
  workerPools: {
    recommended: 6,
    sixWorkerTrial: {
      peakObservedCpuPercent: 603.3,
      peakObservedResidentMiB: 3657.3,
      loadAverageOneMinute: 7.39,
      responsive: true,
    },
    eightWorkerTrial: {
      peakObservedCpuPercent: 884.8,
      peakObservedResidentMiB: 4660.8,
      loadAverageOneMinute: 9.4,
      responsive: true,
      conclusion:
        "Safe for a bounded trial, but slower per worker. Keep six as the default.",
    },
    cacheInputsImmutable: true,
    isolatedCandidateArtifacts: true,
  },
  candidates: rows,
};
report.reportSha256 = sha256(
  JSON.stringify({ ...report, reportSha256: undefined }),
);

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(MARKDOWN, renderMarkdown(report));
console.log(`Wrote ${OUTPUT}`);
console.log(`Wrote ${MARKDOWN}`);

function candidate(id, setting, alternative, screen = "none") {
  return { id, setting, alternative, screen };
}

function humanScreenFor(definition) {
  if (definition.screen === "human") {
    return {
      status: "baseline-favored",
      source: "scripts/generated/embedding-model-comparison.json",
      note:
        "The accepted centered BGE-small model has stronger aggregate human target recall and lower Cultural Codes avoid-word rate than the selectable MiniLM alternatives.",
    };
  }
  if (definition.screen === "coverage") {
    const coverage = {
      "vocabulary-3k": 0.621,
      "vocabulary-10k": 0.8547,
      "vocabulary-100k": 0.9627,
    }[definition.id];
    return {
      status:
        definition.id === "vocabulary-100k"
          ? "alternative-favored"
          : "baseline-favored",
      source: "scripts/generated/candidate-coverage.json",
      observationCoverage: coverage,
      baselineObservationCoverage: 0.9389,
      note:
        "Exact human-clue vocabulary coverage is a screening signal, not end-to-end ranking evidence.",
    };
  }
  if (definition.screen === "gold") {
    return {
      status: "baseline-favored",
      source:
        "docs/evaluations/operative-ranking/concept-ranking-evaluation.json",
      note:
        "The guarded WordNet bridge fixes the frozen JOUST association regression; direct ranking does not.",
    };
  }
  return {
    status: "not-applicable",
    source: null,
    note:
      "No compatible source-separated human or gold artifact isolates this single Play behavior setting.",
  };
}

function assess({ definition, humanScreen, phase, summary }) {
  const counts = summary.playMetrics;
  if (summary.verdict === "block" || counts.regressed > 0) {
    return {
      status: "default-locally-justified",
      note: `${phase} evidence blocks or regresses the alternative.`,
    };
  }
  if (
    humanScreen.status === "baseline-favored" &&
    counts.improved === 0
  ) {
    return {
      status: "default-locally-justified",
      note:
        "Compatible human or gold evidence favors the default and paired gameplay shows no established improvement.",
    };
  }
  if (counts.improved > 0 && counts.regressed === 0) {
    return {
      status: "alternative-promising",
      note:
        "The alternative improves at least one paired metric without an established regression, but remains tuning evidence.",
    };
  }
  if (
    definition.id === "vocabulary-100k" &&
    humanScreen.status === "alternative-favored"
  ) {
    return {
      status: "alternative-promising",
      note:
        "Human clue coverage favors the larger vocabulary, subject to its measured runtime and memory cost.",
    };
  }
  return {
    status: "uncertain",
    note:
      "The available paired evidence does not establish a local improvement or regression.",
  };
}

function timingFromLog(log) {
  const cache = log.match(
    /Board vectors: (hit|miss|precomputed) in ([\d.]+) ms\./u,
  );
  const real = log.match(/^\s*([\d.]+) real\s/mu);
  const rss = log.match(/^\s*(\d+)\s+maximum resident set size$/mu);
  return {
    vectorCache: cache?.[1] ?? "unknown",
    vectorMilliseconds: Number(cache?.[2] ?? NaN),
    wallSeconds: Number(real?.[1] ?? NaN),
    peakResidentBytes: Number(rss?.[1] ?? NaN),
  };
}

function renderMarkdown(report) {
  const rows = report.candidates
    .map(
      (row) =>
        `| 🧪 ${row.setting} | ${statusLabel(row.assessment.status)} | ${row.alternative} | ${row.phase} ${row.boardCount} | ${row.metricStatus.improved} | ${row.metricStatus.regressed} | ${row.metricStatus.uncertain} |`,
    )
    .join("\n");
  return `# English Play default one-factor audit

| 🧪 Setting | 📌 Local result | 🔧 Alternative | 🧾 Evidence | ✅ Improved | ⚠️ Regressed | ❓ Uncertain |
| --- | --- | --- | --- | ---: | ---: | ---: |
${rows}

## Boundaries

- The accepted baseline is ${report.baseline.configurationFingerprint}.
- No held-out boards were used and no promotion is claimed.
- Candidates change one visible behavior setting at a time. Setting interactions and the Cartesian matrix remain untested, so this cannot establish global optimality.
- Six workers remain the recommended pool. The eight-worker trial stayed responsive but reduced per-worker throughput.
`;
}

function statusLabel(status) {
  return {
    "default-locally-justified": "🟢 Default justified",
    "alternative-promising": "🟡 Alternative promising",
    uncertain: "🟠 Uncertain",
  }[status];
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
