import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSubscriptionCliPrompt,
  createSubscriptionCliClueReranker,
} from "./subscription-cli-clue-reranker.mjs";

const cacheDirectory = await mkdtemp(
  join(tmpdir(), "codenames-cli-reranker-"),
);
const inputs = [
  fixture("0:hybrid:dynamic:1:blue", "c0"),
  fixture("1:hybrid:dynamic:1:blue", "c1"),
];
const prompts = [];
let activeRequests = 0;
let peakActiveRequests = 0;

try {
  const first = await createSubscriptionCliClueReranker({
    cacheDirectory,
    cliVersionOverride: "codex-cli test",
    invokeTransport: async (_definition, prompt) => {
      activeRequests += 1;
      peakActiveRequests = Math.max(
        peakActiveRequests,
        activeRequests,
      );
      prompts.push(prompt);
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 10),
      );
      const request = JSON.parse(prompt);
      const structuredOutput = {
        picks: request.cases.map(({ caseId, candidates }) => ({
          caseId,
          candidateId: candidates[0].candidateId,
        })),
      };
      activeRequests -= 1;
      return {
        picks: structuredOutput.picks,
        rawOutput: JSON.stringify(structuredOutput),
        structuredOutput,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
    modelId: "codex-sol",
    requestConcurrency: 2,
  });
  assert.deepEqual(
    await Promise.all(inputs.map((input) => first.select(input))),
    ["c0", "c1"],
  );
  assert.equal(prompts.length, 2);
  assert.equal(peakActiveRequests, 2);
  assert.equal(JSON.parse(prompts[0]).cases.length, 1);
  assert.equal(first.stats().successfulRequests, 2);
  assert.equal(first.stats().caseCount, 2);
  assert.equal(first.stats().usage.inputTokens, 2);
  assert.equal(first.stats().usage.outputTokens, 2);
  assert.equal(first.identity.reasoningEffort, "low");
  assert.ok(
    first.identity.selectionCommand.argv.includes(
      'model_reasoning_effort="low"',
    ),
  );

  const lunaHigh = await createSubscriptionCliClueReranker({
    cacheDirectory: join(cacheDirectory, "luna-high"),
    cliVersionOverride: "codex-cli test",
    invokeTransport: async (_definition, prompt) => {
      const request = JSON.parse(prompt);
      const structuredOutput = {
        picks: [
          {
            caseId: request.cases[0].caseId,
            candidateId: request.cases[0].candidates[0].candidateId,
          },
        ],
      };
      return {
        picks: structuredOutput.picks,
        rawOutput: JSON.stringify(structuredOutput),
        structuredOutput,
        usage: null,
      };
    },
    modelId: "codex-luna-high",
  });
  assert.equal(lunaHigh.identity.selector, "gpt-5.6-luna");
  assert.equal(lunaHigh.identity.reasoningEffort, "high");
  assert.ok(
    lunaHigh.identity.selectionCommand.argv.includes(
      'model_reasoning_effort="high"',
    ),
  );
  assert.equal(await lunaHigh.select(inputs[0]), "c0");

  const cached = await createSubscriptionCliClueReranker({
    cacheDirectory,
    cliVersionOverride: "codex-cli test",
    invokeTransport: async () => {
      throw new Error("matching cache should avoid transport");
    },
    modelId: "codex-sol",
    requestConcurrency: 2,
  });
  assert.deepEqual(
    await Promise.all(inputs.map((input) => cached.select(input))),
    ["c0", "c1"],
  );
  assert.equal(cached.stats().cachedRequestCount, 2);

  let revisionRequests = 0;
  const revised = await createSubscriptionCliClueReranker({
    cacheDirectory,
    cliVersionOverride: "codex-cli revised",
    invokeTransport: async (_definition, prompt) => {
      revisionRequests += 1;
      const request = JSON.parse(prompt);
      const structuredOutput = {
        picks: [
          {
            caseId: request.cases[0].caseId,
            candidateId: request.cases[0].candidates[0].candidateId,
          },
        ],
      };
      return {
        picks: structuredOutput.picks,
        rawOutput: JSON.stringify(structuredOutput),
        structuredOutput,
        usage: null,
      };
    },
    modelId: "codex-sol",
  });
  await revised.select(inputs[0]);
  assert.equal(revisionRequests, 1);

  const quota = await createSubscriptionCliClueReranker({
    cacheDirectory: join(cacheDirectory, "quota"),
    cliVersionOverride: "codex-cli quota",
    invokeTransport: async () => {
      throw new Error("subscription quota exceeded");
    },
    modelId: "codex-sol",
    requestConcurrency: 1,
  });
  const quotaResults = await Promise.allSettled(
    [
      fixture("2:hybrid:dynamic:1:blue", "c0"),
      fixture("3:hybrid:dynamic:1:blue", "c0"),
      fixture("4:hybrid:dynamic:1:blue", "c0"),
    ].map((input) => quota.select(input)),
  );
  assert.deepEqual(
    quotaResults.map(({ status }) => status),
    ["rejected", "rejected", "rejected"],
  );
  assert.equal(quota.stats().quotaStops, 1);

  const built = JSON.parse(buildSubscriptionCliPrompt([inputs[0]]));
  assert.equal(built.promptVersion, 1);
  assert.equal(built.shortlistVersion, "play-safe-shortlist-v1");
  assert.equal(built.cases[0].caseId, inputs[0].caseId);

  console.log("Subscription CLI clue reranker smoke checks passed.");
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}

function fixture(caseId, firstCandidateId) {
  return {
    caseId,
    activeSide: "blue",
    board: [
      { team: "friendly", word: "ALPHA" },
      { team: "assassin", word: "OMEGA" },
    ],
    candidates: [
      {
        candidateId: firstCandidateId,
        clue: "START",
        number: 1,
        targets: ["ALPHA"],
        engineEvidence: {
          expectedNet: 1,
          margin: 0.5,
          risk: "safe",
          score: 60,
          success: 0.9,
        },
      },
    ],
  };
}
