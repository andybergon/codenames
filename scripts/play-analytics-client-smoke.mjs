import assert from "node:assert/strict";
import { createSampleBoardState } from "../src/board-share.js";
import { SIDE } from "../src/gameplay.js";
import {
  GAME_ORIGIN,
  PLAYER_ROLE,
  createPlayGame,
  giveClue,
  passTurn,
} from "../src/play/game-state.js";
import {
  createPlayAnalyticsSync,
  isAnalyticsEligible,
} from "../src/play/analytics.js";

const sample = createSampleBoardState();

function newGame(origin = GAME_ORIGIN.LOCAL) {
  return createPlayGame({
    cards: sample.cards,
    humanSeat: { side: SIDE.BLUE, role: PLAYER_ROLE.SPYMASTER },
    origin,
    seed: "analytics-client-smoke",
    wordSet: sample.wordSet,
  });
}

function playedGame(origin = GAME_ORIGIN.LOCAL) {
  let game = newGame(origin);
  game.analyticsSequence = 1;
  game = giveClue(game, {
    actor: "human",
    clue: "SPACE",
    number: 1,
    intendedLayoutIds: [0],
  });
  game = passTurn(game, { actor: "bot" });
  game.analyticsSequence = 3;
  return game;
}

{
  const requests = [];
  const sync = createPlayAnalyticsSync({
    activeFlushIntervalMs: 0,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(200, { applied: true });
    },
    storage: memoryStorage(),
    windowImpl: eventTarget(),
  });
  const unplayed = newGame();
  unplayed.analyticsSequence = 1;
  assert.equal(isAnalyticsEligible(unplayed), false);
  assert.equal(sync.record(unplayed, { flush: true }), false);
  assert.equal(sync.record(playedGame(GAME_ORIGIN.SHARED)), false);
  const game = playedGame();
  assert.equal(sync.record(game), true);
  assert.equal(await sync.flush(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "snapshot");
  assert.equal(requests[0].snapshotSequence, 3);
  assert.equal(sync.record(game), false);
  assert.equal(await sync.flush(), true);
  assert.equal(requests.length, 1);
}

{
  const requests = [];
  let releaseFirst;
  const blocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let started;
  const firstStarted = new Promise((resolve) => {
    started = resolve;
  });
  const sync = createPlayAnalyticsSync({
    activeFlushIntervalMs: 0,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1) {
        started();
        await blocked;
      }
      return response(200, { applied: true });
    },
    storage: memoryStorage(),
    windowImpl: eventTarget(),
  });
  const first = playedGame();
  sync.record(first);
  const flushing = sync.flush();
  await firstStarted;
  const newer = { ...first, analyticsSequence: 4 };
  sync.record(newer);
  releaseFirst();
  assert.equal(await flushing, true);
  assert.deepEqual(
    requests.map(({ snapshotSequence }) => snapshotSequence),
    [3, 4],
  );
}

{
  const requests = [];
  const sync = createPlayAnalyticsSync({
    activeFlushIntervalMs: 0,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return response(
        body.action === "feedback" ? 201 : 200,
        body.action === "feedback"
          ? { feedback: { id: "feedback-1" } }
          : { applied: true },
      );
    },
    storage: memoryStorage(),
    windowImpl: eventTarget(),
  });
  const feedback = await sync.submitFeedback(playedGame(), {
    scope: { type: "turn", turn: 1 },
    category: "bot",
    note: "Passed too early",
  });
  assert.equal(feedback.id, "feedback-1");
  assert.deepEqual(
    requests.map(({ action }) => action),
    ["snapshot", "feedback"],
  );
}

{
  const beacons = [];
  const target = eventTarget();
  const sync = createPlayAnalyticsSync({
    activeFlushIntervalMs: 0,
    fetchImpl: async () => response(200, {}),
    navigatorImpl: {
      sendBeacon(url, body) {
        beacons.push({ url, body });
        return true;
      },
    },
    storage: memoryStorage(),
    windowImpl: target,
  });
  sync.record(playedGame());
  target.dispatch("pagehide");
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].url, "/api/play-analytics");
  sync.destroy();
}

console.log("Play analytics client smoke checks passed.");

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
}
