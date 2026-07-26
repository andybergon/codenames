import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = parseOptions(process.argv.slice(2));
const sources = await Promise.all(
  options.inputs.map(async ({ modelId, path }) => ({
    modelId,
    report: JSON.parse(await readFile(resolve(path), "utf8")),
  })),
);
const tasksBySource = sources.map(({ modelId, report }) => {
  const games = report?.policies?.hybrid?.gameResults;
  if (!Array.isArray(games)) {
    throw new Error(`${modelId} must use a full Play benchmark report.`);
  }
  return games
    .filter((game) => !game.stalled && game.calibrationTurns?.[0])
    .slice(0, options.tasksPerModel)
    .map((game) => {
      const turn = game.calibrationTurns[0];
      return {
        clue: turn.clue,
        number: turn.number,
        activeSide: turn.side,
        words: turn.words.map((word) => ({
          ...word,
          team:
            word.team === turn.side
              ? "friendly"
              : word.team === oppositeSide(turn.side)
                ? "enemy"
                : word.team,
        })),
        intendedLayoutIds: turn.intendedLayoutIds,
        source: {
          modelId,
          board: game.board,
          turn: turn.turn,
        },
      };
    });
});

function oppositeSide(side) {
  return side === "red" ? "blue" : "red";
}
const available = Math.min(...tasksBySource.map((tasks) => tasks.length));
if (available < options.tasksPerModel) {
  throw new Error(
    `Only ${available} complete tasks per model are available; requested ${options.tasksPerModel}.`,
  );
}
const interleaved = [];
for (let index = 0; index < options.tasksPerModel; index += 1) {
  for (const tasks of tasksBySource) {
    interleaved.push(tasks[index]);
  }
}
const shuffled = deterministicShuffle(interleaved, options.roundId);
const tasks = shuffled.map((task) => ({
  taskId: contentTaskId(options.roundId, task),
  clue: task.clue,
  number: task.number,
  activeSide: task.activeSide,
  words: task.words.map(({ layoutId, word }) => ({ layoutId, word })),
}));
const answerKey = {
  schemaVersion: 1,
  roundId: options.roundId,
  tasks: shuffled.map((task) => ({
    taskId: contentTaskId(options.roundId, task),
    intendedLayoutIds: task.intendedLayoutIds,
    teams: task.words.map(({ layoutId, team }) => ({ layoutId, team })),
    source: task.source,
  })),
};
const round = {
  schemaVersion: 1,
  roundId: options.roundId,
  title: options.title,
  description: options.description,
  createdAt: new Date().toISOString(),
  tasks,
};

await writeFile(resolve(options.output), `${JSON.stringify(round, null, 2)}\n`);
await writeFile(
  resolve(options.answerKey),
  `${JSON.stringify(answerKey, null, 2)}\n`,
);
console.log(
  `Wrote ${resolve(options.output)} with ${tasks.length} blinded tasks.`,
);
console.log(`Wrote ${resolve(options.answerKey)} answer key.`);

function deterministicShuffle(values, seed) {
  const random = createDeterministicRandom(seed);
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

function createDeterministicRandom(seed) {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function contentTaskId(roundId, task) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        roundId,
        clue: task.clue,
        number: task.number,
        activeSide: task.activeSide,
        words: task.words.map(({ layoutId, word }) => ({
          layoutId,
          word,
        })),
        intendedLayoutIds: task.intendedLayoutIds,
        source: task.source,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `${roundId}-${digest}`;
}

function parseOptions(args) {
  const values = {
    roundId: null,
    title: "Embedding calibration",
    description:
      "Blinded opening clues sampled from paired benchmark boards.",
    tasksPerModel: 10,
    inputs: [],
    output: null,
    answerKey: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--round-id") values.roundId = required(value, option);
    else if (option === "--title") values.title = required(value, option);
    else if (option === "--description") {
      values.description = required(value, option);
    } else if (option === "--tasks-per-model") {
      values.tasksPerModel = positiveInteger(value, option);
    } else if (option === "--input") {
      const separator = value?.indexOf("=");
      if (!value || separator < 1) {
        throw new Error(`${option} must use model-id=report-path.`);
      }
      values.inputs.push({
        modelId: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
    } else if (option === "--output") values.output = required(value, option);
    else if (option === "--answer-key") {
      values.answerKey = required(value, option);
    }
    else throw new Error(`Unknown calibration option: ${option}`);
    index += 1;
  }
  if (!values.roundId) throw new Error("--round-id is required.");
  if (!values.output) throw new Error("--output is required.");
  if (!values.answerKey) throw new Error("--answer-key is required.");
  if (values.inputs.length < 2) {
    throw new Error("At least two --input model-id=report-path values are required.");
  }
  return values;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}
