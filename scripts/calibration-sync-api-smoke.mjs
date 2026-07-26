import assert from "node:assert/strict";
import {
  CALIBRATION_AUTH_COOKIE,
  handleCalibrationSyncRequest,
  isLoopbackAddress,
} from "../server/calibration-sync-service.js";
import calibrationApi from "../api/calibration.js";

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
    if (
      existing &&
      (existing.updatedAt > answer.updatedAt ||
        (existing.updatedAt === answer.updatedAt && existing.deletedAt))
    ) {
      return { applied: false, record: existing };
    }
    const record = { ...answer, deletedAt: null };
    answers.set(key, record);
    return { applied: true, record };
  },
  async deleteAnswer({ roundId, taskId, updatedAt }) {
    const key = `${roundId}:${taskId}`;
    const existing = answers.get(key);
    if (existing && existing.updatedAt > updatedAt) {
      return { applied: false, record: existing };
    }
    const record = {
      roundId,
      taskId,
      guessedLayoutIds: [],
      judgment: null,
      note: "",
      updatedAt,
      deletedAt: updatedAt,
    };
    answers.set(key, record);
    return { applied: true, record };
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
assert.equal(isLoopbackAddress("127.0.0.1"), true);
assert.equal(isLoopbackAddress("127.1.2.3"), true);
assert.equal(isLoopbackAddress("::1"), true);
assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
assert.equal(isLoopbackAddress("192.168.1.20"), false);

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

const answerTimestamp = new Date(Date.now() - 60_000).toISOString();
const answer = {
  roundId: "embedding-finalists-v1",
  taskId: "calibration-001",
  guessedLayoutIds: [2, 7],
  judgment: "good",
  note: "Clear association",
  updatedAt: answerTimestamp,
};
const stored = await request("PUT", answer, cookie);
assert.equal(stored.status, 200);
assert.deepEqual(stored.body.answer, { ...answer, deletedAt: null });

const listed = await request("GET", {}, cookie);
assert.equal(listed.status, 200);
assert.deepEqual(listed.body.answers, [{ ...answer, deletedAt: null }]);

const invalid = await request(
  "PUT",
  { ...answer, guessedLayoutIds: [99] },
  cookie,
);
assert.equal(invalid.status, 400);
assert.equal(invalid.body.code, "invalid_answer");

const stale = await request(
  "PUT",
  {
    ...answer,
    note: "Stale",
    updatedAt: new Date(Date.parse(answerTimestamp) - 1_000).toISOString(),
  },
  cookie,
);
assert.equal(stale.status, 409);
assert.equal(stale.body.code, "stale_write");
assert.equal(stale.body.answer.note, "Clear association");

const future = await request(
  "PUT",
  {
    ...answer,
    updatedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  },
  cookie,
);
assert.equal(future.status, 400);
assert.equal(future.body.code, "invalid_answer");

const deletedAt = new Date().toISOString();
const removed = await request(
  "DELETE",
  {
    roundId: answer.roundId,
    taskId: answer.taskId,
    updatedAt: deletedAt,
  },
  cookie,
);
assert.equal(removed.status, 200);
assert.deepEqual(removed.body.answer, {
  roundId: answer.roundId,
  taskId: answer.taskId,
  guessedLayoutIds: [],
  judgment: null,
  note: "",
  updatedAt: deletedAt,
  deletedAt,
});
assert.deepEqual((await request("GET", {}, cookie)).body.answers, [
  removed.body.answer,
]);

const staleRestore = await request("PUT", answer, cookie);
assert.equal(staleRestore.status, 409);
assert.equal(staleRestore.body.answer.deletedAt, deletedAt);

assert.equal((await request("GET")).status, 401);

{
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSyncSecret = process.env.CALIBRATION_SYNC_SECRET;
  delete process.env.DATABASE_URL;
  delete process.env.CALIBRATION_SYNC_SECRET;
  try {
    const raw = Buffer.from(
      JSON.stringify({
        roundId: "round",
        taskId: "task",
        guessedLayoutIds: [],
        judgment: null,
        note: "UTF-8 🙂",
        updatedAt: answerTimestamp,
      }),
    );
    const emojiStart = raw.indexOf(Buffer.from("🙂"));
    const response = mockResponse();
    await calibrationApi(
      chunkedRequest("PUT", [
        raw.subarray(0, emojiStart + 1),
        raw.subarray(emojiStart + 1),
      ]),
      response,
    );
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");

    const oversized = mockResponse();
    await calibrationApi(
      chunkedRequest("PUT", [Buffer.alloc(8_193, "a")]),
      oversized,
    );
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.headers.get("Cache-Control"), "private, no-store");
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSyncSecret === undefined) {
      delete process.env.CALIBRATION_SYNC_SECRET;
    } else {
      process.env.CALIBRATION_SYNC_SECRET = previousSyncSecret;
    }
  }
}

console.log("Calibration database API smoke checks passed.");

function chunkedRequest(method, chunks) {
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(name, value);
    },
    end(body = "") {
      this.body = body;
    },
  };
}
