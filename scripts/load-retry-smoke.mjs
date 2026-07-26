import assert from "node:assert/strict";
import { createJsonLoader } from "../src/clue-index.js";
import { createExtractorLoader } from "../src/embeddings.js";
import {
  createSingleFlightRetryLoader,
  isTransientLoadError,
  retryLoad,
} from "../src/load-retry.js";

assert.equal(isTransientLoadError(Object.assign(new Error("HTTP 408"), { status: 408 })), true);
assert.equal(isTransientLoadError(Object.assign(new Error("HTTP 429"), { status: 429 })), true);
assert.equal(isTransientLoadError(Object.assign(new Error("HTTP 503"), { status: 503 })), true);
assert.equal(isTransientLoadError(Object.assign(new Error("HTTP 404"), { status: 404 })), false);
assert.equal(isTransientLoadError(new TypeError("Failed to fetch")), true);
assert.equal(isTransientLoadError(new Error("WASM initialization failed")), true);
assert.equal(isTransientLoadError(new SyntaxError("Unexpected token")), false);
assert.equal(isTransientLoadError(new Error("Clue index is corrupt")), false);
assert.equal(isTransientLoadError(new Error("Unsupported model configuration")), false);
assert.equal(isTransientLoadError(new Error("Embedding dimensions are incompatible")), false);
assert.equal(isTransientLoadError(new Error("Manifest validation failed")), false);

const retryEvents = [];
const retrySleeps = [];
let retryAttempts = 0;
const recovered = await retryLoad(
  async () => {
    retryAttempts += 1;
    if (retryAttempts < 3) {
      throw Object.assign(new Error("Temporary network failure"), {
        code: "ECONNRESET",
      });
    }
    return "ready";
  },
  {
    baseDelayMs: 100,
    jitterRatio: 0,
    onRetry: (event) => retryEvents.push(event),
    sleep: async (milliseconds) => retrySleeps.push(milliseconds),
  },
);
assert.equal(recovered, "ready");
assert.equal(retryAttempts, 3);
assert.deepEqual(retrySleeps, [100, 200]);
assert.deepEqual(
  retryEvents.map(({ attempt, maxAttempts, delayMs }) => ({
    attempt,
    maxAttempts,
    delayMs,
  })),
  [
    { attempt: 2, maxAttempts: 3, delayMs: 100 },
    { attempt: 3, maxAttempts: 3, delayMs: 200 },
  ],
);

let boundedAttempts = 0;
await assert.rejects(
  retryLoad(
    async () => {
      boundedAttempts += 1;
      throw Object.assign(new Error("Network unavailable"), {
        code: "ENETUNREACH",
      });
    },
    { jitterRatio: 0, sleep: async () => {} },
  ),
  /Network unavailable/,
);
assert.equal(boundedAttempts, 3);

let deterministicAttempts = 0;
await assert.rejects(
  retryLoad(
    async () => {
      deterministicAttempts += 1;
      throw new Error("Clue index dimensions are incompatible");
    },
    { sleep: async () => assert.fail("Deterministic failures must not wait") },
  ),
  /incompatible/,
);
assert.equal(deterministicAttempts, 1);

let sharedAttempts = 0;
const sharedLoader = createSingleFlightRetryLoader(
  async () => {
    sharedAttempts += 1;
    if (sharedAttempts === 1) {
      throw new TypeError("Failed to fetch");
    }
    return { ready: true };
  },
  { jitterRatio: 0, sleep: async () => {} },
);
const firstShared = sharedLoader("same-key");
const secondShared = sharedLoader("same-key");
assert.strictEqual(firstShared, secondShared);
assert.strictEqual(await firstShared, await secondShared);
assert.equal(sharedAttempts, 2);
assert.strictEqual(sharedLoader("same-key"), firstShared);

let slowAttempts = 0;
let releaseSlowLoad;
const slowLoader = createSingleFlightRetryLoader(async () => {
  slowAttempts += 1;
  return new Promise((resolve) => {
    releaseSlowLoad = resolve;
  });
});
const firstSlow = slowLoader("slow-key");
const secondSlow = slowLoader("slow-key");
await Promise.resolve();
assert.strictEqual(firstSlow, secondSlow);
assert.equal(slowAttempts, 1);
releaseSlowLoad("slow result");
assert.equal(await firstSlow, "slow result");
assert.equal(slowAttempts, 1);

let poisonAttempts = 0;
const recoveringLoader = createSingleFlightRetryLoader(
  async () => {
    poisonAttempts += 1;
    if (poisonAttempts <= 3) {
      throw new TypeError("Failed to fetch");
    }
    return "recovered after a later call";
  },
  { jitterRatio: 0, sleep: async () => {} },
);
await assert.rejects(recoveringLoader("poison-key"), /Failed to fetch/);
assert.equal(await recoveringLoader("poison-key"), "recovered after a later call");
assert.equal(poisonAttempts, 4);

let pipelineAttempts = 0;
const extractor = () => "vectors";
const loadExtractor = createExtractorLoader(
  async () => {
    pipelineAttempts += 1;
    if (pipelineAttempts === 1) {
      throw new TypeError("Failed to fetch model");
    }
    return extractor;
  },
  { jitterRatio: 0, sleep: async () => {} },
);
const extractorOptions = {
  model: "test/model",
  revision: "main",
};
const firstExtractor = loadExtractor("test/model@main:", extractorOptions);
const secondExtractor = loadExtractor("test/model@main:", extractorOptions);
assert.strictEqual(firstExtractor, secondExtractor);
assert.strictEqual(await firstExtractor, extractor);
assert.strictEqual(await secondExtractor, extractor);
assert.equal(pipelineAttempts, 2);

let jsonAttempts = 0;
const loadJson = createJsonLoader(
  async () => {
    jsonAttempts += 1;
    if (jsonAttempts === 1) {
      return {
        ok: false,
        status: 503,
      };
    }
    return {
      ok: true,
      json: async () => ({ manifest: true }),
    };
  },
  { jitterRatio: 0, sleep: async () => {} },
);
const firstJson = loadJson("/manifest.json", { label: "clue manifest" });
const secondJson = loadJson("/manifest.json", { label: "clue manifest" });
assert.strictEqual(firstJson, secondJson);
assert.deepEqual(await firstJson, { manifest: true });
assert.deepEqual(await secondJson, { manifest: true });
assert.equal(jsonAttempts, 2);

console.log("Load retry smoke checks passed.");
