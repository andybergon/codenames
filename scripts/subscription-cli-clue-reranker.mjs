import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

export const SUBSCRIPTION_CLI_PROMPT_VERSION = 1;
export const SUBSCRIPTION_CLI_SHORTLIST_VERSION =
  "play-safe-shortlist-v1";
export const SUBSCRIPTION_CLI_TRANSPORT_VERSION = 1;

const MODELS = Object.freeze({
  "claude-opus": {
    cli: "claude",
    selector: "opus",
    transport: "claude-code-subscription",
  },
  "codex-sol": {
    cli: "codex",
    selector: "gpt-5.6-sol",
    transport: "codex-subscription",
  },
  "codex-terra": {
    cli: "codex",
    selector: "gpt-5.6-terra",
    transport: "codex-subscription",
  },
});

export async function createSubscriptionCliClueReranker({
  cacheDirectory,
  cliVersionOverride,
  invokeTransport = invoke,
  modelId,
  requestConcurrency = 2,
  timeoutMs = 120_000,
}) {
  const definition = MODELS[modelId];
  if (!definition) {
    throw new Error(
      `Unknown subscription CLI model ${modelId}. Expected ${Object.keys(MODELS).join(", ")}.`,
    );
  }
  await mkdir(cacheDirectory, { recursive: true });
  const cliVersion =
    cliVersionOverride ?? (await readCliVersion(definition.cli));
  const implementationSha256 = sha256(await readFile(new URL(import.meta.url)));
  const commandTemplate = transportCommand(definition, "{PROMPT}");
  const identity = {
    modelId,
    cli: definition.cli,
    cliVersion,
    implementationSha256,
    selector: definition.selector,
    selectionCommand: commandTemplate,
    subscriptionSurface: definition.transport,
    promptVersion: SUBSCRIPTION_CLI_PROMPT_VERSION,
    shortlistVersion: SUBSCRIPTION_CLI_SHORTLIST_VERSION,
    transportVersion: SUBSCRIPTION_CLI_TRANSPORT_VERSION,
    requestConcurrency,
    casesPerRequest: 1,
    timeoutMs,
    tools: "disabled",
    fallbackModel: null,
  };
  const stats = {
    requestAttempts: 0,
    successfulRequests: 0,
    cachedRequestCount: 0,
    caseCount: 0,
    cacheErrors: 0,
    transportErrors: 0,
    parseErrors: 0,
    validationErrors: 0,
    timeoutErrors: 0,
    retries: 0,
    quotaStops: 0,
    latenciesMs: [],
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
  };
  let queue = [];
  let stopped = null;
  let activeRequests = 0;

  return {
    identity,
    select(input) {
      if (stopped) return Promise.reject(stopped);
      return new Promise((resolveSelection, rejectSelection) => {
        queue.push({ input, rejectSelection, resolveSelection });
        pump();
      });
    },
    stats() {
      return {
        ...stats,
        latenciesMs: [...stats.latenciesMs],
        usage: { ...stats.usage },
      };
    },
  };

  function pump() {
    while (
      queue.length > 0 &&
      !stopped &&
      activeRequests < requestConcurrency
    ) {
      const batch = queue.splice(0, 1);
      activeRequests += 1;
      void runOne(batch).finally(() => {
        activeRequests -= 1;
        pump();
      });
    }
  }

  async function runOne(batch) {
    const prompt = buildSubscriptionCliPrompt(
      batch.map(({ input }) => input),
    );
    const cacheKey = sha256(
      JSON.stringify({
        identity,
        prompt,
      }),
    );
    const cachePath = resolve(cacheDirectory, `${cacheKey}.json`);
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      if (
        sha256(JSON.stringify(cached.identity)) !==
        sha256(JSON.stringify(identity))
      ) {
        throw cacheError("Cached CLI identity does not match.");
      }
      if (cached.prompt !== prompt) {
        throw cacheError("Cached CLI prompt does not match.");
      }
      const picks = validatePicks(cached.picks, batch);
      stats.cachedRequestCount += 1;
      stats.caseCount += batch.length;
      settle(batch, picks);
    } catch (error) {
      if (error.code !== "ENOENT") {
        stats.cacheErrors += 1;
      }
      try {
        const startedAt = performance.now();
        let result;
        try {
          result = await attemptInvoke(
            invokeTransport,
            definition,
            prompt,
            timeoutMs,
            stats,
          );
        } catch (requestError) {
          if (
            isQuotaError(requestError) ||
            !isTransientError(requestError)
          ) {
            throw requestError;
          }
          recordError(stats, requestError);
          stats.retries += 1;
          await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, 1_000),
          );
          result = await attemptInvoke(
            invokeTransport,
            definition,
            prompt,
            timeoutMs,
            stats,
          );
        }
        let picks;
        try {
          picks = validatePicks(result.picks, batch);
        } catch (validationError) {
          validationError.kind = "validation";
          throw validationError;
        }
        stats.successfulRequests += 1;
        stats.caseCount += batch.length;
        stats.latenciesMs.push(
          Number((performance.now() - startedAt).toFixed(1)),
        );
        accumulateUsage(stats.usage, result.usage);
        await writeFile(
          cachePath,
          `${JSON.stringify(
            {
              identity,
              prompt,
              promptSha256: sha256(prompt),
              generatedAt: new Date().toISOString(),
              picks,
              structuredOutput: result.structuredOutput,
              rawOutput: result.rawOutput,
              usage: result.usage,
            },
            null,
            2,
          )}\n`,
        );
        settle(batch, picks);
      } catch (requestError) {
        recordError(stats, requestError);
        stopped = requestError;
        for (const { rejectSelection } of batch) {
          rejectSelection(requestError);
        }
        const pending = queue;
        queue = [];
        for (const { rejectSelection } of pending) {
          rejectSelection(requestError);
        }
      }
    }
  }
}

async function attemptInvoke(
  invokeTransport,
  definition,
  prompt,
  timeoutMs,
  stats,
) {
  stats.requestAttempts += 1;
  return invokeTransport(definition, prompt, timeoutMs);
}

export function buildSubscriptionCliPrompt(cases) {
  return JSON.stringify({
    task:
      "Choose exactly one clue candidate for each independent Codenames spymaster case.",
    promptVersion: SUBSCRIPTION_CLI_PROMPT_VERSION,
    shortlistVersion: SUBSCRIPTION_CLI_SHORTLIST_VERSION,
    rules: [
      "Choose only a supplied candidateId.",
      "The embedding engine already applied clue legality and generated the safe shortlist.",
      "Prefer a clue whose intended targets form a clear human association.",
      "Treat wrong-team, neutral, and assassin risk as guardrails, not scoring opportunities.",
      "Do not invent a clue, target, role, or candidate.",
      "Return only the requested JSON object.",
    ],
    cases,
    output: {
      picks: [{ caseId: "case id", candidateId: "candidate id" }],
    },
  });
}

async function invoke(definition, prompt, timeoutMs) {
  return definition.cli === "claude"
    ? invokeClaude(definition, prompt, timeoutMs)
    : invokeCodex(definition, prompt, timeoutMs);
}

async function invokeClaude(definition, prompt, timeoutMs) {
  const invocation = transportCommand(definition, prompt);
  const output = await run(
    invocation.executable,
    invocation.argv,
    timeoutMs,
  );
  let envelope;
  try {
    envelope = JSON.parse(output.stdout);
  } catch (error) {
    error.kind = "parse";
    throw error;
  }
  if (envelope.is_error) {
    const error = new Error(
      envelope.result ?? "Claude CLI returned an error.",
    );
    error.kind = "transport";
    throw error;
  }
  let structuredOutput = envelope.structured_output;
  if (!structuredOutput) {
    try {
      structuredOutput = JSON.parse(envelope.result);
    } catch (error) {
      error.kind = "parse";
      throw error;
    }
  }
  return {
    picks: structuredOutput.picks,
    rawOutput: output.stdout,
    structuredOutput,
    usage: envelope.usage ?? null,
  };
}

async function invokeCodex(definition, prompt, timeoutMs) {
  const invocation = transportCommand(definition, prompt);
  const output = await run(
    invocation.executable,
    invocation.argv,
    timeoutMs,
  );
  let events;
  try {
    events = output.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    error.kind = "parse";
    throw error;
  }
  const failed = events.find(
    (event) => event.type === "error" || event.type === "turn.failed",
  );
  if (failed) {
    const error = new Error(
      failed.error?.message ??
        failed.message ??
        `Codex CLI reported ${failed.type}.`,
    );
    error.kind = "transport";
    throw error;
  }
  const forbidden = events.find(
    (event) =>
      event.type === "item.completed" &&
      !["agent_message", "error"].includes(event.item?.type),
  );
  if (forbidden) {
    const error = new Error(
      `Codex CLI attempted forbidden item type ${forbidden.item?.type}.`,
    );
    error.kind = "validation";
    throw error;
  }
  const message = events
    .filter(
      (event) =>
        event.type === "item.completed" &&
        event.item?.type === "agent_message",
    )
    .at(-1)?.item?.text;
  if (!message) {
    const error = new Error("Codex CLI returned no agent message.");
    error.kind = "parse";
    throw error;
  }
  let structuredOutput;
  try {
    structuredOutput = JSON.parse(message);
  } catch (error) {
    error.kind = "parse";
    throw error;
  }
  return {
    picks: structuredOutput.picks,
    rawOutput: output.stdout,
    structuredOutput,
    usage: events.find((event) => event.type === "turn.completed")?.usage,
  };
}

function validatePicks(picks, batch) {
  if (!Array.isArray(picks) || picks.length !== batch.length) {
    throw new Error("CLI reranker returned the wrong number of picks.");
  }
  const byCase = new Map(picks.map((pick) => [pick.caseId, pick]));
  return batch.map(({ input }) => {
    const pick = byCase.get(input.caseId);
    const valid = input.candidates.some(
      ({ candidateId }) => candidateId === pick?.candidateId,
    );
    if (!valid) {
      throw new Error(
        `CLI reranker returned an invalid candidate for ${input.caseId}.`,
      );
    }
    return pick;
  });
}

function settle(batch, picks) {
  for (let index = 0; index < batch.length; index += 1) {
    batch[index].resolveSelection(picks[index].candidateId);
  }
}

function run(command, args, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      const error = new Error(
        `${command} CLI timed out after ${timeoutMs} ms.`,
      );
      error.kind = "timeout";
      rejectRun(error);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout, stderr });
      } else {
        const error = new Error(
          `${command} CLI exited ${code}: ${stderr || stdout}`.trim(),
        );
        error.kind = "transport";
        rejectRun(error);
      }
    });
  });
}

function transportCommand(definition, prompt) {
  if (definition.cli === "claude") {
    return {
      executable: "claude",
      argv: [
        "-p",
        "--model",
        definition.selector,
        "--effort",
        "low",
        "--tools",
        "",
        "--permission-mode",
        "dontAsk",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(outputSchema()),
        prompt,
      ],
    };
  }
  return {
    executable: "codex",
    argv: [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--disable",
      "shell_tool",
      "--disable",
      "plugins",
      "--disable",
      "skill_search",
      "--disable",
      "plugin_sharing",
      "--disable",
      "tool_suggest",
      "--model",
      definition.selector,
      "-c",
      'model_reasoning_effort="low"',
      "--json",
      prompt,
    ],
  };
}

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["picks"],
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["caseId", "candidateId"],
          properties: {
            caseId: { type: "string" },
            candidateId: { type: "string" },
          },
        },
      },
    },
  };
}

async function readCliVersion(cli) {
  const output = await run(cli, ["--version"], 10_000);
  return output.stdout.trim();
}

function isQuotaError(error) {
  return /quota|rate.?limit|usage.?limit|capacity|overloaded/iu.test(
    error.message,
  );
}

function isTransientError(error) {
  return /connect|network|socket|stream disconnected|timed out|overloaded/iu.test(
    error.message,
  );
}

function recordError(stats, error) {
  if (isQuotaError(error)) stats.quotaStops += 1;
  if (error.kind === "parse") stats.parseErrors += 1;
  else if (error.kind === "validation") stats.validationErrors += 1;
  else if (error.kind === "timeout") stats.timeoutErrors += 1;
  else stats.transportErrors += 1;
}

function accumulateUsage(total, usage) {
  if (!usage) return;
  total.inputTokens += usage.input_tokens ?? 0;
  total.cachedInputTokens += usage.cached_input_tokens ?? 0;
  total.cacheCreationInputTokens +=
    usage.cache_creation_input_tokens ?? 0;
  total.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  total.outputTokens += usage.output_tokens ?? 0;
  total.reasoningOutputTokens +=
    usage.reasoning_output_tokens ?? 0;
}

function cacheError(message) {
  const error = new Error(message);
  error.kind = "cache";
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
