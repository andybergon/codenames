import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSubscriptionCliClueReranker } from "./subscription-cli-clue-reranker.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_ROOT = resolve(ROOT, ".cache/subscription-cli-benchmark");
const MODELS = Object.freeze(["codex-sol", "codex-terra", "claude-opus"]);
const { reuseBaselines, selectedModels } = parseOptions(process.argv.slice(2));
const acceptedDevelopment = resolve(
  ROOT,
  "scripts/generated/play-accepted-baseline-development.json",
);
const sameModelDirectory = resolve(OUTPUT_ROOT, "baseline-same-model");
const acceptedSmoke = resolve(sameModelDirectory, "smoke.json");
const transferDirectory = resolve(OUTPUT_ROOT, "baseline-transfer");
const transferSmoke = resolve(transferDirectory, "smoke.json");
const failures = [];
const providerEnvironmentPolicy = environmentProvenance();

await access(acceptedDevelopment);
if (reuseBaselines) {
  await Promise.all([access(acceptedSmoke), access(transferSmoke)]);
} else {
  await Promise.all([
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
}

for (const modelId of selectedModels) {
  const directory = resolve(OUTPUT_ROOT, modelId);
  await mkdir(directory, { recursive: true });
  const failurePath = resolve(directory, "failure.json");
  const progressPath = resolve(directory, "progress.json");
  const priorFailure = await readJsonIfExists(failurePath);
  const progress = await readJsonIfExists(progressPath);
  const provenance = await probeCliIdentity(modelId);
  if (
    progress?.provenance &&
    JSON.stringify(progress.provenance) !== JSON.stringify(provenance)
  ) {
    throw new Error(
      `${modelId} CLI identity changed since the recorded progress. Start a separate evidence directory instead of mixing screens.`,
    );
  }
  const completedScreens = await validateCompletedScreens(
    directory,
    modelId,
    progress?.completedScreens ?? priorFailure?.completedScreens ?? [],
    provenance,
  );
  await writeProgress(progressPath, {
    modelId,
    provenance,
    completedScreens,
  });
  await archiveFailure(failurePath, directory, priorFailure);
  let activeScreen = completedScreens.includes("smoke")
    ? "development"
    : "smoke";
  try {
    if (!completedScreens.includes("smoke")) {
      await runScreen({
        baseline: acceptedSmoke,
        baselineId: "accepted-production-smoke",
        directory,
        modelId,
        name: "smoke",
        playArgs: ["--split", "smoke"],
      });
      completedScreens.push("smoke");
      await writeProgress(progressPath, {
        modelId,
        provenance,
        completedScreens,
      });
    }
    activeScreen = "development";
    if (!completedScreens.includes("development")) {
      await runScreen({
        baseline: acceptedDevelopment,
        baselineId: "accepted-production-development",
        directory,
        modelId,
        name: "development",
        playArgs: ["--split", "development"],
      });
      completedScreens.push("development");
      await writeProgress(progressPath, {
        modelId,
        provenance,
        completedScreens,
      });
    }
    activeScreen = "transfer-smoke";
    if (!completedScreens.includes("transfer-smoke")) {
      await runScreen({
        baseline: transferSmoke,
        baselineId: "accepted-production-transfer-smoke",
        directory,
        modelId,
        name: "transfer-smoke",
        playArgs: ["--split", "smoke", "--operative-model", "minilm-l6"],
      });
      completedScreens.push("transfer-smoke");
      await writeProgress(progressPath, {
        modelId,
        provenance,
        completedScreens,
      });
    }
  } catch (error) {
    const failure = {
      modelId,
      generatedAt: new Date().toISOString(),
      failedScreen: activeScreen,
      completedScreens,
      provenance,
      providerEnvironmentPolicy,
      error: error.message,
      heldOutTestConsumed: false,
      fallbackModel: null,
    };
    failures.push(failure);
    await writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`);
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
  const log = resolve(directory, `${name}.log`);
  await archiveLog(log);
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
    log,
  );
  await run("npm", [
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
  ]);
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

function parseOptions(args) {
  const reuseBaselines = args.includes("--reuse-baselines");
  const remaining = args.filter((value) => value !== "--reuse-baselines");
  if (remaining.length === 0) {
    return { reuseBaselines, selectedModels: MODELS };
  }
  if (remaining.length !== 2 || remaining[0] !== "--models") {
    throw new Error(
      "Usage: node scripts/run-subscription-cli-clue-reranker-screen.mjs [--reuse-baselines] [--models codex-sol,codex-terra,claude-opus]",
    );
  }
  const models = remaining[1].split(",").filter(Boolean);
  if (
    models.length === 0 ||
    models.some((modelId) => !MODELS.includes(modelId))
  ) {
    throw new Error(`Models must be selected from ${MODELS.join(", ")}.`);
  }
  return { reuseBaselines, selectedModels: models };
}

function subscriptionEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !isProviderCredentialOrRoute(name),
    ),
  );
}

function environmentProvenance() {
  return {
    version: 1,
    removedVariableNames: Object.keys(process.env)
      .filter(isProviderCredentialOrRoute)
      .sort(),
    subscriptionConfigVariablesAllowed: ["CLAUDE_CONFIG_DIR", "CODEX_HOME"],
    alternateProviderRoutesRemoved: true,
  };
}

function isProviderCredentialOrRoute(name) {
  if (["CLAUDE_CONFIG_DIR", "CODEX_HOME"].includes(name)) return false;
  return (
    /^(?:ANTHROPIC|OPENAI|CLAUDE|CODEX|AWS|GOOGLE|VERTEX|AZURE|BEDROCK)_/u.test(
      name,
    ) ||
    /(?:API_KEY|AUTH_TOKEN|ACCESS_KEY|SECRET_KEY|SESSION_TOKEN)$/u.test(name) ||
    /(?:BASE_URL|API_BASE|ENDPOINT)$/u.test(name)
  );
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function validateCompletedScreens(
  directory,
  modelId,
  screenIds,
  provenance,
) {
  const completed = [];
  for (const screenId of screenIds) {
    if (!["smoke", "development", "transfer-smoke"].includes(screenId)) {
      continue;
    }
    try {
      const [report, comparison] = await Promise.all([
        readJsonIfExists(resolve(directory, `${screenId}.json`)),
        readJsonIfExists(resolve(directory, `${screenId}-comparison.json`)),
        access(resolve(directory, `${screenId}.log`)),
      ]);
      const reranker = report?.methodology?.subscriptionClueReranker;
      if (!reranker) continue;
      const { stats: _stats, ...reportIdentity } = reranker;
      if (
        reportIdentity.modelId !== modelId ||
        JSON.stringify(reportIdentity) !== JSON.stringify(provenance) ||
        !comparison?.candidates?.some(({ id }) => id === modelId)
      ) {
        continue;
      }
      completed.push(screenId);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return completed;
}

async function probeCliIdentity(modelId) {
  const reranker = await createSubscriptionCliClueReranker({
    cacheDirectory: resolve(
      ROOT,
      ".cache/subscription-cli-clue-reranker",
      modelId,
    ),
    modelId,
    requestConcurrency: modelId.startsWith("codex-") ? 1 : 2,
  });
  return reranker.identity;
}

async function writeProgress(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        providerEnvironmentPolicy,
        ...value,
      },
      null,
      2,
    )}\n`,
  );
  await rename(temporaryPath, path);
}

async function archiveFailure(path, directory, failure) {
  if (!failure) return;
  const archiveDirectory = resolve(directory, "failures");
  await mkdir(archiveDirectory, { recursive: true });
  const timestamp = failure.generatedAt.replaceAll(":", "-");
  await rename(path, resolve(archiveDirectory, `${timestamp}.json`));
}

async function archiveLog(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  await rename(path, `${path.slice(0, -4)}.attempt-${timestamp}.log`);
}
