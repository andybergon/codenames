import REPORT from "../../scripts/generated/play-model-comparison-v3.json" with { type: "json" };
import SETTINGS_AUDIT from "../../docs/evaluations/play-default-audit/play-default-audit.json" with { type: "json" };
import CLI_SCREEN from "../../docs/evaluations/subscription-cli-reranker/subscription-cli-reranker-screen.json" with { type: "json" };
import { benchmarkRows, validateBenchmarkReport } from "./scorecard.js";

validateBenchmarkReport(REPORT);

const AUDIT_GROUPS = [
  {
    id: "alternative-promising",
    icon: "🟡",
    label: "Worth deeper testing",
    description: "A useful development signal, but not production evidence.",
    open: true,
  },
  {
    id: "default-locally-justified",
    icon: "🟢",
    label: "Current default supported",
    description: "The tested alternative did not improve on the current default.",
    open: false,
  },
  {
    id: "uncertain",
    icon: "🟠",
    label: "No clear result",
    description: "The recorded evidence did not establish a direction.",
    open: false,
  },
];

const SCREEN_RESULTS = {
  block: { icon: "🔴", label: "Blocked" },
  "needs-more-data": { icon: "🟡", label: "Uncertain" },
  promote: { icon: "🟢", label: "Passed" },
};

const CLI_STAGE_SLOTS = [
  { id: "smoke", label: "Smoke", description: "20-board fast regression check" },
  { id: "development", label: "Development", description: "128-board tuning comparison" },
  { id: "transfer-smoke", label: "Transfer", description: "20 boards with a different operative model" },
];

export function createBenchmarkMode() {
  const root = document.querySelector("#benchmark-mode");
  if (!root) return { setActive() {} };

  root.replaceChildren(buildLearningPage());

  return {
    setActive(active) {
      root.hidden = !active;
    },
  };
}

function buildLearningPage() {
  const shell = document.createElement("div");
  shell.className = "benchmark-shell benchmark-learning";
  shell.innerHTML = `
    <header class="benchmark-heading">
      <div>
        <span class="eyebrow">Evaluation lab · local only</span>
        <h2>What the benchmarks found</h2>
        <p>Two studies tested changes against the current Play setup. Start with the conclusions, then open the evidence you want to inspect.</p>
      </div>
      <span class="benchmark-version">Report v${formatInteger(REPORT.schemaVersion)}</span>
    </header>

    ${renderTakeaways()}
    ${renderTestingStages()}
    ${renderSettingsStudy()}
    ${renderCliStudy()}
    ${renderLimitations()}
    ${renderTechnicalDetails()}
  `;
  return shell;
}

function renderTakeaways() {
  const outcomes = SETTINGS_AUDIT.summary.outcomes;
  const completed = CLI_SCREEN.summary.completedStages;
  return `
    <section class="benchmark-learning-summary" aria-labelledby="benchmark-summary-title">
      <div class="benchmark-section-heading">
        <div>
          <span class="eyebrow">Short answer</span>
          <h3 id="benchmark-summary-title">What we learned</h3>
        </div>
        <span class="benchmark-status" data-state="no-change">No production change</span>
      </div>
      <p class="benchmark-lead">The current Play setup remains the best-supported choice. ${formatInteger(outcomes["alternative-promising"])} setting changes deserve more development testing, while every tested CLI reranker was blocked at smoke.</p>
      <div class="benchmark-takeaway-grid">
        <article data-summary="settings">
          <span>Play settings</span>
          <strong>${formatInteger(SETTINGS_AUDIT.summary.candidateCount)} alternatives</strong>
          <small>${formatInteger(outcomes["default-locally-justified"])} keep default · ${formatInteger(outcomes["alternative-promising"])} worth deeper testing · ${formatInteger(outcomes.uncertain)} unclear</small>
        </article>
        <article data-summary="cli">
          <span>CLI rerankers</span>
          <strong>${formatInteger(CLI_SCREEN.summary.modelCount)} models</strong>
          <small>${formatInteger(CLI_SCREEN.summary.outcomes.block)} blocked · ${formatInteger(completed.development)} reached development</small>
        </article>
        <article data-summary="sealed">
          <span>Promotion evidence</span>
          <strong>${formatInteger(completed.heldOutTest)} sealed boards</strong>
          <small>No held-out test or rollout decision</small>
        </article>
      </div>
      <div class="benchmark-baseline-reference">
        <span>Compared with</span>
        <strong>${escapeHtml(REPORT.baseline.configurationLabels.modelIndex)}</strong>
        <span>on ${formatInteger(REPORT.evidence.pairedBoards)} development boards</span>
      </div>
    </section>`;
}

function renderTestingStages() {
  const auditStages = SETTINGS_AUDIT.summary.stages;
  const cliStages = CLI_SCREEN.summary.completedStages;
  const heldOutCount = SETTINGS_AUDIT.methodology.heldOutBoardsUsed;
  const stages = [
    {
      id: "human-gold",
      icon: "👥",
      title: "Human or gold",
      count: "Used where compatible",
      detail: "Gross-failure and alignment evidence. No paired CLI clue-selection judgments were available.",
      state: "partial",
    },
    {
      id: "smoke",
      icon: "🔥",
      title: "Smoke · 20 boards",
      count: `${formatInteger(auditStages.smoke)} settings decided here · ${formatInteger(cliStages.smoke)} CLI models completed`,
      detail: "Fast tuning screen. A clear regression stops a candidate early.",
      state: "used",
    },
    {
      id: "calibration",
      icon: "🎯",
      title: "Calibration · 100 boards",
      count: "Not used here",
      detail: "Tuning evidence only. It cannot authorize promotion.",
      state: "not-used",
    },
    {
      id: "development",
      icon: "🛠️",
      title: "Development · 128 boards",
      count: `${formatInteger(auditStages.development)} settings · ${formatInteger(cliStages.development)} CLI models`,
      detail: "Larger candidate comparison, still for tuning rather than promotion.",
      state: "used",
    },
    {
      id: "transfer",
      icon: "🔁",
      title: "Transfer · 20 boards",
      count: `${formatInteger(cliStages.transferSmoke)} CLI models`,
      detail: "A different operative model checks whether the result is fragile.",
      state: "partial",
    },
    {
      id: "held-out",
      icon: "🔒",
      title: "Sealed test · 150 boards",
      count: `${formatInteger(heldOutCount)} used`,
      detail: "Requires explicit authorization and reviewed human evidence. It was not opened.",
      state: "not-used",
    },
  ];
  return `
    <section class="benchmark-study benchmark-stage-study" aria-labelledby="benchmark-stages-title">
      <div class="benchmark-section-heading">
        <div>
          <span class="eyebrow">The route through the evidence</span>
          <h3 id="benchmark-stages-title">How testing works</h3>
        </div>
      </div>
      <div class="benchmark-stage-strip">
        ${stages.map(renderStage).join("")}
      </div>
      <p class="benchmark-evidence-note">A safety-gate failure blocks a candidate even if one headline score improves.</p>
    </section>`;
}

function renderStage(stage, index) {
  return `<article class="benchmark-stage" data-stage="${escapeHtml(stage.id)}" data-state="${escapeHtml(stage.state)}">
    <span class="benchmark-stage-number">${formatInteger(index + 1)}</span>
    <div>
      <h4>${stage.icon} ${escapeHtml(stage.title)}</h4>
      <strong>${escapeHtml(stage.count)}</strong>
      <p>${escapeHtml(stage.detail)}</p>
    </div>
  </article>`;
}

function renderSettingsStudy() {
  const outcomes = SETTINGS_AUDIT.summary.outcomes;
  return `
    <section class="benchmark-study" aria-labelledby="benchmark-settings-title">
      <div class="benchmark-section-heading">
        <div>
          <span class="eyebrow">Study 1 · Play settings</span>
          <h3 id="benchmark-settings-title">One change at a time</h3>
          <p>${escapeHtml(SETTINGS_AUDIT.methodology.design)}</p>
        </div>
        <span class="benchmark-status" data-state="tuning">Tuning only</span>
      </div>
      <div class="benchmark-outcome-split" role="group" aria-label="Settings study outcomes">
        ${AUDIT_GROUPS.map(
          (group) => `<span data-state="${escapeHtml(group.id)}"><strong>${formatInteger(outcomes[group.id])}</strong> ${escapeHtml(group.label)}</span>`,
        ).join("")}
      </div>
      <div class="benchmark-outcome-groups">
        ${AUDIT_GROUPS.map(renderAuditGroup).join("")}
      </div>
      <p class="benchmark-evidence-note">${escapeHtml(SETTINGS_AUDIT.methodology.interactionLimitation)}</p>
    </section>`;
}

function renderAuditGroup(group) {
  const rows = SETTINGS_AUDIT.candidates.filter(
    (row) => row.assessment.status === group.id,
  );
  if (rows.length === 0) return "";
  return `<details class="benchmark-outcome-group" data-outcome-group="${escapeHtml(group.id)}" ${group.open ? "open" : ""}>
    <summary>
      <span>${group.icon} <strong>${escapeHtml(group.label)}</strong> <small>${escapeHtml(group.description)}</small></span>
      <b>${formatInteger(SETTINGS_AUDIT.summary.outcomes[group.id])}</b>
    </summary>
    <div class="benchmark-setting-list">
      ${rows.map(renderAuditResult).join("")}
    </div>
  </details>`;
}

function renderAuditResult(row) {
  return `<article class="benchmark-setting-result" data-audit-result="${escapeHtml(row.assessment.status)}">
    <div class="benchmark-setting-result-heading">
      <div>
        <span>${escapeHtml(row.setting)}</span>
        <h4>${escapeHtml(row.alternative)}</h4>
      </div>
      <span class="benchmark-status" data-state="${escapeHtml(row.assessment.status)}">${escapeHtml(auditLabel(row.assessment.status))}</span>
    </div>
    <p>${escapeHtml(row.assessment.note)}</p>
    <div class="benchmark-result-meta">
      <span><b>${escapeHtml(humanize(row.phase))}</b>${formatInteger(row.boardCount)} boards</span>
      <span><b>Metrics</b>${formatInteger(row.metricStatus.improved)} improved · ${formatInteger(row.metricStatus.regressed)} regressed · ${formatInteger(row.metricStatus.uncertain)} uncertain</span>
      <span><b>Human or gold</b>${escapeHtml(humanScreenLabel(row.humanScreen.status))}</span>
    </div>
    <details class="benchmark-result-evidence">
      <summary>Evidence and configuration</summary>
      <p><strong>Human or gold evidence:</strong> ${escapeHtml(row.humanScreen.note)}</p>
      ${renderAuditConfiguration(row)}
    </details>
  </article>`;
}

function renderAuditConfiguration(row) {
  const artifact = row.artifacts.candidate;
  return `<div class="benchmark-setting-chips">
    ${Object.entries(artifact.configurationLabels)
      .map(
        ([label, value]) => `<span><b>${escapeHtml(humanize(label))}</b>${escapeHtml(value)}</span>`,
      )
      .join("")}
    <span class="benchmark-wide-chip"><b>fingerprint</b><code>${escapeHtml(artifact.configurationFingerprint)}</code></span>
  </div>`;
}

function renderCliStudy() {
  return `
    <section class="benchmark-study" aria-labelledby="benchmark-cli-title">
      <div class="benchmark-section-heading">
        <div>
          <span class="eyebrow">Study 2 · LLM rerankers</span>
          <h3 id="benchmark-cli-title">Could a coding CLI pick better clues?</h3>
          <p>Each model reranked the same safe embedding shortlist. All ${formatInteger(CLI_SCREEN.summary.modelCount)} were blocked before any sealed test.</p>
        </div>
        <span class="benchmark-status" data-state="block">No rollout</span>
      </div>
      ${renderMetricGuide()}
      <div class="benchmark-cli-models">
        ${CLI_SCREEN.models.map(renderCliModel).join("")}
      </div>
      <p class="benchmark-evidence-note">${escapeHtml(CLI_SCREEN.scientificBoundary.runtimeBoundary)}</p>
    </section>`;
}

function renderMetricGuide() {
  return `<div class="benchmark-score-guide" role="group" aria-label="How to read the scores">
    <article><strong>Score</strong><span>Correct cards per turn. Higher is better.</span></article>
    <article><strong>Change</strong><span>Model score minus the current default.</span></article>
    <article><strong>95% range</strong><span>The likely range. Crossing zero means uncertain.</span></article>
    <article><strong>Safety checks</strong><span>Assassin, wrong-team, neutral, fallback, and stall gates can block.</span></article>
  </div>`;
}

function renderCliModel(model) {
  const overall = SCREEN_RESULTS[model.overallStatus] ?? SCREEN_RESULTS["needs-more-data"];
  return `<article class="benchmark-cli-model" data-cli-model="${escapeHtml(model.id)}">
    <div class="benchmark-cli-model-heading">
      <div>
        <h4>🤖 ${escapeHtml(model.label)}</h4>
        <p>${escapeHtml(model.identity.resolvedModel ?? model.identity.selector)}</p>
      </div>
      <span class="benchmark-status" data-state="${escapeHtml(model.overallStatus)}">${overall.icon} ${overall.label}</span>
    </div>
    ${renderCliCost(model)}
    <div class="benchmark-cli-stage-grid">
      ${CLI_STAGE_SLOTS.map((slot) => renderCliStage(model, slot)).join("")}
    </div>
    ${renderRunNotes(model)}
  </article>`;
}

function renderCliCost(model) {
  const economics = model.economics;
  if (economics?.status !== "measured") {
    return `<p class="benchmark-cli-cost"><strong>Cost unavailable</strong><span>${escapeHtml(economics?.reason ?? "No matching subscription rate is recorded.")}</span></p>`;
  }
  return `<p class="benchmark-cli-cost">
    <strong>💳 ≈${formatUsd(economics.apiEquivalent.usdPerGame)}/game · ${formatCredits(economics.creditsPerGame)} credits/game</strong>
    <span>API-equivalent estimate from ${formatInteger(economics.completedGames)} completed games · <a href="${escapeHtml(economics.apiEquivalent.rateCard.sourceUrl)}" target="_blank" rel="noreferrer">API pricing</a></span>
  </p>`;
}

function renderCliStage(model, slot) {
  const screen = model.screens.find((item) => item.id === slot.id);
  if (!screen) return renderMissingCliStage(model, slot);
  const metric = screen.metrics.correctCardsPerTurn;
  const result = SCREEN_RESULTS[screen.verdict] ?? SCREEN_RESULTS["needs-more-data"];
  const reason =
    screen.reasons?.[0] ??
    (screen.verdict === "needs-more-data"
      ? "The report marks this stage uncertain and records no single reason."
      : "No blocking reason was recorded.");
  return `<section class="benchmark-cli-stage" data-cli-stage="${escapeHtml(slot.id)}" data-state="${escapeHtml(screen.verdict)}">
    <div class="benchmark-cli-stage-heading">
      <div><span>${escapeHtml(slot.label)}</span><small>${formatInteger(screen.evidence.boardCount)} boards</small></div>
      <span class="benchmark-status" data-state="${escapeHtml(screen.verdict)}">${result.icon} ${result.label}</span>
    </div>
    <div class="benchmark-score-comparison">
      <span><small>Current</small><strong>${formatStudyNumber(metric.baseline)}</strong></span>
      <span><small>Model</small><strong>${formatStudyNumber(metric.candidate)}</strong></span>
      <span><small>Change</small><strong class="benchmark-delta" data-state="${escapeHtml(metric.status)}">${formatStudySigned(metric.delta.estimate)}</strong></span>
    </div>
    <p><strong>95% range:</strong> ${formatStudyInterval(metric.delta)}</p>
    <p>${escapeHtml(reason)}</p>
    ${renderSelectionDiagnostics(screen.selectionDiagnostics)}
    <details class="benchmark-result-evidence">
      <summary>Exact recorded values</summary>
      <dl class="benchmark-exact-values">
        <div><dt>Current</dt><dd>${formatNumber(metric.baseline)}</dd></div>
        <div><dt>Model</dt><dd>${formatNumber(metric.candidate)}</dd></div>
        <div><dt>Change</dt><dd>${formatSigned(metric.delta.estimate)}</dd></div>
        <div><dt>95% range</dt><dd>${formatInterval(metric.delta)}</dd></div>
        <div><dt>Configuration</dt><dd><code>${escapeHtml(screen.configurationFingerprint)}</code></dd></div>
      </dl>
    </details>
  </section>`;
}

function renderSelectionDiagnostics(diagnostics) {
  if (!diagnostics) return "";
  return `<p class="benchmark-selection-diagnostics"><strong>Clue ambition:</strong> multi-card clues ${formatPercent(diagnostics.multiClueRate.baseline)} → ${formatPercent(diagnostics.multiClueRate.candidate)}, first-half clue number ${formatStudyNumber(diagnostics.firstHalfMeanClueNumber.baseline)} → ${formatStudyNumber(diagnostics.firstHalfMeanClueNumber.candidate)}, passes/game ${formatStudyNumber(diagnostics.passesPerGame.baseline)} → ${formatStudyNumber(diagnostics.passesPerGame.candidate)}.</p>`;
}

function renderMissingCliStage(model, slot) {
  const interruption = model.interruptions?.find(
    (item) => item.failedScreen === slot.id,
  );
  let reason = "This stage was not run.";
  if (interruption?.class === "monthly-subscription-limit") {
    reason = `Stopped at the monthly subscription limit after ${formatDuration(interruption.run.seconds)}.`;
  } else if (slot.id === "transfer-smoke") {
    reason = "Not run because the earlier development stage did not complete.";
  }
  return `<section class="benchmark-cli-stage" data-cli-stage="${escapeHtml(slot.id)}" data-state="not-run">
    <div class="benchmark-cli-stage-heading">
      <div><span>${escapeHtml(slot.label)}</span><small>${escapeHtml(slot.description)}</small></div>
      <span class="benchmark-status" data-state="not-run">⚪ Not run</span>
    </div>
    <p>${escapeHtml(reason)}</p>
  </section>`;
}

function renderRunNotes(model) {
  const interruptions = model.interruptions ?? [];
  const limitations = model.measurementLimitations ?? [];
  if (interruptions.length === 0 && limitations.length === 0) return "";
  return `<details class="benchmark-run-notes">
    <summary>Run notes</summary>
    ${
      interruptions.length > 0
        ? `<h5>Interruptions</h5><ul>${interruptions
            .map(
              (item) => `<li><strong>${escapeHtml(humanize(item.failedScreen))}:</strong> ${escapeHtml(humanize(item.class))} after ${formatDuration(item.run.seconds)}</li>`,
            )
            .join("")}</ul>`
        : ""
    }
    ${
      limitations.length > 0
        ? `<h5>Measurement limitations</h5><ul>${limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : ""
    }
  </details>`;
}

function renderLimitations() {
  return `<section class="benchmark-limitations" aria-labelledby="benchmark-limitations-title">
    <div class="benchmark-section-heading">
      <div>
        <span class="eyebrow">Read the boundary</span>
        <h3 id="benchmark-limitations-title">What this evidence cannot show</h3>
      </div>
    </div>
    <ul>
      <li><strong>No sealed test:</strong> neither study used held-out promotion boards.</li>
      <li><strong>No paired CLI human evidence:</strong> the available human and gold data did not judge these models choosing from the same frozen shortlist.</li>
      <li><strong>No settings matrix:</strong> the settings audit changed one factor at a time and did not test interactions.</li>
      <li><strong>No runtime claim:</strong> subscription coding CLIs are a research surface, not a Play dependency.</li>
    </ul>
  </section>`;
}

function renderTechnicalDetails() {
  const candidates = benchmarkRows(REPORT);
  return `<details class="benchmark-technical">
    <summary>Technical details and provenance</summary>
    <div class="benchmark-technical-grid">
      <section>
        <h4>Accepted baseline</h4>
        <div class="benchmark-setting-chips">
          ${Object.entries(REPORT.baseline.configurationLabels)
            .map(([label, value]) => `<span><b>${escapeHtml(humanize(label))}</b>${escapeHtml(value)}</span>`)
            .join("")}
          <span class="benchmark-wide-chip"><b>fingerprint</b><code>${escapeHtml(REPORT.baseline.configurationFingerprint)}</code></span>
        </div>
      </section>
      <section>
        <h4>Checked artifacts</h4>
        <dl class="benchmark-artifact-list">
          <div><dt>Canonical report</dt><dd><code>${escapeHtml(REPORT.comparisonFingerprint)}</code></dd></div>
          <div><dt>Settings audit</dt><dd><code>${escapeHtml(SETTINGS_AUDIT.reportSha256)}</code></dd></div>
          <div><dt>Canonical candidates</dt><dd>${formatInteger(candidates.length)}</dd></div>
        </dl>
      </section>
      <section>
        <h4>Research boundaries</h4>
        <p>${escapeHtml(CLI_SCREEN.humanGold.blocker)}</p>
        <p>${escapeHtml(SETTINGS_AUDIT.methodology.interactionLimitation)}</p>
      </section>
    </div>
  </details>`;
}

function auditLabel(status) {
  return AUDIT_GROUPS.find((group) => group.id === status)?.label ?? humanize(status);
}

function humanScreenLabel(status) {
  const labels = {
    "baseline-favored": "Current default favored",
    "alternative-favored": "Alternative favored",
    "not-applicable": "Not available",
  };
  return labels[status] ?? humanize(status);
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "Not recorded";
}

function formatStudyNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "Not recorded";
}

function formatCredits(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "Not recorded";
}

function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(3)}` : "Not recorded";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "Not recorded";
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return "Not recorded";
  return `${value > 0 ? "+" : ""}${value.toFixed(4)}`;
}

function formatStudySigned(value) {
  if (!Number.isFinite(value)) return "Not recorded";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatInterval(value) {
  if (!value || !Number.isFinite(value.lower) || !Number.isFinite(value.upper)) {
    return "Not recorded";
  }
  return `[${formatSigned(value.lower)}, ${formatSigned(value.upper)}]`;
}

function formatStudyInterval(value) {
  if (!value || !Number.isFinite(value.lower) || !Number.isFinite(value.upper)) {
    return "Not recorded";
  }
  return `${formatStudySigned(value.lower)} to ${formatStudySigned(value.upper)}`;
}

function formatInteger(value) {
  return Number.isFinite(value)
    ? Math.round(value).toLocaleString("en")
    : "Not recorded";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "an unrecorded duration";
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  return `${(seconds / 60).toFixed(1)} minutes`;
}

function humanize(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
