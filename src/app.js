import { Check, Monitor, Moon, Share2, Sun, createIcons } from "lucide";
import MODEL_PICKER_BENCHMARK from "../scripts/generated/model-picker-benchmark.json" with { type: "json" };
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  createRandomSeed,
  createSampleBoardState,
  decodeBoardParam,
  encodeBoardParam,
} from "./board-share.js";
import { loadShardedClueIndex } from "./clue-index.js";
import { centerEmbeddings, embedTerms } from "./embeddings.js";
import {
  CANDIDATE_OPTIONS,
  DEFAULT_CANDIDATE_COUNT,
  DEFAULT_MODEL_ID,
  PICKER_MODEL_OPTIONS,
  indexManifestUrl,
  modelOption,
} from "./model-lab.js";
import {
  SIDE,
  applySuggestionTurn,
  boardForSide,
  boardTeamFromPerspective,
  teamForSide,
  winningSide,
} from "./gameplay.js";
import { closeInfoPopovers, createInfoControl } from "./info-control.js";
import { analyzeEmbeddedBoard, calculateBoardMetrics } from "./model.js";
import { createPlayMode } from "./play/mode.js";
import { ROLE_SEQUENCE, TEAMS, WORD_SET } from "./word-data.js";

const TEAM_BY_ID = new Map(TEAMS.map((team) => [team.id, team]));
const TEAM_SORT_ORDER = new Map(TEAMS.map((team, index) => [team.id, index]));
const RESULTS_PER_SIZE = 6;
const DEFAULT_TARGET_RANGE = Object.freeze({ min: 2, max: 4 });
const DEFAULT_MINIMUM_WORTH = 50;
const THEME_STORAGE_KEY = "codenames-theme";
const THEME_VALUES = new Set(["system", "light", "dark"]);
const MAX_TARGET_WORDS = ROLE_SEQUENCE.filter((team) => team === "friendly").length;
const BOARD_METRIC_DEFINITIONS = {
  complexity: {
    label: "Board complexity",
    key: "board-complexity",
    info:
      "100 minus the average Blue and Red ease scores. Ease is 65% average Worth of the best three safe clues, 20% average Worth of the best three stretch clues, and 15% safe-option breadth; four safe options earns full credit. 0-32 is Easy, 33-65 Moderate, and 66-100 Hard.",
  },
  edge: {
    label: "Blue vs red",
    key: "side-edge",
    info:
      "Blue ease minus Red ease after scoring the board again with Blue and Red roles swapped. Positive favors Blue, negative favors Red, and a difference within 3 points is shown as Even. B and R show each side's 0-100 ease score.",
  },
};
const MOBILE_METRIC_DEFINITION = {
  id: "recommendation-metrics",
  label: "Recommendation metrics",
  info: "Worth ranks overall clue usefulness. Est. hit estimates the chance of getting every target before a miss. Risk is a safety label with hard cutoffs, so a Safe clue can still have lower Worth than a Medium clue.",
};
const MODEL_PICKER_INFO = {
  id: "measurements",
  label: "Model picker measurements",
  info: `Human fit combines target recall on 7,703 played Codenames Duet turns with exact-match vocabulary coverage across 9,932 usable human clues. It is a comparison index, not an end-to-end success rate. Speed is the median of ${MODEL_PICKER_BENCHMARK.methodology.iterations} fixed Node scoring runs after ${MODEL_PICKER_BENCHMARK.methodology.warmups} warmups on ${MODEL_PICKER_BENCHMARK.environment.cpu}; loading is excluded. Download combines the embedding model and the clue index required by that configuration. Longer cell bars mean better fit, faster scoring, or a smaller total download.`,
};
const CANDIDATE_FILTER_INFO = {
  id: "candidate-filter",
  label: "available clue candidates",
  info: "This count starts from the selected vocabulary and dynamically removes clues that conflict with the remaining board words: exact matches, simple stem variants, and words that contain or are contained by a board word. There is no additional fixed removal at runtime, so the count changes with the board and guessed cards.",
};
const PICKER_BENCHMARK_BY_CONFIGURATION = new Map(
  MODEL_PICKER_BENCHMARK.results.map((result) => [
    `${result.modelId}:${result.candidateCount}`,
    result,
  ]),
);
const SUGGESTION_COLUMNS = [
  { id: "clue", label: "Clue", key: "clue", direction: "asc" },
  { id: "items", label: "Items", key: "number", direction: "desc" },
  { id: "targets", label: "Targets" },
  {
    id: "worth",
    label: "Worth",
    key: "worth",
    direction: "desc",
    info: "Overall usefulness from 0-99. It rewards more likely targets, stronger semantic fit, cohesive target words, safety margin, and clue familiarity. Risk is shown separately.",
  },
  {
    id: "net",
    label: "Net",
    key: "expectedNet",
    direction: "desc",
    advanced: true,
    info: "Estimated value: items times hit chance, minus the role-weighted cost of a miss. Higher is better.",
  },
  {
    id: "hit",
    label: "Est. hit",
    key: "success",
    direction: "desc",
    info: "Estimated chance that teammates get every intended target before hitting another card. This is a model estimate, not a percentage measured from real games.",
  },
  {
    id: "risk",
    label: "Risk",
    key: "risk",
    direction: "desc",
    info: "A traffic-light safety label with hard cutoffs. Safe needs 1-3 targets, at least 73% estimated hit, and a 0.11 safety margin. Assassin danger, a margin below 0.025, or hit below 56% is Risky; the rest is Medium.",
  },
  {
    id: "danger",
    label: "Closest danger",
    key: "danger",
    direction: "desc",
    info: "The non-friendly card most attracted to the clue after role penalties. The chip shows its word and raw similarity; its color shows the role.",
  },
  {
    id: "margin",
    label: "Margin",
    key: "margin",
    direction: "desc",
    advanced: true,
    info: "Weakest target similarity minus the strongest role-weighted danger. Positive values are safer.",
  },
  {
    id: "semantics",
    label: "Fit / cohesion",
    advanced: true,
    info: "Fit is clue similarity to the target centroid. Cohesion is the average similarity among the target words.",
  },
  { id: "action", label: "Apply" },
];
const RISK_SORT_VALUE = {
  safe: 3,
  medium: 2,
  risky: 1,
};

const initialBoardState = readInitialBoardState();
let board = cloneBoard(initialBoardState.cards);
let boardCollapsed = false;
let recommendationsCollapsed = false;
let boardOrder = initialBoardState.order;
let boardWordSet = initialBoardState.wordSet;
let nextBoardWordSet = boardWordSet;
let randomLayoutOrder = [...initialBoardState.randomLayoutOrder];
let boardSource = { ...initialBoardState.source };
let targetRanges = {
  [SIDE.BLUE]: { ...DEFAULT_TARGET_RANGE },
  [SIDE.RED]: { ...DEFAULT_TARGET_RANGE },
};
let targetRange = targetRanges[SIDE.BLUE];
let targetRangeLimit = MAX_TARGET_WORDS;
let minimumWorth = DEFAULT_MINIMUM_WORTH;
let activeTargetBoundary = null;
let flippingCardLayoutIds = new Set();
let suggestionSort = { key: "worth", direction: "desc" };
let showAdvancedMetrics = false;
let activeSide = SIDE.BLUE;
let turnMessage = "";
let latestAnalysis = null;
let latestAnalyses = { [SIDE.BLUE]: null, [SIDE.RED]: null };
let analyzeTimer = 0;
let analysisRun = 0;
let hasAnalysis = false;
const clueIndexPromises = new Map();
let selectedModelId = DEFAULT_MODEL_ID;
let selectedCandidateCount = DEFAULT_CANDIDATE_COUNT;
let shareFeedbackTimer = 0;
let appMode = readAppMode();
let trainerInitialized = false;
let trainerInitializationFrame = 0;
let trainerInitializationTimer = 0;

board =
  boardOrder === BOARD_ORDER.RANDOM ? sortBoardByRandomLayout(board) : sortBoardByRole(board);

const elements = {
  boardGrid: document.querySelector("#board-grid"),
  boardCounts: document.querySelector("#board-counts"),
  boardMetrics: document.querySelector("#board-metrics"),
  recommendationResults: document.querySelector("#recommendation-results"),
  recommendationContent: document.querySelector("#recommendation-content"),
  recommendationToolbar: document.querySelector("#recommendation-toolbar"),
  resultsPanel: document.querySelector(".results-panel"),
  analysisStatus: document.querySelector("#analysis-status"),
  recommendationCount: document.querySelector("#recommendation-count"),
  candidateFilterInfo: document.querySelector("#candidate-filter-info"),
  targetRangeControl: document.querySelector("#target-range-control"),
  targetRangeValue: document.querySelector("#target-range-value"),
  targetCountBreakdown: document.querySelector("#target-count-breakdown"),
  targetMin: document.querySelector("#target-min"),
  targetMax: document.querySelector("#target-max"),
  minimumWorth: document.querySelector("#minimum-worth"),
  minimumWorthValue: document.querySelector("#minimum-worth-value"),
  mobileSuggestionSort: document.querySelector("#mobile-suggestion-sort"),
  mobileMetricHelp: document.querySelector("#mobile-metric-help"),
  sideButtons: [...document.querySelectorAll("[data-recommendation-side]")],
  turnStatus: document.querySelector("#turn-status"),
  advancedMetrics: document.querySelector("#advanced-metrics"),
  worthDistribution: document.querySelector("#worth-distribution"),
  modelLabModel: document.querySelector("#model-lab-model"),
  modelLabCandidates: document.querySelector("#model-lab-candidates"),
  modelLabMatrix: document.querySelector("#model-lab-matrix"),
  modelPickerInfo: document.querySelector("#model-picker-info"),
  loadSample: document.querySelector("#load-sample"),
  randomBoard: document.querySelector("#random-board"),
  orderRandom: document.querySelector("#order-random"),
  orderGrouped: document.querySelector("#order-grouped"),
  wordSetButtons: [...document.querySelectorAll("[data-word-set-value]")],
  shareBoard: document.querySelector("#share-board"),
  toggleBoard: document.querySelector("#toggle-board"),
  toggleRecommendations: document.querySelector("#toggle-recommendations"),
  themeButtons: [...document.querySelectorAll("[data-theme-value]")],
  appTitle: document.querySelector("#app-title"),
  appModeButtons: [...document.querySelectorAll("[data-app-mode]")],
  trainModeLoading: document.querySelector("#train-mode-loading"),
  trainerWorkspace: document.querySelector("#trainer-workspace"),
  modelLab: document.querySelector("#model-lab"),
  playMode: document.querySelector("#play-mode"),
};

const playMode = createPlayMode();

elements.modelLabModel.addEventListener("change", (event) => {
  selectedModelId = event.target.value;
  switchModelLabConfiguration();
});
elements.modelLabCandidates.addEventListener("change", (event) => {
  selectedCandidateCount = Number(event.target.value);
  switchModelLabConfiguration();
});

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

createIcons({
  icons: { Check, Monitor, Moon, Share2, Sun },
  attrs: { width: 18, height: 18, "stroke-width": 2 },
});

for (const button of elements.appModeButtons) {
  button.addEventListener("click", () => setAppMode(button.dataset.appMode));
}

for (const button of elements.themeButtons) {
  button.addEventListener("click", () => setTheme(button.dataset.themeValue));
}

systemTheme.addEventListener("change", () => {
  if (document.documentElement.dataset.themeSetting === "system") {
    applyTheme("system");
  }
});

elements.loadSample.addEventListener("click", () => {
  loadBoardState(createSampleBoardState());
  syncBoardUrl();
  render();
});

elements.randomBoard.addEventListener("click", () => {
  loadBoardState(
    createGeneratedBoardState(createRandomSeed(), BOARD_ORDER.SORTED, nextBoardWordSet),
  );
  syncBoardUrl();
  render();
});

for (const button of elements.wordSetButtons) {
  button.addEventListener("click", () => {
    setNewBoardWordSet(button.dataset.wordSetValue);
  });
}

elements.orderRandom.addEventListener("click", () => {
  if (boardOrder === BOARD_ORDER.RANDOM) {
    return;
  }

  boardOrder = BOARD_ORDER.RANDOM;
  board = sortBoardByRandomLayout(board);
  syncBoardUrl();
  renderBoard();
});

elements.orderGrouped.addEventListener("click", () => {
  if (boardOrder === BOARD_ORDER.SORTED) {
    return;
  }

  boardOrder = BOARD_ORDER.SORTED;
  board = sortBoardByRole(board);
  syncBoardUrl();
  renderBoard();
});

elements.shareBoard.addEventListener("click", () => {
  void copyBoardShareLink();
});

elements.toggleBoard.addEventListener("click", () => {
  boardCollapsed = !boardCollapsed;
  renderBoardVisibility();
});

elements.toggleRecommendations.addEventListener("click", () => {
  recommendationsCollapsed = !recommendationsCollapsed;
  renderRecommendationsVisibility();
});

elements.targetMin.addEventListener("input", (event) => {
  setTargetRange("min", Number(event.target.value));
});

elements.targetMax.addEventListener("input", (event) => {
  setTargetRange("max", Number(event.target.value));
});

elements.minimumWorth.addEventListener("input", (event) => {
  minimumWorth = Number(event.target.value);
  renderMinimumWorthControl();
  renderRecommendationTable();
});

elements.mobileSuggestionSort.addEventListener("change", (event) => {
  const [key, direction] = event.target.value.split(":");
  suggestionSort = { key, direction };
  renderRecommendationTable();
});

for (const button of elements.sideButtons) {
  button.addEventListener("click", () => {
    setActiveSide(button.dataset.recommendationSide);
  });
}

elements.advancedMetrics.addEventListener("change", (event) => {
  showAdvancedMetrics = event.target.checked;
  if (
    !showAdvancedMetrics &&
    SUGGESTION_COLUMNS.some(
      (column) => column.advanced && column.key === suggestionSort.key,
    )
  ) {
    suggestionSort = { key: "worth", direction: "desc" };
  }
  renderRecommendationTable();
});

elements.targetMin.addEventListener("keydown", (event) => {
  handleTargetRangeKey("min", event);
});

elements.targetMax.addEventListener("keydown", (event) => {
  handleTargetRangeKey("max", event);
});

elements.targetRangeControl.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  const value = targetValueFromPointer(event.clientX);
  const minDistance = Math.abs(value - targetRange.min);
  const maxDistance = Math.abs(value - targetRange.max);
  activeTargetBoundary =
    minDistance === maxDistance
      ? value <= (targetRange.min + targetRange.max) / 2
        ? "min"
        : "max"
      : minDistance < maxDistance
        ? "min"
        : "max";
  elements.targetRangeControl.setPointerCapture(event.pointerId);
  elements[activeTargetBoundary === "min" ? "targetMin" : "targetMax"].focus({
    preventScroll: true,
  });
  setTargetRange(activeTargetBoundary, value);
});

elements.targetRangeControl.addEventListener("pointermove", (event) => {
  if (!activeTargetBoundary) {
    return;
  }

  setTargetRange(activeTargetBoundary, targetValueFromPointer(event.clientX));
});

for (const eventName of ["pointerup", "pointercancel"]) {
  elements.targetRangeControl.addEventListener(eventName, (event) => {
    if (elements.targetRangeControl.hasPointerCapture(event.pointerId)) {
      elements.targetRangeControl.releasePointerCapture(event.pointerId);
    }
    activeTargetBoundary = null;
  });
}

document.addEventListener("click", () => {
  closeInfoPopovers();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeInfoPopovers();
    if (document.activeElement?.classList.contains("info-button")) {
      document.activeElement.blur();
    }
  }
});

elements.mobileMetricHelp.append(
  createInfoControl(MOBILE_METRIC_DEFINITION, "mobile-recommendations"),
);
elements.modelPickerInfo.append(createInfoControl(MODEL_PICKER_INFO, "model-picker"));
elements.candidateFilterInfo.append(
  createInfoControl(CANDIDATE_FILTER_INFO, "recommendation-status"),
);
applyTheme(readThemeSetting());
renderAppMode();
playMode.setActive(appMode === "play");
if (appMode === "train") {
  initializeTrainer();
}

function switchModelLabConfiguration() {
  analysisRun += 1;
  hasAnalysis = false;
  invalidateAnalyses();
  renderModelLab();
  void runAnalysis();
}

function renderModelLab() {
  elements.modelLabModel.value = selectedModelId;
  elements.modelLabCandidates.value = String(selectedCandidateCount);
  const smallestConfigurationBytes = Math.min(
    ...PICKER_MODEL_OPTIONS.flatMap((model) =>
      CANDIDATE_OPTIONS.map((candidate) => model.modelBytes + candidate.indexBytes),
    ),
  );
  const fastestScoreMs = Math.min(
    ...MODEL_PICKER_BENCHMARK.results
      .filter(({ modelId }) => PICKER_MODEL_OPTIONS.some(({ id }) => id === modelId))
      .map(({ medianMs }) => medianMs),
  );
  const configurations = PICKER_MODEL_OPTIONS.flatMap((model) =>
    CANDIDATE_OPTIONS.map((candidate) => {
      const benchmark = PICKER_BENCHMARK_BY_CONFIGURATION.get(`${model.id}:${candidate.count}`);
      return {
        model,
        candidate,
        benchmark,
        humanFit: model.humanQuality * candidate.humanClueCoverage,
        totalBytes: model.modelBytes + candidate.indexBytes,
      };
    }),
  );
  const table = document.createElement("table");
  table.className = "model-comparison-table";
  table.innerHTML = `
    <thead><tr><th scope="col">Embedding model</th>${CANDIDATE_OPTIONS.map((option) => `
      <th scope="col"><strong>${option.count.toLocaleString()} clues</strong><span>${(option.humanClueCoverage * 100).toFixed(1)}% human clue coverage</span><span class="model-index-size">${(option.indexBytes / 1_000_000).toFixed(1)} MB index</span></th>`).join("")}</tr></thead>
    <tbody>${PICKER_MODEL_OPTIONS.map((option) => `
      <tr data-model-id="${option.id}">
        <th scope="row"><strong>${option.label}</strong><span>${Math.round(option.modelBytes / 1_000_000)} MB base model</span></th>
        ${CANDIDATE_OPTIONS.map((candidate) => {
          const { count } = candidate;
          const benchmark = PICKER_BENCHMARK_BY_CONFIGURATION.get(`${option.id}:${count}`);
          const humanFit = option.humanQuality * candidate.humanClueCoverage;
          const totalBytes = option.modelBytes + candidate.indexBytes;
          const fitWidth = Math.round((humanFit / 0.56) * 100);
          const speedWidth = Math.min(100, Math.round((fastestScoreMs / benchmark.medianMs) * 100));
          const downloadWidth = Math.round((smallestConfigurationBytes / totalBytes) * 100);
          const selected = option.id === selectedModelId && count === selectedCandidateCount;
          const recommended = option.id === DEFAULT_MODEL_ID && count === DEFAULT_CANDIDATE_COUNT;
          return `<td><button type="button" class="model-combination" data-model-id="${option.id}" data-candidate-count="${count}" aria-pressed="${selected}">
            ${recommended ? '<span class="model-recommendation-badge">Recommended</span>' : ""}
            <div class="model-cell-measure"><span>Fit</span><div class="lab-bar quality" aria-hidden="true"><i style="width:${fitWidth}%"></i></div><b>${(humanFit * 100).toFixed(1)}%</b></div>
            <div class="model-cell-measure"><span>Speed</span><div class="lab-bar speed" aria-hidden="true"><i style="width:${speedWidth}%"></i></div><b>${benchmark.medianMs.toFixed(1)} ms</b></div>
            <div class="model-cell-measure"><span>Download</span><div class="lab-bar download" aria-hidden="true"><i style="width:${downloadWidth}%"></i></div><b>${(totalBytes / 1_000_000).toFixed(1)} MB</b></div>
          </button></td>`;
        }).join("")}
      </tr>`).join("")}</tbody>`;
  table.querySelectorAll(".model-combination").forEach((button) => {
    button.addEventListener("click", () => {
      const modelId = button.dataset.modelId;
      const candidateCount = Number(button.dataset.candidateCount);
      if (modelId === selectedModelId && candidateCount === selectedCandidateCount) return;
      selectedModelId = modelId;
      selectedCandidateCount = candidateCount;
      elements.modelLabModel.value = modelId;
      elements.modelLabCandidates.value = String(candidateCount);
      switchModelLabConfiguration();
    });
  });
  const tableScroller = document.createElement("div");
  tableScroller.className = "model-table-scroll";
  tableScroller.append(table);
  elements.modelLabMatrix.replaceChildren(tableScroller, createParetoChart(configurations));
}

function createParetoChart(configurations) {
  const width = 760;
  const height = 246;
  const plot = { left: 50, right: 24, top: 18, bottom: 42 };
  const minMs = Math.min(...configurations.map(({ benchmark }) => benchmark.medianMs));
  const maxMs = Math.max(...configurations.map(({ benchmark }) => benchmark.medianMs));
  const minFit = 0.32;
  const maxFit = 0.57;
  const colors = {
    "minilm-l3": "var(--orange)",
    "minilm-l6": "var(--blue)",
    "bge-small": "var(--green)",
  };
  const x = (milliseconds) =>
    plot.left +
    (Math.log(milliseconds / minMs) / Math.log(maxMs / minMs)) *
      (width - plot.left - plot.right);
  const y = (fit) =>
    plot.top + ((maxFit - fit) / (maxFit - minFit)) * (height - plot.top - plot.bottom);
  const pointsByModel = new Map(
    PICKER_MODEL_OPTIONS.map((model) => [
      model.id,
      configurations.filter((configuration) => configuration.model.id === model.id),
    ]),
  );
  const xTicks = [minMs, 200, 600, 2_000].filter((tick, index) =>
    index === 0 || (tick > minMs && tick < maxMs),
  );
  const yTicks = [0.35, 0.45, 0.55];
  const grid = [
    ...xTicks.map((tick) => `<line x1="${x(tick)}" y1="${plot.top}" x2="${x(tick)}" y2="${height - plot.bottom}" />`),
    ...yTicks.map((tick) => `<line x1="${plot.left}" y1="${y(tick)}" x2="${width - plot.right}" y2="${y(tick)}" />`),
  ].join("");
  const tickLabels = [
    ...xTicks.map((tick) => `<text x="${x(tick)}" y="${height - 20}" text-anchor="middle">${Math.round(tick).toLocaleString()} ms</text>`),
    ...yTicks.map((tick) => `<text x="${plot.left - 9}" y="${y(tick) + 4}" text-anchor="end">${Math.round(tick * 100)}%</text>`),
  ].join("");
  const series = [...pointsByModel.entries()].map(([modelId, points]) => {
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.benchmark.medianMs)},${y(point.humanFit)}`).join(" ");
    const circles = points.map((point) => {
      const radius = 5 + Math.sqrt(point.totalBytes / 1_000_000) * 0.7;
      const recommended = point.model.id === DEFAULT_MODEL_ID && point.candidate.count === DEFAULT_CANDIDATE_COUNT;
      return `<g><circle cx="${x(point.benchmark.medianMs)}" cy="${y(point.humanFit)}" r="${radius.toFixed(1)}" fill="${colors[modelId]}" class="pareto-point${recommended ? " is-recommended" : ""}"><title>${point.model.label}, ${point.candidate.count.toLocaleString()} clues: ${(point.humanFit * 100).toFixed(1)}% human fit, ${point.benchmark.medianMs.toFixed(1)} ms, ${(point.totalBytes / 1_000_000).toFixed(1)} MB total download</title></circle>${recommended ? `<text class="pareto-default-label" text-anchor="end" x="${x(point.benchmark.medianMs) - radius - 5}" y="${y(point.humanFit) - radius}">Default</text>` : ""}</g>`;
    }).join("");
    return `<path d="${path}" fill="none" stroke="${colors[modelId]}" class="pareto-series" />${circles}`;
  }).join("");
  const legend = PICKER_MODEL_OPTIONS.map((model, index) => `
    <g transform="translate(${plot.left + index * 145},${height - 14})"><circle r="5" fill="${colors[model.id]}" /><text x="10" y="4">${model.label}</text></g>`).join("");
  const wrapper = document.createElement("section");
  wrapper.className = "model-pareto";
  wrapper.innerHTML = `
    <div class="model-pareto-heading"><strong>Pareto frontier</strong><span>Higher fit, farther left, and smaller bubbles are better. Speed uses a log scale.</span></div>
    <div class="model-pareto-plot"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="pareto-title pareto-description">
      <title id="pareto-title">Model and clue vocabulary Pareto frontier</title>
      <desc id="pareto-description">Human fit versus logarithmically scaled scoring time for the three non-dominated model families and four clue vocabulary sizes. Bubble size represents the total model and clue-index download. MiniLM-L6 with ten thousand clues is recommended.</desc>
      <g class="pareto-grid">${grid}</g>
      <g class="pareto-ticks">${tickLabels}</g>
      <text class="pareto-axis-label" x="${plot.left}" y="12">Human fit</text>
      ${series}
      <g class="pareto-legend">${legend}</g>
    </svg></div>`;
  return wrapper;
}

function render() {
  renderBoard();
  renderTurnControls();
  if (appMode === "train") {
    void runAnalysis();
  }
}

function readAppMode() {
  return new URL(window.location.href).searchParams.get("mode") === "play" ? "play" : "train";
}

function setAppMode(nextMode) {
  if (nextMode !== "train" && nextMode !== "play") {
    return;
  }
  if (appMode === nextMode) {
    return;
  }
  appMode = nextMode;
  const url = new URL(window.location.href);
  if (appMode === "play") {
    url.searchParams.set("mode", "play");
  } else {
    url.searchParams.delete("mode");
  }
  window.history.replaceState(null, "", url);
  renderAppMode();
  playMode.setActive(appMode === "play");
  if (appMode === "train") {
    if (trainerInitialized) {
      if (!hasAnalysis) {
        scheduleAnalysis();
      }
    } else {
      scheduleTrainerInitialization();
    }
  } else {
    cancelTrainerInitialization();
    pauseTrainerAnalysis();
  }
}

function renderAppMode() {
  const isPlay = appMode === "play";
  const isTrainerLoading = !isPlay && !trainerInitialized;
  elements.trainModeLoading.hidden = !isTrainerLoading;
  elements.trainerWorkspace.hidden = isPlay || isTrainerLoading;
  elements.modelLab.hidden = isPlay || isTrainerLoading;
  elements.playMode.hidden = !isPlay;
  elements.appTitle.textContent = "Codenames";
  document.title = "Codenames";
  for (const button of elements.appModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.appMode === appMode));
  }
}

function initializeTrainer() {
  if (trainerInitialized) {
    return;
  }
  renderModelLab();
  renderBoard();
  renderTurnControls();
  trainerInitialized = true;
  renderAppMode();
  scheduleAnalysis();
}

function scheduleTrainerInitialization() {
  if (
    trainerInitialized ||
    trainerInitializationFrame ||
    trainerInitializationTimer
  ) {
    return;
  }
  trainerInitializationFrame = window.requestAnimationFrame(() => {
    trainerInitializationFrame = 0;
    trainerInitializationTimer = window.setTimeout(() => {
      trainerInitializationTimer = 0;
      if (appMode === "train") {
        initializeTrainer();
      }
    }, 80);
  });
}

function cancelTrainerInitialization() {
  window.cancelAnimationFrame(trainerInitializationFrame);
  window.clearTimeout(trainerInitializationTimer);
  trainerInitializationFrame = 0;
  trainerInitializationTimer = 0;
}

function pauseTrainerAnalysis() {
  window.clearTimeout(analyzeTimer);
  analyzeTimer = 0;
  analysisRun += 1;
  setAnalysisBusy(false);
}

function readThemeSetting() {
  const setting = document.documentElement.dataset.themeSetting;
  return THEME_VALUES.has(setting) ? setting : "system";
}

function setTheme(setting) {
  if (!THEME_VALUES.has(setting)) {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, setting);
  } catch {
    // The selected theme still applies for this page when storage is unavailable.
  }
  applyTheme(setting);
}

function applyTheme(setting) {
  const resolved = setting === "system" ? (systemTheme.matches ? "dark" : "light") : setting;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeSetting = setting;
  document.documentElement.style.colorScheme = resolved;

  for (const button of elements.themeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.themeValue === setting));
  }
}

function readInitialBoardState() {
  const url = new URL(window.location.href);
  try {
    return decodeBoardParam(url.searchParams.get("b"));
  } catch (error) {
    console.warn("Ignoring invalid shared board code.", error);
    url.searchParams.delete("b");
    window.history.replaceState(null, "", url);
    return createSampleBoardState();
  }
}

function markBoardCustomized() {
  boardSource = { type: "explicit" };
}

function syncBoardUrl() {
  try {
    const code = encodeBoardParam({
      cards: board,
      randomLayoutOrder,
      order: boardOrder,
      wordSet: boardWordSet,
      source: boardSource,
    });
    const url = new URL(window.location.href);
    if (code) {
      url.searchParams.set("b", code);
    } else {
      url.searchParams.delete("b");
    }
    window.history.replaceState(null, "", url);
    return true;
  } catch {
    setShareButtonState("error");
    return false;
  }
}

async function copyBoardShareLink() {
  if (!syncBoardUrl()) {
    return;
  }

  try {
    await writeClipboardText(window.location.href);
    setShareButtonState("copied");
  } catch {
    setShareButtonState("error");
  }
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function setShareButtonState(state) {
  window.clearTimeout(shareFeedbackTimer);
  elements.shareBoard.dataset.state = state;
  const copied = state === "copied";
  const error = state === "error";
  const label = copied
    ? "Board link copied"
    : error
      ? "Unable to copy board link"
      : "Copy board share link";
  elements.shareBoard.setAttribute("aria-label", label);
  elements.shareBoard.title = label;

  const icon = document.createElement("i");
  icon.dataset.lucide = copied ? "check" : "share-2";
  icon.setAttribute("aria-hidden", "true");
  elements.shareBoard.replaceChildren(icon);
  createIcons({
    icons: { Check, Share2 },
    attrs: { width: 18, height: 18, "stroke-width": 2 },
    root: elements.shareBoard,
  });

  if (state !== "idle") {
    shareFeedbackTimer = window.setTimeout(() => setShareButtonState("idle"), 5000);
  }
}

function renderBoard() {
  elements.boardGrid.replaceChildren();

  const displayedBoard = board.map((card, sourceIndex) => ({ card, sourceIndex }));

  displayedBoard.forEach(({ card, sourceIndex }, displayIndex) => {
    const cardElement = document.createElement("div");
    cardElement.className = "word-card";
    cardElement.dataset.team = card.team;
    cardElement.dataset.done = String(Boolean(card.done));
    cardElement.dataset.sourceIndex = String(sourceIndex);
    if (flippingCardLayoutIds.has(card.layoutId)) {
      cardElement.classList.add("is-flipping");
    }

    const cardWord = card.word || `word ${displayIndex + 1}`;
    if (card.done) {
      cardElement.classList.add("is-done");

      const back = document.createElement("div");
      back.className = "card-back";
      const backWord = document.createElement("strong");
      backWord.className = "card-back-word";
      backWord.textContent = card.word;
      const backStatus = document.createElement("span");
      backStatus.className = "card-back-status";
      backStatus.textContent = "Guessed";
      back.append(backWord, backStatus);

      const restoreButton = createCardStateButton({
        action: "restore-card",
        label: `Return guessed card ${cardWord} to the board`,
        title: `Return guessed card ${cardWord} to the board`,
        onClick: () => setCardDone(sourceIndex, false),
      });
      cardElement.append(back, restoreButton);
      elements.boardGrid.append(cardElement);
      return;
    }

    const input = document.createElement("input");
    input.className = "word-input";
    input.value = card.word;
    input.setAttribute("aria-label", `Word ${displayIndex + 1}`);
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", (event) => {
      board[sourceIndex] = {
        ...board[sourceIndex],
        word: event.target.value,
      };
      invalidateAnalyses();
      turnMessage = "";
      markBoardCustomized();
      syncBoardUrl();
      scheduleAnalysis();
    });

    const roleRow = document.createElement("div");
    roleRow.className = "role-row";

    for (const team of TEAMS) {
      const roleButton = document.createElement("button");
      roleButton.className = "role-button";
      roleButton.type = "button";
      roleButton.dataset.team = team.id;
      roleButton.textContent = team.short;
      roleButton.title = team.label;
      roleButton.setAttribute("aria-label", `Set ${card.word || `word ${displayIndex + 1}`} as ${team.label}`);
      roleButton.setAttribute("aria-pressed", String(card.team === team.id));
      roleButton.addEventListener("click", () => {
        board[sourceIndex] = {
          ...board[sourceIndex],
          team: team.id,
        };
        invalidateAnalyses();
        turnMessage = "";
        markBoardCustomized();
        if (boardOrder === BOARD_ORDER.SORTED) {
          board = sortBoardByRole(board);
        }
        syncBoardUrl();
        render();
      });
      roleRow.append(roleButton);
    }

    const doneButton = createCardStateButton({
      action: "complete-card",
      label: `Mark ${cardWord} as guessed`,
      title: `Mark ${cardWord} as guessed`,
      onClick: () => setCardDone(sourceIndex, true),
    });

    cardElement.append(input, roleRow, doneButton);
    elements.boardGrid.append(cardElement);
  });

  flippingCardLayoutIds.clear();

  renderBoardCounts(board);
  renderBoardOrderControl();
  renderBoardWordSetControl();
  renderBoardVisibility();
}

function renderBoardOrderControl() {
  elements.orderGrouped.setAttribute(
    "aria-pressed",
    String(boardOrder === BOARD_ORDER.SORTED),
  );
  elements.orderRandom.setAttribute(
    "aria-pressed",
    String(boardOrder === BOARD_ORDER.RANDOM),
  );
}

function renderBoardWordSetControl() {
  for (const button of elements.wordSetButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.wordSetValue === nextBoardWordSet),
    );
  }
}

function setNewBoardWordSet(nextWordSet) {
  if (
    nextWordSet === nextBoardWordSet ||
    (nextWordSet !== WORD_SET.OFFICIAL && nextWordSet !== WORD_SET.EXTENDED)
  ) {
    return;
  }

  nextBoardWordSet = nextWordSet;
  renderBoardWordSetControl();
}

function setActiveSide(nextSide) {
  if ((nextSide !== SIDE.BLUE && nextSide !== SIDE.RED) || nextSide === activeSide) {
    return;
  }

  activeSide = nextSide;
  targetRange = targetRanges[activeSide];
  latestAnalysis = latestAnalyses[activeSide];
  turnMessage = "";
  updateTargetRangeLimit(board);
  renderTurnControls();
  renderAnalysisSummary(latestAnalysis);
}

function renderTurnControls() {
  for (const button of elements.sideButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.recommendationSide === activeSide),
    );
  }
  elements.resultsPanel.dataset.activeSide = activeSide;

  const winner = winningSide(board);
  if (winner) {
    elements.turnStatus.textContent = turnMessage
      ? `${sideLabel(winner)} wins · ${turnMessage}`
      : `${sideLabel(winner)} wins`;
    return;
  }
  elements.turnStatus.textContent = turnMessage;
}

function resetGameState() {
  activeSide = SIDE.BLUE;
  targetRanges = {
    [SIDE.BLUE]: { ...DEFAULT_TARGET_RANGE },
    [SIDE.RED]: { ...DEFAULT_TARGET_RANGE },
  };
  targetRange = targetRanges[activeSide];
  turnMessage = "";
  invalidateAnalyses();
}

function invalidateAnalyses() {
  latestAnalysis = null;
  latestAnalyses = { [SIDE.BLUE]: null, [SIDE.RED]: null };
  renderWorthDistribution([]);
  renderTargetCountBreakdown([]);
  renderMessage(elements.recommendationResults, "Updating recommendations...");
  elements.recommendationCount.textContent = "-";
}

function createCardStateButton({ action, label, title, onClick }) {
  const button = document.createElement("button");
  button.className = `card-state-button ${action}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function setCardDone(sourceIndex, done) {
  const layoutId = board[sourceIndex].layoutId;
  board[sourceIndex] = {
    ...board[sourceIndex],
    done,
  };
  flippingCardLayoutIds = new Set([layoutId]);
  invalidateAnalyses();
  turnMessage = "";
  render();
}

function renderBoardVisibility() {
  elements.boardGrid.hidden = boardCollapsed;
  elements.boardGrid.closest(".board-panel")?.classList.toggle("is-collapsed", boardCollapsed);
  elements.toggleBoard.setAttribute("aria-expanded", String(!boardCollapsed));
  elements.toggleBoard.setAttribute(
    "aria-label",
    boardCollapsed ? "Expand board" : "Collapse board",
  );
  elements.toggleBoard.title = boardCollapsed ? "Expand board" : "Collapse board";
}

function renderRecommendationsVisibility() {
  elements.recommendationToolbar.hidden = recommendationsCollapsed;
  elements.recommendationContent.hidden = recommendationsCollapsed;
  elements.resultsPanel.classList.toggle("is-collapsed", recommendationsCollapsed);
  elements.toggleRecommendations.setAttribute("aria-expanded", String(!recommendationsCollapsed));
  elements.toggleRecommendations.setAttribute(
    "aria-label",
    recommendationsCollapsed ? "Expand recommendations" : "Collapse recommendations",
  );
  elements.toggleRecommendations.title = recommendationsCollapsed
    ? "Expand recommendations"
    : "Collapse recommendations";
}

function scheduleAnalysis() {
  window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => {
    void runAnalysis();
    renderBoardCounts(board);
  }, 180);
}

async function runAnalysis() {
  const runId = ++analysisRun;
  setAnalysisBusy(true);

  if (!hasAnalysis) {
    renderPending();
  }

  try {
    const configuration = `${selectedModelId}:${selectedCandidateCount}`;
    if (!clueIndexPromises.has(configuration)) {
      const candidateOption = CANDIDATE_OPTIONS.find(({ count }) => count === selectedCandidateCount);
      elements.analysisStatus.textContent = `Loading ${selectedCandidateCount.toLocaleString()} clues (${(candidateOption.indexBytes / 1_000_000).toFixed(1)} MB index)`;
      const clueIndexPromise = loadShardedClueIndex(indexManifestUrl(selectedModelId), selectedCandidateCount)
        .catch((error) => {
          clueIndexPromises.delete(configuration);
          throw error;
        });
      clueIndexPromises.set(configuration, clueIndexPromise);
    }
    const activeModel = modelOption(selectedModelId);
    const boardSnapshot = cloneBoard(board);
    const [clueIndex, boardVectors] = await Promise.all([
      clueIndexPromises.get(configuration),
      embedTerms(
        boardSnapshot.map((card) => card.word),
        {
          model: activeModel.model,
          onProgress: (event) => renderModelProgress(event, runId),
        },
      ),
    ]);

    if (runId !== analysisRun) {
      return;
    }
    if (clueIndex.model !== activeModel.model || clueIndex.dimensions !== activeModel.dimensions) {
      throw new Error(
        `Clue index ${clueIndex.model}/${clueIndex.dimensions}d is incompatible with ${activeModel.model}/${activeModel.dimensions}d`,
      );
    }

    const scoreStartedAt = performance.now();
    const centeredBoardVectors = centerEmbeddings(boardVectors, clueIndex.centering.mean);
    const blueResult = analyzeEmbeddedBoard(boardSnapshot, centeredBoardVectors, clueIndex, {
      limit: RESULTS_PER_SIZE,
    });
    const redResult = analyzeEmbeddedBoard(
      boardForSide(boardSnapshot, SIDE.RED),
      centeredBoardVectors,
      clueIndex,
      { limit: RESULTS_PER_SIZE },
    );
    const boardMetrics = calculateBoardMetrics(blueResult, redResult);
    latestAnalyses = { [SIDE.BLUE]: blueResult, [SIDE.RED]: redResult };
    latestAnalysis = latestAnalyses[activeSide];
    renderRecommendationTable();
    renderBoardMetrics(boardMetrics);
    renderAnalysisSummary(latestAnalysis);
    const scoreMs = Math.round(performance.now() - scoreStartedAt);
    elements.analysisStatus.textContent = `${latestAnalysis.summary.candidateTotal} candidates | ${scoreMs} ms score`;
    hasAnalysis = true;
  } catch (error) {
    if (runId !== analysisRun) {
      return;
    }
    renderError(error);
  } finally {
    if (runId === analysisRun) {
      setAnalysisBusy(false);
    }
  }
}

function renderModelProgress(event, runId) {
  if (runId !== analysisRun) {
    return;
  }

  if (event.status === "progress" && typeof event.progress === "number") {
    elements.analysisStatus.textContent = `Loading local model ${Math.round(event.progress)}%`;
    return;
  }

  if (event.status === "ready") {
    elements.analysisStatus.textContent = "Scoring candidates";
  }
}

function setAnalysisBusy(isBusy) {
  elements.resultsPanel?.setAttribute("aria-busy", String(isBusy));
  elements.boardMetrics?.setAttribute("aria-busy", String(isBusy));
  if (isBusy) {
    elements.analysisStatus.textContent = hasAnalysis ? "Updating analysis" : "Loading local model";
  }
}

function renderPending() {
  renderBoardMetrics();
  renderWorthDistribution([]);
  renderMessage(elements.recommendationResults, "Loading local embedding model...");
  elements.recommendationCount.textContent = "-";
}

function renderError(error) {
  invalidateAnalyses();
  renderBoardMetrics();
  renderWorthDistribution([]);
  const message = error instanceof Error ? error.message : String(error);
  renderMessage(elements.recommendationResults, "Analysis unavailable.", "error");
  elements.recommendationCount.textContent = "-";
  elements.analysisStatus.textContent = message;
}

function renderAnalysisSummary(analysis) {
}

function renderRecommendationTable() {
  if (!latestAnalysis) {
    return;
  }

  const rangeSuggestions = latestAnalysis.suggestions.filter(
    (suggestion) => suggestion.number >= targetRange.min && suggestion.number <= targetRange.max,
  );
  const qualitySuggestions = latestAnalysis.suggestions.filter(
    (suggestion) => suggestion.worth >= minimumWorth,
  );
  const suggestions = rangeSuggestions.filter(
    (suggestion) => suggestion.worth >= minimumWorth,
  );
  const rangeLabel = formatTargetRange(targetRange);
  renderMobileSortControl();
  renderWorthDistribution(rangeSuggestions);
  renderTargetCountBreakdown(qualitySuggestions);
  elements.recommendationCount.textContent = String(suggestions.length);
  elements.recommendationCount.setAttribute(
    "aria-label",
    `${suggestions.length} ${sideLabel(activeSide)} recommendations for ${rangeLabel} target words with Worth ${minimumWorth} or higher`,
  );
  renderSuggestions(
    elements.recommendationResults,
    suggestions,
    `No ${sideLabel(activeSide)} clue found for ${rangeLabel} target words with Worth ${minimumWorth} or higher.`,
  );
}

function renderMobileSortControl() {
  elements.mobileSuggestionSort.value = `${suggestionSort.key}:${suggestionSort.direction}`;
  for (const option of elements.mobileSuggestionSort.querySelectorAll("[data-advanced]")) {
    option.hidden = !showAdvancedMetrics;
    option.disabled = !showAdvancedMetrics;
  }
}

function renderBoardMetrics(metrics = null) {
  const complexityDefinition = BOARD_METRIC_DEFINITIONS.complexity;
  const edgeDefinition = BOARD_METRIC_DEFINITIONS.edge;
  const complexity = createBoardMetric({
    definition: complexityDefinition,
    value: metrics ? `${metrics.complexity} ${complexityLabel(metrics.complexity)}` : "--",
    tone: metrics ? complexityTone(metrics.complexity) : "",
  });
  const edge = createBoardMetric({
    definition: edgeDefinition,
    value: metrics ? formatSideEdge(metrics.edge) : "--",
    detail: metrics ? `B ${metrics.blueEase} / R ${metrics.redEase}` : "",
    tone: metrics ? sideEdgeTone(metrics.edge) : "",
  });

  elements.boardMetrics.replaceChildren(complexity, edge);
}

function createBoardMetric({ definition, value, detail = "", tone }) {
  const metric = document.createElement("div");
  metric.className = "board-metric";
  if (tone) {
    metric.dataset.tone = tone;
  }

  const heading = document.createElement("span");
  heading.className = "board-metric-heading";
  const label = document.createElement("span");
  label.className = "board-metric-label";
  label.textContent = definition.label;
  heading.append(label, createInfoControl(definition, "board-metrics"));

  const score = document.createElement("strong");
  score.className = "board-metric-value";
  score.textContent = value;
  metric.append(heading, score);

  if (detail) {
    const metadata = document.createElement("span");
    metadata.className = "board-metric-detail";
    metadata.textContent = detail;
    metric.append(metadata);
  }

  return metric;
}

function renderSuggestions(container, suggestions, emptyMessage) {
  container.replaceChildren();

  if (suggestions.length === 0) {
    renderMessage(container, emptyMessage);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "suggestion-table-wrap";

  const table = document.createElement("table");
  table.className = `suggestion-table${showAdvancedMetrics ? " is-advanced" : ""}`;
  const columns = SUGGESTION_COLUMNS.filter(
    (column) => showAdvancedMetrics || !column.advanced,
  );
  const columnGroup = document.createElement("colgroup");
  for (const column of columns) {
    const tableColumn = document.createElement("col");
    tableColumn.className = `column-${column.id}`;
    columnGroup.append(tableColumn);
  }

  const header = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.dataset.column = column.id;
    const isActive = column.key === suggestionSort.key;
    const content = document.createElement("div");
    content.className = "column-header-content";

    if (column.key) {
      cell.setAttribute(
        "aria-sort",
        isActive ? (suggestionSort.direction === "asc" ? "ascending" : "descending") : "none",
      );
      const sortButton = document.createElement("button");
      sortButton.className = "sort-button";
      sortButton.type = "button";
      sortButton.dataset.sortKey = column.key;
      sortButton.setAttribute(
        "aria-label",
        isActive
          ? `Sort by ${column.label}, currently ${suggestionSort.direction === "asc" ? "ascending" : "descending"}`
          : `Sort by ${column.label}`,
      );
      sortButton.addEventListener("click", () => {
        setSuggestionSort(column);
      });

      const label = document.createElement("span");
      label.textContent = column.label;
      const icon = document.createElement("span");
      icon.className = `sort-icon${isActive ? ` ${suggestionSort.direction}` : ""}`;
      icon.setAttribute("aria-hidden", "true");
      sortButton.append(label, icon);
      content.append(sortButton);
    } else {
      const label = document.createElement("span");
      label.className = "column-label";
      label.textContent = column.label;
      content.append(label);
    }

    if (column.info) {
      content.append(createInfoControl(column, container.id));
    }

    cell.append(content);
    headerRow.append(cell);
  }
  header.append(headerRow);

  const body = document.createElement("tbody");
  for (const suggestion of [...suggestions].sort(compareSuggestionsForDisplay)) {
    body.append(renderSuggestionRow(suggestion, columns));
  }

  table.append(columnGroup, header, body);
  wrapper.append(table);
  container.append(wrapper);
  createIcons({
    icons: { Check },
    attrs: { width: 15, height: 15, "stroke-width": 2.5 },
    root: wrapper,
  });
}

function setSuggestionSort(column) {
  if (suggestionSort.key === column.key) {
    suggestionSort = {
      key: column.key,
      direction: suggestionSort.direction === "asc" ? "desc" : "asc",
    };
  } else {
    suggestionSort = {
      key: column.key,
      direction: column.direction,
    };
  }

  renderRecommendationTable();
}

function compareSuggestionsForDisplay(left, right) {
  const leftValue = suggestionSortValue(left, suggestionSort.key);
  const rightValue = suggestionSortValue(right, suggestionSort.key);
  let comparison = compareSortValues(leftValue, rightValue);

  if (suggestionSort.direction === "desc") {
    comparison *= -1;
  }
  if (comparison !== 0) {
    return comparison;
  }

  if (suggestionSort.key !== "number" && right.number !== left.number) {
    return right.number - left.number;
  }

  if (suggestionSort.key === "number") {
    const worthComparison =
      suggestionSortValue(right, "worth") - suggestionSortValue(left, "worth");
    if (worthComparison !== 0) {
      return worthComparison;
    }
  }

  return right.sortScore - left.sortScore;
}

function suggestionSortValue(suggestion, key) {
  if (key === "clue") {
    return suggestion.clue;
  }
  if (key === "number" || key === "worth") {
    return suggestion[key];
  }
  if (key === "expectedNet") {
    return Number(suggestion.expectedNet.toFixed(1));
  }
  if (key === "success") {
    return Math.round(suggestion.success * 100);
  }
  if (key === "risk") {
    return RISK_SORT_VALUE[suggestion.risk];
  }
  if (key === "danger") {
    return Number(suggestion.closestDanger.sim.toFixed(2));
  }
  if (key === "margin") {
    return Number(suggestion.margin.toFixed(2));
  }

  return 0;
}

function compareSortValues(left, right) {
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  return left - right;
}

function renderMessage(container, message, variant = "") {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = variant ? `empty ${variant}` : "empty";
  empty.textContent = message;
  container.append(empty);
}

function renderSuggestionRow(suggestion, columns) {
  const row = document.createElement("tr");
  row.className = "suggestion-row";
  row.dataset.risk = suggestion.risk;
  row.dataset.targetCount = String(suggestion.number);
  const gameOver = Boolean(winningSide(board));
  row.dataset.actionable = String(!gameOver);
  const applyLabel = `Apply ${suggestion.clue} ${suggestion.number} for ${sideLabel(activeSide)} and mark ${suggestion.targets.map((target) => target.word).join(", ")} guessed`;
  row.title = applyLabel;
  row.addEventListener("click", (event) => {
    if (!gameOver && !event.target.closest("button")) {
      applyRecommendation(suggestion);
    }
  });

  const clueCell = createTableCell("Clue", "clue-cell");
  const clue = document.createElement("strong");
  clue.textContent = suggestion.clue;
  clue.title = suggestion.clue;
  clueCell.append(clue);

  const actionCell = createTableCell("Apply", "action-cell");
  const applyButton = document.createElement("button");
  applyButton.className = "apply-suggestion-button";
  applyButton.type = "button";
  applyButton.setAttribute("aria-label", applyLabel);
  applyButton.title = applyLabel;
  applyButton.disabled = gameOver;
  applyButton.addEventListener("click", () => applyRecommendation(suggestion));
  const applyIcon = document.createElement("i");
  applyIcon.dataset.lucide = "check";
  applyIcon.setAttribute("aria-hidden", "true");
  applyButton.append(applyIcon);
  actionCell.append(applyButton);

  const itemCell = createTableCell("Items", "item-cell");
  const itemCount = document.createElement("strong");
  itemCount.textContent = String(suggestion.number);
  itemCell.append(itemCount);

  const targetsCell = createTableCell("Targets", "targets-cell");
  const targets = document.createElement("div");
  targets.className = "target-list";
  for (const target of suggestion.targets) {
    const chip = document.createElement("span");
    chip.className = "target-chip";
    const score = formatNumber(target.sim, 2);
    chip.setAttribute("aria-label", `${target.word}, similarity ${score}`);
    chip.title = `${target.word} ${score}`;
    const word = document.createElement("span");
    word.className = "target-word";
    word.textContent = target.word;
    const value = document.createElement("span");
    value.className = "target-score";
    value.textContent = score;
    chip.append(word, value);
    targets.append(chip);
  }
  targetsCell.append(targets);

  const worthCell = createScoreCell("Worth", String(suggestion.worth), "worth-cell");
  const netCell = createScoreCell("Net", formatSigned(suggestion.expectedNet, 1), "net-cell");
  const hitCell = createScoreCell(
    "Est. hit",
    `${Math.round(suggestion.success * 100)}%`,
    "hit-cell",
  );

  const riskCell = createTableCell("Risk", "risk-cell");
  const badge = document.createElement("span");
  badge.className = `badge ${suggestion.risk}`;
  badge.textContent = labelRisk(suggestion.risk);
  riskCell.append(badge);

  const dangerCell = createTableCell("Closest danger", "danger-cell");
  const dangerChip = document.createElement("span");
  const dangerTeam = boardTeamFromPerspective(suggestion.closestDanger.team, activeSide);
  dangerChip.className = `danger-chip ${dangerTeam}`;
  const dangerSimilarity = formatNumber(suggestion.closestDanger.sim, 2);
  const dangerRole = teamLabel(dangerTeam);
  const dangerWord = document.createElement("span");
  dangerWord.className = "danger-word";
  dangerWord.textContent = suggestion.closestDanger.word;
  const dangerScore = document.createElement("span");
  dangerScore.className = "danger-score";
  dangerScore.textContent = dangerSimilarity;
  dangerChip.append(dangerWord, dangerScore);
  dangerChip.setAttribute(
    "aria-label",
    `${suggestion.closestDanger.word}, ${dangerRole}, similarity ${dangerSimilarity}`,
  );
  dangerChip.title = dangerRole;
  dangerCell.append(dangerChip);

  const marginCell = createScoreCell(
    "Margin",
    formatSigned(suggestion.margin, 2),
    suggestion.margin >= 0 ? "margin-cell positive" : "margin-cell negative",
  );

  const semanticsCell = createTableCell("Fit / cohesion", "semantics-cell");
  const fit = document.createElement("span");
  fit.textContent = `Fit ${formatNumber(suggestion.centroidFit, 2)}`;
  const cohesion = document.createElement("span");
  cohesion.textContent = `Coh ${formatNumber(suggestion.cohesion, 2)}`;
  semanticsCell.append(fit, cohesion);

  const cells = {
    clue: clueCell,
    items: itemCell,
    targets: targetsCell,
    worth: worthCell,
    net: netCell,
    hit: hitCell,
    risk: riskCell,
    danger: dangerCell,
    margin: marginCell,
    semantics: semanticsCell,
    action: actionCell,
  };
  for (const column of columns) {
    row.append(cells[column.id]);
  }
  return row;
}

function applyRecommendation(suggestion) {
  if (winningSide(board)) {
    return;
  }

  const playedSide = activeSide;
  const applied = applySuggestionTurn(board, suggestion, playedSide);
  if (applied.appliedLayoutIds.length === 0) {
    return;
  }

  board = applied.cards;
  flippingCardLayoutIds = new Set(applied.appliedLayoutIds);
  turnMessage = `${suggestion.clue.toUpperCase()} ${suggestion.number} applied for ${sideLabel(playedSide)}`;
  if (applied.nextSide !== activeSide) {
    activeSide = applied.nextSide;
    targetRange = targetRanges[activeSide];
  }
  invalidateAnalyses();
  render();
}

function createTableCell(label, className) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.dataset.label = label;
  return cell;
}

function createScoreCell(label, value, className) {
  const cell = createTableCell(label, `score-cell ${className}`);
  const score = document.createElement("strong");
  score.textContent = value;
  cell.append(score);
  return cell;
}

function loadBoardState(state) {
  board = cloneBoard(state.cards);
  randomLayoutOrder = [...state.randomLayoutOrder];
  boardOrder = state.order;
  boardWordSet = state.wordSet;
  boardSource = { ...state.source };
  board =
    boardOrder === BOARD_ORDER.RANDOM
      ? sortBoardByRandomLayout(board)
      : sortBoardByRole(board);
  resetGameState();
}

function sortBoardByRole(cards) {
  return cards
    .map((card, sourceIndex) => ({ card, sourceIndex }))
    .sort(
      (left, right) =>
        TEAM_SORT_ORDER.get(left.card.team) - TEAM_SORT_ORDER.get(right.card.team) ||
        left.card.layoutId - right.card.layoutId ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ card }) => card);
}

function sortBoardByRandomLayout(cards) {
  const positions = new Map(randomLayoutOrder.map((layoutId, index) => [layoutId, index]));
  return [...cards].sort(
    (left, right) => positions.get(left.layoutId) - positions.get(right.layoutId),
  );
}

function renderBoardCounts(cards) {
  const counts = Object.fromEntries(TEAMS.map((team) => [team.id, 0]));
  let doneCount = 0;
  for (const card of cards) {
    if (card.done) {
      doneCount += 1;
    } else {
      counts[card.team] += 1;
    }
  }

  const indicators = TEAMS.map((team) => {
    const indicator = document.createElement("span");
    indicator.className = "board-count";
    indicator.dataset.team = team.id;

    const label = document.createElement("span");
    label.textContent = team.label;
    const value = document.createElement("strong");
    value.textContent = String(counts[team.id]);

    indicator.append(label, value);
    return indicator;
  });

  if (doneCount > 0) {
    const doneIndicator = document.createElement("span");
    doneIndicator.className = "board-count";
    doneIndicator.dataset.team = "done";
    const label = document.createElement("span");
    label.textContent = "Guessed";
    const value = document.createElement("strong");
    value.textContent = String(doneCount);
    doneIndicator.append(label, value);
    indicators.push(doneIndicator);
  }

  elements.boardCounts.replaceChildren(...indicators);
  updateTargetRangeLimit(cards);
}

function updateTargetRangeLimit(cards) {
  const available = cards.filter(
    (card) =>
      !card.done &&
      card.team === teamForSide(activeSide) &&
      String(card.word ?? "").trim().length > 0,
  ).length;
  const nextLimit = Math.max(1, Math.min(MAX_TARGET_WORDS, available));
  targetRangeLimit = nextLimit;
  targetRange.max = Math.min(targetRange.max, targetRangeLimit);
  targetRange.min = Math.min(targetRange.min, targetRange.max);
  renderTargetRangeControl();

  if (latestAnalysis) {
    renderRecommendationTable();
  } else {
    renderTargetCountBreakdown([]);
  }
}

function setTargetRange(boundary, value) {
  if (boundary === "min") {
    targetRange.min = Math.min(value, targetRange.max);
  } else {
    targetRange.max = Math.max(value, targetRange.min);
  }

  renderTargetRangeControl();
  renderRecommendationTable();
}

function handleTargetRangeKey(boundary, event) {
  const current = targetRange[boundary];
  const nextValue = {
    ArrowDown: current - 1,
    ArrowLeft: current - 1,
    ArrowRight: current + 1,
    ArrowUp: current + 1,
    End: targetRangeLimit,
    Home: 1,
  }[event.key];

  if (nextValue === undefined) {
    return;
  }

  event.preventDefault();
  setTargetRange(boundary, Math.max(1, Math.min(targetRangeLimit, nextValue)));
}

function targetValueFromPointer(clientX) {
  const bounds = elements.targetRangeControl.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  return Math.round(1 + progress * (targetRangeLimit - 1));
}

function renderTargetRangeControl() {
  elements.targetMin.max = String(targetRangeLimit);
  elements.targetMax.max = String(targetRangeLimit);
  elements.targetMin.value = String(targetRange.min);
  elements.targetMax.value = String(targetRange.max);
  elements.targetRangeValue.textContent = formatTargetRange(targetRange);

  const denominator = Math.max(1, targetRangeLimit - 1);
  const start = ((targetRange.min - 1) / denominator) * 100;
  const end = ((targetRange.max - 1) / denominator) * 100;
  elements.targetRangeControl.style.setProperty("--range-start", `${start}%`);
  elements.targetRangeControl.style.setProperty("--range-end", `${end}%`);
  renderMinimumWorthControl();
}

function renderMinimumWorthControl() {
  elements.minimumWorth.value = String(minimumWorth);
  elements.minimumWorthValue.textContent = String(minimumWorth);
  elements.minimumWorth.style.setProperty("--worth-progress", `${(minimumWorth / 99) * 100}%`);
}

function renderWorthDistribution(suggestions) {
  const binSize = 5;
  const bins = Array.from({ length: 20 }, () => 0);
  for (const suggestion of suggestions) {
    const index = Math.min(bins.length - 1, Math.floor(suggestion.worth / binSize));
    bins[index] += 1;
  }

  const maximum = Math.max(1, ...bins);
  const bars = bins.map((count, index) => {
    const start = index * binSize;
    const end = index === bins.length - 1 ? 99 : start + binSize - 1;
    const bar = document.createElement("span");
    bar.className = "worth-distribution-bar";
    bar.dataset.included = String(end >= minimumWorth);
    bar.dataset.empty = String(count === 0);
    bar.style.setProperty(
      "--bar-height",
      count === 0 ? "0%" : `${(count / maximum) * 100}%`,
    );
    bar.title = `Worth ${start}-${end}: ${count} ${count === 1 ? "clue" : "clues"}`;
    return bar;
  });

  const included = suggestions.filter((suggestion) => suggestion.worth >= minimumWorth).length;
  const excluded = suggestions.length - included;
  elements.worthDistribution.replaceChildren(...bars);
  elements.worthDistribution.setAttribute(
    "aria-label",
    `Worth distribution for ${suggestions.length} clues in the selected target range. ${included} meet the minimum of ${minimumWorth}; lowering it can add ${excluded}.`,
  );
}

function renderTargetCountBreakdown(suggestions) {
  const counts = Array.from({ length: targetRangeLimit }, () => 0);
  for (const suggestion of suggestions) {
    if (suggestion.number <= targetRangeLimit) {
      counts[suggestion.number - 1] += 1;
    }
  }

  const marks = counts.map((count, index) => {
    const targetCount = index + 1;
    const mark = document.createElement("span");
    mark.className = "target-count-mark";
    mark.dataset.selected = String(
      targetCount >= targetRange.min && targetCount <= targetRange.max,
    );
    mark.dataset.hasResults = String(count > 0);
    mark.title = `${targetCount} target ${targetCount === 1 ? "word" : "words"}: ${count} ${count === 1 ? "clue" : "clues"}`;

    const number = document.createElement("strong");
    number.textContent = String(targetCount);
    const total = document.createElement("small");
    total.textContent = String(count);
    mark.append(number, total);
    return mark;
  });

  elements.targetCountBreakdown.replaceChildren(...marks);
  elements.targetCountBreakdown.setAttribute(
    "aria-label",
    counts
      .map(
        (count, index) =>
          `${index + 1} ${index === 0 ? "target" : "targets"}: ${count} ${count === 1 ? "clue" : "clues"}`,
      )
      .join("; "),
  );
}

function formatTargetRange(rangeValue) {
  return rangeValue.min === rangeValue.max
    ? String(rangeValue.min)
    : `${rangeValue.min}-${rangeValue.max}`;
}

function cloneBoard(cards) {
  return cards.map((card) => ({ ...card }));
}

function labelRisk(risk) {
  if (risk === "safe") {
    return "Safe";
  }

  if (risk === "medium") {
    return "Medium";
  }

  return "Risky";
}

function complexityLabel(complexity) {
  if (complexity <= 32) {
    return "Easy";
  }
  if (complexity <= 65) {
    return "Moderate";
  }
  return "Hard";
}

function complexityTone(complexity) {
  if (complexity <= 32) {
    return "easy";
  }
  if (complexity <= 65) {
    return "moderate";
  }
  return "hard";
}

function formatSideEdge(edge) {
  if (Math.abs(edge) <= 3) {
    return "Even";
  }
  return edge > 0 ? `Blue +${edge}` : `Red +${Math.abs(edge)}`;
}

function sideEdgeTone(edge) {
  if (Math.abs(edge) <= 3) {
    return "even";
  }
  return edge > 0 ? "blue" : "red";
}

function teamLabel(teamId) {
  return TEAM_BY_ID.get(teamId)?.label ?? teamId;
}

function sideLabel(side) {
  return side === SIDE.RED ? "Red" : "Blue";
}

function formatSigned(value, digits) {
  const fixed = Number(value).toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

function formatNumber(value, digits) {
  return Number(value).toFixed(digits);
}
