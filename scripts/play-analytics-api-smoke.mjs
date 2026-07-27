import assert from "node:assert/strict";
import { createSampleBoardState } from "../src/board-share.js";
import { SIDE } from "../src/gameplay.js";
import {
  PLAYER_ROLE,
  createPlayGame,
  giveClue,
  passTurn,
} from "../src/play/game-state.js";
import {
  completedGameIdentity,
  encodePlayGame,
} from "../src/play/game-share.js";
import {
  PLAY_ANALYTICS_ADMIN_COOKIE,
  PLAY_ANALYTICS_COOKIE,
  handlePlayAnalyticsRequest,
} from "../server/play-analytics-service.js";

const databaseUrl = "postgresql://smoke.invalid/analytics";
const reviewSecret = "analytics-review-secret";
const games = new Map();
const feedback = [];
const reviews = new Map();
const annotations = [];
let nextId = 1;

const storeFactory = () => ({
  async upsertGame(participantKey, snapshot) {
    const key = `${participantKey}:${snapshot.gameId}`;
    const existing = games.get(key);
    if (
      existing &&
      (existing.snapshotSequence >= snapshot.snapshotSequence ||
        existing.snapshotHash === snapshot.snapshotHash)
    ) {
      return {
        applied: false,
        analyticsId: existing.analyticsId,
        snapshotSequence: existing.snapshotSequence,
      };
    }
    const record = {
      ...snapshot,
      participantKey,
      analyticsId: existing?.analyticsId ?? String(nextId++),
    };
    games.set(key, record);
    return {
      applied: true,
      analyticsId: record.analyticsId,
      snapshotSequence: record.snapshotSequence,
    };
  },
  async getOwnedGame(participantKey, gameId) {
    return games.get(`${participantKey}:${gameId}`) ?? null;
  },
  async insertFeedback(participantKey, gameId, value) {
    const record = {
      id: `feedback-${feedback.length + 1}`,
      gameId,
      ...value,
      createdAt: new Date().toISOString(),
    };
    feedback.push({ participantKey, ...record });
    return record;
  },
  async listGames(filters) {
    return [...games.values()]
      .filter(
        (game) =>
          filters.developerMode === null ||
          game.developerMode === filters.developerMode,
      )
      .map((game) => ({
        ...game,
        reviewStatus:
          reviews.get(game.analyticsId)?.reviewStatus ?? "unreviewed",
        labels: reviews.get(game.analyticsId)?.labels ?? [],
        feedbackCount: feedback.filter(
          (entry) =>
            entry.participantKey === game.participantKey &&
            entry.gameId === game.gameId,
        ).length,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        completedAt: null,
      }));
  },
  async getGame(analyticsId) {
    const game = [...games.values()].find(
      (entry) => entry.analyticsId === String(analyticsId),
    );
    if (!game) return null;
    return {
      ...game,
      gameId: game.gameId,
      reviewStatus:
        reviews.get(game.analyticsId)?.reviewStatus ?? "unreviewed",
      labels: reviews.get(game.analyticsId)?.labels ?? [],
      reviewNote: reviews.get(game.analyticsId)?.note ?? "",
      feedback: feedback.filter(
        (entry) =>
          entry.participantKey === game.participantKey &&
          entry.gameId === game.gameId,
      ),
      annotations: annotations.filter(
        (entry) => entry.analyticsId === game.analyticsId,
      ),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      completedAt: null,
    };
  },
  async upsertReview(analyticsId, value) {
    const record = {
      analyticsId: String(analyticsId),
      ...value,
      updatedAt: new Date().toISOString(),
    };
    reviews.set(String(analyticsId), record);
    return record;
  },
  async insertAnnotation(analyticsId, value) {
    const record = {
      id: `annotation-${annotations.length + 1}`,
      analyticsId: String(analyticsId),
      ...value,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    annotations.push(record);
    return record;
  },
});

const request = ({
  method = "POST",
  body = {},
  cookie = "",
  url = "/api/play-analytics",
  trustLocalClient = false,
} = {}) =>
  handlePlayAnalyticsRequest({
    method,
    body,
    headers: { cookie },
    url,
    databaseUrl,
    reviewSecret,
    secureCookie: false,
    trustLocalClient,
    storeFactory,
  });

const unconfigured = await handlePlayAnalyticsRequest({
  method: "GET",
  databaseUrl: "",
});
assert.equal(unconfigured.status, 503);
assert.equal(unconfigured.body.code, "not_configured");

const sample = createSampleBoardState();
let game = createPlayGame({
  cards: sample.cards,
  humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
  seed: "analytics-api-smoke",
  wordSet: sample.wordSet,
});
game.analyticsSequence = 1;
const unplayedCode = encodePlayGame(game);
const gameId = completedGameIdentity(game);
const unplayed = await request({
  body: {
    action: "snapshot",
    gameId,
    snapshotSequence: 1,
    snapshotCode: unplayedCode,
  },
});
assert.equal(unplayed.status, 400);

game = giveClue(game, {
  actor: "human",
  clue: "SPACE",
  number: 1,
  intendedLayoutIds: [0],
});
game = passTurn(game, { actor: "bot" });
game.analyticsSequence = 3;
const snapshot = {
  action: "snapshot",
  gameId,
  snapshotSequence: game.analyticsSequence,
  snapshotCode: encodePlayGame(game),
};
const stored = await request({ body: snapshot });
assert.equal(stored.status, 200);
assert.equal(stored.body.applied, true);
assert.match(
  stored.headers["Set-Cookie"],
  new RegExp(`^${PLAY_ANALYTICS_COOKIE}=`),
);
assert.match(stored.headers["Set-Cookie"], /HttpOnly/);
assert.match(stored.headers["Set-Cookie"], /SameSite=Lax/);
const participantCookie = stored.headers["Set-Cookie"].split(";")[0];

const duplicate = await request({ body: snapshot, cookie: participantCookie });
assert.equal(duplicate.status, 200);
assert.equal(duplicate.body.applied, false);

const otherParticipant = await request({ body: snapshot });
assert.equal(otherParticipant.status, 200);
assert.notEqual(
  otherParticipant.headers["Set-Cookie"].split(";")[0],
  participantCookie,
);
assert.equal(games.size, 2);

const invalidReplay = await request({
  body: { ...snapshot, snapshotCode: `${snapshot.snapshotCode}x` },
  cookie: participantCookie,
});
assert.equal(invalidReplay.status, 400);

const feedbackResult = await request({
  cookie: participantCookie,
  body: {
    action: "feedback",
    gameId,
    snapshotSequence: 3,
    scope: { type: "action", turn: 1, actionIndex: 0 },
    category: "clue",
    note: "This clue felt odd.",
  },
});
assert.equal(feedbackResult.status, 201);
assert.equal(feedbackResult.body.feedback.scopeType, "action");
assert.match(feedbackResult.body.feedback.scopeKey, /clue-given/);

assert.equal((await request({ method: "GET" })).status, 401);
const rejected = await request({
  body: { action: "authenticate", key: "wrong" },
});
assert.equal(rejected.status, 401);
const authenticated = await request({
  body: { action: "authenticate", key: reviewSecret },
});
assert.equal(authenticated.status, 204);
assert.match(
  authenticated.headers["Set-Cookie"],
  new RegExp(`^${PLAY_ANALYTICS_ADMIN_COOKIE}=`),
);
const adminCookie = authenticated.headers["Set-Cookie"].split(";")[0];

const listed = await request({
  method: "GET",
  cookie: adminCookie,
  url: "/api/play-analytics?cohort=player",
});
assert.equal(listed.status, 200);
assert.equal(listed.body.games.length, 2);
assert.ok(
  listed.body.games.every((storedGame) => !storedGame.developerMode),
);

const analyticsId = listed.body.games[0].analyticsId;
const reviewed = await request({
  method: "PATCH",
  cookie: adminCookie,
  body: {
    action: "review",
    analyticsId,
    reviewStatus: "actionable",
    labels: ["clue"],
    note: "Review the clue policy.",
  },
});
assert.equal(reviewed.status, 200);
assert.equal(reviewed.body.review.reviewStatus, "actionable");

const annotation = await request({
  cookie: adminCookie,
  body: {
    action: "annotation",
    analyticsId,
    scope: { type: "turn", turn: 1 },
    note: "Opening turn",
  },
});
assert.equal(annotation.status, 201);
assert.equal(annotation.body.annotation.scopeType, "turn");

const detail = await request({
  method: "GET",
  cookie: adminCookie,
  url: `/api/play-analytics?game=${analyticsId}`,
});
assert.equal(detail.status, 200);
assert.equal(detail.body.game.gameId, gameId);
assert.equal(detail.body.game.game.phase, "awaiting-clue");

console.log("Play analytics API smoke checks passed.");
