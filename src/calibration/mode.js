import {
  calibrationProgress,
  clearCalibrationAnswer,
  createCalibrationState,
  loadCalibrationState,
  mergeCalibrationRound,
  normalizeCalibrationRound,
  normalizeCalibrationState,
  saveCalibrationState,
  upsertCalibrationAnswer,
} from "./store.js";

const DEFAULT_MANIFEST_URL = "/data/calibration/manifest.json";

export function createCalibrationMode(options = {}) {
  const root = document.querySelector("#calibration-mode");
  if (!root) {
    return { setActive() {} };
  }

  let state = loadCalibrationState();
  let activeRoundId = state.rounds[0]?.round.roundId ?? null;
  let taskIndex = 0;
  let selectedGuesses = [];
  let active = false;
  let initialized = false;
  let statusMessage = "";

  root.replaceChildren(buildShell());
  const elements = {
    roundSelect: root.querySelector("#calibration-round"),
    progress: root.querySelector("#calibration-progress"),
    taskNav: root.querySelector("#calibration-task-nav"),
    clue: root.querySelector("#calibration-clue"),
    number: root.querySelector("#calibration-number"),
    board: root.querySelector("#calibration-board"),
    guessOrder: root.querySelector("#calibration-guess-order"),
    judgment: root.querySelector("#calibration-judgment"),
    note: root.querySelector("#calibration-note"),
    status: root.querySelector("#calibration-status"),
    previous: root.querySelector("#calibration-previous"),
    next: root.querySelector("#calibration-next"),
    saveNext: root.querySelector("#calibration-save-next"),
    clear: root.querySelector("#calibration-clear"),
    exportButton: root.querySelector("#calibration-export"),
    importButton: root.querySelector("#calibration-import"),
    importInput: root.querySelector("#calibration-import-input"),
  };

  elements.roundSelect.addEventListener("change", () => {
    activeRoundId = elements.roundSelect.value;
    taskIndex = firstUnansweredIndex(activeRound());
    loadCurrentAnswer();
    render();
  });
  elements.previous.addEventListener("click", () => moveTask(-1));
  elements.next.addEventListener("click", () => moveTask(1));
  elements.saveNext.addEventListener("click", () => saveCurrentAnswer(true));
  elements.clear.addEventListener("click", clearCurrentAnswer);
  elements.judgment.addEventListener("change", () => {
    statusMessage = "";
  });
  elements.note.addEventListener("input", () => {
    statusMessage = "";
  });
  elements.exportButton.addEventListener("click", exportState);
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => {
    void importFile(elements.importInput.files?.[0]);
    elements.importInput.value = "";
  });

  return {
    async setActive(nextActive) {
      active = nextActive;
      root.hidden = !active;
      if (!active) return;
      if (!initialized) {
        initialized = true;
        await loadBuiltInRounds(options.manifestUrl ?? DEFAULT_MANIFEST_URL);
      }
      render();
    },
  };

  async function loadBuiltInRounds(manifestUrl) {
    try {
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`Calibration manifest returned ${response.status}.`);
      }
      const manifest = await response.json();
      for (const roundUrl of manifest.rounds ?? []) {
        const roundResponse = await fetch(new URL(roundUrl, response.url));
        if (!roundResponse.ok) {
          throw new Error(`Calibration round returned ${roundResponse.status}.`);
        }
        state = mergeCalibrationRound(state, await roundResponse.json());
      }
      saveCalibrationState(state);
      activeRoundId ??= state.rounds[0]?.round.roundId ?? null;
      taskIndex = firstUnansweredIndex(activeRound());
      loadCurrentAnswer();
    } catch (error) {
      statusMessage =
        state.rounds.length > 0
          ? "Built-in rounds could not be refreshed. Saved rounds remain available."
          : error.message;
    }
  }

  function render() {
    renderRoundOptions();
    const storedRound = activeRound();
    const task = currentTask();
    const progress = calibrationProgress(storedRound);
    elements.progress.textContent = storedRound
      ? `${progress.answered}/${progress.taskCount} answered`
      : "No calibration round";
    elements.taskNav.replaceChildren(
      ...(storedRound?.round.tasks ?? []).map(({ taskId }, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "calibration-task-dot";
        button.dataset.state = storedRound.answers[taskId]
          ? "answered"
          : "unanswered";
        button.setAttribute("aria-label", `Open calibration task ${index + 1}`);
        button.setAttribute("aria-current", String(index === taskIndex));
        button.addEventListener("click", () => {
          taskIndex = index;
          loadCurrentAnswer();
          render();
        });
        return button;
      }),
    );
    renderTask(task);
    elements.previous.disabled = !task || taskIndex === 0;
    elements.next.disabled =
      !task || taskIndex === storedRound.round.tasks.length - 1;
    elements.saveNext.disabled = !task;
    elements.clear.disabled = !task || !storedRound.answers[task.taskId];
    elements.exportButton.disabled = state.rounds.length === 0;
    elements.status.textContent = statusMessage;
  }

  function renderRoundOptions() {
    const selected = activeRoundId;
    elements.roundSelect.replaceChildren(
      ...state.rounds.map(({ round, answers }) => {
        const option = document.createElement("option");
        const answered = Object.keys(answers).length;
        option.value = round.roundId;
        option.textContent = `${round.title} (${answered}/${round.tasks.length})`;
        return option;
      }),
    );
    elements.roundSelect.disabled = state.rounds.length === 0;
    if (selected && state.rounds.some(({ round }) => round.roundId === selected)) {
      elements.roundSelect.value = selected;
    }
  }

  function renderTask(task) {
    elements.board.replaceChildren();
    if (!task) {
      elements.clue.textContent = "Import or generate a calibration round";
      elements.number.textContent = "";
      elements.guessOrder.textContent = "";
      elements.judgment.value = "";
      elements.note.value = "";
      return;
    }
    elements.clue.textContent = task.clue;
    elements.number.textContent = String(task.number);
    elements.board.replaceChildren(
      ...task.words.map((entry) => {
        const button = document.createElement("button");
        const guessPosition = selectedGuesses.indexOf(entry.layoutId);
        button.type = "button";
        button.className = "calibration-word";
        button.dataset.selected = String(guessPosition >= 0);
        button.setAttribute(
          "aria-label",
          guessPosition >= 0
            ? `${entry.word}, guess ${guessPosition + 1}`
            : entry.word,
        );
        const label = document.createElement("span");
        label.textContent = entry.word;
        button.append(label);
        if (guessPosition >= 0) {
          const order = document.createElement("b");
          order.textContent = String(guessPosition + 1);
          order.setAttribute("aria-hidden", "true");
          button.append(order);
        }
        button.addEventListener("click", () => toggleGuess(entry.layoutId));
        return button;
      }),
    );
    renderGuessOrder(task);
  }

  function renderGuessOrder(task) {
    const words = new Map(task.words.map((entry) => [entry.layoutId, entry.word]));
    elements.guessOrder.textContent =
      selectedGuesses.length > 0
        ? selectedGuesses
            .map((layoutId, index) => `${index + 1}. ${words.get(layoutId)}`)
            .join("  ")
        : "No guesses selected. Saving this records a pass.";
  }

  function toggleGuess(layoutId) {
    const existingIndex = selectedGuesses.indexOf(layoutId);
    if (existingIndex >= 0) {
      selectedGuesses.splice(existingIndex, 1);
    } else {
      const task = currentTask();
      if (selectedGuesses.length >= task.number + 1) {
        statusMessage = `This clue allows at most ${task.number + 1} guesses.`;
        render();
        return;
      }
      selectedGuesses.push(layoutId);
    }
    statusMessage = "";
    renderTask(currentTask());
    elements.status.textContent = statusMessage;
  }

  function saveCurrentAnswer(advance) {
    const task = currentTask();
    if (!task) return;
    state = upsertCalibrationAnswer(
      state,
      activeRoundId,
      task.taskId,
      {
        guessedLayoutIds: selectedGuesses,
        judgment: elements.judgment.value,
        note: elements.note.value,
      },
    );
    saveCalibrationState(state);
    statusMessage = "Answer saved locally.";
    if (advance && taskIndex < activeRound().round.tasks.length - 1) {
      taskIndex += 1;
      loadCurrentAnswer();
    }
    render();
  }

  function clearCurrentAnswer() {
    const task = currentTask();
    if (!task) return;
    state = clearCalibrationAnswer(state, activeRoundId, task.taskId);
    saveCalibrationState(state);
    statusMessage = "Saved answer cleared.";
    loadCurrentAnswer();
    render();
  }

  function moveTask(offset) {
    const tasks = activeRound()?.round.tasks ?? [];
    taskIndex = Math.max(0, Math.min(tasks.length - 1, taskIndex + offset));
    loadCurrentAnswer();
    render();
  }

  function loadCurrentAnswer() {
    const task = currentTask();
    const answer = task ? activeRound()?.answers[task.taskId] : null;
    selectedGuesses = [...(answer?.guessedLayoutIds ?? [])];
    elements.judgment.value = answer?.judgment ?? "";
    elements.note.value = answer?.note ?? "";
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      if (normalizeCalibrationRound(value)) {
        state = mergeCalibrationRound(state, value);
        activeRoundId = value.roundId;
      } else {
        const imported = normalizeCalibrationState(value);
        if (imported.rounds.length === 0) {
          throw new Error("The file contains no valid calibration rounds.");
        }
        for (const storedRound of imported.rounds) {
          state = mergeCalibrationRound(state, storedRound.round);
          const current = state.rounds.find(
            ({ round }) => round.roundId === storedRound.round.roundId,
          );
          current.answers = { ...current.answers, ...storedRound.answers };
        }
        activeRoundId = imported.rounds[0].round.roundId;
      }
      saveCalibrationState(state);
      taskIndex = firstUnansweredIndex(activeRound());
      loadCurrentAnswer();
      statusMessage = "Calibration data imported.";
    } catch (error) {
      statusMessage = `Import failed: ${error.message}`;
    }
    render();
  }

  function exportState() {
    const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `codenames-calibration-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    statusMessage = "Calibration data exported.";
    elements.status.textContent = statusMessage;
  }

  function activeRound() {
    return state.rounds.find(({ round }) => round.roundId === activeRoundId) ?? null;
  }

  function currentTask() {
    return activeRound()?.round.tasks[taskIndex] ?? null;
  }
}

function firstUnansweredIndex(storedRound) {
  if (!storedRound) return 0;
  const index = storedRound.round.tasks.findIndex(
    ({ taskId }) => !storedRound.answers[taskId],
  );
  return index === -1 ? 0 : index;
}

function buildShell() {
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("div");
  heading.className = "calibration-heading";
  heading.innerHTML = `
    <div>
      <p class="eyebrow">Hidden benchmark tool</p>
      <h2>Human calibration</h2>
      <p>Guess naturally from each blinded clue. Answers stay in this browser until exported.</p>
    </div>
    <div class="calibration-file-actions">
      <button id="calibration-import" class="button secondary" type="button">Import round</button>
      <button id="calibration-export" class="button secondary" type="button">Export answers</button>
      <input id="calibration-import-input" type="file" accept="application/json,.json" hidden />
    </div>`;

  const controls = document.createElement("div");
  controls.className = "calibration-controls";
  controls.innerHTML = `
    <label>Round
      <select id="calibration-round"></select>
    </label>
    <strong id="calibration-progress">No calibration round</strong>`;

  const task = document.createElement("article");
  task.className = "calibration-task";
  task.innerHTML = `
    <div class="calibration-task-heading">
      <div>
        <span class="calibration-task-label">Clue</span>
        <strong id="calibration-clue">Loading calibration</strong>
      </div>
      <div class="calibration-number">
        <span>Number</span>
        <strong id="calibration-number"></strong>
      </div>
    </div>
    <p class="calibration-instruction">Select the words you would guess, in order. You can stop early or take one bonus guess.</p>
    <div id="calibration-board" class="calibration-board" aria-label="Calibration board"></div>
    <p id="calibration-guess-order" class="calibration-guess-order" aria-live="polite"></p>
    <div class="calibration-optional">
      <label>Would you give this clue?
        <select id="calibration-judgment">
          <option value="">Optional</option>
          <option value="good">Good</option>
          <option value="unsure">Unsure</option>
          <option value="bad">Bad</option>
        </select>
      </label>
      <label>Note
        <input id="calibration-note" type="text" maxlength="2000" placeholder="Optional correction or context" />
      </label>
    </div>
    <div class="calibration-actions">
      <button id="calibration-previous" class="button secondary" type="button">Previous</button>
      <button id="calibration-clear" class="button secondary" type="button">Clear answer</button>
      <button id="calibration-next" class="button secondary" type="button">Next</button>
      <button id="calibration-save-next" class="button primary" type="button">Save and next</button>
    </div>
    <p id="calibration-status" class="calibration-status" aria-live="polite"></p>`;

  const navigation = document.createElement("nav");
  navigation.id = "calibration-task-nav";
  navigation.className = "calibration-task-nav";
  navigation.setAttribute("aria-label", "Calibration tasks");

  fragment.append(heading, controls, task, navigation);
  return fragment;
}
