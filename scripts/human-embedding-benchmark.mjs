import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { get } from "@vercel/blob";

const DATASET_COMMIT = "9bf4550e681f7a42ac406439b00b0c717f59f13c";
const DATASET_BASE = `https://raw.githubusercontent.com/SALT-NLP/codenames/${DATASET_COMMIT}/data`;
const CONNECTOR_COMMIT = "8d824794d623adf4dd19cbff13d987d539b19c5e";
const CONNECTOR_BASE = `https://raw.githubusercontent.com/hawkrobe/lexical-search-and-pragmatics/${CONNECTOR_COMMIT}/data/exp1`;
const STRATEGY_COMMIT = "936b9f412fa0368f84800dd46f66d493d623418c";
const STRATEGY_BASE = `https://raw.githubusercontent.com/NoahPrescott/Codenames-Strategy-and-Structure/${STRATEGY_COMMIT}`;
const COOCCURRENCE_COMMIT = "1902049d9a5e3fa9c7b1b78b4340c648a780b920";
const COOCCURRENCE_BASE = `https://raw.githubusercontent.com/xerevity/CodeNamesAgent/${COOCCURRENCE_COMMIT}/data/english/eval_data`;
const BLOB_DATASET_ROOT = "datasets";

export async function loadHumanEmbeddingBenchmark(root) {
  const cacheDirectory = resolve(
    root,
    ".cache/evaluations/cultural-codes",
  );
  const [
    clueRows,
    guessRows,
    connectorRows,
    connectorBoards,
    strategyBoards,
    cooccurrenceUsers,
    cooccurrenceBoards,
    cooccurrenceColors,
    cooccurrenceClues,
  ] =
    await Promise.all([
      loadDataset(cacheDirectory, "clue_generation_task/all.csv"),
      loadDataset(cacheDirectory, "generate_guess_task/all.csv"),
      loadConnectorCsv(cacheDirectory, "cleaned.csv"),
      loadConnectorJson(cacheDirectory, "boards.json"),
      loadRemoteJson(
        `${STRATEGY_BASE}/boards-data.json`,
        resolve(cacheDirectory, "strategy-structure", "boards-data.json"),
        blobPath(
          "strategy-structure",
          STRATEGY_COMMIT,
          "boards-data.json",
        ),
      ),
      loadRemoteCsv(
        `${COOCCURRENCE_BASE}/dataclips_userdata_en.csv`,
        resolve(cacheDirectory, "cooccurrence", "dataclips_userdata_en.csv"),
        blobPath(
          "cooccurrence",
          COOCCURRENCE_COMMIT,
          "dataclips_userdata_en.csv",
        ),
      ),
      loadRemoteRows(
        `${COOCCURRENCE_BASE}/boards_en.csv`,
        resolve(cacheDirectory, "cooccurrence", "boards_en.csv"),
        blobPath("cooccurrence", COOCCURRENCE_COMMIT, "boards_en.csv"),
      ),
      loadRemoteRows(
        `${COOCCURRENCE_BASE}/board_colors.csv`,
        resolve(cacheDirectory, "cooccurrence", "board_colors.csv"),
        blobPath(
          "cooccurrence",
          COOCCURRENCE_COMMIT,
          "board_colors.csv",
        ),
      ),
      loadRemoteRows(
        `${COOCCURRENCE_BASE}/clues.csv`,
        resolve(cacheDirectory, "cooccurrence", "clues.csv"),
        blobPath("cooccurrence", COOCCURRENCE_COMMIT, "clues.csv"),
        ";",
      ),
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
  const strategyEntries = Object.values(strategyBoards);
  const strategyHumanClues = strategyEntries.map((board) =>
    buildStrategyTurn(
      board,
      board.human_clue,
      board.human_intended_words,
      board.human_guess_human_clue,
    ),
  );
  const strategyGptClues = strategyEntries.map((board) =>
    buildStrategyTurn(
      board,
      board.gpt_clue,
      board.gpt_intended_words,
      board.human_guess_gpt_clue,
    ),
  );
  const cooccurrence = buildCooccurrenceTurns(
    cooccurrenceUsers,
    cooccurrenceBoards,
    cooccurrenceColors,
    cooccurrenceClues,
  );
  const datasets = {
    culturalCodes,
    connector,
    strategyHumanClues,
    strategyGptClues,
    cooccurrence,
  };
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
      strategyHumanClues: {
        name: "Strategy and Structure, human clues",
        repository:
          "https://github.com/NoahPrescott/Codenames-Strategy-and-Structure",
        commit: STRATEGY_COMMIT,
        boards: strategyHumanClues.length,
        responses: countResponses(strategyHumanClues),
      },
      strategyGptClues: {
        name: "Strategy and Structure, GPT-4o clues",
        repository:
          "https://github.com/NoahPrescott/Codenames-Strategy-and-Structure",
        commit: STRATEGY_COMMIT,
        boards: strategyGptClues.length,
        responses: countResponses(strategyGptClues),
      },
      cooccurrence: {
        name: "Codenames as a Game of Co-occurrence Counting, English",
        repository: "https://github.com/xerevity/CodeNamesAgent",
        commit: COOCCURRENCE_COMMIT,
        clueBoards: cooccurrence.length,
        responses: countResponses(cooccurrence),
      },
      licenseNote:
        "The upstream data repositories do not declare explicit dataset licenses. Raw snapshots are kept in the private codenames-calibration-data Blob store and a gitignored local cache; they are not publicly redistributed.",
      storage: {
        blobStore: "codenames-calibration-data",
        access: "private",
        region: "dub1",
        fallback: "Pinned upstream source",
      },
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
    goodWordGuessTurns: 0,
    goodWordRecall: 0,
    targetTurns: 0,
    targetRecall: 0,
    exactTargetSets: 0,
    avoidHits: 0,
    pairwiseCorrect: 0,
    pairwiseTotal: 0,
  };

  for (const turn of evaluationTurns) {
    const clueVector = requiredVector(vectors, turn.clue);
    const guessSets =
      turn.guessSets ??
      (turn.guesses?.length > 0 ? [turn.guesses] : []);
    for (const guesses of guessSets) {
      const humanGuesses = guesses.filter((word) =>
        turn.remaining.includes(word),
      );
      if (humanGuesses.length === 0) continue;
      const ranked = rankWords(turn.remaining, clueVector, vectors);
      const predicted = ranked
        .slice(0, humanGuesses.length)
        .map(({ word }) => word);
      totals.guessTurns += 1;
      totals.firstGuessHits += Number(ranked[0]?.word === humanGuesses[0]);
      totals.guessRecall +=
        intersectionSize(predicted, humanGuesses) / humanGuesses.length;
      if (turn.good?.length > 0) {
        totals.goodWordGuessTurns += 1;
        totals.goodWordRecall +=
          intersectionSize(predicted, turn.good) / predicted.length;
      }
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
    firstGuessAccuracy: average(totals.firstGuessHits, totals.guessTurns),
    guessRecallAtHumanCount: average(
      totals.guessRecall,
      totals.guessTurns,
    ),
    goodWordRateAtHumanCount: average(
      totals.goodWordRecall,
      totals.goodWordGuessTurns,
    ),
    targetRecallAtCount: average(totals.targetRecall, totals.targetTurns),
    exactTargetSetAccuracy: average(
      totals.exactTargetSets,
      totals.targetTurns,
    ),
    avoidWordRate: average(totals.avoidHits, totals.targetTurns),
    pairwiseTargetAccuracy: average(
      totals.pairwiseCorrect,
      totals.pairwiseTotal,
    ),
  };
}

async function loadDataset(cacheDirectory, relativePath) {
  const cachePath = resolve(cacheDirectory, relativePath);
  let raw;
  try {
    raw = await readFile(cachePath, "utf8");
  } catch {
    raw = await loadRemoteFile(
      `${DATASET_BASE}/${relativePath}`,
      cachePath,
      blobPath("cultural-codes", DATASET_COMMIT, relativePath),
    );
  }
  return parseCsv(raw);
}

async function loadConnectorCsv(cacheDirectory, relativePath) {
  const raw = await loadRemoteFile(
    `${CONNECTOR_BASE}/${relativePath}`,
    resolve(cacheDirectory, "connector", relativePath),
    blobPath("connector", CONNECTOR_COMMIT, relativePath),
  );
  return parseCsv(raw);
}

async function loadConnectorJson(cacheDirectory, relativePath) {
  const raw = await loadRemoteFile(
    `${CONNECTOR_BASE}/${relativePath}`,
    resolve(cacheDirectory, "connector", relativePath),
    blobPath("connector", CONNECTOR_COMMIT, relativePath),
  );
  return JSON.parse(raw);
}

async function loadRemoteJson(url, cachePath, privateBlobPath) {
  return JSON.parse(
    await loadRemoteFile(url, cachePath, privateBlobPath),
  );
}

async function loadRemoteCsv(url, cachePath, privateBlobPath) {
  return parseCsv(await loadRemoteFile(url, cachePath, privateBlobPath));
}

async function loadRemoteRows(
  url,
  cachePath,
  privateBlobPath,
  delimiter = ",",
) {
  return parseDelimitedRows(
    await loadRemoteFile(url, cachePath, privateBlobPath),
    delimiter,
  );
}

async function loadRemoteFile(url, cachePath, privateBlobPath) {
  try {
    return await readFile(cachePath, "utf8");
  } catch {
    const blobContent = await loadPrivateBlob(privateBlobPath);
    if (blobContent !== null) {
      await writeCachedFile(cachePath, blobContent);
      return blobContent;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Dataset download failed (${response.status}): ${url}`);
    }
    const raw = await response.text();
    await writeCachedFile(cachePath, raw);
    return raw;
  }
}

async function loadPrivateBlob(pathname) {
  if (!pathname || !process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return new Response(result.stream).text();
  } catch (error) {
    console.warn(
      `Private dataset Blob unavailable, using pinned upstream: ${error.message}`,
    );
    return null;
  }
}

async function writeCachedFile(cachePath, content) {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, content, "utf8");
}

function blobPath(source, commit, relativePath) {
  return `${BLOB_DATASET_ROOT}/${source}/${commit}/${relativePath}`;
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

function buildStrategyTurn(board, clue, targets, guessSets) {
  const remaining = board.words.map(normalize);
  const normalizedTargets = targets.map(normalize);
  return {
    clue: normalize(clue),
    targets: normalizedTargets,
    neutral: remaining.filter((word) => !normalizedTargets.includes(word)),
    avoid: [],
    remaining,
    guessSets: guessSets.map((guesses) => guesses.map(normalize)),
  };
}

function buildCooccurrenceTurns(
  userRows,
  boardRows,
  colorRows,
  clueRows,
) {
  const boards = new Map(
    boardRows.map(([id, ...words]) => [
      id,
      words.filter(Boolean).map(normalize),
    ]),
  );
  const colors = new Map(
    colorRows.map(([id, ...values]) => [
      id,
      values.filter(Boolean).map(Number),
    ]),
  );
  const clues = new Map();
  for (const [boardId, ...values] of clueRows) {
    for (let index = 0; index < values.length; index += 2) {
      const clue = normalize(values[index]);
      const number = Number(values[index + 1]);
      if (!clue || !Number.isInteger(number)) continue;
      clues.set(`${boardId}:${index / 2}`, { clue, number });
    }
  }

  const grouped = new Map();
  for (const row of userRows) {
    const boardId = String(row.tablaid);
    const clueId = String(row.utalasid);
    const board = boards.get(boardId);
    const boardColors = colors.get(boardId);
    const clue = clues.get(`${boardId}:${clueId}`);
    if (!board || !boardColors || !clue) {
      throw new Error(
        `Unknown co-occurrence round: board ${boardId}, clue ${clueId}`,
      );
    }
    if (board.length !== boardColors.length) {
      throw new Error(`Co-occurrence board ${boardId} has mismatched colors.`);
    }
    const guessCount = Number(row.tipp);
    const guesses = Array.from(
      { length: guessCount },
      (_, index) => normalize(row[`tipp${index + 1}`]),
    ).filter(Boolean);
    const key = `${boardId}:${clueId}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        clue: clue.clue,
        number: clue.number,
        targets: [],
        neutral: [],
        avoid: [],
        good: board.filter((_, index) => boardColors[index] === 2),
        remaining: board,
        guessSets: [],
      });
    }
    grouped.get(key).guessSets.push(guesses);
  }
  return [...grouped.values()];
}

function parseList(text, label) {
  const match = text.match(new RegExp(`${label}: \\[(.*?)\\](?:,|$)`));
  if (!match) throw new Error(`Could not parse ${label} from: ${text}`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((entry) =>
    normalize(entry[1]),
  );
}

function parseCsv(raw) {
  const rows = parseDelimitedRows(raw);
  const headers = rows.shift();
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      ),
    );
}

function parseDelimitedRows(raw, delimiter = ",") {
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
    } else if (character === delimiter) {
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
  return rows.filter((values) => values.some(Boolean));
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

function average(total, count) {
  return count > 0 ? round(total / count) : null;
}

function countResponses(turns) {
  return turns.reduce(
    (total, turn) => total + (turn.guessSets?.length ?? 0),
    0,
  );
}
