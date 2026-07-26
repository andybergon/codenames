import {
  calibrationProgress,
  clearCalibrationAnswer,
  createCalibrationState,
  loadCalibrationState,
  mergeCalibrationRound,
  mergeCalibrationState,
  normalizeCalibrationRound,
  normalizeCalibrationState,
  saveCalibrationState,
  upsertCalibrationAnswer,
} from "./store.js";
import {
  applyRemoteCalibrationRecord,
  createCalibrationRemoteSync,
  reconcileCalibrationAnswers,
} from "./sync.js";

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
  let emptyBaselineIsPass = false;

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
    syncStatus: root.querySelector("#calibration-sync-status"),
    syncKey: root.querySelector("#calibration-sync-key"),
    syncConnect: root.querySelector("#calibration-sync-connect"),
  };
  const remoteSync = createCalibrationRemoteSync({
    onStatus: renderSyncStatus,
    onConflict: handleRemoteConflict,
  });

  elements.roundSelect.addEventListener("change", () => {
    activeRoundId = elements.roundSelect.value;
    taskIndex = firstUnansweredIndex(activeRound());
    statusMessage = "";
    loadCurrentAnswer();
    render();
  });
  elements.previous.addEventListener("click", () => moveTask(-1));
  elements.next.addEventListener("click", () => moveTask(1));
  elements.saveNext.addEventListener("click", recordPassAndAdvance);
  elements.clear.addEventListener("click", clearCurrentAnswer);
  elements.judgment.addEventListener("change", () => {
    persistCurrentDraft();
  });
  elements.note.addEventListener("input", () => {
    persistCurrentDraft();
  });
  elements.exportButton.addEventListener("click", exportState);
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => {
    void importFile(elements.importInput.files?.[0]);
    elements.importInput.value = "";
  });
  elements.syncConnect.addEventListener("click", () => {
    void connectDatabase();
  });
  elements.syncKey.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void connectDatabase();
    }
  });

  return {
    async setActive(nextActive) {
      active = nextActive;
      root.hidden = !active;
      if (!active) return;
      if (!initialized) {
        initialized = true;
        await loadBuiltInRounds(options.manifestUrl ?? DEFAULT_MANIFEST_URL);
        render();
        void loadRemoteAnswers({ reposition: true }).then(render);
        return;
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
        button.setAttribute(
          "aria-label",
          `Open calibration task ${index + 1}, ${
            storedRound.answers[taskId] ? "answered" : "unanswered"
          }`,
        );
        button.setAttribute("aria-current", String(index === taskIndex));
        button.addEventListener("click", () => {
          taskIndex = index;
          statusMessage = "";
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
    elements.saveNext.disabled = !task || hasDraftContent();
    elements.saveNext.textContent =
      taskIndex === storedRound?.round.tasks.length - 1
        ? "Record pass"
        : "Record pass and next";
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

  function renderTask(task, focusLayoutId = null) {
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
        button.dataset.layoutId = String(entry.layoutId);
        button.dataset.selected = String(guessPosition >= 0);
        button.setAttribute("aria-pressed", String(guessPosition >= 0));
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
    if (focusLayoutId !== null) {
      elements.board
        .querySelector(`[data-layout-id="${focusLayoutId}"]`)
        ?.focus({ preventScroll: true });
    }
  }

  function renderGuessOrder(task) {
    const words = new Map(task.words.map((entry) => [entry.layoutId, entry.word]));
    elements.guessOrder.textContent =
      selectedGuesses.length > 0
        ? selectedGuesses
            .map((layoutId, index) => `${index + 1}. ${words.get(layoutId)}`)
            .join("  ")
        : "No guesses selected. Use Record pass only if you would not guess.";
  }

  function toggleGuess(layoutId) {
    const existingIndex = selectedGuesses.indexOf(layoutId);
    if (existingIndex >= 0) {
      selectedGuesses.splice(existingIndex, 1);
    } else {
      const task = currentTask();
      if (selectedGuesses.length >= task.number + 1) {
        statusMessage = `This clue allows at most ${task.number + 1} guesses.`;
        renderTask(task, layoutId);
        elements.status.textContent = statusMessage;
        return;
      }
      selectedGuesses.push(layoutId);
    }
    persistCurrentDraft();
    renderTask(currentTask(), layoutId);
    elements.status.textContent = statusMessage;
  }

  function persistCurrentDraft() {
    const task = currentTask();
    if (!task) return false;
    if (!hasDraftContent()) {
      if (emptyBaselineIsPass) {
        state = upsertCalibrationAnswer(
          state,
          activeRoundId,
          task.taskId,
          {
            guessedLayoutIds: [],
            judgment: null,
            note: "",
          },
        );
        saveCalibrationState(state);
        remoteSync.save(
          activeRoundId,
          task.taskId,
          activeRound().answers[task.taskId],
        );
        statusMessage = "Explicit pass preserved.";
        renderPersistenceState();
        return true;
      }
      if (activeRound()?.answers[task.taskId]) {
        state = clearCalibrationAnswer(state, activeRoundId, task.taskId);
        const deletedAt = activeRound().deletions[task.taskId];
        saveCalibrationState(state);
        remoteSync.clear(activeRoundId, task.taskId, deletedAt);
        statusMessage = "Empty answer removed.";
      } else {
        statusMessage = "";
      }
      renderPersistenceState();
      return false;
    }
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
    remoteSync.save(
      activeRoundId,
      task.taskId,
      activeRound().answers[task.taskId],
    );
    statusMessage = "Saved automatically in this browser.";
    renderPersistenceState();
    return true;
  }

  function recordPassAndAdvance() {
    const task = currentTask();
    if (!task || hasDraftContent()) return;
    state = upsertCalibrationAnswer(
      state,
      activeRoundId,
      task.taskId,
      {
        guessedLayoutIds: [],
        judgment: null,
        note: "",
      },
    );
    saveCalibrationState(state);
    remoteSync.save(
      activeRoundId,
      task.taskId,
      activeRound().answers[task.taskId],
    );
    emptyBaselineIsPass = true;
    if (taskIndex < activeRound().round.tasks.length - 1) {
      taskIndex += 1;
      loadCurrentAnswer();
      statusMessage = "Pass recorded for the previous task.";
    } else {
      statusMessage = "Pass saved locally.";
    }
    render();
  }

  function hasDraftContent() {
    return (
      selectedGuesses.length > 0 ||
      elements.judgment.value !== "" ||
      elements.note.value.trim() !== ""
    );
  }

  function renderPersistenceState() {
    const storedRound = activeRound();
    const task = currentTask();
    const progress = calibrationProgress(storedRound);
    elements.progress.textContent = storedRound
      ? `${progress.answered}/${progress.taskCount} answered`
      : "No calibration round";
    const currentDot = elements.taskNav.children[taskIndex];
    if (currentDot) {
      const answered = Boolean(storedRound?.answers[task?.taskId]);
      currentDot.dataset.state = answered
        ? "answered"
        : "unanswered";
      currentDot.setAttribute(
        "aria-label",
        `Open calibration task ${taskIndex + 1}, ${
          answered ? "answered" : "unanswered"
        }`,
      );
    }
    updateActiveRoundOption();
    elements.clear.disabled = !task || !storedRound?.answers[task.taskId];
    elements.saveNext.disabled = !task || hasDraftContent();
    elements.status.textContent = statusMessage;
  }

  function clearCurrentAnswer() {
    const task = currentTask();
    if (!task) return;
    state = clearCalibrationAnswer(state, activeRoundId, task.taskId);
    const deletedAt = activeRound().deletions[task.taskId];
    saveCalibrationState(state);
    remoteSync.clear(activeRoundId, task.taskId, deletedAt);
    emptyBaselineIsPass = false;
    statusMessage = "Saved answer cleared.";
    loadCurrentAnswer();
    render();
  }

  function moveTask(offset) {
    const tasks = activeRound()?.round.tasks ?? [];
    taskIndex = Math.max(0, Math.min(tasks.length - 1, taskIndex + offset));
    statusMessage = "";
    loadCurrentAnswer();
    render();
  }

  function loadCurrentAnswer() {
    const task = currentTask();
    const answer = task ? activeRound()?.answers[task.taskId] : null;
    selectedGuesses = [...(answer?.guessedLayoutIds ?? [])];
    elements.judgment.value = answer?.judgment ?? "";
    elements.note.value = answer?.note ?? "";
    emptyBaselineIsPass = Boolean(
      answer &&
        answer.guessedLayoutIds.length === 0 &&
        answer.judgment === null &&
        answer.note === "",
    );
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const importedRound = normalizeCalibrationRound(value);
      if (importedRound) {
        state = mergeCalibrationRound(state, importedRound);
        activeRoundId = importedRound.roundId;
      } else {
        const imported = normalizeCalibrationState(value);
        if (imported.rounds.length === 0) {
          throw new Error("The file contains no valid calibration rounds.");
        }
        state = mergeCalibrationState(state, imported);
        activeRoundId = imported.rounds[0].round.roundId;
      }
      saveCalibrationState(state);
      queueAllLocalAnswers();
      taskIndex = firstUnansweredIndex(activeRound());
      loadCurrentAnswer();
      statusMessage = "Calibration data imported.";
    } catch (error) {
      statusMessage = `Import failed: ${error.message}`;
    }
    render();
  }

  async function loadRemoteAnswers({ reposition = false } = {}) {
    const remoteAnswers = await remoteSync.load();
    if (!remoteAnswers) return;
    const reconciled = reconcileCalibrationAnswers(state, remoteAnswers);
    state = reconciled.state;
    saveCalibrationState(state);
    for (const upload of reconciled.uploads) {
      if (upload.method === "DELETE") {
        remoteSync.clear(upload.roundId, upload.taskId, upload.updatedAt);
      } else {
        remoteSync.save(upload.roundId, upload.taskId, upload.answer);
      }
    }
    await remoteSync.flush();
    if (reposition) {
      taskIndex = firstUnansweredIndex(activeRound());
    }
    loadCurrentAnswer();
  }

  function queueAllLocalAnswers() {
    for (const storedRound of state.rounds) {
      for (const [taskId, answer] of Object.entries(storedRound.answers)) {
        remoteSync.save(storedRound.round.roundId, taskId, answer);
      }
      for (const [taskId, updatedAt] of Object.entries(
        storedRound.deletions,
      )) {
        remoteSync.clear(storedRound.round.roundId, taskId, updatedAt);
      }
    }
  }

  async function connectDatabase() {
    const key = elements.syncKey.value;
    if (!key) return;
    elements.syncConnect.disabled = true;
    const connected = await remoteSync.authenticate(key);
    elements.syncConnect.disabled = false;
    if (!connected) return;
    elements.syncKey.value = "";
    await loadRemoteAnswers();
    render();
  }

  function handleRemoteConflict(record) {
    if (!record || !applyRemoteCalibrationRecord(state, record)) return;
    saveCalibrationState(state);
    if (
      record.roundId === activeRoundId &&
      record.taskId === currentTask()?.taskId
    ) {
      loadCurrentAnswer();
    }
    statusMessage = "A newer database version was restored.";
    render();
  }

  function renderSyncStatus(syncState) {
    const labels = {
      checking: "Checking database…",
      syncing: "Saving to database…",
      synced: "Database synced",
      auth_required: "Database key required",
      not_configured: "Local only",
      offline: "Saved locally · database pending",
      rejected: "Saved locally · database rejected",
    };
    elements.syncStatus.textContent = labels[syncState] ?? labels.offline;
    elements.syncStatus.dataset.state = syncState;
    const needsKey = syncState === "auth_required";
    elements.syncKey.hidden = !needsKey;
    elements.syncConnect.hidden = !needsKey;
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
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    statusMessage = "Calibration data exported.";
    elements.status.textContent = statusMessage;
  }

  function activeRound() {
    return state.rounds.find(({ round }) => round.roundId === activeRoundId) ?? null;
  }

  function currentTask() {
    return activeRound()?.round.tasks[taskIndex] ?? null;
  }

  function updateActiveRoundOption() {
    const storedRound = activeRound();
    const option = [...elements.roundSelect.options].find(
      ({ value }) => value === activeRoundId,
    );
    if (!storedRound || !option) return;
    const progress = calibrationProgress(storedRound);
    option.textContent =
      `${storedRound.round.title} (${progress.answered}/${progress.taskCount})`;
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
      <p>Guess naturally from each blinded clue. Answers save automatically, with browser storage as the local fallback; export JSON for backup and analysis.</p>
    </div>
    <div class="calibration-file-actions">
      <div class="calibration-sync">
        <span id="calibration-sync-status" aria-live="polite">Checking database…</span>
        <input id="calibration-sync-key" type="password" autocomplete="current-password" placeholder="One-time sync key" aria-label="Calibration database sync key" hidden />
        <button id="calibration-sync-connect" class="button secondary" type="button" hidden>Connect</button>
      </div>
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
    <strong id="calibration-progress" class="calibration-progress">No calibration round</strong>`;

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
    <p class="calibration-instruction">Select the words you would guess, in order. Choices, rating, and notes save automatically. Record a pass only when you would make no guess.</p>
    <div id="calibration-board" class="calibration-board" role="group" aria-label="Calibration board"></div>
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
      <button id="calibration-save-next" class="button secondary" type="button">Record pass and next</button>
      <button id="calibration-next" class="button primary" type="button">Next</button>
    </div>
    <p id="calibration-status" class="calibration-status" aria-live="polite"></p>`;

  const navigation = document.createElement("nav");
  navigation.id = "calibration-task-nav";
  navigation.className = "calibration-task-nav";
  navigation.setAttribute("aria-label", "Calibration tasks");

  fragment.append(heading, controls, task, navigation);
  return fragment;
}
