import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const INPUT_ROOT = resolve(
  ROOT,
  ".cache/subscription-cli-benchmark",
);
const OUTPUT_DIRECTORY = resolve(
  ROOT,
  "docs/evaluations/subscription-cli-reranker",
);
const MODELS = Object.freeze([
  { id: "codex-sol", label: "GPT-5.6 Sol" },
  { id: "codex-terra", label: "GPT-5.6 Terra" },
  { id: "claude-opus", label: "Claude Opus" },
]);
const SCREENS = Object.freeze([
  { id: "smoke", label: "Same-model smoke" },
  { id: "development", label: "Same-model development" },
  { id: "transfer-smoke", label: "MiniLM-L6 transfer smoke" },
]);

const models = [];
for (const model of MODELS) {
  const screens = [];
  for (const screen of SCREENS) {
    screens.push(await readScreen(model, screen));
  }
  const stats = aggregateStats(screens.map(({ requests }) => requests));
  for (const screen of screens) {
    delete screen.requests.latencyValues;
  }
  models.push({
    ...model,
    availability: "available",
    overallStatus: screens.some(({ verdict }) => verdict === "block")
      ? "block"
      : "needs-more-data",
    identity: screens[0].identity,
    requests: stats,
    screens,
  });
}

const humanGold = {
  status: "unavailable",
  blocker:
    "No reviewed source contains paired baseline and CLI-candidate judgments for selecting one clue from the same frozen embedding shortlist.",
  heldOutCalibrationConsumed: false,
  inspected: await Promise.all([
    reference(
      "scripts/generated/human-data-embedding-comparison.json",
      "Listener ranking after a fixed clue, not spymaster clue selection.",
    ),
    reference(
      "public/data/calibration/embedding-finalists-v1.json",
      "Sealed fixed-clue calibration tasks with no CLI candidate cases.",
    ),
    reference(
      "scripts/generated/calibration-answer-keys/embedding-finalists-v1.json",
      "Held-out answer key, not consumed by this screen.",
    ),
    reference(
      "docs/evaluations/operative-ranking/concept-ranking-evaluation.json",
      "Operative card ranking after a fixed clue.",
    ),
    reference(
      "docs/evaluations/operative-ranking/hosted-listwise-reranker-evaluation.json",
      "Operative listwise fixture after a fixed clue.",
    ),
  ]),
};

const report = {
  schemaVersion: 1,
  artifactKind: "subscription-cli-clue-reranker-screen",
  generatedAt: [...models]
    .flatMap(({ screens }) => screens.map(({ generatedAt }) => generatedAt))
    .sort()
    .at(-1),
  scientificBoundary: {
    apiRequests: false,
    apiKeysInherited: false,
    subscriptionCliOnly: true,
    heldOutTestConsumed: false,
    promotionEvidence: false,
    productionAvailabilityClaim: false,
    providerFallback: false,
    apiSpendCapUsd: 5,
    runtimeBoundary:
      "The web application cannot invoke coding subscription CLIs during normal play.",
  },
  protocol: {
    promptVersion: 1,
    shortlistVersion: "play-safe-shortlist-v1",
    casesPerRequest: 1,
    samePromptAcrossModels: true,
    fixedBoardSplits: {
      smoke: 20,
      development: 128,
      transferSmoke: 20,
      heldOutTest: 0,
    },
  },
  humanGold,
  discardedPilot: {
    acceptedAsEvidence: false,
    reason:
      "An initial simultaneous three-model pilot hit subscription connection failures and used schedule-dependent batching with incomplete cache provenance. A corrected Sol trial at four concurrent requests also stopped after repeated connection refusals. Both incomplete attempts were replaced by the corrected one-case, two-request protocol.",
  },
  models,
  conclusion: {
    status: models.every(({ overallStatus }) => overallStatus === "block")
      ? "no-promising-cli-candidate"
      : "research-signal-only",
    heldOutAuthorized: false,
    promotionDeclared: false,
  },
};

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeFile(
  resolve(OUTPUT_DIRECTORY, "subscription-cli-reranker-screen.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  resolve(OUTPUT_DIRECTORY, "subscription-cli-reranker-screen.md"),
  renderMarkdown(report),
);
console.log(
  `Wrote ${relative(ROOT, OUTPUT_DIRECTORY)}/subscription-cli-reranker-screen.{json,md}`,
);

async function readScreen(model, screen) {
  const directory = resolve(INPUT_ROOT, model.id);
  const reportPath = resolve(directory, `${screen.id}.json`);
  const comparisonPath = resolve(
    directory,
    `${screen.id}-comparison.json`,
  );
  const logPath = resolve(directory, `${screen.id}.log`);
  const [reportArtifact, comparisonArtifact, log] = await Promise.all([
    readArtifact(reportPath),
    readArtifact(comparisonPath),
    readFile(logPath, "utf8"),
  ]);
  const candidate = comparisonArtifact.json.candidates.find(
    ({ id }) => id === model.id,
  );
  if (!candidate) {
    throw new Error(
      `${relative(ROOT, comparisonPath)} has no ${model.id} candidate.`,
    );
  }
  const reranker =
    reportArtifact.json.methodology?.subscriptionClueReranker;
  if (!reranker) {
    throw new Error(
      `${relative(ROOT, reportPath)} has no subscription CLI provenance.`,
    );
  }
  return {
    id: screen.id,
    label: screen.label,
    generatedAt: reportArtifact.json.generatedAt,
    verdict: candidate.verdict.status,
    reasons: candidate.verdict.reasons,
    identity: withoutStats(reranker),
    requests: requestSummary(reranker.stats),
    run: timingSummary(log),
    evidence: {
      split: reportArtifact.json.methodology.split,
      boardOffset: reportArtifact.json.methodology.boardOffset,
      boardCount: reportArtifact.json.methodology.boardCount,
      operativeModelId:
        reportArtifact.json.methodology.operativeModelId,
      heldOutProtocol:
        reportArtifact.json.methodology.heldOutProtocol ?? null,
    },
    configurationFingerprint:
      reportArtifact.json.configurationFingerprint,
    configurationSchema:
      reportArtifact.json.configuration?.schemaVersion,
    pinnedAssets: {
      implementation:
        reportArtifact.json.configuration.implementation.contentSha256,
      boardWords:
        reportArtifact.json.configuration.board.wordContentSha256,
      spymasterManifest:
        reportArtifact.json.configuration.spymaster.modelIndex
          .manifestSha256,
      operativeManifest:
        reportArtifact.json.configuration.operative.modelIndex
          .manifestSha256,
      conceptAssets:
        reportArtifact.json.configuration.operative.conceptBridges.asset
          ?.contentSha256 ?? null,
    },
    metrics: Object.fromEntries(
      Object.entries(candidate.metrics).map(([id, metric]) => [
        id,
        {
          baseline: metric.baseline,
          candidate: metric.candidate,
          delta: metric.delta,
          status: metric.status,
        },
      ]),
    ),
    gates: candidate.promotion.gates,
    artifacts: {
      report: artifactReference(reportArtifact),
      comparison: artifactReference(comparisonArtifact),
      baseline: {
        path: comparisonArtifact.json.baseline.path,
        sha256: comparisonArtifact.json.baseline.sha256,
        configurationFingerprint:
          comparisonArtifact.json.baseline.configurationFingerprint,
      },
      timingLog: {
        path: relative(ROOT, logPath),
        sha256: sha256(log),
      },
    },
  };
}

function requestSummary(stats) {
  const errors =
    stats.transportErrors +
    stats.parseErrors +
    stats.validationErrors +
    stats.timeoutErrors;
  return {
    requestAttempts: stats.requestAttempts,
    successfulRequests: stats.successfulRequests,
    cachedRequests: stats.cachedRequestCount,
    cases: stats.caseCount,
    retries: stats.retries,
    quotaStops: stats.quotaStops,
    errors: {
      total: errors,
      transport: stats.transportErrors,
      parse: stats.parseErrors,
      validation: stats.validationErrors,
      timeout: stats.timeoutErrors,
      rate: round(errors / Math.max(1, stats.requestAttempts)),
    },
    fallbackRate: 0,
    cacheHitRate: round(
      stats.cachedRequestCount /
        Math.max(
          1,
          stats.cachedRequestCount + stats.successfulRequests,
        ),
    ),
    latencyMs: distribution(stats.latenciesMs),
    latencyValues: stats.latenciesMs,
    usage: stats.usage,
  };
}

function aggregateStats(stats) {
  const totals = {
    requestAttempts: 0,
    successfulRequests: 0,
    cachedRequests: 0,
    cases: 0,
    retries: 0,
    quotaStops: 0,
    errors: 0,
    latencies: [],
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
  };
  for (const value of stats) {
    totals.requestAttempts += value.requestAttempts;
    totals.successfulRequests += value.successfulRequests;
    totals.cachedRequests += value.cachedRequests;
    totals.cases += value.cases;
    totals.retries += value.retries;
    totals.quotaStops += value.quotaStops;
    totals.errors += value.errors.total;
    totals.latencies.push(...value.latencyValues);
    for (const key of Object.keys(totals.usage)) {
      totals.usage[key] += value.usage[key] ?? 0;
    }
  }
  return {
    requestAttempts: totals.requestAttempts,
    successfulRequests: totals.successfulRequests,
    cachedRequests: totals.cachedRequests,
    cases: totals.cases,
    retries: totals.retries,
    quotaStops: totals.quotaStops,
    errors: totals.errors,
    errorRate: round(
      totals.errors / Math.max(1, totals.requestAttempts),
    ),
    fallbackRate: 0,
    cacheHitRate: round(
      totals.cachedRequests /
        Math.max(
          1,
          totals.cachedRequests + totals.successfulRequests,
        ),
    ),
    latencyMs: distribution(totals.latencies),
    usage: totals.usage,
  };
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    mean: round(
      sorted.reduce((sum, value) => sum + value, 0) /
        Math.max(1, sorted.length),
    ),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maximum: sorted.at(-1) ?? null,
  };
}

function timingSummary(log) {
  return {
    seconds: Number(log.match(/^\s*([\d.]+) real/m)?.[1] ?? NaN),
    maximumResidentBytes: Number(
      log.match(/^\s*(\d+)  maximum resident set size/m)?.[1] ?? NaN,
    ),
    boardVectorCache: {
      status: log.match(/Board vectors: (\w+)/u)?.[1] ?? null,
      milliseconds: Number(
        log.match(/Board vectors: \w+ in ([\d.]+) ms/u)?.[1] ?? NaN,
      ),
    },
  };
}

async function reference(path, limitation) {
  const artifact = await readArtifact(resolve(ROOT, path));
  return {
    path,
    sha256: artifact.sha256,
    limitation,
  };
}

async function readArtifact(path) {
  const bytes = await readFile(path);
  return {
    path,
    bytes,
    json: JSON.parse(bytes),
    sha256: sha256(bytes),
  };
}

function artifactReference(artifact) {
  return {
    path: relative(ROOT, artifact.path),
    sha256: artifact.sha256,
    bytes: artifact.bytes.length,
  };
}

function withoutStats(reranker) {
  const { stats: _stats, ...identity } = reranker;
  return identity;
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(quantile * sorted.length) - 1];
}

function round(value) {
  return Number(value.toFixed(6));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function renderMarkdown(value) {
  const rows = value.models
    .map(
      (model) =>
        `| 🤖 ${model.label} | ${status(model.overallStatus)} | ${status(model.screens[0].verdict)} | ${status(model.screens[1].verdict)} | ${status(model.screens[2].verdict)} | ${model.requests.requestAttempts} | ${formatMilliseconds(model.requests.latencyMs.p50)} | ${formatPercent(model.requests.errorRate)} |`,
    )
    .join("\n");
  const details = value.models
    .map((model) => {
      const screens = model.screens
        .map(
          (screen) =>
            `- ${screen.label}: ${status(screen.verdict)}, ${screen.evidence.boardCount} boards, ${screen.requests.requestAttempts} requests, p50 ${formatMilliseconds(screen.requests.latencyMs.p50)}, ${screen.run.seconds.toFixed(2)} s, peak RSS ${formatBytes(screen.run.maximumResidentBytes)}.`,
        )
        .join("\n");
      return `## 🤖 ${model.label}\n\n- Selector: \`${model.identity.selector}\` through \`${model.identity.cliVersion}\` on the \`${model.identity.subscriptionSurface}\` surface.\n- Prompt: v${model.identity.promptVersion}, shortlist \`${model.identity.shortlistVersion}\`, one case per request, ${model.identity.requestConcurrency} bounded requests, no tools, no fallback.\n- Usage: ${model.requests.usage.inputTokens.toLocaleString()} input, ${model.requests.usage.cachedInputTokens.toLocaleString()} cached input, ${model.requests.usage.cacheCreationInputTokens.toLocaleString()} cache-creation input, ${model.requests.usage.cacheReadInputTokens.toLocaleString()} cache-read input, and ${model.requests.usage.outputTokens.toLocaleString()} output tokens.\n${screens}`;
    })
    .join("\n\n");
  return `# Subscription CLI clue reranker screen\n\n| 🧠 Candidate | 🚦 Overall | 🔬 Smoke | 🛠️ Development | 🛡️ Transfer | 🔢 Requests | ⏱️ P50 | ⚠️ Error rate |\n| --- | --- | --- | --- | --- | ---: | ---: | ---: |\n${rows}\n\nThese are subscription CLI research signals. No API request, API key, sealed test board, promotion decision, or production-runtime claim is part of this report.\n\n## 👥 Human and gold evidence\n\n🚫 Unavailable. ${value.humanGold.blocker} The sealed 30-task calibration round was not consumed. Existing listener and operative artifacts remain source references only and are not attached as clue-selection evidence.\n\n${details}\n\n## 📌 Boundary\n\n- The safe embedding engine generated every six-item shortlist and the selected clue continued through the existing game engine.\n- Same-model self-play, development comparison, and MiniLM-L6 transfer remain separate.\n- A gate failure blocks even if another headline metric rises.\n- The web application cannot call these coding CLIs in normal play.\n- Any future provider API implementation remains separate and keeps the absolute $5 total spend cap.\n`;
}

function status(value) {
  return {
    block: "🔴 Block",
    "needs-more-data": "🟡 Needs data",
    promote: "🟢 Promote",
  }[value] ?? value;
}

function formatMilliseconds(value) {
  return value == null ? "N/A" : `${value.toFixed(1)} ms`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatBytes(value) {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
