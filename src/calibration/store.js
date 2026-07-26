export const CALIBRATION_STORAGE_KEY = "codenames-human-calibration-v1";
export const CALIBRATION_SCHEMA_VERSION = 1;

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
    typeof value.roundId !== "string" ||
    !value.roundId.trim() ||
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

export function mergeCalibrationRound(state, definition) {
  const normalized = normalizeCalibrationRound(definition);
  if (!normalized) {
    throw new Error("Calibration round is invalid.");
  }
  const next = normalizeCalibrationState(state);
  const existingIndex = next.rounds.findIndex(
    ({ round }) => round.roundId === normalized.roundId,
  );
  if (existingIndex === -1) {
    next.rounds.push({ round: normalized, answers: {} });
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
  next.rounds[existingIndex] = {
    round: normalized,
    answers: Object.fromEntries(
      Object.entries(existing.answers).filter(([taskId]) =>
        retainedTaskIds.has(taskId),
      ),
    ),
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
    updatedAt: now,
  };
  return next;
}

export function clearCalibrationAnswer(state, roundId, taskId) {
  const next = normalizeCalibrationState(state);
  const storedRound = next.rounds.find(({ round }) => round.roundId === roundId);
  if (storedRound) {
    delete storedRound.answers[taskId];
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
          updatedAt: cleanText(answer?.updatedAt),
        },
      ]),
  );
  return { round, answers };
}

function normalizeTask(value) {
  if (
    typeof value?.taskId !== "string" ||
    !value.taskId.trim() ||
    typeof value.clue !== "string" ||
    !value.clue.trim() ||
    !Number.isInteger(value.number) ||
    value.number < 1 ||
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
