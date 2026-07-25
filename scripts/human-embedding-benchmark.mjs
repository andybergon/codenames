import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DATASET_COMMIT = "9bf4550e681f7a42ac406439b00b0c717f59f13c";
const DATASET_BASE = `https://raw.githubusercontent.com/SALT-NLP/codenames/${DATASET_COMMIT}/data`;
const CONNECTOR_COMMIT = "8d824794d623adf4dd19cbff13d987d539b19c5e";
const CONNECTOR_BASE = `https://raw.githubusercontent.com/hawkrobe/lexical-search-and-pragmatics/${CONNECTOR_COMMIT}/data/exp1`;

export async function loadHumanEmbeddingBenchmark(root) {
  const cacheDirectory = resolve(
    root,
    ".cache/evaluations/cultural-codes",
  );
  const [clueRows, guessRows, connectorRows, connectorBoards] =
    await Promise.all([
      loadDataset(cacheDirectory, "clue_generation_task/all.csv"),
      loadDataset(cacheDirectory, "generate_guess_task/all.csv"),
      loadConnectorCsv(cacheDirectory, "cleaned.csv"),
      loadConnectorJson(cacheDirectory, "boards.json"),
    ]);
  if (clueRows.length !== guessRows.length) {
    throw new Error(
      `Dataset row mismatch: ${clueRows.length} clues vs ${guessRows.length} guesses`,
    );
  }
  const culturalCodes = clueRows.map((clueRow, index) =>
    buildTurn(clueRow, guessRows[index]),
  );
  const connector = connectorRows.map((row) =>
    buildConnectorTurn(row, connectorBoards),
  );
  const datasets = { culturalCodes, connector };
  const terms = [
    ...new Set(
      Object.values(datasets).flatMap((turns) =>
        turns.flatMap((turn) => [
          turn.clue,
          ...turn.remaining,
          ...turn.targets,
          ...turn.neutral,
          ...turn.avoid,
        ]),
      ),
    ),
  ].sort();
  return {
    datasets,
    terms,
    metadata: {
      culturalCodes: {
        name: "Cultural Codes",
        repository: "https://github.com/SALT-NLP/codenames",
        commit: DATASET_COMMIT,
        turns: culturalCodes.length,
      },
      connector: {
        name: "Lexical Search and Pragmatics in Connector, Experiment 1",
        repository:
          "https://github.com/hawkrobe/lexical-search-and-pragmatics",
        commit: CONNECTOR_COMMIT,
        turns: connector.length,
      },
      licenseNote:
        "Neither upstream repository has an explicit license file. Data is fetched into the gitignored cache and is not redistributed.",
    },
  };
}

export function scoreHumanEmbeddingBenchmark(datasets, vectors) {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, turns]) => [
      name,
      scoreTurns(turns, vectors),
    ]),
  );
}

function scoreTurns(evaluationTurns, vectors) {
  const totals = {
    guessTurns: 0,
    firstGuessHits: 0,
    guessRecall: 0,
    targetTurns: 0,
    targetRecall: 0,
    exactTargetSets: 0,
    avoidHits: 0,
    pairwiseCorrect: 0,
    pairwiseTotal: 0,
  };

  for (const turn of evaluationTurns) {
    const clueVector = requiredVector(vectors, turn.clue);
    const humanGuesses = turn.guesses.filter((word) =>
      turn.remaining.includes(word),
    );
    if (humanGuesses.length > 0) {
      const ranked = rankWords(turn.remaining, clueVector, vectors);
      const predicted = ranked
        .slice(0, humanGuesses.length)
        .map(({ word }) => word);
      totals.guessTurns += 1;
      totals.firstGuessHits += Number(ranked[0]?.word === humanGuesses[0]);
      totals.guessRecall +=
        intersectionSize(predicted, humanGuesses) / humanGuesses.length;
    }

    const candidates = [
      ...new Set([...turn.targets, ...turn.neutral, ...turn.avoid]),
    ];
    if (turn.targets.length === 0 || candidates.length === 0) continue;
    const ranked = rankWords(candidates, clueVector, vectors);
    const predicted = ranked
      .slice(0, turn.targets.length)
      .map(({ word }) => word);
    const targetSet = new Set(turn.targets);
    totals.targetTurns += 1;
    totals.targetRecall +=
      intersectionSize(predicted, turn.targets) / turn.targets.length;
    totals.exactTargetSets += Number(
      predicted.length === turn.targets.length &&
        predicted.every((word) => targetSet.has(word)),
    );
    totals.avoidHits += Number(
      predicted.some((word) => turn.avoid.includes(word)),
    );

    for (const target of turn.targets) {
      const targetScore = dot(clueVector, requiredVector(vectors, target));
      for (const other of [...turn.neutral, ...turn.avoid]) {
        totals.pairwiseTotal += 1;
        totals.pairwiseCorrect += Number(
          targetScore > dot(clueVector, requiredVector(vectors, other)),
        );
      }
    }
  }

  return {
    scoredGuessTurns: totals.guessTurns,
    scoredTargetTurns: totals.targetTurns,
    firstGuessAccuracy: round(totals.firstGuessHits / totals.guessTurns),
    guessRecallAtHumanCount: round(totals.guessRecall / totals.guessTurns),
    targetRecallAtCount: round(totals.targetRecall / totals.targetTurns),
    exactTargetSetAccuracy: round(
      totals.exactTargetSets / totals.targetTurns,
    ),
    avoidWordRate: round(totals.avoidHits / totals.targetTurns),
    pairwiseTargetAccuracy: round(
      totals.pairwiseCorrect / totals.pairwiseTotal,
    ),
  };
}

async function loadDataset(cacheDirectory, relativePath) {
  const cachePath = resolve(cacheDirectory, relativePath);
  let raw;
  try {
    raw = await readFile(cachePath, "utf8");
  } catch {
    const response = await fetch(`${DATASET_BASE}/${relativePath}`);
    if (!response.ok) {
      throw new Error(
        `Dataset download failed (${response.status}): ${relativePath}`,
      );
    }
    raw = await response.text();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, raw, "utf8");
  }
  return parseCsv(raw);
}

async function loadConnectorCsv(cacheDirectory, relativePath) {
  const raw = await loadRemoteFile(
    `${CONNECTOR_BASE}/${relativePath}`,
    resolve(cacheDirectory, "connector", relativePath),
  );
  return parseCsv(raw);
}

async function loadConnectorJson(cacheDirectory, relativePath) {
  const raw = await loadRemoteFile(
    `${CONNECTOR_BASE}/${relativePath}`,
    resolve(cacheDirectory, "connector", relativePath),
  );
  return JSON.parse(raw);
}

async function loadRemoteFile(url, cachePath) {
  try {
    return await readFile(cachePath, "utf8");
  } catch {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Dataset download failed (${response.status}): ${url}`);
    }
    const raw = await response.text();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, raw, "utf8");
    return raw;
  }
}

function buildTurn(clueRow, guessRow) {
  if (clueRow[""] !== guessRow[""]) {
    throw new Error(
      `Dataset rows are misaligned at ${clueRow[""]} / ${guessRow[""]}`,
    );
  }
  return {
    clue: normalize(clueRow.output),
    targets: parseList(clueRow.base_text, "targets"),
    neutral: parseList(clueRow.base_text, "tan"),
    avoid: parseList(clueRow.base_text, "black"),
    remaining: parseList(guessRow.base_text, "remaining"),
    guesses: String(guessRow.output ?? "")
      .split(",")
      .map(normalize)
      .filter(Boolean),
  };
}

function buildConnectorTurn(row, boards) {
  const remaining = boards[row.boardnames]?.map(normalize);
  if (!remaining) {
    throw new Error(`Unknown Connector board: ${row.boardnames}`);
  }
  const targets = [normalize(row.Word1), normalize(row.Word2)];
  return {
    clue: normalize(row.correctedClue),
    targets,
    neutral: remaining.filter((word) => !targets.includes(word)),
    avoid: [],
    remaining,
    guesses: [],
  };
}

function parseList(text, label) {
  const match = text.match(new RegExp(`${label}: \\[(.*?)\\](?:,|$)`));
  if (!match) throw new Error(`Could not parse ${label} from: ${text}`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((entry) =>
    normalize(entry[1]),
  );
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (character === '"' && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      ),
    );
}

function rankWords(words, clueVector, vectors) {
  return words
    .map((word) => ({
      word,
      score: dot(clueVector, requiredVector(vectors, word)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.word.localeCompare(right.word),
    );
}

function requiredVector(vectors, word) {
  const vector = vectors.get(word);
  if (!vector) throw new Error(`No embedding for benchmark term: ${word}`);
  return vector;
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

function intersectionSize(left, right) {
  const rightSet = new Set(right);
  return left.reduce(
    (total, value) => total + Number(rightSet.has(value)),
    0,
  );
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function round(value) {
  return Number(value.toFixed(4));
}
