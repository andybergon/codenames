const DEFAULT_ENDPOINT = "/api/calibration";
const SYNC_DELAY_MS = 350;

export function createCalibrationRemoteSync({
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
  onStatus = () => {},
} = {}) {
  const pending = new Map();
  let timer = null;
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
    clear(roundId, taskId) {
      queue("DELETE", { roundId, taskId });
    },
    async flush() {
      return flush();
    },
    get state() {
      return state;
    },
  };

  function queue(method, body) {
    pending.set(`${body.roundId}:${body.taskId}`, { method, body });
    if (state === "not_configured") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, SYNC_DELAY_MS);
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (pending.size === 0 || state === "not_configured") return true;
    const operations = [...pending.entries()];
    for (const [key, operation] of operations) {
      const result = await request(operation.method, operation.body);
      if (!result.ok) {
        setState(result.state);
        return false;
      }
      pending.delete(key);
    }
    setState("synced");
    return true;
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
      if (response.ok) return { ok: true, body: payload };
      return {
        ok: false,
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
      return { ok: false, body: null, state: "offline" };
    }
  }

  function setState(nextState) {
    state = nextState;
    onStatus(nextState);
  }
}

export function reconcileCalibrationAnswers(state, remoteAnswers) {
  const remoteByKey = new Map(
    remoteAnswers.map((answer) => [
      `${answer.roundId}:${answer.taskId}`,
      answer,
    ]),
  );
  const uploads = [];
  for (const storedRound of state.rounds) {
    for (const [taskId, localAnswer] of Object.entries(storedRound.answers)) {
      const key = `${storedRound.round.roundId}:${taskId}`;
      const remoteAnswer = remoteByKey.get(key);
      if (!remoteAnswer) {
        uploads.push({
          roundId: storedRound.round.roundId,
          taskId,
          answer: localAnswer,
        });
        continue;
      }
      remoteByKey.delete(key);
      if (timestamp(localAnswer.updatedAt) > timestamp(remoteAnswer.updatedAt)) {
        uploads.push({
          roundId: storedRound.round.roundId,
          taskId,
          answer: localAnswer,
        });
        continue;
      }
      if (timestamp(remoteAnswer.updatedAt) > timestamp(localAnswer.updatedAt)) {
        storedRound.answers[taskId] = toStoredAnswer(remoteAnswer);
      }
    }
  }
  for (const remoteAnswer of remoteByKey.values()) {
    const storedRound = state.rounds.find(
      ({ round }) => round.roundId === remoteAnswer.roundId,
    );
    if (
      storedRound?.round.tasks.some(
        ({ taskId }) => taskId === remoteAnswer.taskId,
      )
    ) {
      storedRound.answers[remoteAnswer.taskId] = toStoredAnswer(remoteAnswer);
    }
  }
  return { state, uploads };
}

function toStoredAnswer(answer) {
  return {
    guessedLayoutIds: answer.guessedLayoutIds,
    judgment: answer.judgment,
    note: answer.note,
    updatedAt: answer.updatedAt,
  };
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
