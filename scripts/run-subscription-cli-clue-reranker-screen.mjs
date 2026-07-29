import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  open,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_ROOT = resolve(
  ROOT,
  ".cache/subscription-cli-benchmark",
);
const MODELS = Object.freeze([
  "codex-sol",
  "codex-terra",
  "claude-opus",
]);
const selectedModels = parseModels(process.argv.slice(2));
const acceptedDevelopment = resolve(
  ROOT,
  "scripts/generated/play-accepted-baseline-development.json",
);
const sameModelDirectory = resolve(OUTPUT_ROOT, "baseline-same-model");
const acceptedSmoke = resolve(sameModelDirectory, "smoke.json");
const transferDirectory = resolve(OUTPUT_ROOT, "baseline-transfer");
const transferSmoke = resolve(transferDirectory, "smoke.json");
const failures = [];

await Promise.all([
  access(acceptedDevelopment),
  mkdir(sameModelDirectory, { recursive: true }),
  mkdir(transferDirectory, { recursive: true }),
]);

await timedNpm(
  [
    "run",
    "benchmark:play",
    "--",
    "--split",
    "smoke",
    "--comparison-only",
    "--output",
    acceptedSmoke,
  ],
  resolve(sameModelDirectory, "smoke.log"),
);
await timedNpm(
  [
    "run",
    "benchmark:play",
    "--",
    "--split",
    "smoke",
    "--comparison-only",
    "--operative-model",
    "minilm-l6",
    "--output",
    transferSmoke,
  ],
  resolve(transferDirectory, "smoke.log"),
);

for (const modelId of selectedModels) {
  const directory = resolve(OUTPUT_ROOT, modelId);
  await mkdir(directory, { recursive: true });
  const failurePath = resolve(directory, "failure.json");
  await unlink(failurePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  try {
    await runScreen({
      baseline: acceptedSmoke,
      baselineId: "accepted-production-smoke",
      directory,
      modelId,
      name: "smoke",
      playArgs: ["--split", "smoke"],
    });
    await runScreen({
      baseline: acceptedDevelopment,
      baselineId: "accepted-production-development",
      directory,
      modelId,
      name: "development",
      playArgs: ["--split", "development"],
    });
    await runScreen({
      baseline: transferSmoke,
      baselineId: "accepted-production-transfer-smoke",
      directory,
      modelId,
      name: "transfer-smoke",
      playArgs: [
        "--split",
        "smoke",
        "--operative-model",
        "minilm-l6",
      ],
    });
  } catch (error) {
    const failure = {
      modelId,
      generatedAt: new Date().toISOString(),
      error: error.message,
      heldOutTestConsumed: false,
      fallbackModel: null,
    };
    failures.push(failure);
    await writeFile(
      failurePath,
      `${JSON.stringify(failure, null, 2)}\n`,
    );
    console.error(`${modelId} stopped: ${error.message}`);
  }
}

console.log(
  `Completed non-held-out subscription CLI screens for ${selectedModels.join(", ")}.`,
);
if (failures.length > 0) {
  process.exitCode = 1;
}

async function runScreen({
  baseline,
  baselineId,
  directory,
  modelId,
  name,
  playArgs,
}) {
  const report = resolve(directory, `${name}.json`);
  const comparison = resolve(directory, `${name}-comparison.json`);
  await timedNpm(
    [
      "run",
      "benchmark:play",
      "--",
      ...playArgs,
      "--comparison-only",
      "--subscription-cli-model",
      modelId,
      "--output",
      report,
    ],
    resolve(directory, `${name}.log`),
  );
  await run(
    "npm",
    [
      "run",
      "benchmark:compare",
      "--",
      "--baseline",
      baseline,
      "--baseline-id",
      baselineId,
      "--candidate",
      `${modelId}=${report}`,
      "--output",
      comparison,
    ],
  );
}

function timedNpm(args, logPath) {
  return run("/usr/bin/time", ["-l", "npm", ...args], logPath);
}

async function run(executable, args, logPath = null) {
  const output = logPath ? await open(logPath, "w") : null;
  console.log(`Running ${executable} ${args.join(" ")}`);
  try {
    await new Promise((resolveRun, rejectRun) => {
      const child = spawn(executable, args, {
        cwd: ROOT,
        env: subscriptionEnvironment(),
        stdio: output
          ? ["ignore", output.fd, output.fd]
          : ["ignore", "inherit", "inherit"],
      });
      child.on("error", rejectRun);
      child.on("close", (code, signal) => {
        if (code === 0) resolveRun();
        else {
          rejectRun(
            new Error(
              `${executable} exited ${code ?? `on signal ${signal}`}${logPath ? `; see ${logPath}` : ""}.`,
            ),
          );
        }
      });
    });
  } finally {
    await output?.close();
  }
}

function parseModels(args) {
  if (args.length === 0) return MODELS;
  if (args.length !== 2 || args[0] !== "--models") {
    throw new Error(
      "Usage: node scripts/run-subscription-cli-clue-reranker-screen.mjs [--models codex-sol,codex-terra,claude-opus]",
    );
  }
  const models = args[1].split(",").filter(Boolean);
  if (
    models.length === 0 ||
    models.some((modelId) => !MODELS.includes(modelId))
  ) {
    throw new Error(`Models must be selected from ${MODELS.join(", ")}.`);
  }
  return models;
}

function subscriptionEnvironment() {
  const {
    ANTHROPIC_API_KEY: _anthropicApiKey,
    OPENAI_API_KEY: _openAiApiKey,
    ...environment
  } = process.env;
  return environment;
}
