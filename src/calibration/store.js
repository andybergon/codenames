export const CALIBRATION_STORAGE_KEY = "codenames-human-calibration-v1";
export const CALIBRATION_SCHEMA_VERSION = 1;
export const CALIBRATION_LEGACY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_TASK_NUMBER = 9;
const MAX_LAYOUT_ID = 24;

export function createCalibrationState() {
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    rounds: [],
  };
}

export function loadCalibrationState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CALIBRATION_STORAGE_KEY);
    return raw ? normalizeCalibrationState(JSON.parse(raw)) : createCalibrationState();
  } catch {
    return createCalibrationState();
  }
}

export function saveCalibrationState(
  state,
  storage = globalThis.localStorage,
) {
  try {
    storage?.setItem(
      CALIBRATION_STORAGE_KEY,
      JSON.stringify(normalizeCalibrationState(state)),
    );
    return true;
  } catch {
    return false;
  }
}

export function normalizeCalibrationState(value) {
  const rounds = Array.isArray(value?.rounds)
    ? value.rounds.map(normalizeStoredRound).filter(Boolean)
    : [];
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    rounds,
  };
}

export function normalizeCalibrationRound(value) {
  if (
    value?.schemaVersion !== CALIBRATION_SCHEMA_VERSION ||
    !isValidIdentifier(value.roundId) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0
  ) {
    return null;
  }
  const tasks = value.tasks.map(normalizeTask).filter(Boolean);
  if (tasks.length !== value.tasks.length) {
    return null;
  }
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    roundId: value.roundId.trim(),
    title: cleanText(value.title) || value.roundId.trim(),
    description: cleanText(value.description),
    createdAt: cleanText(value.createdAt),
    tasks,
  };
}

export function mergeCalibrationRound(
  state,
  definition,
  now = new Date().toISOString(),
) {
  const normalized = normalizeCalibrationRound(definition);
  if (!normalized) {
    throw new Error("Calibration round is invalid.");
  }
  const next = normalizeCalibrationState(state);
  const existingIndex = next.rounds.findIndex(
    ({ round }) => round.roundId === normalized.roundId,
  );
  if (existingIndex === -1) {
    next.rounds.push({ round: normalized, answers: {}, deletions: {} });
    return next;
  }
  const existing = next.rounds[existingIndex];
  const existingTasks = new Map(
    existing.round.tasks.map((task) => [task.taskId, taskSignature(task)]),
  );
  const retainedTaskIds = new Set(
    normalized.tasks
      .filter(
        (task) =>
          existingTasks.get(task.taskId) === taskSignature(task),
      )
      .map(({ taskId }) => taskId),
  );
  const retainedAnswers = Object.fromEntries(
    Object.entries(existing.answers).filter(([taskId]) =>
      retainedTaskIds.has(taskId),
    ),
  );
  const deletions = { ...existing.deletions };
  for (const taskId of Object.keys(existing.answers)) {
    if (!retainedTaskIds.has(taskId)) {
      deletions[taskId] = newestTimestamp(deletions[taskId], now);
    }
  }
  next.rounds[existingIndex] = {
    round: normalized,
    answers: retainedAnswers,
    deletions,
  };
  return next;
}

export function upsertCalibrationAnswer(
  state,
  roundId,
  taskId,
  answer,
  now = new Date().toISOString(),
) {
  const next = normalizeCalibrationState(state);
  const storedRound = next.rounds.find(({ round }) => round.roundId === roundId);
  const task = storedRound?.round.tasks.find((entry) => entry.taskId === taskId);
  if (!storedRound || !task) {
    throw new Error("Calibration task was not found.");
  }
  const allowedIds = new Set(task.words.map(({ layoutId }) => layoutId));
  const guessedLayoutIds = [
    ...new Set(
      (Array.isArray(answer?.guessedLayoutIds)
        ? answer.guessedLayoutIds
        : []
      ).filter((layoutId) => allowedIds.has(layoutId)),
    ),
  ].slice(0, task.number + 1);
  storedRound.answers[taskId] = {
    guessedLayoutIds,
    judgment: ["good", "unsure", "bad"].includes(answer?.judgment)
      ? answer.judgment
      : null,
    note: cleanText(answer?.note),
    updatedAt: normalizeTimestamp(now),
  };
  delete storedRound.deletions[taskId];
  return next;
}

export function clearCalibrationAnswer(
  state,
  roundId,
  taskId,
  now = new Date().toISOString(),
) {
  const next = normalizeCalibrationState(state);
  const storedRound = next.rounds.find(({ round }) => round.roundId === roundId);
  if (
    storedRound?.round.tasks.some((entry) => entry.taskId === taskId)
  ) {
    delete storedRound.answers[taskId];
    storedRound.deletions[taskId] = newestTimestamp(
      storedRound.deletions[taskId],
      now,
    );
  }
  return next;
}

export function mergeCalibrationState(state, importedState) {
  let next = normalizeCalibrationState(state);
  const imported = normalizeCalibrationState(importedState);
  for (const importedRound of imported.rounds) {
    next = mergeCalibrationRound(next, importedRound.round);
    const current = next.rounds.find(
      ({ round }) => round.roundId === importedRound.round.roundId,
    );
    for (const [taskId, answer] of Object.entries(importedRound.answers)) {
      applyNewestEvent(current, taskId, {
        type: "answer",
        updatedAt: answer.updatedAt,
        answer,
      });
    }
    for (const [taskId, updatedAt] of Object.entries(
      importedRound.deletions,
    )) {
      applyNewestEvent(current, taskId, {
        type: "deletion",
        updatedAt,
      });
    }
  }
  return next;
}

export function calibrationProgress(storedRound) {
  const taskCount = storedRound?.round.tasks.length ?? 0;
  const answered = storedRound
    ? storedRound.round.tasks.filter(
        ({ taskId }) => storedRound.answers[taskId],
      ).length
    : 0;
  return {
    answered,
    taskCount,
    complete: taskCount > 0 && answered === taskCount,
  };
}

function normalizeStoredRound(value) {
  const round = normalizeCalibrationRound(value?.round);
  if (!round) return null;
  const taskIds = new Set(round.tasks.map(({ taskId }) => taskId));
  const answers = Object.fromEntries(
    Object.entries(value?.answers ?? {})
      .filter(([taskId]) => taskIds.has(taskId))
      .map(([taskId, answer]) => [
        taskId,
        {
          guessedLayoutIds: Array.isArray(answer?.guessedLayoutIds)
            ? [...new Set(answer.guessedLayoutIds)].filter((layoutId) =>
                round.tasks
                  .find((task) => task.taskId === taskId)
                  .words.some((word) => word.layoutId === layoutId),
              )
            : [],
          judgment: ["good", "unsure", "bad"].includes(answer?.judgment)
            ? answer.judgment
            : null,
          note: cleanText(answer?.note),
          updatedAt: normalizeTimestamp(answer?.updatedAt),
        },
      ]),
  );
  const deletions = Object.fromEntries(
    Object.entries(value?.deletions ?? {})
      .filter(([taskId]) => isValidIdentifier(taskId))
      .map(([taskId, updatedAt]) => [
        taskId,
        normalizeTimestamp(updatedAt),
      ]),
  );
  for (const [taskId, deletionAt] of Object.entries(deletions)) {
    const answer = answers[taskId];
    if (answer && timestamp(deletionAt) >= timestamp(answer.updatedAt)) {
      delete answers[taskId];
    } else if (answer) {
      delete deletions[taskId];
    }
  }
  return { round, answers, deletions };
}

function normalizeTask(value) {
  if (
    !isValidIdentifier(value?.taskId) ||
    typeof value.clue !== "string" ||
    !value.clue.trim() ||
    !Number.isInteger(value.number) ||
    value.number < 1 ||
    value.number > MAX_TASK_NUMBER ||
    !Array.isArray(value.words) ||
    value.words.length < 2
  ) {
    return null;
  }
  const words = value.words.map(normalizeWord).filter(Boolean);
  if (words.length !== value.words.length) {
    return null;
  }
  const layoutIds = new Set(words.map(({ layoutId }) => layoutId));
  return {
    taskId: value.taskId.trim(),
    clue: value.clue.trim(),
    number: value.number,
    activeSide: value.activeSide === "red" ? "red" : "blue",
    words,
    intendedLayoutIds: Array.isArray(value.intendedLayoutIds)
      ? [...new Set(value.intendedLayoutIds)].filter((layoutId) =>
          layoutIds.has(layoutId),
        )
      : [],
    source: {
      modelId: cleanText(value.source?.modelId),
      board: Number.isInteger(value.source?.board) ? value.source.board : null,
      turn: Number.isInteger(value.source?.turn) ? value.source.turn : null,
    },
  };
}

function normalizeWord(value) {
  if (
    !Number.isInteger(value?.layoutId) ||
    value.layoutId < 0 ||
    value.layoutId > MAX_LAYOUT_ID ||
    typeof value.word !== "string" ||
    !value.word.trim()
  ) {
    return null;
  }
  return {
    layoutId: value.layoutId,
    word: value.word.trim(),
    team: [
      "blue",
      "red",
      "friendly",
      "enemy",
      "neutral",
      "assassin",
    ].includes(value.team)
      ? value.team
      : null,
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function taskSignature(task) {
  return JSON.stringify({
    clue: task.clue,
    number: task.number,
    activeSide: task.activeSide,
    words: task.words,
    intendedLayoutIds: task.intendedLayoutIds,
    source: task.source,
  });
}

function applyNewestEvent(storedRound, taskId, event) {
  const taskExists = storedRound.round.tasks.some(
    (task) => task.taskId === taskId,
  );
  const localAnswer = storedRound.answers[taskId];
  const localDeletion = storedRound.deletions[taskId];
  const localTimestamp = Math.max(
    timestamp(localAnswer?.updatedAt),
    timestamp(localDeletion),
  );
  const eventTimestamp = timestamp(event.updatedAt);
  if (
    eventTimestamp < localTimestamp ||
    (
      eventTimestamp === localTimestamp &&
      localDeletion &&
      event.type === "answer"
    )
  ) {
    return;
  }
  if (event.type === "answer" && taskExists) {
    storedRound.answers[taskId] = event.answer;
    delete storedRound.deletions[taskId];
    return;
  }
  delete storedRound.answers[taskId];
  storedRound.deletions[taskId] = normalizeTimestamp(event.updatedAt);
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : CALIBRATION_LEGACY_TIMESTAMP;
}

function newestTimestamp(left, right) {
  return timestamp(left) > timestamp(right)
    ? normalizeTimestamp(left)
    : normalizeTimestamp(right);
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}
