export const DEFAULT_LOAD_ATTEMPTS = 3;

const TRANSIENT_STATUS_CODES = new Set([408, 429]);
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);
const TRANSIENT_MESSAGE =
  /\b(?:connection|could not load|fetch|failed to (?:fetch|initialize|load)|initialization failed|load failed|network|temporar(?:y|ily)|timed? ?out|timeout)\b/i;
const DETERMINISTIC_MESSAGE =
  /\b(?:corrupt|dimension|incompatible|invalid (?:configuration|data|model)|malformed|unsupported|validation)\b/i;

export function isTransientLoadError(error) {
  if (!error || error.retryable === false) {
    return false;
  }
  if (error.retryable === true) {
    return true;
  }

  const status = Number(error.status ?? error.cause?.status);
  if (Number.isFinite(status)) {
    return (
      TRANSIENT_STATUS_CODES.has(status) ||
      (status >= 500 && status <= 599)
    );
  }

  if (TRANSIENT_ERROR_CODES.has(error.code ?? error.cause?.code)) {
    return true;
  }
  if (error.name === "TimeoutError") {
    return true;
  }
  if (
    error instanceof SyntaxError ||
    error instanceof RangeError ||
    error.name === "AbortError"
  ) {
    return false;
  }

  const message = String(error.message ?? error);
  if (DETERMINISTIC_MESSAGE.test(message)) {
    return false;
  }
  return TRANSIENT_MESSAGE.test(message);
}

export function retryLoad(operation, options = {}) {
  const maxAttempts = Math.max(
    1,
    Math.floor(options.maxAttempts ?? DEFAULT_LOAD_ATTEMPTS),
  );
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 150);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 600);
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.2));
  const classifyError = options.classifyError ?? isTransientLoadError;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;

  return run();

  async function run() {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation({ attempt, maxAttempts });
      } catch (error) {
        if (attempt >= maxAttempts || !classifyError(error)) {
          throw error;
        }

        const unjitteredDelay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** (attempt - 1),
        );
        const jitter = unjitteredDelay * jitterRatio * (random() * 2 - 1);
        const delayMs = Math.max(0, Math.round(unjitteredDelay + jitter));
        options.onRetry?.({
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          error,
        });
        await sleep(delayMs);
      }
    }
    throw new Error("Load retry loop exhausted without a result.");
  }
}

export function createSingleFlightRetryLoader(loadAttempt, retryOptions = {}) {
  const promises = new Map();

  return function load(key, options = {}) {
    if (!promises.has(key)) {
      const promise = retryLoad(
        () => loadAttempt(key, options),
        {
          ...retryOptions,
          ...options.retry,
          onRetry: options.onRetry ?? retryOptions.onRetry,
        },
      ).catch((error) => {
        if (promises.get(key) === promise) {
          promises.delete(key);
        }
        throw error;
      });
      promises.set(key, promise);
    }

    return promises.get(key);
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
