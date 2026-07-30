import REPORT from "../../scripts/generated/play-model-comparison-v3.json" with { type: "json" };
import SETTINGS_AUDIT from "../../docs/evaluations/play-default-audit/play-default-audit.json" with { type: "json" };
import CLI_SCREEN from "../../docs/evaluations/subscription-cli-reranker/subscription-cli-reranker-screen.json" with { type: "json" };
import {
  benchmarkRows,
  humanAlignmentSlices,
  validateBenchmarkReport,
} from "./scorecard.js";
import { createInfoControl } from "../info-control.js";

validateBenchmarkReport(REPORT);

const VERDICTS = {
  promote: {
    icon: "✅",
    label: "Promote",
    detail: "All recorded promotion requirements passed.",
  },
  block: {
    icon: "🚫",
    label: "Blocked",
    detail: "At least one recorded promotion requirement failed.",
  },
  "needs-more-data": {
    icon: "⬜",
    label: "Needs evidence",
    detail: "The report identifies evidence still required.",
  },
};

const METRIC_STATUS = {
  improved: ["🟢", "Improved"],
  regressed: ["🔴", "Regressed"],
  uncertain: ["🟡", "Uncertain"],
  unchanged: ["⚪", "Unchanged"],
  changed: ["🔵", "Changed"],
  reported: ["🔵", "Reported"],
};

const AUDIT_ASSESSMENTS = {
  "default-locally-justified": {
    icon: "🟢",
    label: "Default justified",
    detail: "The tested alternative did not beat the accepted default locally.",
  },
  "alternative-promising": {
    icon: "🟡",
    label: "Promising signal",
    detail: "The alternative showed a tuning signal, not promotion evidence.",
  },
  uncertain: {
    icon: "🟠",
    label: "Uncertain",
    detail: "The recorded evidence did not establish a direction.",
  },
};

const SCREEN_RESULTS = {
  block: ["🚫", "Blocked"],
  "needs-more-data": ["⬜", "Needs evidence"],
  promote: ["✅", "Passed"],
};

const AUDIT_SCREEN_RESULTS = {
  "baseline-favored": ["🟢", "Default favored"],
  "alternative-favored": ["🟡", "Alternative favored"],
  "not-applicable": ["⚪", "Not available"],
};

const COLUMN_INFO = [
  {
    id: "configuration",
    label: "Configuration",
    info: "One candidate configuration from the canonical v3 report. The report stores the exact configuration, fingerprint, artifact hash, and changed behavior fields.",
  },
  {
    id: "verdict",
    label: "Verdict",
    info: "The CLI-owned final verdict. The page displays it without recalculating gates or promotion eligibility.",
  },
  {
    id: "evidence",
    label: "Evidence",
    info: "The fixed paired board split and sample size recorded by the canonical report.",
  },
  {
    id: "improved",
    label: "Improved",
    info: "Metrics whose full paired 95% interval clears zero in the preferred direction.",
  },
  {
    id: "regressed",
    label: "Regressed",
    info: "Metrics whose full paired 95% interval clears zero in the worse direction.",
  },
  {
    id: "uncertain",
    label: "Uncertain",
    info: "Metrics whose paired interval does not establish a clear direction.",
  },
  {
    id: "human",
    label: "Human sources",
    info: "Source-separated aggregate or blinded human evidence slices. Tuning and feedback slices cannot promote.",
  },
];

export function createBenchmarkMode() {
  const root = document.querySelector("#benchmark-mode");
  if (!root) return { setActive() {} };

  const rows = benchmarkRows(REPORT);
  let activeCandidateId = rows[0]?.id ?? null;
  let verdictFilter = "all";
  let sortBy = "verdict";
  let activeTab = "scorecard";

  root.replaceChildren(buildShell());
  attachColumnInfo(root);
  const elements = {
    summary: root.querySelector("#benchmark-summary"),
    body: root.querySelector("#benchmark-table-body"),
    empty: root.querySelector("#benchmark-empty"),
    details: root.querySelector("#benchmark-details"),
    filter: root.querySelector("#benchmark-filter"),
    sort: root.querySelector("#benchmark-sort"),
    tabs: [...root.querySelectorAll("[data-benchmark-tab]")],
    panels: [...root.querySelectorAll("[data-benchmark-panel]")],
  };

  elements.filter.addEventListener("change", () => {
    verdictFilter = elements.filter.value;
    renderTable();
  });
  elements.sort.addEventListener("change", () => {
    sortBy = elements.sort.value;
    renderTable();
  });
  elements.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-benchmark-row]");
    if (!button) return;
    activeCandidateId = button.dataset.benchmarkRow;
    renderTable();
    renderDetails();
  });
  for (const tab of elements.tabs) {
    tab.addEventListener("click", () => selectTab(tab.dataset.benchmarkTab));
    tab.addEventListener("keydown", handleTabKeydown);
  }

  render();

  return {
    setActive(active) {
      root.hidden = !active;
      if (active) render();
    },
  };

  function render() {
    renderSummary();
    renderTable();
    renderDetails();
    selectTab(activeTab);
  }

  function selectTab(tabId) {
    if (!elements.tabs.some((tab) => tab.dataset.benchmarkTab === tabId)) {
      return;
    }
    activeTab = tabId;
    for (const tab of elements.tabs) {
      const selected = tab.dataset.benchmarkTab === activeTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of elements.panels) {
      panel.hidden = panel.dataset.benchmarkPanel !== activeTab;
    }
  }

  function handleTabKeydown(event) {
    const currentIndex = elements.tabs.indexOf(event.currentTarget);
    const keys = {
      ArrowLeft: currentIndex - 1,
      ArrowRight: currentIndex + 1,
      Home: 0,
      End: elements.tabs.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const nextIndex =
      (keys[event.key] + elements.tabs.length) % elements.tabs.length;
    const nextTab = elements.tabs[nextIndex];
    selectTab(nextTab.dataset.benchmarkTab);
    nextTab.focus();
  }

  function renderSummary() {
    const fingerprint = REPORT.baseline.configurationFingerprint;
    const verdicts = REPORT.summary.verdicts;
    elements.summary.innerHTML = `
      <article>
        <span>Accepted baseline</span>
        <strong>${escapeHtml(
          REPORT.baseline.configurationLabels.modelIndex,
        )}</strong>
        <small>${escapeHtml(fingerprint)}</small>
      </article>
      <article>
        <span>Evidence</span>
        <strong>${formatInteger(REPORT.evidence.pairedBoards)} boards</strong>
        <small>${escapeHtml(REPORT.evidence.split)} · ${escapeHtml(
          REPORT.evidence.splitRole,
        )}</small>
      </article>
      <article>
        <span>Candidate verdicts</span>
        <strong>${REPORT.summary.candidateCount}</strong>
        <small>${verdicts.promote} promote · ${verdicts.block} block · ${verdicts.needsMoreData} need evidence</small>
      </article>`;
  }

  function renderTable() {
    const visibleRows = rows
      .filter(
        (row) =>
          verdictFilter === "all" ||
          row.verdict.status === verdictFilter,
      )
      .sort(rowSorter(sortBy));
    elements.body.innerHTML = visibleRows
      .map((row) => renderRow(row))
      .join("");
    elements.empty.hidden = rows.length !== 0;
  }

  function renderRow(row) {
    const status = VERDICTS[row.verdict.status];
    const active = row.id === activeCandidateId;
    const counts = row.summary.playMetrics;
    return `<tr data-status="${row.verdict.status}" ${
      active ? 'data-active="true"' : ""
    }>
      <td data-label="Configuration">
        <button
          type="button"
          class="benchmark-row-button"
          data-benchmark-row="${escapeHtml(row.id)}"
          aria-pressed="${active}"
        >
          <strong>🧪 ${escapeHtml(row.id)}</strong>
          <small>${escapeHtml(
            row.artifact.configurationLabels.modelIndex,
          )}</small>
        </button>
      </td>
      <td data-label="Verdict">
        <span class="benchmark-status" data-state="${escapeHtml(
          row.verdict.status,
        )}">${status.icon} ${status.label}</span>
      </td>
      <td data-label="Evidence">
        <strong>${formatInteger(row.comparison.pairedBoards)} boards</strong>
        <small>${escapeHtml(row.methodology.split)} · ${escapeHtml(
          row.artifact.evidence.splitRole,
        )}</small>
      </td>
      <td data-label="Improved"><strong>${counts.improved}</strong></td>
      <td data-label="Regressed"><strong>${counts.regressed}</strong></td>
      <td data-label="Uncertain"><strong>${counts.uncertain}</strong></td>
      <td data-label="Human sources">
        <strong>${row.summary.humanAlignment.slices}</strong>
        <small>${row.summary.humanAlignment.tuningSlices} tuning · ${row.summary.humanAlignment.heldOutSlices} held-out</small>
      </td>
    </tr>`;
  }

  function renderDetails() {
    const row = rows.find(({ id }) => id === activeCandidateId);
    elements.details.innerHTML = row
      ? renderCandidateDetails(row)
      : renderBaselineDetails();
  }
}

function buildShell() {
  const shell = document.createElement("div");
  shell.className = "benchmark-shell";
  shell.innerHTML = `
    <header class="benchmark-heading">
      <div>
        <span class="eyebrow">Hidden evaluation lab</span>
        <h2>Benchmark comparison</h2>
        <p>The canonical report owns every score, delta, interval, gate, and verdict. This page is a compact evidence browser.</p>
      </div>
      <span class="benchmark-version">Report v${REPORT.schemaVersion}</span>
    </header>
    <div class="benchmark-tabs" role="tablist" aria-label="Benchmark views">
      <button
        id="benchmark-tab-scorecard"
        type="button"
        role="tab"
        aria-selected="true"
        aria-controls="benchmark-panel-scorecard"
        data-benchmark-tab="scorecard"
      >📊 Overview</button>
      <button
        id="benchmark-tab-settings"
        type="button"
        role="tab"
        aria-selected="false"
        aria-controls="benchmark-panel-settings"
        data-benchmark-tab="settings"
        tabindex="-1"
      >⚙️ Settings audit</button>
      <button
        id="benchmark-tab-cli"
        type="button"
        role="tab"
        aria-selected="false"
        aria-controls="benchmark-panel-cli"
        data-benchmark-tab="cli"
        tabindex="-1"
      >🤖 CLI research</button>
      <button
        id="benchmark-tab-evidence"
        type="button"
        role="tab"
        aria-selected="false"
        aria-controls="benchmark-panel-evidence"
        data-benchmark-tab="evidence"
        tabindex="-1"
      >🧾 Testing stages</button>
    </div>
    <div
      id="benchmark-panel-scorecard"
      class="benchmark-panel"
      role="tabpanel"
      aria-labelledby="benchmark-tab-scorecard"
      data-benchmark-panel="scorecard"
    >
      <section id="benchmark-summary" class="benchmark-summary" aria-label="Benchmark summary"></section>
      <section class="benchmark-results" aria-labelledby="benchmark-results-title">
      <div class="benchmark-results-heading">
        <div>
          <span class="eyebrow">Baseline versus candidates</span>
          <h2 id="benchmark-results-title">Checked comparisons</h2>
        </div>
        <div class="benchmark-controls">
          <label>Sort
            <select id="benchmark-sort">
              <option value="verdict">Verdict</option>
              <option value="regressions">Regressions</option>
              <option value="label">Configuration</option>
            </select>
          </label>
          <label>Verdict
            <select id="benchmark-filter">
              <option value="all">All</option>
              <option value="promote">Promote</option>
              <option value="needs-more-data">Needs evidence</option>
              <option value="block">Blocked</option>
            </select>
          </label>
        </div>
      </div>
      <p class="benchmark-scroll-hint">Scroll horizontally to compare every status.</p>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th data-benchmark-column="configuration">🧪 Configuration</th>
              <th data-benchmark-column="verdict">📌 Verdict</th>
              <th data-benchmark-column="evidence">🧾 Evidence</th>
              <th data-benchmark-column="improved">✅ Improved</th>
              <th data-benchmark-column="regressed">⚠️ Regressed</th>
              <th data-benchmark-column="uncertain">❓ Uncertain</th>
              <th data-benchmark-column="human">👥 Human sources</th>
            </tr>
          </thead>
          <tbody id="benchmark-table-body"></tbody>
        </table>
      </div>
      <p id="benchmark-empty" class="benchmark-empty-detail" hidden>
        No candidate comparison is attached. The accepted baseline below is recorded without invented deltas, gates, or a promotion verdict.
      </p>
      </section>
      <section id="benchmark-details" class="benchmark-details" aria-live="polite"></section>
    </div>
    <section
      id="benchmark-panel-settings"
      class="benchmark-panel"
      role="tabpanel"
      aria-labelledby="benchmark-tab-settings"
      data-benchmark-panel="settings"
      hidden
    >${renderSettingsAudit()}</section>
    <section
      id="benchmark-panel-cli"
      class="benchmark-panel"
      role="tabpanel"
      aria-labelledby="benchmark-tab-cli"
      data-benchmark-panel="cli"
      hidden
    >${renderCliResearch()}</section>
    <section
      id="benchmark-panel-evidence"
      class="benchmark-panel benchmark-methodology"
      role="tabpanel"
      aria-labelledby="benchmark-tab-evidence"
      data-benchmark-panel="evidence"
      hidden
    >${renderEvidenceGuide()}</section>`;
  return shell;
}

function renderSettingsAudit() {
  return `
    <section class="benchmark-artifact-view" aria-labelledby="benchmark-settings-title">
      <div class="benchmark-artifact-heading">
        <div>
          <span class="eyebrow">One setting at a time</span>
          <h2 id="benchmark-settings-title">${escapeHtml(
            SETTINGS_AUDIT.title,
          )}</h2>
          <p>${escapeHtml(SETTINGS_AUDIT.methodology.design)}</p>
        </div>
        <span class="benchmark-status" data-state="tuning">🧪 Tuning only</span>
      </div>
      <div class="benchmark-boundary-strip">
        <span>🔬 Smoke stops clear regressions early</span>
        <span>🛠️ Development checks promising or uncertain alternatives</span>
        <span>🔒 ${formatInteger(
          SETTINGS_AUDIT.methodology.heldOutBoardsUsed,
        )} held-out boards used</span>
        <span>🚫 No promotion claim</span>
      </div>
      <p class="benchmark-artifact-note">${escapeHtml(
        SETTINGS_AUDIT.methodology.interactionLimitation,
      )}</p>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table benchmark-audit-table">
          <thead>
            <tr>
              <th>🧪 Setting</th>
              <th>🔧 Alternative</th>
              <th>🧾 Stage</th>
              <th>📌 Local result</th>
              <th>📊 Metric results</th>
              <th>🚦 Comparison</th>
              <th>👥 Human or gold</th>
              <th>🔐 Exact configuration</th>
            </tr>
          </thead>
          <tbody>
            ${SETTINGS_AUDIT.candidates.map(renderAuditRow).join("")}
          </tbody>
        </table>
      </div>
      <p class="benchmark-evidence-note">
        Audit artifact <code>${escapeHtml(
          SETTINGS_AUDIT.reportSha256,
        )}</code>
      </p>
    </section>`;
}

function renderAuditRow(row) {
  const assessment =
    AUDIT_ASSESSMENTS[row.assessment.status] ??
    AUDIT_ASSESSMENTS.uncertain;
  const verdict = VERDICTS[row.verdict] ?? VERDICTS["needs-more-data"];
  const humanScreen =
    AUDIT_SCREEN_RESULTS[row.humanScreen.status] ??
    AUDIT_SCREEN_RESULTS["not-applicable"];
  return `<tr data-audit-result="${escapeHtml(row.assessment.status)}">
    <td><strong>🧪 ${escapeHtml(row.setting)}</strong></td>
    <td><strong>${escapeHtml(row.alternative)}</strong></td>
    <td>
      <strong>🧾 ${escapeHtml(humanize(row.phase))}</strong>
      <small>${formatInteger(row.boardCount)} boards</small>
    </td>
    <td>
      <span class="benchmark-status" data-state="${escapeHtml(
        row.assessment.status,
      )}">${assessment.icon} ${assessment.label}</span>
      <small>${escapeHtml(row.assessment.note)}</small>
    </td>
    <td>${renderMetricTotals(row.metricStatus)}</td>
    <td>
      <span class="benchmark-status" data-state="${escapeHtml(
        row.verdict,
      )}">${verdict.icon} ${verdict.label}</span>
    </td>
    <td>
      <strong>${humanScreen[0]} ${humanScreen[1]}</strong>
      <small>${escapeHtml(row.humanScreen.note)}</small>
    </td>
    <td>${renderAuditConfiguration(row)}</td>
  </tr>`;
}

function renderMetricTotals(metricStatus) {
  return `<div class="benchmark-metric-totals">
    <span data-state="improved">✅ ${formatInteger(
      metricStatus.improved,
    )} improved</span>
    <span data-state="regressed">⚠️ ${formatInteger(
      metricStatus.regressed,
    )} regressed</span>
    <span data-state="uncertain">❓ ${formatInteger(
      metricStatus.uncertain,
    )} uncertain</span>
  </div>`;
}

function renderAuditConfiguration(row) {
  const artifact = row.artifacts.candidate;
  return `<details class="benchmark-audit-configuration">
    <summary>View configuration</summary>
    <div class="benchmark-setting-chips">
      ${Object.entries(artifact.configurationLabels)
        .map(
          ([label, value]) =>
            `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`,
        )
        .join("")}
    </div>
    <p class="benchmark-fingerprint">
      <b>Configuration fingerprint</b>
      <code>${escapeHtml(artifact.configurationFingerprint)}</code>
    </p>
  </details>`;
}

function renderCliResearch() {
  return `
    <section class="benchmark-artifact-view" aria-labelledby="benchmark-cli-title">
      <div class="benchmark-artifact-heading">
        <div>
          <span class="eyebrow">Embedding shortlist rerankers</span>
          <h2 id="benchmark-cli-title">Subscription CLI research</h2>
          <p>Each model receives the same safe embedding shortlist. Scores below are artifact-recorded correct cards per turn, with candidate-minus-baseline intervals.</p>
        </div>
        <span class="benchmark-status" data-state="block">🚫 No rollout</span>
      </div>
      <div class="benchmark-boundary-strip">
        <span>💳 Subscription CLI only</span>
        <span>🔐 No API keys or fallback models</span>
        <span>🧪 ${formatInteger(
          CLI_SCREEN.protocol.fixedBoardSplits.heldOutTest,
        )} held-out boards used</span>
        <span>👥 Human or gold screen unavailable</span>
      </div>
      <p class="benchmark-artifact-note">${escapeHtml(
        CLI_SCREEN.humanGold.blocker,
      )}</p>
      <div class="benchmark-cli-models">
        ${CLI_SCREEN.models.map(renderCliModel).join("")}
      </div>
      <p class="benchmark-evidence-note">${escapeHtml(
        CLI_SCREEN.scientificBoundary.runtimeBoundary,
      )}</p>
    </section>`;
}

function renderCliModel(model) {
  const overall =
    SCREEN_RESULTS[model.overallStatus] ?? SCREEN_RESULTS["needs-more-data"];
  const interruption = model.failure?.interruption;
  return `<article class="benchmark-cli-model">
    <div class="benchmark-cli-model-heading">
      <div>
        <h3>🤖 ${escapeHtml(model.label)}</h3>
        <p>${escapeHtml(model.identity.resolvedModel ?? model.identity.selector)}</p>
      </div>
      <span class="benchmark-status" data-state="${escapeHtml(
        model.overallStatus,
      )}">${overall[0]} ${overall[1]}</span>
    </div>
    <div class="benchmark-setting-chips">
      <span><b>shortlist</b>${escapeHtml(
        model.identity.shortlistVersion,
      )}</span>
      <span><b>prompt</b>v${formatInteger(
        model.identity.promptVersion,
      )}</span>
      <span><b>surface</b>${escapeHtml(
        model.identity.subscriptionSurface,
      )}</span>
      <span><b>fallback</b>${escapeHtml(
        model.identity.fallbackModel ?? "none",
      )}</span>
    </div>
    <div class="benchmark-table-wrap">
      <table class="benchmark-table benchmark-cli-table">
        <thead>
          <tr>
            <th>🧾 Stage</th>
            <th>📍 Baseline score</th>
            <th>🤖 Candidate score</th>
            <th>Δ Change</th>
            <th>📐 95% interval</th>
            <th>📌 Result</th>
            <th>🚧 Blocking reason</th>
          </tr>
        </thead>
        <tbody>
          ${model.screens.map(renderCliScreen).join("")}
        </tbody>
      </table>
    </div>
    ${
      interruption
        ? `<div class="benchmark-interruption">
            <strong>⏸ ${escapeHtml(
              humanize(interruption.class),
            )}</strong>
            <span>Development stopped after ${formatDuration(
              interruption.run.seconds,
            )}. Transfer was not run.</span>
          </div>`
        : ""
    }
  </article>`;
}

function renderCliScreen(screen) {
  const metric = screen.metrics.correctCardsPerTurn;
  const result =
    SCREEN_RESULTS[screen.verdict] ?? SCREEN_RESULTS["needs-more-data"];
  const reason =
    screen.reasons?.[0] ??
    (screen.verdict === "needs-more-data"
      ? "The recorded interval remains uncertain."
      : "No blocking reason recorded.");
  return `<tr data-screen-result="${escapeHtml(screen.verdict)}">
    <td>
      <strong>🧾 ${escapeHtml(screen.label)}</strong>
      <small>${formatInteger(screen.evidence.boardCount)} boards · operative ${escapeHtml(
        screen.evidence.operativeModelId,
      )}</small>
    </td>
    <td><strong>${formatNumber(metric.baseline)}</strong></td>
    <td><strong>${formatNumber(metric.candidate)}</strong></td>
    <td><strong class="benchmark-delta" data-state="${escapeHtml(
      metric.status === "regressed" ? "worse" : "neutral",
    )}">${formatSigned(metric.delta.estimate)}</strong></td>
    <td>${formatInterval(metric.delta)}</td>
    <td>
      <span class="benchmark-status" data-state="${escapeHtml(
        screen.verdict,
      )}">${result[0]} ${result[1]}</span>
    </td>
    <td><small>${escapeHtml(reason)}</small></td>
  </tr>`;
}

function renderEvidenceGuide() {
  const layers = REPORT.methodology?.evidenceLayers;
  if (!layers) {
    return `<p class="benchmark-empty-detail">
      This report does not include the evidence-layer metadata needed to explain its test flow.
    </p>`;
  }
  const slices = REPORT.evidenceFamilies?.humanAlignment?.slices ?? [];
  const selfPlay = layers.fixedBoardSelfPlay;
  const guardrails = layers.gameplaySafety;
  const flow = layers.promotionFlow;
  return `
    <div class="benchmark-methodology-heading">
      <div>
        <span class="eyebrow">How candidates advance</span>
        <h2>Testing stages</h2>
        <p>Definitions and promotion rules come from the canonical report. Completed setting and CLI results remain in their separate artifact views.</p>
      </div>
      <small>Displayed from report v${REPORT.schemaVersion}</small>
    </div>
    <div class="benchmark-evidence-grid">
      <article>
        <h3>1. 👥 ${escapeHtml(layers.humanAlignment.label)}</h3>
        <p>${escapeHtml(layers.humanAlignment.role)}</p>
        <div class="benchmark-source-list">
          ${
            slices.length > 0
              ? slices.map(renderEvidenceSource).join("")
              : `<p class="benchmark-empty-detail">
                  No source-separated human or reviewed gold slices are attached to this artifact.
                </p>`
          }
        </div>
      </article>
      <article>
        <h3>2. 🎲 ${escapeHtml(selfPlay.label)}</h3>
        <p>${escapeHtml(selfPlay.role)}</p>
        <dl class="benchmark-split-list">
          ${selfPlay.splits
            .map(
              (split) => `
                <div data-benchmark-split="${escapeHtml(split.id)}">
                  <dt>${escapeHtml(humanize(split.id))}</dt>
                  <dd><strong>${formatInteger(
                    split.boardCount,
                  )} boards</strong><span>${escapeHtml(split.role)}</span></dd>
                </div>`,
            )
            .join("")}
        </dl>
      </article>
      <article>
        <h3>3. 🛡️ ${escapeHtml(guardrails.label)}</h3>
        <p>${escapeHtml(guardrails.role)}</p>
        <ul class="benchmark-guardrail-list">
          ${guardrails.metrics
            .map((metric) => `<li>${escapeHtml(metric)}</li>`)
            .join("")}
        </ul>
      </article>
      <article>
        <h3>4. 🔁 ${escapeHtml(layers.crossModelTransfer.label)}</h3>
        <p>${escapeHtml(layers.crossModelTransfer.role)}</p>
      </article>
    </div>
    <section class="benchmark-flow" aria-labelledby="benchmark-flow-title">
      <h3 id="benchmark-flow-title">🚦 Promotion flow</h3>
      <ol>
        ${flow.steps
          .map(
            (step) => `
              <li>
                <strong>${escapeHtml(step.label)}</strong>
                <span>${escapeHtml(step.role)}</span>
              </li>`,
          )
          .join("")}
      </ol>
      <ul class="benchmark-flow-rules">
        ${flow.rules
          .map((rule) => `<li>${escapeHtml(rule)}</li>`)
          .join("")}
      </ul>
    </section>`;
}

function renderEvidenceSource(slice) {
  const revision = slice.source?.revision;
  return `<div class="benchmark-source-item">
    <strong>${escapeHtml(slice.source?.name ?? slice.id ?? "Unnamed source")}</strong>
    <span>${formatInteger(slice.observation?.count)} ${escapeHtml(
      slice.observation?.unit ?? "observations",
    )}</span>
    <small>${
      revision
        ? `Revision ${escapeHtml(revision.kind)}:${escapeHtml(revision.value)}`
        : "Revision not recorded"
    }</small>
  </div>`;
}

function attachColumnInfo(root) {
  for (const definition of COLUMN_INFO) {
    const header = root.querySelector(
      `[data-benchmark-column="${definition.id}"]`,
    );
    const label = document.createElement("span");
    label.className = "benchmark-column-heading";
    label.append(
      document.createTextNode(header.textContent),
      createInfoControl(definition, "benchmark-column"),
    );
    header.replaceChildren(label);
  }
}

function renderBaselineDetails() {
  return `
    <div class="benchmark-details-heading">
      <div>
        <span class="eyebrow">Accepted baseline</span>
        <h2>${escapeHtml(REPORT.baseline.id)}</h2>
        <p>${formatInteger(
          REPORT.evidence.pairedBoards,
        )} ${escapeHtml(REPORT.evidence.split)} boards. Candidate evidence has not been attached.</p>
      </div>
      <span class="benchmark-status" data-state="baseline">📍 Baseline</span>
    </div>
    ${renderConfiguration(REPORT.baseline)}
    ${renderProvenance(REPORT.baseline)}`;
}

function renderCandidateDetails(row) {
  const status = VERDICTS[row.verdict.status];
  const slices = humanAlignmentSlices(REPORT, row.id);
  return `
    <div class="benchmark-details-heading">
      <div>
        <span class="eyebrow">Selected comparison</span>
        <h2>${escapeHtml(row.id)}</h2>
        <p>${escapeHtml(status.detail)}</p>
      </div>
      <span class="benchmark-status" data-state="${escapeHtml(
        row.verdict.status,
      )}">${status.icon} ${status.label}</span>
    </div>
    ${renderConfiguration(row.artifact)}
    <section class="benchmark-detail-section">
      <h3>📏 Play metrics</h3>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table benchmark-metric-table">
          <thead>
            <tr>
              <th>📏 Metric</th>
              <th>📍 Baseline</th>
              <th>🧪 Candidate</th>
              <th>Δ Candidate</th>
              <th>📐 95% interval</th>
              <th>📌 Status</th>
            </tr>
          </thead>
          <tbody>
            ${Object.values(row.metrics)
              .map(renderMetricRow)
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="benchmark-detail-section">
      <h3>🚦 Promotion gates</h3>
      <div class="benchmark-gate-grid">
        ${Object.entries(row.promotion.gates)
          .map(([id, gate]) => renderGate(id, gate))
          .join("")}
      </div>
    </section>
    <section class="benchmark-detail-section">
      <h3>👥 Human alignment</h3>
      ${
        slices.length > 0
          ? slices.map(renderHumanSlice).join("")
          : '<p class="benchmark-empty-detail">No source-separated human comparison is attached.</p>'
      }
    </section>
    <section class="benchmark-detail-section">
      <h3>📌 Decision evidence</h3>
      <ul class="benchmark-reason-list">
        ${[...row.verdict.reasons, ...row.verdict.requiredEvidence]
          .map((reason) => `<li>${escapeHtml(reason)}</li>`)
          .join("")}
      </ul>
    </section>
    ${renderProvenance(row.artifact)}`;
}

function renderConfiguration(artifact) {
  return `
    <div class="benchmark-setting-chips">
      ${Object.entries(artifact.configurationLabels)
        .map(
          ([label, value]) =>
            `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`,
        )
        .join("")}
    </div>
    <p class="benchmark-fingerprint">
      <b>Configuration fingerprint</b>
      <code>${escapeHtml(artifact.configurationFingerprint)}</code>
    </p>
    <details class="benchmark-disclosure">
      <summary>Full canonical configuration</summary>
      <pre>${escapeHtml(JSON.stringify(artifact.configuration, null, 2))}</pre>
    </details>`;
}

function renderMetricRow(metric) {
  const [icon, label] =
    METRIC_STATUS[metric.status] ?? ["⚪", metric.status];
  return `<tr>
    <td><strong>${escapeHtml(metric.label)}</strong></td>
    <td>${formatNumber(metric.baseline)}</td>
    <td>${formatNumber(metric.candidate)}</td>
    <td>${formatSigned(metric.delta.estimate)}</td>
    <td>${formatInterval(metric.delta)}</td>
    <td><span class="benchmark-metric-status" data-state="${escapeHtml(
      metric.status,
    )}">${icon} ${escapeHtml(label)}</span></td>
  </tr>`;
}

function renderGate(id, gate) {
  const labels = {
    pass: ["✅", "Pass"],
    block: ["🚫", "Block"],
    "needs-more-data": ["⬜", "Needs evidence"],
  };
  const [icon, label] = labels[gate.status];
  return `<article data-state="${escapeHtml(gate.status)}">
    <span>${escapeHtml(humanize(id))}</span>
    <strong>${icon} ${label}</strong>
  </article>`;
}

function renderHumanSlice(slice) {
  return `<details class="benchmark-disclosure benchmark-human-slice">
    <summary>
      <span>${escapeHtml(slice.source.name)}</span>
      <small>${escapeHtml(slice.role)} · ${formatInteger(
        slice.observation.count,
      )} ${escapeHtml(slice.observation.unit)}</small>
    </summary>
    <p>${escapeHtml(slice.source.format)}</p>
    <p><b>Revision</b> <code>${escapeHtml(
      slice.source.revision.kind,
    )}:${escapeHtml(slice.source.revision.value)}</code></p>
    <div class="benchmark-table-wrap">
      <table class="benchmark-table benchmark-metric-table">
        <thead>
          <tr>
            <th>📏 Metric</th>
            <th>📍 Baseline</th>
            <th>🧪 Candidate</th>
            <th>Δ Candidate</th>
            <th>📐 Interval</th>
            <th>📌 Status</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(slice.metrics)
            .map(([id, metric]) =>
              renderHumanMetricRow(id, metric),
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </details>`;
}

function renderHumanMetricRow(id, metric) {
  const [icon, label] =
    METRIC_STATUS[metric.status] ?? ["⚪", metric.status];
  return `<tr>
    <td><strong>${escapeHtml(humanize(id))}</strong><small>${escapeHtml(
      metric.definition,
    )}</small></td>
    <td>${formatNumber(metric.baseline)}</td>
    <td>${formatNumber(metric.candidate)}</td>
    <td>${formatSigned(metric.delta)}</td>
    <td>${metric.interval ? escapeHtml(JSON.stringify(metric.interval)) : "N/A"}</td>
    <td>${icon} ${escapeHtml(label)}</td>
  </tr>`;
}

function renderProvenance(artifact) {
  return `<p class="benchmark-evidence-note">
    Artifact <code>${escapeHtml(artifact.sha256)}</code> · ${escapeHtml(
      artifact.path,
    )}
  </p>`;
}

function rowSorter(sortBy) {
  if (sortBy === "label") {
    return (left, right) => left.id.localeCompare(right.id);
  }
  if (sortBy === "regressions") {
    return (left, right) =>
      right.summary.playMetrics.regressed -
        left.summary.playMetrics.regressed ||
      left.id.localeCompare(right.id);
  }
  const order = {
    promote: 0,
    "needs-more-data": 1,
    block: 2,
  };
  return (left, right) =>
    order[left.verdict.status] - order[right.verdict.status] ||
    left.id.localeCompare(right.id);
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "N/A";
}

function formatSigned(value) {
  return Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${Number(value).toFixed(4)}`
    : "N/A";
}

function formatInterval(value) {
  return value &&
    Number.isFinite(value.lower) &&
    Number.isFinite(value.upper)
    ? `${formatSigned(value.lower)} to ${formatSigned(value.upper)}`
    : "N/A";
}

function formatInteger(value) {
  return Number.isFinite(value)
    ? Number(value).toLocaleString("en-US")
    : "Unknown";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "an unknown duration";
  if (seconds < 60) return `${Number(seconds).toFixed(1)} seconds`;
  return `${Number(seconds / 60).toFixed(1)} minutes`;
}

function humanize(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replaceAll("-", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
