import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CALIBRATION_STORAGE_KEY,
  calibrationProgress,
  clearCalibrationAnswer,
  createCalibrationState,
  loadCalibrationState,
  mergeCalibrationRound,
  saveCalibrationState,
  upsertCalibrationAnswer,
} from "../src/calibration/store.js";
import { reconcileCalibrationAnswers } from "../src/calibration/sync.js";

const round = {
  schemaVersion: 1,
  roundId: "smoke-round",
  title: "Smoke round",
  tasks: [
    {
      taskId: "task-1",
      clue: "orbit",
      number: 2,
      activeSide: "blue",
      words: [
        { layoutId: 1, word: "MOON", team: "blue" },
        { layoutId: 2, word: "SATELLITE", team: "blue" },
        { layoutId: 3, word: "BOMB", team: "assassin" },
      ],
      intendedLayoutIds: [1, 2],
      source: { modelId: "smoke-model", board: 1, turn: 1 },
    },
  ],
};

let state = mergeCalibrationRound(createCalibrationState(), round);
assert.deepEqual(calibrationProgress(state.rounds[0]), {
  answered: 0,
  taskCount: 1,
  complete: false,
});

state = upsertCalibrationAnswer(
  state,
  "smoke-round",
  "task-1",
  {
    guessedLayoutIds: [1, 2, 3, 99],
    judgment: "good",
    note: "Clear clue",
  },
  "2026-07-26T00:00:00.000Z",
);
assert.deepEqual(state.rounds[0].answers["task-1"], {
  guessedLayoutIds: [1, 2, 3],
  judgment: "good",
  note: "Clear clue",
  updatedAt: "2026-07-26T00:00:00.000Z",
});
assert.equal(calibrationProgress(state.rounds[0]).complete, true);

const values = new Map();
const storage = {
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    values.set(key, value);
  },
};
assert.equal(saveCalibrationState(state, storage), true);
assert.ok(values.has(CALIBRATION_STORAGE_KEY));
assert.deepEqual(loadCalibrationState(storage), state);

state = mergeCalibrationRound(state, {
  ...round,
  tasks: [{ ...round.tasks[0], clue: "space" }],
});
assert.equal(calibrationProgress(state.rounds[0]).answered, 0);

const localNewer = upsertCalibrationAnswer(
  mergeCalibrationRound(createCalibrationState(), round),
  "smoke-round",
  "task-1",
  { guessedLayoutIds: [1], judgment: "good", note: "Local" },
  "2026-07-26T12:00:00.000Z",
);
const localResult = reconcileCalibrationAnswers(localNewer, [
  {
    roundId: "smoke-round",
    taskId: "task-1",
    guessedLayoutIds: [2],
    judgment: "bad",
    note: "Remote",
    updatedAt: "2026-07-26T11:00:00.000Z",
  },
]);
assert.deepEqual(localResult.uploads, [
  {
    roundId: "smoke-round",
    taskId: "task-1",
    answer: localNewer.rounds[0].answers["task-1"],
  },
]);
assert.equal(
  localResult.state.rounds[0].answers["task-1"].note,
  "Local",
);

const remoteResult = reconcileCalibrationAnswers(localNewer, [
  {
    roundId: "smoke-round",
    taskId: "task-1",
    guessedLayoutIds: [2],
    judgment: "unsure",
    note: "Newer remote",
    updatedAt: "2026-07-26T13:00:00.000Z",
  },
]);
assert.equal(remoteResult.uploads.length, 0);
assert.deepEqual(remoteResult.state.rounds[0].answers["task-1"], {
  guessedLayoutIds: [2],
  judgment: "unsure",
  note: "Newer remote",
  updatedAt: "2026-07-26T13:00:00.000Z",
});

state = clearCalibrationAnswer(state, "smoke-round", "task-1");
assert.equal(calibrationProgress(state.rounds[0]).answered, 0);

const publicRound = JSON.parse(
  await readFile(
    "public/data/calibration/embedding-finalists-v1.json",
    "utf8",
  ),
);
const answerKey = JSON.parse(
  await readFile(
    "scripts/generated/calibration-answer-keys/embedding-finalists-v1.json",
    "utf8",
  ),
);
assert.equal(publicRound.tasks.length, 30);
assert.deepEqual(
  publicRound.tasks.map(({ taskId }) => taskId).sort(),
  answerKey.tasks.map(({ taskId }) => taskId).sort(),
);
for (const task of publicRound.tasks) {
  assert.equal(Object.hasOwn(task, "source"), false);
  assert.equal(Object.hasOwn(task, "intendedLayoutIds"), false);
  assert.equal(task.words.some((word) => Object.hasOwn(word, "team")), false);
}

console.log("Calibration storage smoke checks passed.");
