import { Check, Monitor, Moon, Share2, Sun, createIcons } from "lucide";
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  createRandomSeed,
  createSampleBoardState,
  decodeBoardParam,
  encodeBoardParam,
} from "./board-share.js";
import { loadClueIndex } from "./clue-index.js";
import { EMBEDDING_MODEL, centerEmbeddings, embedTerms } from "./embeddings.js";
import { analyzeEmbeddedBoard, calculateBoardMetrics } from "./model.js";
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
const SUGGESTION_COLUMNS = [
  { id: "clue", label: "Clue", key: "clue", direction: "asc" },
  { id: "items", label: "Items", key: "number", direction: "desc" },
  { id: "targets", label: "Targets" },
  {
    id: "worth",
    label: "Worth",
    key: "worth",
    direction: "desc",
    info: "A 0-99 heuristic combining expected net, semantic fit, cohesion, safety margin, consistency, and clue familiarity.",
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
    info: "Heuristic chance that the clue safely reaches its intended targets. It is not calibrated from real games yet.",
  },
  {
    id: "risk",
    label: "Risk",
    key: "risk",
    direction: "desc",
    info: "Safe, Medium, or Risky based on margin, hit estimate, target count, and whether the assassin is the closest danger.",
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
];
const RISK_SORT_VALUE = {
  safe: 3,
  medium: 2,
  risky: 1,
};

const initialBoardState = readInitialBoardState();
let board = cloneBoard(initialBoardState.cards);
let boardCollapsed = false;
let boardOrder = initialBoardState.order;
let boardWordSet = initialBoardState.wordSet;
let nextBoardWordSet = boardWordSet;
let randomLayoutOrder = [...initialBoardState.randomLayoutOrder];
let boardSource = { ...initialBoardState.source };
let targetRange = { ...DEFAULT_TARGET_RANGE };
let targetRangeLimit = MAX_TARGET_WORDS;
let minimumWorth = DEFAULT_MINIMUM_WORTH;
let activeTargetBoundary = null;
let flippingCardIndex = null;
let suggestionSort = { key: "worth", direction: "desc" };
let showAdvancedMetrics = false;
let latestAnalysis = null;
let analyzeTimer = 0;
let analysisRun = 0;
let hasAnalysis = false;
let clueIndexPromise;
let shareFeedbackTimer = 0;

board =
  boardOrder === BOARD_ORDER.RANDOM ? sortBoardByRandomLayout(board) : sortBoardByRole(board);

const elements = {
  boardGrid: document.querySelector("#board-grid"),
  boardCounts: document.querySelector("#board-counts"),
  boardMetrics: document.querySelector("#board-metrics"),
  recommendationResults: document.querySelector("#recommendation-results"),
  resultsPanel: document.querySelector(".results-panel"),
  analysisStatus: document.querySelector("#analysis-status"),
  recommendationCount: document.querySelector("#recommendation-count"),
  targetRangeControl: document.querySelector("#target-range-control"),
  targetRangeValue: document.querySelector("#target-range-value"),
  targetCountBreakdown: document.querySelector("#target-count-breakdown"),
  targetMin: document.querySelector("#target-min"),
  targetMax: document.querySelector("#target-max"),
  minimumWorth: document.querySelector("#minimum-worth"),
  minimumWorthValue: document.querySelector("#minimum-worth-value"),
  mobileSuggestionSort: document.querySelector("#mobile-suggestion-sort"),
  advancedMetrics: document.querySelector("#advanced-metrics"),
  worthDistribution: document.querySelector("#worth-distribution"),
  friendlyTotal: document.querySelector("#friendly-total"),
  candidateTotal: document.querySelector("#candidate-total"),
  bestMargin: document.querySelector("#best-margin"),
  bestNet: document.querySelector("#best-net"),
  modelName: document.querySelector("#model-name"),
  vocabularySource: document.querySelector("#vocabulary-source"),
  loadSample: document.querySelector("#load-sample"),
  randomBoard: document.querySelector("#random-board"),
  orderRandom: document.querySelector("#order-random"),
  orderGrouped: document.querySelector("#order-grouped"),
  wordSetButtons: [...document.querySelectorAll("[data-word-set-value]")],
  shareBoard: document.querySelector("#share-board"),
  toggleBoard: document.querySelector("#toggle-board"),
  themeButtons: [...document.querySelectorAll("[data-theme-value]")],
};

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

createIcons({
  icons: { Check, Monitor, Moon, Share2, Sun },
  attrs: { width: 18, height: 18, "stroke-width": 2 },
});

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

applyTheme(readThemeSetting());
render();

function render() {
  renderBoard();
  void runAnalysis();
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
    if (sourceIndex === flippingCardIndex) {
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
      backStatus.textContent = "Done";
      back.append(backWord, backStatus);

      const restoreButton = createCardStateButton({
        action: "restore-card",
        label: `Return ${cardWord} to the board`,
        title: `Return ${cardWord} to the board`,
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
      label: `Mark ${cardWord} as done`,
      title: `Mark ${cardWord} as done`,
      onClick: () => setCardDone(sourceIndex, true),
    });

    cardElement.append(input, roleRow, doneButton);
    elements.boardGrid.append(cardElement);
  });

  flippingCardIndex = null;

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
  board[sourceIndex] = {
    ...board[sourceIndex],
    done,
  };
  flippingCardIndex = sourceIndex;
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

function scheduleAnalysis() {
  window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => {
    void runAnalysis();
    renderBoardCounts(board);
  }, 180);
}

async function runAnalysis() {
  const runId = ++analysisRun;
  const startedAt = performance.now();
  setAnalysisBusy(true);

  if (!hasAnalysis) {
    renderPending();
  }

  try {
    clueIndexPromise ??= loadClueIndex();
    const boardSnapshot = cloneBoard(board);
    const [clueIndex, boardVectors] = await Promise.all([
      clueIndexPromise,
      embedTerms(
        boardSnapshot.map((card) => card.word),
        {
          onProgress: (event) => renderModelProgress(event, runId),
        },
      ),
    ]);

    if (runId !== analysisRun) {
      return;
    }
    if (clueIndex.model !== EMBEDDING_MODEL) {
      throw new Error(`Clue index uses ${clueIndex.model}, but the browser loaded ${EMBEDDING_MODEL}`);
    }

    const centeredBoardVectors = centerEmbeddings(boardVectors, clueIndex.centering.mean);
    const result = analyzeEmbeddedBoard(boardSnapshot, centeredBoardVectors, clueIndex, {
      limit: RESULTS_PER_SIZE,
    });
    const redResult = analyzeEmbeddedBoard(
      swapCompetitiveTeams(boardSnapshot),
      centeredBoardVectors,
      clueIndex,
      { limit: RESULTS_PER_SIZE },
    );
    const boardMetrics = calculateBoardMetrics(result, redResult);
    latestAnalysis = result;
    renderRecommendationTable();
    renderBoardMetrics(boardMetrics);

    elements.friendlyTotal.textContent = String(result.summary.friendlyTotal);
    elements.candidateTotal.textContent = String(result.summary.candidateTotal);
    elements.bestMargin.textContent = formatSigned(result.summary.bestMargin, 2);
    elements.bestNet.textContent = formatSigned(result.summary.bestNet, 1);
    elements.modelName.textContent = shortModelName(clueIndex.model);
    elements.vocabularySource.textContent = `${clueIndex.vocabulary.source} ${clueIndex.vocabulary.sourceVersion} + seeds`;
    elements.analysisStatus.textContent = `${result.summary.candidateTotal} candidates | ${Math.round(performance.now() - startedAt)} ms`;
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
  latestAnalysis = null;
  renderBoardMetrics();
  renderWorthDistribution([]);
  const message = error instanceof Error ? error.message : String(error);
  renderMessage(elements.recommendationResults, "Analysis unavailable.", "error");
  elements.recommendationCount.textContent = "-";
  elements.analysisStatus.textContent = message;
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
    `${suggestions.length} recommendations for ${rangeLabel} target words with Worth ${minimumWorth} or higher`,
  );
  renderSuggestions(
    elements.recommendationResults,
    suggestions,
    `No clue found for ${rangeLabel} target words with Worth ${minimumWorth} or higher.`,
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
}

function createInfoControl(column, tableId) {
  const control = document.createElement("span");
  control.className = "info-control";
  control.addEventListener("pointerenter", () => {
    control.classList.remove("is-dismissed");
    positionInfoPopover(button, popover);
  });
  control.addEventListener("focusin", () => {
    control.classList.remove("is-dismissed");
    positionInfoPopover(button, popover);
  });

  const tooltipId = `info-${tableId}-${column.id}`;
  const button = document.createElement("button");
  button.className = "info-button";
  button.type = "button";
  button.textContent = "i";
  button.setAttribute("aria-label", `About ${column.label}`);
  button.setAttribute("aria-controls", tooltipId);
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    closeInfoPopovers();
    control.classList.remove("is-dismissed");
    button.setAttribute("aria-expanded", String(!wasOpen));
    if (!wasOpen) {
      positionInfoPopover(button, popover);
    }
  });

  const popover = document.createElement("span");
  popover.className = "info-popover";
  popover.id = tooltipId;
  popover.role = "tooltip";
  popover.textContent = column.info;

  control.append(button, popover);
  return control;
}

function positionInfoPopover(button, popover) {
  requestAnimationFrame(() => {
    const buttonBounds = button.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const gutter = 12;
    const gap = 8;
    const left = Math.max(
      gutter,
      Math.min(buttonBounds.left, window.innerWidth - popoverBounds.width - gutter),
    );
    const below = buttonBounds.bottom + gap;
    const top =
      below + popoverBounds.height <= window.innerHeight - gutter
        ? below
        : Math.max(gutter, buttonBounds.top - popoverBounds.height - gap);
    popover.style.setProperty("--info-left", `${left}px`);
    popover.style.setProperty("--info-top", `${top}px`);
  });
}

function closeInfoPopovers() {
  for (const control of document.querySelectorAll(".info-control")) {
    control.querySelector(".info-button")?.setAttribute("aria-expanded", "false");
    control.classList.add("is-dismissed");
  }
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

  const clueCell = createTableCell("Clue", "clue-cell");
  const clue = document.createElement("strong");
  clue.textContent = suggestion.clue;
  clueCell.append(clue);

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
    chip.textContent = `${target.word} ${formatNumber(target.sim, 2)}`;
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
  dangerChip.className = `danger-chip ${suggestion.closestDanger.team}`;
  const dangerSimilarity = formatNumber(suggestion.closestDanger.sim, 2);
  const dangerRole = teamLabel(suggestion.closestDanger.team);
  dangerChip.textContent = `${suggestion.closestDanger.word} ${dangerSimilarity}`;
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
  };
  for (const column of columns) {
    row.append(cells[column.id]);
  }
  return row;
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

function swapCompetitiveTeams(cards) {
  return cards.map((card) => ({
    ...card,
    team:
      card.team === "friendly" ? "enemy" : card.team === "enemy" ? "friendly" : card.team,
  }));
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
    label.textContent = "Done";
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
      !card.done && card.team === "friendly" && String(card.word ?? "").trim().length > 0,
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

function shortModelName(model) {
  return model.split("/").at(-1) ?? model;
}

function formatSigned(value, digits) {
  const fixed = Number(value).toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

function formatNumber(value, digits) {
  return Number(value).toFixed(digits);
}
