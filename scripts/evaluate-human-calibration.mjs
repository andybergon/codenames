import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeCalibrationState } from "../src/calibration/store.js";

const options = parseOptions(process.argv.slice(2));
const inputBytes = await readFile(resolve(options.input));
const state = normalizeCalibrationState(
  JSON.parse(inputBytes.toString("utf8")),
);
if (state.rounds.length === 0) {
  throw new Error("Calibration export contains no valid rounds.");
}
const answerKeySources = await Promise.all(
  options.answerKeys.map(async (path) => {
    const bytes = await readFile(resolve(path));
    return {
      path,
      bytes,
      report: JSON.parse(bytes.toString("utf8")),
    };
  }),
);
const answerKeys = answerKeySources.map(({ report }) => report);
const answerKeyByRound = new Map(
  answerKeySources.map((source) => [source.report.roundId, source]),
);
const hiddenByTask = new Map(
  answerKeys.flatMap((answerKey) =>
    (answerKey.tasks ?? []).map((task) => [
      `${answerKey.roundId}:${task.taskId}`,
      task,
    ]),
  ),
);
const observations = state.rounds.flatMap(({ round, answers }) =>
  round.tasks
    .filter(({ taskId }) => answers[taskId])
    .map((task) => ({
      task: enrichTask(
        task,
        hiddenByTask.get(`${round.roundId}:${task.taskId}`),
      ),
      answer: answers[task.taskId],
    })),
);
if (observations.some(({ task }) => !task.source.modelId)) {
  throw new Error(
    "Calibration model attribution is missing. Supply the matching --answer-key file.",
  );
}
const modelIds = [...new Set(observations.map(({ task }) => task.source.modelId))]
  .filter(Boolean)
  .sort();
const models = Object.fromEntries(
  modelIds.map((modelId) => [
    modelId,
    summarize(
      observations.filter(({ task }) => task.source.modelId === modelId),
    ),
  ]),
);
const rounds = state.rounds
  .map(({ round, answers }) => {
    const roundObservations = round.tasks
      .filter(({ taskId }) => answers[taskId])
      .map((task) => ({
        task: enrichTask(
          task,
          hiddenByTask.get(`${round.roundId}:${task.taskId}`),
        ),
        answer: answers[task.taskId],
      }));
    const roundModelIds = [
      ...new Set(
        roundObservations.map(({ task }) => task.source.modelId),
      ),
    ]
      .filter(Boolean)
      .sort();
    const answerKeySource = answerKeyByRound.get(round.roundId);
    return {
      roundId: round.roundId,
      title: round.title,
      role: "held-out",
      source: {
        id: round.roundId,
        name: round.title,
        revision: {
          kind: "sha256",
          value: stableSha256({
            round,
            answerKeySha256: answerKeySource
              ? sha256(answerKeySource.bytes)
              : null,
          }),
        },
        answerKey: answerKeySource
          ? {
              path: answerKeySource.path,
              sha256: sha256(answerKeySource.bytes),
            }
          : null,
      },
      observationUnit: "answered blinded clue task",
      answeredTasks: roundObservations.length,
      models: Object.fromEntries(
        roundModelIds.map((modelId) => [
          modelId,
          summarize(
            roundObservations.filter(
              ({ task }) => task.source.modelId === modelId,
            ),
          ),
        ]),
      ),
    };
  })
  .filter(({ answeredTasks }) => answeredTasks > 0);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  input: options.input,
  sources: {
    input: {
      path: options.input,
      sha256: sha256(inputBytes),
    },
    answerKeys: answerKeySources.map(({ path, bytes, report }) => ({
      path,
      roundId: report.roundId,
      sha256: sha256(bytes),
    })),
  },
  methodology: {
    unit: "answered blinded clue task",
    targetRecall:
      "Recall of intended targets within the first declared-number human guesses.",
    safety:
      "Observed wrong-team, neutral, and assassin selections across every human guess.",
    pass:
      "A saved task with no guesses is an explicit human pass.",
    blinding:
      "Model attribution, intended targets, and team roles come from a separate answer key that the browser round does not load.",
  },
  answeredTasks: observations.length,
  models,
  rounds,
};
await writeFile(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${resolve(options.output)}`);

function summarize(observations) {
  const totals = observations.reduce(
    (summary, { task, answer }) => {
      const wordById = new Map(
        task.words.map((word) => [word.layoutId, word]),
      );
      const declaredGuesses = answer.guessedLayoutIds.slice(0, task.number);
      const targets = new Set(task.intendedLayoutIds);
      const recalled = declaredGuesses.filter((layoutId) =>
        targets.has(layoutId),
      ).length;
      summary.tasks += 1;
      summary.targetRecall += recalled / Math.max(1, targets.size);
      summary.exactTargets += Number(
        recalled === targets.size &&
          declaredGuesses.length === targets.size,
      );
      summary.guesses += answer.guessedLayoutIds.length;
      summary.passes += Number(answer.guessedLayoutIds.length === 0);
      for (const layoutId of answer.guessedLayoutIds) {
        const team = wordById.get(layoutId)?.team;
        summary.assassinHits += Number(team === "assassin");
        summary.wrongTeamHits += Number(team === "enemy");
        summary.neutralHits += Number(team === "neutral");
      }
      summary.good += Number(answer.judgment === "good");
      summary.unsure += Number(answer.judgment === "unsure");
      summary.bad += Number(answer.judgment === "bad");
      return summary;
    },
    {
      tasks: 0,
      targetRecall: 0,
      exactTargets: 0,
      guesses: 0,
      passes: 0,
      wrongTeamHits: 0,
      neutralHits: 0,
      assassinHits: 0,
      good: 0,
      unsure: 0,
      bad: 0,
    },
  );
  return {
    answeredTasks: totals.tasks,
    targetRecallAtDeclaredCount: rounded(totals.targetRecall / totals.tasks),
    exactTargetRate: rounded(totals.exactTargets / totals.tasks),
    guessesPerTask: rounded(totals.guesses / totals.tasks),
    passes: totals.passes,
    passRate: rounded(totals.passes / totals.tasks),
    wrongTeamHitsPerTask: rounded(totals.wrongTeamHits / totals.tasks),
    neutralHitsPerTask: rounded(totals.neutralHits / totals.tasks),
    assassinHitRate: rounded(totals.assassinHits / totals.tasks),
    judgment: {
      good: totals.good,
      unsure: totals.unsure,
      bad: totals.bad,
    },
  };
}

function enrichTask(task, hidden) {
  if (!hidden) return task;
  const teamById = new Map(
    (hidden.teams ?? []).map(({ layoutId, team }) => [layoutId, team]),
  );
  return {
    ...task,
    intendedLayoutIds: hidden.intendedLayoutIds ?? [],
    words: task.words.map((word) => ({
      ...word,
      team: teamById.get(word.layoutId) ?? null,
    })),
    source: hidden.source ?? task.source,
  };
}

function parseOptions(args) {
  const values = {
    input: null,
    output: "scripts/generated/human-calibration-report.json",
    answerKeys: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--input") values.input = required(value, option);
    else if (option === "--output") values.output = required(value, option);
    else if (option === "--answer-key") {
      values.answerKeys.push(required(value, option));
    }
    else throw new Error(`Unknown human calibration option: ${option}`);
    index += 1;
  }
  if (!values.input) throw new Error("--input is required.");
  return values;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableSha256(value) {
  return sha256(
    Buffer.from(
      JSON.stringify(sortValue(value)),
      "utf8",
    ),
  );
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}
