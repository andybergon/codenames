import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const apiKey = process.env.OPENAI_API_KEY || readDopplerKey();
const vite = resolve("node_modules/vite/bin/vite.js");
const child = spawn(process.execPath, [vite, ...process.argv.slice(2)], {
  env: {
    ...process.env,
    OPENAI_API_KEY: apiKey,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});

function readDopplerKey() {
  const result = spawnSync(
    "doppler",
    [
      "secrets",
      "get",
      "CODENAMES_OPENAI_API_KEY",
      "--plain",
      "--project",
      "apps",
      "--config",
      "shared",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(
      "Set OPENAI_API_KEY or configure CODENAMES_OPENAI_API_KEY in Doppler apps/shared.",
    );
  }
  return result.stdout.trim();
}
