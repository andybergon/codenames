import { loadClueIndex } from "./clue-index.js";
import { EMBEDDING_MODEL, centerEmbeddings, embedTerms } from "./embeddings.js";
import { analyzeEmbeddedBoard } from "./model.js";
import { DEFAULT_BOARD, ROLE_SEQUENCE, TEAMS, WORD_BANK } from "./word-data.js";

const TEAM_BY_ID = new Map(TEAMS.map((team) => [team.id, team]));
const TEAM_SORT_ORDER = new Map(TEAMS.map((team, index) => [team.id, index]));
const MAX_RESULTS = 8;

let board = cloneBoard(DEFAULT_BOARD);
let boardOrder = "grouped";
let boardCollapsed = false;
let analyzeTimer = 0;
let analysisRun = 0;
let hasAnalysis = false;
let clueIndexPromise;

const elements = {
  boardGrid: document.querySelector("#board-grid"),
  boardCounts: document.querySelector("#board-counts"),
  safeResults: document.querySelector("#safe-results"),
  stretchResults: document.querySelector("#stretch-results"),
  resultsPanel: document.querySelector(".results-panel"),
  analysisStatus: document.querySelector("#analysis-status"),
  safeCount: document.querySelector("#safe-count"),
  stretchCount: document.querySelector("#stretch-count"),
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
  toggleBoard: document.querySelector("#toggle-board"),
};

elements.loadSample.addEventListener("click", () => {
  board = cloneBoard(DEFAULT_BOARD);
  boardOrder = "grouped";
  render();
});

elements.randomBoard.addEventListener("click", () => {
  board = createRandomBoard();
  boardOrder = "random";
  render();
});

elements.orderRandom.addEventListener("click", () => {
  boardOrder = "random";
  renderBoard();
});

elements.orderGrouped.addEventListener("click", () => {
  boardOrder = "grouped";
  renderBoard();
});

elements.toggleBoard.addEventListener("click", () => {
  boardCollapsed = !boardCollapsed;
  renderBoardVisibility();
});

render();

function render() {
  renderBoard();
  void runAnalysis();
}

function renderBoard() {
  elements.boardGrid.replaceChildren();

  const displayedBoard = board
    .map((card, sourceIndex) => ({ card, sourceIndex }))
    .sort((left, right) => {
      if (boardOrder === "random") {
        return left.sourceIndex - right.sourceIndex;
      }

      return (
        TEAM_SORT_ORDER.get(left.card.team) - TEAM_SORT_ORDER.get(right.card.team) ||
        left.sourceIndex - right.sourceIndex
      );
    });

  displayedBoard.forEach(({ card, sourceIndex }, displayIndex) => {
    const cardElement = document.createElement("div");
    cardElement.className = "word-card";
    cardElement.dataset.team = card.team;
    cardElement.dataset.sourceIndex = String(sourceIndex);

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
        render();
      });
      roleRow.append(roleButton);
    }

    cardElement.append(input, roleRow);
    elements.boardGrid.append(cardElement);
  });

  renderBoardCounts(board);
  elements.orderRandom.setAttribute("aria-pressed", String(boardOrder === "random"));
  elements.orderGrouped.setAttribute("aria-pressed", String(boardOrder === "grouped"));
  renderBoardVisibility();
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
      limit: MAX_RESULTS,
    });
    renderSuggestions(elements.safeResults, result.safe, "No safe 2-3 clue found for this board.");
    renderSuggestions(elements.stretchResults, result.stretch, "No stretch clue found for this board.");

    elements.safeCount.textContent = String(result.safe.length);
    elements.stretchCount.textContent = String(result.stretch.length);
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
  if (isBusy) {
    elements.analysisStatus.textContent = hasAnalysis ? "Updating analysis" : "Loading local model";
  }
}

function renderPending() {
  renderMessage(elements.safeResults, "Loading local embedding model...");
  renderMessage(elements.stretchResults, "Preparing clue index...");
  elements.safeCount.textContent = "-";
  elements.stretchCount.textContent = "-";
}

function renderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  renderMessage(elements.safeResults, "Analysis unavailable.", "error");
  renderMessage(elements.stretchResults, "Edit a card or load a board to retry.", "error");
  elements.analysisStatus.textContent = message;
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
  table.className = "suggestion-table";

  const header = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of [
    "Clue",
    "Items",
    "Targets",
    "Worth",
    "Net",
    "Est. hit",
    "Risk",
    "Closest danger",
    "Margin",
    "Fit / cohesion",
  ]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.append(cell);
  }
  header.append(headerRow);

  const body = document.createElement("tbody");
  for (const suggestion of suggestions) {
    body.append(renderSuggestionRow(suggestion));
  }

  table.append(header, body);
  wrapper.append(table);
  container.append(wrapper);
}

function renderMessage(container, message, variant = "") {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = variant ? `empty ${variant}` : "empty";
  empty.textContent = message;
  container.append(empty);
}

function renderSuggestionRow(suggestion) {
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
  dangerChip.textContent = `${suggestion.closestDanger.word} ${teamLabel(suggestion.closestDanger.team)} ${formatNumber(
    suggestion.closestDanger.sim,
    2,
  )}`;
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

  row.append(
    clueCell,
    itemCell,
    targetsCell,
    worthCell,
    netCell,
    hitCell,
    riskCell,
    dangerCell,
    marginCell,
    semanticsCell,
  );
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

function createRandomBoard() {
  const words = shuffle([...WORD_BANK]).slice(0, 25);
  const roles = shuffle([...ROLE_SEQUENCE]);

  return words.map((word, index) => ({
    word,
    team: roles[index],
  }));
}

function renderBoardCounts(cards) {
  const counts = Object.fromEntries(TEAMS.map((team) => [team.id, 0]));
  for (const card of cards) {
    counts[card.team] += 1;
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

  elements.boardCounts.replaceChildren(...indicators);
}

function cloneBoard(cards) {
  return cards.map((card) => ({ ...card }));
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
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
