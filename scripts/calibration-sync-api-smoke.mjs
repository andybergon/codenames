import assert from "node:assert/strict";
import {
  CALIBRATION_AUTH_COOKIE,
  handleCalibrationSyncRequest,
} from "../server/calibration-sync-service.js";

const databaseUrl = "postgresql://smoke.invalid/calibration";
const syncSecret = "correct-horse-battery-staple";
const answers = new Map();
const storeFactory = () => ({
  async listAnswers() {
    return [...answers.values()];
  },
  async upsertAnswer(answer) {
    const key = `${answer.roundId}:${answer.taskId}`;
    const existing = answers.get(key);
    if (!existing || existing.updatedAt <= answer.updatedAt) {
      answers.set(key, answer);
    }
  },
  async deleteAnswer({ roundId, taskId }) {
    answers.delete(`${roundId}:${taskId}`);
  },
});

const request = (method, body = {}, cookie = "") =>
  handleCalibrationSyncRequest({
    method,
    body,
    headers: { cookie },
    databaseUrl,
    syncSecret,
    secureCookie: false,
    storeFactory,
  });

const unconfigured = await handleCalibrationSyncRequest({
  method: "GET",
  databaseUrl: "",
  syncSecret: "",
});
assert.equal(unconfigured.status, 503);
assert.equal(unconfigured.body.code, "not_configured");

const trustedLocal = await handleCalibrationSyncRequest({
  method: "GET",
  databaseUrl,
  syncSecret: "",
  trustLocalClient: true,
  storeFactory,
});
assert.equal(trustedLocal.status, 200);
assert.deepEqual(trustedLocal.body.answers, []);

const rejected = await request("POST", {
  action: "authenticate",
  key: "wrong-key",
});
assert.equal(rejected.status, 401);
assert.equal(rejected.body.code, "invalid_key");

const authenticated = await request("POST", {
  action: "authenticate",
  key: syncSecret,
});
assert.equal(authenticated.status, 204);
assert.match(
  authenticated.headers["Set-Cookie"],
  new RegExp(`^${CALIBRATION_AUTH_COOKIE}=`),
);
assert.match(authenticated.headers["Set-Cookie"], /HttpOnly/);
assert.match(authenticated.headers["Set-Cookie"], /SameSite=Strict/);
const cookie = authenticated.headers["Set-Cookie"].split(";")[0];

const answer = {
  roundId: "embedding-finalists-v1",
  taskId: "calibration-001",
  guessedLayoutIds: [2, 7],
  judgment: "good",
  note: "Clear association",
  updatedAt: "2026-07-26T12:00:00.000Z",
};
const stored = await request("PUT", answer, cookie);
assert.equal(stored.status, 200);
assert.deepEqual(stored.body.answer, answer);

const listed = await request("GET", {}, cookie);
assert.equal(listed.status, 200);
assert.deepEqual(listed.body.answers, [answer]);

const invalid = await request(
  "PUT",
  { ...answer, guessedLayoutIds: [99] },
  cookie,
);
assert.equal(invalid.status, 400);
assert.equal(invalid.body.code, "invalid_answer");

const removed = await request(
  "DELETE",
  { roundId: answer.roundId, taskId: answer.taskId },
  cookie,
);
assert.equal(removed.status, 200);
assert.deepEqual((await request("GET", {}, cookie)).body.answers, []);

assert.equal((await request("GET")).status, 401);

console.log("Calibration database API smoke checks passed.");
