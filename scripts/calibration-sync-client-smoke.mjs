import assert from "node:assert/strict";
import { createCalibrationRemoteSync } from "../src/calibration/sync.js";

const answer = (note, updatedAt) => ({
  guessedLayoutIds: [1],
  judgment: "good",
  note,
  updatedAt,
});

{
  const requests = [];
  let releaseFirst;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const firstReleased = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const sync = createCalibrationRemoteSync({
    syncDelayMs: 60_000,
    fetchImpl: async (_endpoint, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        markStarted();
        await firstReleased;
      }
      return response(200, { answer: requests.at(-1) });
    },
  });
  sync.save("round", "task", answer("First", "2026-07-26T10:00:00.000Z"));
  const firstFlush = sync.flush();
  await started;
  sync.save("round", "task", answer("Second", "2026-07-26T11:00:00.000Z"));
  releaseFirst();
  assert.equal(await firstFlush, false);
  assert.equal(await sync.flush(), true);
  assert.deepEqual(
    requests.map(({ note }) => note),
    ["First", "Second"],
  );
}

{
  const requests = [];
  const statuses = [];
  const sync = createCalibrationRemoteSync({
    syncDelayMs: 60_000,
    onStatus: (status) => statuses.push(status),
    fetchImpl: async (_endpoint, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return body.taskId === "bad"
        ? response(400, { code: "invalid_answer" })
        : response(200, { answer: body });
    },
  });
  sync.save("round", "bad", answer("Bad", "2026-07-26T10:00:00.000Z"));
  sync.save("round", "good", answer("Good", "2026-07-26T10:00:00.000Z"));
  assert.equal(await sync.flush(), false);
  assert.deepEqual(
    requests.map(({ taskId }) => taskId),
    ["bad", "good"],
  );
  assert.equal(statuses.at(-1), "rejected");
}

{
  const conflicts = [];
  const current = {
    roundId: "round",
    taskId: "task",
    guessedLayoutIds: [2],
    judgment: "unsure",
    note: "Newer",
    updatedAt: "2026-07-26T12:00:00.000Z",
    deletedAt: null,
  };
  const sync = createCalibrationRemoteSync({
    syncDelayMs: 60_000,
    onConflict: (record) => conflicts.push(record),
    fetchImpl: async () =>
      response(409, { code: "stale_write", answer: current }),
  });
  sync.save("round", "task", answer("Old", "2026-07-26T10:00:00.000Z"));
  assert.equal(await sync.flush(), true);
  assert.deepEqual(conflicts, [current]);
}

{
  let attempts = 0;
  const sync = createCalibrationRemoteSync({
    syncDelayMs: 60_000,
    initialRetryDelayMs: 1,
    maxRetryDelayMs: 2,
    fetchImpl: async (_endpoint, options) => {
      attempts += 1;
      return attempts === 1
        ? response(503, { code: "database_unavailable" })
        : response(200, { answer: JSON.parse(options.body) });
    },
  });
  sync.save("round", "task", answer("Retry", "2026-07-26T10:00:00.000Z"));
  assert.equal(await sync.flush(), false);
  await waitFor(() => attempts === 2);
  assert.equal(sync.state, "synced");
}

console.log("Calibration sync client smoke checks passed.");

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

async function waitFor(predicate) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error("Timed out waiting for calibration sync retry.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
