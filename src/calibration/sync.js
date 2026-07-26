const DEFAULT_ENDPOINT = "/api/calibration";
const SYNC_DELAY_MS = 350;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

export function createCalibrationRemoteSync({
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
  onStatus = () => {},
  onConflict = () => {},
  syncDelayMs = SYNC_DELAY_MS,
  initialRetryDelayMs = INITIAL_RETRY_DELAY_MS,
  maxRetryDelayMs = MAX_RETRY_DELAY_MS,
} = {}) {
  const pending = new Map();
  let timer = null;
  let flushPromise = null;
  let retryAttempt = 0;
  let state = "checking";

  return {
    async load() {
      const result = await request("GET");
      if (result.ok) {
        setState("synced");
        return result.body.answers ?? [];
      }
      setState(result.state);
      return null;
    },
    async authenticate(key) {
      const result = await request("POST", {
        action: "authenticate",
        key,
      });
      if (!result.ok) {
        setState(result.state);
        return false;
      }
      setState("synced");
      await flush();
      return true;
    },
    save(roundId, taskId, answer) {
      queue("PUT", {
        roundId,
        taskId,
        guessedLayoutIds: answer.guessedLayoutIds,
        judgment: answer.judgment,
        note: answer.note,
        updatedAt: answer.updatedAt,
      });
    },
    clear(roundId, taskId, updatedAt = new Date().toISOString()) {
      queue("DELETE", { roundId, taskId, updatedAt });
    },
    async flush() {
      return flush();
    },
    get state() {
      return state;
    },
  };

  function queue(method, body) {
    pending.set(operationKey(body), { method, body });
    if (state === "not_configured" || state === "auth_required") return;
    setState("syncing");
    scheduleFlush(syncDelayMs);
  }

  function scheduleFlush(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  function scheduleRetry() {
    const delay = Math.min(
      initialRetryDelayMs * 2 ** retryAttempt,
      maxRetryDelayMs,
    );
    retryAttempt += 1;
    scheduleFlush(delay);
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (flushPromise) return flushPromise;
    flushPromise = flushPending();
    try {
      return await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  async function flushPending() {
    if (pending.size === 0 || state === "not_configured") return true;
    let rejected = false;
    const operations = [...pending.entries()];
    for (const [key, operation] of operations) {
      const result = await request(operation.method, operation.body);
      if (result.ok) {
        deleteIfCurrent(key, operation);
        retryAttempt = 0;
        continue;
      }
      if (result.status === 409) {
        deleteIfCurrent(key, operation);
        retryAttempt = 0;
        onConflict(result.body?.answer ?? null);
        continue;
      }
      if (result.status === 401 || result.state === "not_configured") {
        setState(result.state);
        return false;
      }
      if (result.status >= 400 && result.status < 500) {
        deleteIfCurrent(key, operation);
        rejected = true;
        continue;
      }
      setState("offline");
      scheduleRetry();
      return false;
    }
    if (pending.size > 0) {
      setState("syncing");
      scheduleFlush(0);
      return false;
    }
    setState(rejected ? "rejected" : "synced");
    return !rejected;
  }

  function deleteIfCurrent(key, operation) {
    if (pending.get(key) === operation) {
      pending.delete(key);
    }
  }

  async function request(method, body) {
    try {
      const response = await fetchImpl(endpoint, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload =
        response.status === 204
          ? null
          : await response.json().catch(() => ({}));
      if (response.ok) {
        return { ok: true, status: response.status, body: payload };
      }
      return {
        ok: false,
        status: response.status,
        body: payload,
        state:
          response.status === 401
            ? "auth_required"
            : response.status === 503 &&
                payload?.code === "not_configured"
              ? "not_configured"
              : "offline",
      };
    } catch {
      return { ok: false, status: 0, body: null, state: "offline" };
    }
  }

  function setState(nextState) {
    state = nextState;
    onStatus(nextState);
  }
}

export function reconcileCalibrationAnswers(state, remoteAnswers) {
  const remoteByKey = new Map(
    remoteAnswers.map((answer) => [operationKey(answer), answer]),
  );
  const uploads = [];
  for (const storedRound of state.rounds) {
    const taskIds = new Set([
      ...Object.keys(storedRound.answers),
      ...Object.keys(storedRound.deletions ?? {}),
    ]);
    for (const taskId of taskIds) {
      const local = localRecord(storedRound, taskId);
      const key = operationKey({
        roundId: storedRound.round.roundId,
        taskId,
      });
      const remote = remoteByKey.get(key);
      if (!remote) {
        uploads.push(local);
        continue;
      }
      remoteByKey.delete(key);
      const comparison = compareRecords(local, remote);
      if (comparison > 0) {
        uploads.push(local);
      } else if (comparison < 0) {
        applyRemoteCalibrationRecord(state, remote);
      }
    }
  }
  for (const remote of remoteByKey.values()) {
    applyRemoteCalibrationRecord(state, remote);
  }
  return { state, uploads };
}

export function applyRemoteCalibrationRecord(state, record) {
  if (!record?.roundId || !record?.taskId) return false;
  const storedRound = state.rounds.find(
    ({ round }) => round.roundId === record.roundId,
  );
  if (!storedRound) return false;
  storedRound.deletions ??= {};
  if (record.deletedAt) {
    delete storedRound.answers[record.taskId];
    storedRound.deletions[record.taskId] = record.deletedAt;
    return true;
  }
  if (
    !storedRound.round.tasks.some(({ taskId }) => taskId === record.taskId)
  ) {
    return false;
  }
  storedRound.answers[record.taskId] = toStoredAnswer(record);
  delete storedRound.deletions[record.taskId];
  return true;
}

function localRecord(storedRound, taskId) {
  const answer = storedRound.answers[taskId];
  if (answer) {
    return {
      method: "PUT",
      roundId: storedRound.round.roundId,
      taskId,
      answer,
      updatedAt: answer.updatedAt,
    };
  }
  const updatedAt = storedRound.deletions[taskId];
  return {
    method: "DELETE",
    roundId: storedRound.round.roundId,
    taskId,
    updatedAt,
  };
}

function compareRecords(local, remote) {
  const localTime = timestamp(local.updatedAt);
  const remoteTime = timestamp(remote.deletedAt ?? remote.updatedAt);
  if (localTime !== remoteTime) return localTime - remoteTime;
  const localDeleted = local.method === "DELETE";
  const remoteDeleted = Boolean(remote.deletedAt);
  return Number(localDeleted) - Number(remoteDeleted);
}

function toStoredAnswer(answer) {
  return {
    guessedLayoutIds: answer.guessedLayoutIds,
    judgment: answer.judgment,
    note: answer.note,
    updatedAt: answer.updatedAt,
  };
}

function operationKey(value) {
  return JSON.stringify([value.roundId, value.taskId]);
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
