import { GAME_ORIGIN, GAME_PHASE } from "./game-state.js";
import {
  completedGameIdentity,
  encodePlayGame,
} from "./game-share.js";

const DEFAULT_ENDPOINT = "/api/play-analytics";
const STORAGE_KEY = "codenames-play-analytics-v1";
const ACTIVE_FLUSH_INTERVAL_MS = 60_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_STORED_ACKS = 32;

export function createPlayAnalyticsSync({
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  navigatorImpl = globalThis.navigator,
  storage = globalThis.localStorage,
  windowImpl = globalThis.window,
  activeFlushIntervalMs = ACTIVE_FLUSH_INTERVAL_MS,
  initialRetryDelayMs = INITIAL_RETRY_DELAY_MS,
  maxRetryDelayMs = MAX_RETRY_DELAY_MS,
  onStatus = () => {},
} = {}) {
  const acknowledgments = loadAcknowledgments(storage);
  let pending = null;
  let flushPromise = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let intervalTimer = null;
  let state = "idle";

  const onPageHide = () => {
    flushWithBeacon();
  };
  windowImpl?.addEventListener?.("pagehide", onPageHide);

  return {
    record(game, { flush = false } = {}) {
      const snapshot = createAnalyticsSnapshot(game);
      if (!snapshot) return false;
      if (
        snapshot.snapshotSequence <=
        (acknowledgments[snapshot.gameId] ?? 0)
      ) {
        return false;
      }
      if (
        !pending ||
        pending.gameId !== snapshot.gameId ||
        pending.snapshotSequence <= snapshot.snapshotSequence
      ) {
        pending = snapshot;
      }
      ensureInterval();
      setState("pending");
      if (flush) void runFlush();
      return true;
    },
    async flush() {
      return runFlush();
    },
    async submitFeedback(game, feedback) {
      const snapshot = createAnalyticsSnapshot(game);
      if (!snapshot) {
        throw new Error("Only locally created played games can receive feedback.");
      }
      pending = snapshot;
      const snapshotStored = await runFlush();
      if (!snapshotStored) {
        throw new Error("The game could not be saved before feedback was sent.");
      }
      const result = await request({
        action: "feedback",
        gameId: snapshot.gameId,
        snapshotSequence: snapshot.snapshotSequence,
        scope: feedback.scope,
        category: feedback.category,
        note: feedback.note,
      });
      if (!result.ok) {
        throw new Error(result.body?.error ?? "Feedback could not be sent.");
      }
      return result.body.feedback;
    },
    destroy() {
      windowImpl?.removeEventListener?.("pagehide", onPageHide);
      clearTimeout(retryTimer);
      clearInterval(intervalTimer);
      retryTimer = null;
      intervalTimer = null;
    },
    get state() {
      return state;
    },
  };

  function ensureInterval() {
    if (intervalTimer || !activeFlushIntervalMs) return;
    intervalTimer = setInterval(() => {
      if (pending) void runFlush();
    }, activeFlushIntervalMs);
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const delay = Math.min(
      initialRetryDelayMs * 2 ** retryAttempt,
      maxRetryDelayMs,
    );
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runFlush();
    }, delay);
  }

  async function runFlush() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (flushPromise) return flushPromise;
    if (!pending || !fetchImpl) return true;
    flushPromise = flushPending();
    try {
      return await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  async function flushPending() {
    while (pending) {
      const snapshot = pending;
      setState("syncing");
      const result = await request(snapshot);
      if (result.ok) {
        if (pending === snapshot) pending = null;
        retryAttempt = 0;
        acknowledgments[snapshot.gameId] = Math.max(
          acknowledgments[snapshot.gameId] ?? 0,
          snapshot.snapshotSequence,
        );
        saveAcknowledgments(storage, acknowledgments);
        continue;
      }
      if (result.status >= 400 && result.status < 500) {
        if (pending === snapshot) pending = null;
        setState("rejected");
        return false;
      }
      setState("offline");
      scheduleRetry();
      return false;
    }
    setState("synced");
    return true;
  }

  function flushWithBeacon() {
    if (!pending || !navigatorImpl?.sendBeacon) return false;
    const body = JSON.stringify(pending);
    const accepted = navigatorImpl.sendBeacon(
      endpoint,
      new Blob([body], { type: "application/json" }),
    );
    if (accepted) setState("pending");
    return accepted;
  }

  async function request(body) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      return {
        ok: response.ok,
        status: response.status,
        body: payload,
      };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  }

  function setState(nextState) {
    state = nextState;
    onStatus(nextState);
  }
}

export function createAnalyticsSnapshot(game) {
  if (!isAnalyticsEligible(game)) return null;
  const snapshotCode = encodePlayGame(game);
  return {
    action: "snapshot",
    gameId: completedGameIdentity(game),
    snapshotSequence: game.analyticsSequence,
    snapshotCode,
  };
}

export function isAnalyticsEligible(game) {
  return (
    game?.origin === GAME_ORIGIN.LOCAL &&
    Number.isSafeInteger(game.analyticsSequence) &&
    game.analyticsSequence > 0 &&
    (game.phase === GAME_PHASE.COMPLETE ||
      game.history?.some((event) => event.type === "turn-ended"))
  );
}

function loadAcknowledgments(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(
              ([gameId, sequence]) =>
                /^g_[a-z0-9]+$/u.test(gameId) &&
                Number.isSafeInteger(sequence) &&
                sequence >= 0,
            )
            .slice(-MAX_STORED_ACKS),
        )
      : {};
  } catch {
    return {};
  }
}

function saveAcknowledgments(storage, acknowledgments) {
  try {
    const entries = Object.entries(acknowledgments).slice(-MAX_STORED_ACKS);
    storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}
