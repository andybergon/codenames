import SCORECARD from "../../scripts/generated/benchmark-scorecard.json" with { type: "json" };
import {
  DEFAULT_HUMAN_WEIGHT,
  scoreBenchmarkRow,
  scoreDelta,
} from "./scorecard.js";
import { createInfoControl } from "../info-control.js";

const STATUS = {
  production: {
    label: "Production",
    icon: "✅",
    detail: "Current production reference with checked transfer evidence.",
  },
  blocked: {
    label: "Blocked",
    icon: "❌",
    detail: "Human and self-play evidence exists, but transfer gates failed.",
  },
  "needs-transfer": {
    label: "Needs transfer",
    icon: "🟡",
    detail: "The settings combination has not completed the transfer screen.",
  },
};

const HUMAN_SOURCE_LABELS = {
  culturalCodes: "Cultural Codes",
  connector: "Connector",
  strategyHumanClues: "Human clues",
  strategyGptClues: "GPT clues",
  cooccurrence: "Co-occurrence",
};

const COLUMN_INFO = [
  {
    id: "combination",
    label: "Combination",
    info: "One complete benchmark configuration, including embedding model, clue count, scoring policy, operative behavior, and related settings. Select a row to inspect its full scorecard.",
  },
  {
    id: "score",
    label: "Score",
    info: "The 0-100 headline score from the objective slider. By default it is 60% Human and 40% same-model Fun. Transfer results are deliberately excluded and remain a separate promotion gate.",
  },
  {
    id: "status",
    label: "Status",
    info: "Production has checked transfer evidence. Needs transfer has not completed the cross-model screen. Blocked means the available transfer evidence failed the promotion gates.",
  },
  {
    id: "human",
    label: "Human",
    info: "A 0-100 human-alignment score. Five dataset sources receive equal weight, and each source combines its available guess, target, pairwise, exact-set, good-word, and inverted avoid-rate measurements.",
  },
  {
    id: "fun",
    label: "Fun",
    info: "The 0-100 same-model self-play Fun Index. It combines ambitious multi-card clues, productive momentum, close-game suspense, and an 8 to 12 turn flow target.",
  },
  {
    id: "correct-turn",
    label: "Correct per turn",
    info: "Mean correct friendly cards guessed per turn in same-model self-play. Higher is more productive, but this optimistic regression metric does not prove that clues transfer to a different listener.",
  },
  {
    id: "cross-correct",
    label: "Cross correct",
    info: "Mean correct friendly cards per turn when this configuration generates clues and the fixed MiniLM-L6 operative interprets them. This tests whether clue meaning transfers across embedding geometries.",
  },
  {
    id: "cross-danger",
    label: "Cross danger",
    info: "Wrong-team cards hit per game plus assassin rate under the fixed cross-model listener. Lower is safer. Not run means this configuration still needs transfer evidence.",
  },
];

export function createBenchmarkMode() {
  const root = document.querySelector("#benchmark-mode");
  if (!root) return { setActive() {} };

  let humanWeight = DEFAULT_HUMAN_WEIGHT;
  let sortBy = "score";
  let statusFilter = "all";
  let activeRowId = SCORECARD.baselineId;

  root.replaceChildren(buildShell());
  attachColumnInfo(root);
  const elements = {
    humanWeight: root.querySelector("#benchmark-human-weight"),
    humanWeightValue: root.querySelector(
      "#benchmark-human-weight-value",
    ),
    funWeightValue: root.querySelector(
      "#benchmark-fun-weight-value",
    ),
    sort: root.querySelector("#benchmark-sort"),
    filter: root.querySelector("#benchmark-filter"),
    summary: root.querySelector("#benchmark-summary"),
    body: root.querySelector("#benchmark-table-body"),
    details: root.querySelector("#benchmark-details"),
  };

  elements.humanWeight.addEventListener("input", () => {
    humanWeight = Number(elements.humanWeight.value);
    render();
  });
  elements.sort.addEventListener("change", () => {
    sortBy = elements.sort.value;
    renderTable();
  });
  elements.filter.addEventListener("change", () => {
    statusFilter = elements.filter.value;
    renderTable();
  });
  elements.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-benchmark-row]");
    if (!button) return;
    activeRowId = button.dataset.benchmarkRow;
    renderTable();
    renderDetails();
  });

  render();

  return {
    setActive(active) {
      root.hidden = !active;
      if (active) render();
    },
  };

  function render() {
    elements.humanWeightValue.textContent = `${humanWeight}%`;
    elements.funWeightValue.textContent = `${100 - humanWeight}%`;
    renderSummary();
    renderTable();
    renderDetails();
  }

  function renderSummary() {
    const scored = scoredRows().sort(
      (left, right) => right.score - left.score,
    );
    const leader = scored[0];
    const reference = scored.find(
      ({ id }) => id === SCORECARD.baselineId,
    );
    elements.summary.innerHTML = `
      <article>
        <span>Highest score</span>
        <strong>${formatScore(leader.score)}</strong>
        <small>${escapeHtml(leader.label)}</small>
      </article>
      <article>
        <span>Production reference</span>
        <strong>${formatScore(reference.score)}</strong>
        <small>${escapeHtml(reference.label)}</small>
      </article>
      <article>
        <span>Evidence</span>
        <strong>${SCORECARD.rows.length} combos</strong>
        <small>14,404 human guesses</small>
      </article>`;
  }

  function renderTable() {
    const allRows = scoredRows();
    const baseline = allRows.find(
      ({ id }) => id === SCORECARD.baselineId,
    );
    const rows = allRows
      .filter(
        (row) =>
          statusFilter === "all" || row.status === statusFilter,
      )
      .sort(rowSorter(sortBy));
    elements.body.innerHTML = rows
      .map((row) => renderRow(row, baseline))
      .join("");
  }

  function renderRow(row, baseline) {
    const status = STATUS[row.status];
    const active = row.id === activeRowId;
    return `<tr data-status="${row.status}" ${
      active ? 'data-active="true"' : ""
    }>
      <td data-label="Combo">
        <button
          type="button"
          class="benchmark-row-button"
          data-benchmark-row="${escapeHtml(row.id)}"
          aria-pressed="${active}"
        >
          <strong>🧪 ${escapeHtml(row.label)}</strong>
          <small>${row.settings.candidates.toLocaleString()} clues · ${escapeHtml(
            row.settings.transform,
          )}</small>
        </button>
      </td>
      <td data-label="Score" class="benchmark-score-cell">
        <strong>${formatScore(row.score)}</strong>
        ${deltaMarkup(scoreDelta(row.score, baseline.score))}
      </td>
      <td data-label="Status">
        <span class="benchmark-status" data-state="${row.status}">
          ${status.icon} ${status.label}
        </span>
      </td>
      ${metricCell(
        "Human",
        row.scores.humanAlignment,
        baseline.scores.humanAlignment,
        formatScore,
      )}
      ${metricCell(
        "Fun",
        row.scores.selfPlayFun,
        baseline.scores.selfPlayFun,
        formatScore,
      )}
      ${metricCell(
        "Correct / turn",
        row.selfPlay.correctCardsPerTurn,
        baseline.selfPlay.correctCardsPerTurn,
        formatDecimal,
      )}
      ${metricCell(
        "Cross correct",
        row.transfer?.correctCardsPerTurn,
        baseline.transfer?.correctCardsPerTurn,
        formatDecimal,
      )}
      <td data-label="Cross danger">
        ${
          row.transfer
            ? `<strong>${formatDecimal(
                row.transfer.wrongTeamHitsPerGame,
              )} wrong</strong><small>${formatPercent(
                row.transfer.assassinRate,
              )} assassin</small>`
            : "<strong>Not run</strong><small>Transfer needed</small>"
        }
      </td>
    </tr>`;
  }

  function renderDetails() {
    const allRows = scoredRows();
    const row = allRows.find(({ id }) => id === activeRowId);
    const baseline = allRows.find(
      ({ id }) => id === SCORECARD.baselineId,
    );
    const status = STATUS[row.status];
    elements.details.innerHTML = `
      <div class="benchmark-details-heading">
        <div>
          <span class="eyebrow">Selected scorecard</span>
          <h2>${escapeHtml(row.label)}</h2>
          <p>
            <span class="benchmark-status" data-state="${row.status}">
              ${status.icon} ${status.label}
            </span>
            ${status.detail}
          </p>
        </div>
        <strong class="benchmark-detail-score">${formatScore(
          row.score,
        )}</strong>
      </div>
      <div class="benchmark-setting-chips">
        ${Object.entries(row.settings)
          .map(
            ([key, value]) =>
              `<span><b>${settingLabel(key)}</b>${escapeHtml(
                formatSetting(value),
              )}</span>`,
          )
          .join("")}
      </div>
      <div class="benchmark-score-grid">
        ${scoreCard(
          "🎯 Headline score",
          row.score,
          baseline.score,
          formatScore,
        )}
        ${scoreCard(
          "👥 Human alignment",
          row.scores.humanAlignment,
          baseline.scores.humanAlignment,
          formatScore,
        )}
        ${scoreCard(
          "🎉 Self-play Fun",
          row.scores.selfPlayFun,
          baseline.scores.selfPlayFun,
          formatScore,
        )}
        ${scoreCard(
          "✅ Correct / turn",
          row.selfPlay.correctCardsPerTurn,
          baseline.selfPlay.correctCardsPerTurn,
          formatDecimal,
        )}
        ${scoreCard(
          "⏱️ Turns / game",
          row.selfPlay.meanTurnsPerGame,
          baseline.selfPlay.meanTurnsPerGame,
          formatDecimal,
          true,
        )}
        ${scoreCard(
          "🔀 Cross correct",
          row.transfer?.correctCardsPerTurn,
          baseline.transfer?.correctCardsPerTurn,
          formatDecimal,
        )}
        ${scoreCard(
          "🔴 Cross wrong",
          row.transfer?.wrongTeamHitsPerGame,
          baseline.transfer?.wrongTeamHitsPerGame,
          formatDecimal,
          true,
        )}
        ${scoreCard(
          "☠️ Cross assassin",
          row.transfer?.assassinRate,
          baseline.transfer?.assassinRate,
          formatPercent,
          true,
          formatPercentagePointDelta,
        )}
      </div>
      <div class="benchmark-breakdowns">
        <section>
          <h3>👥 Human sources</h3>
          <div class="benchmark-bars">
            ${Object.entries(row.human)
              .map(
                ([source, result]) => `
                  <div>
                    <span>${HUMAN_SOURCE_LABELS[source]}</span>
                    <div><i style="width:${result.score}%"></i></div>
                    <strong>${formatScore(result.score)}</strong>
                  </div>`,
              )
              .join("")}
          </div>
        </section>
        <section>
          <h3>🎉 Fun components</h3>
          ${
            row.selfPlay.funComponents
              ? `<div class="benchmark-bars">
                  ${Object.entries(row.selfPlay.funComponents)
                    .map(
                      ([component, value]) => `
                        <div>
                          <span>${capitalize(component)}</span>
                          <div><i style="width:${value}%"></i></div>
                          <strong>${formatScore(value)}</strong>
                        </div>`,
                    )
                    .join("")}
                </div>`
              : `<p class="benchmark-empty-detail">The sampled hosted run records the total Fun score and game outcomes, but not its component breakdown.</p>`
          }
        </section>
      </div>
      <p class="benchmark-evidence-note">
        Self-play: ${row.evidence.selfPlayBoards} boards · Transfer:
        ${
          row.evidence.transferBoards > 0
            ? `${row.evidence.transferBoards} paired boards`
            : "not run"
        }. Transfer remains a gate and does not add hidden headline-score points.
      </p>`;
  }

  function scoredRows() {
    return SCORECARD.rows.map((row) => ({
      ...row,
      score: scoreBenchmarkRow(row, humanWeight),
    }));
  }
}

function buildShell() {
  const shell = document.createElement("div");
  shell.className = "benchmark-shell";
  shell.innerHTML = `
    <header class="benchmark-heading">
      <div>
        <span class="eyebrow">Hidden evaluation lab</span>
        <h2>Benchmark scorecard</h2>
        <p>Each row is one complete settings combination. Adjust the headline objective, compare deltas, then inspect the human, self-play, and transfer evidence separately.</p>
      </div>
      <span class="benchmark-version">Objective v${SCORECARD.objective.version}</span>
    </header>
    <section class="benchmark-objective" aria-labelledby="benchmark-objective-title">
      <div>
        <span class="eyebrow">Headline objective</span>
        <h3 id="benchmark-objective-title">Human evidence + self-play Fun</h3>
        <p>Transfer remains a promotion gate, not a point source.</p>
      </div>
      <label for="benchmark-human-weight">
        <span>Human <output id="benchmark-human-weight-value">60%</output></span>
        <input id="benchmark-human-weight" type="range" min="0" max="100" step="5" value="60" />
        <span>Self-play <output id="benchmark-fun-weight-value">40%</output></span>
      </label>
    </section>
    <section id="benchmark-summary" class="benchmark-summary" aria-label="Benchmark summary"></section>
    <section class="benchmark-results" aria-labelledby="benchmark-results-title">
      <div class="benchmark-results-heading">
        <div>
          <span class="eyebrow">Configuration matrix</span>
          <h2 id="benchmark-results-title">Checked combinations</h2>
        </div>
        <div class="benchmark-controls">
          <label>Sort
            <select id="benchmark-sort">
              <option value="score">Headline score</option>
              <option value="human">Human alignment</option>
              <option value="fun">Self-play Fun</option>
              <option value="label">Configuration</option>
            </select>
          </label>
          <label>Status
            <select id="benchmark-filter">
              <option value="all">All evidence</option>
              <option value="production">Production</option>
              <option value="needs-transfer">Needs transfer</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
        </div>
      </div>
      <p class="benchmark-scroll-hint">Scroll horizontally to compare every score.</p>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th data-benchmark-column="combination">🧪 Combination</th>
              <th data-benchmark-column="score">🎯 Score</th>
              <th data-benchmark-column="status">📌 Status</th>
              <th data-benchmark-column="human">👥 Human</th>
              <th data-benchmark-column="fun">🎉 Fun</th>
              <th data-benchmark-column="correct-turn">✅ Correct / turn</th>
              <th data-benchmark-column="cross-correct">🔀 Cross correct</th>
              <th data-benchmark-column="cross-danger">⚠️ Cross danger</th>
            </tr>
          </thead>
          <tbody id="benchmark-table-body"></tbody>
        </table>
      </div>
    </section>
    <section id="benchmark-details" class="benchmark-details" aria-live="polite"></section>`;
  return shell;
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

function metricCell(label, value, baseline, formatter) {
  return `<td data-label="${label}">
    <strong>${formatter(value)}</strong>
    ${deltaMarkup(scoreDelta(value, baseline))}
  </td>`;
}

function scoreCard(
  label,
  value,
  baseline,
  formatter,
  invert = false,
  deltaFormatter = formatDelta,
) {
  return `<article>
    <span>${label}</span>
    <strong>${formatter(value)}</strong>
    ${deltaMarkup(scoreDelta(value, baseline, invert), deltaFormatter)}
  </article>`;
}

function deltaMarkup(delta, formatter = formatDelta) {
  if (!Number.isFinite(delta)) {
    return "<small>no baseline</small>";
  }
  const state =
    Math.abs(delta) < 0.05
      ? "same"
      : delta > 0
        ? "better"
        : "worse";
  const label =
    state === "same"
      ? "baseline"
      : formatter(delta);
  return `<small class="benchmark-delta" data-state="${state}">${label}</small>`;
}

function rowSorter(sortBy) {
  if (sortBy === "label") {
    return (left, right) => left.label.localeCompare(right.label);
  }
  const getter =
    sortBy === "human"
      ? (row) => row.scores.humanAlignment
      : sortBy === "fun"
        ? (row) => row.scores.selfPlayFun
        : (row) => row.score;
  return (left, right) =>
    getter(right) - getter(left) ||
    left.label.localeCompare(right.label);
}

function settingLabel(key) {
  return {
    language: "Language",
    wordSet: "Words",
    embedding: "Embedding",
    provider: "Runtime",
    transform: "Transform",
    candidates: "Clues",
    scoring: "Scoring",
    multiTolerance: "Tolerance",
    aggression: "Operative",
    bonusGuesses: "Bonus",
  }[key];
}

function formatSetting(value) {
  return typeof value === "number" ? value.toLocaleString() : value;
}

function formatScore(value) {
  return Number.isFinite(value) ? Number(value).toFixed(1) : "N/A";
}

function formatDecimal(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "N/A";
}

function formatPercent(value) {
  return Number.isFinite(value)
    ? `${(Number(value) * 100).toFixed(1)}%`
    : "N/A";
}

function formatDelta(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatPercentagePointDelta(value) {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
