import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeCalibrationState } from "../src/calibration/store.js";

const options = parseOptions(process.argv.slice(2));
const state = normalizeCalibrationState(
  JSON.parse(await readFile(resolve(options.input), "utf8")),
);
if (state.rounds.length === 0) {
  throw new Error("Calibration export contains no valid rounds.");
}
const answerKeys = await Promise.all(
  options.answerKeys.map(async (path) =>
    JSON.parse(await readFile(resolve(path), "utf8")),
  ),
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
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  input: options.input,
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
