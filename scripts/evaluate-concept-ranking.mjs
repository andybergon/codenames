import { env, pipeline } from "@huggingface/transformers";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadHumanEmbeddingBenchmark } from "./human-embedding-benchmark.mjs";
import { DEFAULT_BOARD } from "../src/word-data.js";
import {
  conceptTexts,
  dotVectors,
  maximumConceptSimilarity,
  normalizeConceptTerm,
  scoreOperativeAssociation,
} from "../src/play/concept-ranking.js";
import { centerEmbeddings } from "../src/embeddings.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = resolve(
  ROOT,
  "scripts/generated/concept-ranking-evaluation.json",
);
const CONCEPT_DIRECTORY = resolve(ROOT, "public/data/concepts");
const MODEL_DEFINITIONS = [
  {
    id: "bge-small",
    role: "production",
    sampleStride: 1,
  },
  {
    id: "minilm-l6",
    role: "independent-operative",
    sampleStride: 4,
  },
];
const JOUST_WORDS = ["piano", "match", "crown", "glove", "belt"];
const ORIGINAL_FIXTURES = [
  {
    clue: "paleography",
    targets: ["paper", "journal"],
    candidates: ["paper", "journal", "teeth", "vinyl", "shakespeare"],
  },
  {
    clue: "heraldry",
    targets: ["crown", "eagle"],
    candidates: ["crown", "eagle", "weapon", "sorcerer", "siege"],
  },
  {
    clue: "specter",
    targets: ["ghost", "shadow"],
    candidates: ["ghost", "shadow", "genius", "mirror", "radar"],
  },
  {
    clue: "thespian",
    targets: ["play", "actor"],
    candidates: ["play", "actor", "agent", "surgeon", "alien"],
  },
  {
    clue: "seance",
    targets: ["ghost", "spirit"],
    candidates: ["ghost", "spirit", "scorpion", "oasis", "undertaker"],
  },
];
const OFFSETS = [0, 0.025, 0.05, 0.075, 0.1];
const ACTIVATION_CEILINGS = [0.2, 0.22, 0.25, 0.3];
const GUARDED_OFFSETS = [0.05, 0.075, 0.1];
const BATCH_SIZE = 128;

env.cacheDir =
  process.env.HF_CACHE_DIR ?? resolve(ROOT, ".cache/huggingface");
env.allowRemoteModels = process.env.ALLOW_REMOTE_MODELS === "1";

const definitions = await loadConceptDefinitions();
const human = await loadHumanEmbeddingBenchmark(
  process.env.HUMAN_DATA_ROOT ?? ROOT,
);
const terms = [
  ...new Set([
    ...human.terms,
    "joust",
    ...JOUST_WORDS,
    ...ORIGINAL_FIXTURES.flatMap(({ candidates, clue }) => [
      clue,
      ...candidates,
    ]),
  ]),
].sort();
const modelReports = [];

for (const definition of MODEL_DEFINITIONS) {
  const manifest = JSON.parse(
    await readFile(
      resolve(
        ROOT,
        `public/data/model-lab/${definition.id}/manifest.json`,
      ),
      "utf8",
    ),
  );
  const context = await buildModelContext(
    manifest,
    terms,
    definitions,
  );
  const datasets = Object.fromEntries(
    Object.entries(human.datasets).map(([name, turns]) => [
      name,
      turns.filter(
        (_turn, index) => index % definition.sampleStride === 0,
      ),
    ]),
  );
  const direct = scoreDatasets(
    datasets,
    (clue, word) => directScore(context, clue, word),
  );
  const offsets = Object.fromEntries(
    OFFSETS.map((offset) => [
      offset,
      scoreDatasets(datasets, (clue, word) =>
        scoreOperativeAssociation(
          directScore(context, clue, word),
          conceptScore(context, clue, word),
          { conceptOffset: offset },
        ),
      ),
    ]),
  );
  const guarded = Object.fromEntries(
    GUARDED_OFFSETS.map((conceptOffset) => [
      conceptOffset,
      Object.fromEntries(
        ACTIVATION_CEILINGS.map((activationCeiling) => [
          activationCeiling,
          scoreGuardedDatasets(datasets, context, {
            activationCeiling,
            conceptOffset,
          }),
        ]),
      ),
    ]),
  );
  modelReports.push({
    id: definition.id,
    model: manifest.model,
    role: definition.role,
    sampleStride: definition.sampleStride,
    turns: Object.fromEntries(
      Object.entries(datasets).map(([name, turns]) => [
        name,
        turns.length,
      ]),
    ),
    embeddingLatencyMs: context.embeddingLatencyMs,
    warmTurnLatencyMs: await measureWarmTurnLatency(
      context.extractor,
      definitions,
    ),
    direct,
    offsets,
    guarded,
    originalFixtures:
      definition.id === "bge-small"
        ? evaluateOriginalFixtures(context, {
            activationCeiling: 0.2,
            conceptOffset: 0.05,
          })
        : [],
    joust: {
      direct: rankJoust(context, null),
      offsets: Object.fromEntries(
        OFFSETS.map((offset) => [
          offset,
          rankJoust(context, offset),
        ]),
      ),
    },
  });
  if (typeof context.extractor.dispose === "function") {
    await context.extractor.dispose();
  }
}

const report = {
  version: 3,
  fixture:
    "JOUST → medieval tournament → MATCH / CROWN / GLOVE / BELT, where PIANO was guessed before those stronger human associations.",
  source: {
    concepts: "Princeton WordNet 3.0",
    humanDatasets: human.metadata,
  },
  approaches: {
    direct: {
      description:
        "Centered clue-to-card cosine similarity, the production baseline.",
    },
    latentVocabularyWalk: await evaluateLatentVocabularyWalk(),
    wordnetSenseBridge: {
      description:
        "Maximum cosine between separate WordNet sense-definition embeddings for the clue and card, calibrated back into operative score geometry with max(direct, concept - offset).",
      offsets: OFFSETS,
      guardedActivationCeilings: ACTIVATION_CEILINGS,
      guardedOffsets: GUARDED_OFFSETS,
    },
    hostedLlmReranker: {
      status: "rejected-before-paid-run",
      reason:
        "Automatic bot turns require bounded local latency, offline behavior, and zero per-turn spend. A hosted reranker would also add a server dependency to public clue and board data.",
      paidCostUsd: 0,
    },
  },
  selected: {
    approach: "wordnetSenseBridge",
    modelId: "bge-small",
    conceptOffset: 0.05,
    activationCeiling: 0.2,
    minimumClueNumber: 2,
    otherModelBehavior: "direct",
    rationale:
      "The bridge activates only for multi-card clues whose best direct match is below 0.20. The 0.05 offset is the most conservative tested calibration that places all four preserved JOUST associations before PIANO.",
  },
  models: modelReports,
};

await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH}`);

async function buildModelContext(manifest, activeTerms, conceptDefinitions) {
  const extractor = await pipeline(
    "feature-extraction",
    manifest.model,
    {
      dtype: "q8",
    },
  );
  const conceptTermList = [];
  const conceptRanges = new Map();
  for (const term of activeTerms) {
    const normalized = normalizeConceptTerm(term);
    const start = conceptTermList.length;
    conceptTermList.push(
      ...conceptTexts(
        normalized,
        conceptDefinitions.get(normalized) ?? [],
      ),
    );
    conceptRanges.set(normalized, {
      start,
      end: conceptTermList.length,
    });
  }
  const startedAt = performance.now();
  const [baseRaw, conceptRaw] = await Promise.all([
    embedBatches(extractor, activeTerms),
    embedBatches(extractor, conceptTermList),
  ]);
  const embeddingLatencyMs = round(performance.now() - startedAt);
  const baseCentered = centerEmbeddings(
    baseRaw,
    manifest.centering.mean,
  );
  const conceptCentered = centerEmbeddings(
    conceptRaw,
    manifest.centering.mean,
  );
  return {
    extractor,
    embeddingLatencyMs,
    conceptDefinitions,
    baseVectors: new Map(
      activeTerms.map((term, index) => [
        normalizeConceptTerm(term),
        baseCentered[index],
      ]),
    ),
    conceptVectors: new Map(
      [...conceptRanges].map(([term, range]) => [
        term,
        conceptCentered.slice(range.start, range.end),
      ]),
    ),
  };
}

function evaluateOriginalFixtures(
  context,
  { activationCeiling, conceptOffset },
) {
  return ORIGINAL_FIXTURES.map((fixture) => {
    const direct = rankWords(
      fixture.clue,
      fixture.candidates,
      (clue, word) =>
        directScore(context, clue, word),
    );
    const activated =
      fixture.targets.length >= 2 &&
      (direct[0]?.score ?? Number.POSITIVE_INFINITY) <
        activationCeiling;
    const guarded = activated
      ? rankWords(fixture.clue, fixture.candidates, (clue, word) =>
          scoreOperativeAssociation(
            directScore(context, clue, word),
            conceptScore(context, clue, word),
            { conceptOffset },
          ),
        )
      : direct;
    const count = fixture.targets.length;
    const directTop = direct.slice(0, count).map(({ word }) => word);
    const guardedTop = guarded
      .slice(0, count)
      .map(({ word }) => word);
    return {
      clue: fixture.clue.toUpperCase(),
      clueNumber: count,
      targets: fixture.targets.map((word) => word.toUpperCase()),
      candidates: fixture.candidates.map((word) =>
        word.toUpperCase(),
      ),
      activated,
      directTop: directTop.map((word) => word.toUpperCase()),
      guardedTop: guardedTop.map((word) => word.toUpperCase()),
      directTargetHits: intersectionSize(
        directTop,
        fixture.targets,
      ),
      guardedTargetHits: intersectionSize(
        guardedTop,
        fixture.targets,
      ),
      bridges: fixture.targets.map((word) => ({
        target: word.toUpperCase(),
        ...bestConceptBridge(
          context,
          fixture.clue,
          word,
          conceptOffset,
        ),
      })),
    };
  });
}

function bestConceptBridge(
  context,
  clue,
  word,
  conceptOffset,
) {
  if (!word) {
    return null;
  }
  const clueTerm = normalizeConceptTerm(clue);
  const wordTerm = normalizeConceptTerm(word);
  const clueVectors = context.conceptVectors.get(clueTerm) ?? [];
  const wordVectors = context.conceptVectors.get(wordTerm) ?? [];
  const clueDefinitions =
    context.conceptDefinitions.get(clueTerm) ?? [];
  const wordDefinitions =
    context.conceptDefinitions.get(wordTerm) ?? [];
  let best = null;
  for (
    let clueIndex = 0;
    clueIndex < clueVectors.length;
    clueIndex += 1
  ) {
    for (
      let wordIndex = 0;
      wordIndex < wordVectors.length;
      wordIndex += 1
    ) {
      const similarity = dotVectors(
        clueVectors[clueIndex],
        wordVectors[wordIndex],
      );
      if (!best || similarity > best.similarity) {
        best = {
          similarity,
          clueSense: clueDefinitions[clueIndex],
          targetSense: wordDefinitions[wordIndex],
        };
      }
    }
  }
  if (!best) {
    return null;
  }
  const direct = directScore(context, clue, word);
  const guarded = scoreOperativeAssociation(
    direct,
    best.similarity,
    { conceptOffset },
  );
  return {
    clueSense: best.clueSense,
    targetSense: best.targetSense,
    direct: round(direct),
    concept: round(best.similarity),
    guarded: round(guarded),
    lift: round(guarded - direct),
  };
}

async function embedBatches(extractor, values) {
  const vectors = [];
  for (let start = 0; start < values.length; start += BATCH_SIZE) {
    const batch = values.slice(start, start + BATCH_SIZE);
    const output = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });
    vectors.push(
      ...output.tolist().map((vector) =>
        Float32Array.from(vector),
      ),
    );
  }
  return vectors;
}

async function measureWarmTurnLatency(extractor, conceptDefinitions) {
  const cardWords = DEFAULT_BOARD.map(({ word }) =>
    normalizeConceptTerm(word),
  );
  const conceptTermList = [
    ...conceptTexts(
      "joust",
      conceptDefinitions.get("joust") ?? [],
    ),
    ...cardWords.flatMap((word) =>
      conceptTexts(
        word,
        conceptDefinitions.get(word) ?? [],
      ),
    ),
  ];
  await embedBatches(extractor, ["latency warmup"]);
  await embedBatches(extractor, conceptTermList);
  const directSamples = [];
  const conceptSamples = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    let startedAt = performance.now();
    await embedBatches(extractor, [`joust ${iteration}`]);
    directSamples.push(performance.now() - startedAt);
    startedAt = performance.now();
    await embedBatches(
      extractor,
      conceptTermList.map(
        (term) => `${term} ${iteration}`,
      ),
    );
    conceptSamples.push(performance.now() - startedAt);
  }
  return {
    cardCount: cardWords.length,
    conceptTexts: conceptTermList.length,
    directMedian: round(median(directSamples)),
    conceptMedian: round(median(conceptSamples)),
    addedMedian: round(
      median(conceptSamples) - median(directSamples),
    ),
  };
}

function directScore(context, clue, word) {
  return dotVectors(
    requiredVector(context.baseVectors, clue),
    requiredVector(context.baseVectors, word),
  );
}

function conceptScore(context, clue, word) {
  return maximumConceptSimilarity(
    context.conceptVectors.get(normalizeConceptTerm(clue)) ?? [],
    context.conceptVectors.get(normalizeConceptTerm(word)) ?? [],
  );
}

function rankJoust(context, conceptOffset) {
  return JOUST_WORDS.map((word) => {
    const direct = directScore(context, "joust", word);
    const concept = conceptScore(context, "joust", word);
    return {
      word: word.toUpperCase(),
      score: round(
        conceptOffset === null
          ? direct
          : scoreOperativeAssociation(direct, concept, {
              conceptOffset,
            }),
      ),
      direct: round(direct),
      concept: round(concept),
    };
  }).sort(
    (left, right) =>
      right.score - left.score ||
      left.word.localeCompare(right.word),
  );
}

function scoreDatasets(datasets, scorePair) {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, turns]) => [
      name,
      scoreTurns(turns, scorePair),
    ]),
  );
}

function scoreGuardedDatasets(
  datasets,
  context,
  { activationCeiling, conceptOffset },
) {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, turns]) => [
      name,
      scoreGuardedTurns(turns, context, {
        activationCeiling,
        conceptOffset,
      }),
    ]),
  );
}

function scoreGuardedTurns(
  turns,
  context,
  { activationCeiling, conceptOffset },
) {
  return scoreTurns(
    turns,
    (clue, word) => directScore(context, clue, word),
    {
      rankWords: (clue, words, clueNumber) => {
        const direct = rankWords(
          clue,
          words,
          (activeClue, word) =>
            directScore(context, activeClue, word),
        );
        if (
          clueNumber < 2 ||
          (direct[0]?.score ?? Number.POSITIVE_INFINITY) >=
            activationCeiling
        ) {
          return direct;
        }
        return rankWords(clue, words, (activeClue, word) =>
          scoreOperativeAssociation(
            directScore(context, activeClue, word),
            conceptScore(context, activeClue, word),
            { conceptOffset },
          ),
        );
      },
    },
  );
}

function scoreTurns(
  turns,
  scorePair,
  { rankWords: activeRankWords = rankWords } = {},
) {
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
  for (const turn of turns) {
    const humanGuesses = turn.guesses.filter((word) =>
      turn.remaining.includes(word),
    );
    if (humanGuesses.length > 0) {
      const ranked = activeRankWords(
        turn.clue,
        turn.remaining,
        turn.targets.length,
        scorePair,
      );
      const predicted = ranked
        .slice(0, humanGuesses.length)
        .map(({ word }) => word);
      totals.guessTurns += 1;
      totals.firstGuessHits += Number(
        ranked[0]?.word === humanGuesses[0],
      );
      totals.guessRecall +=
        intersectionSize(predicted, humanGuesses) /
        humanGuesses.length;
    }

    const candidates = [
      ...new Set([
        ...turn.targets,
        ...turn.neutral,
        ...turn.avoid,
      ]),
    ];
    if (turn.targets.length === 0 || candidates.length === 0) {
      continue;
    }
    const ranked = activeRankWords(
      turn.clue,
      candidates,
      turn.targets.length,
      scorePair,
    );
    const scoreByWord = new Map(
      ranked.map(({ word, score }) => [word, score]),
    );
    const predicted = ranked
      .slice(0, turn.targets.length)
      .map(({ word }) => word);
    const targetSet = new Set(turn.targets);
    totals.targetTurns += 1;
    totals.targetRecall +=
      intersectionSize(predicted, turn.targets) /
      turn.targets.length;
    totals.exactTargetSets += Number(
      predicted.length === turn.targets.length &&
      predicted.every((word) => targetSet.has(word)),
    );
    totals.avoidHits += Number(
      predicted.some((word) => turn.avoid.includes(word)),
    );
    for (const target of turn.targets) {
      const targetScore = scoreByWord.get(target);
      for (const other of [...turn.neutral, ...turn.avoid]) {
        totals.pairwiseTotal += 1;
        totals.pairwiseCorrect += Number(
          targetScore > scoreByWord.get(other),
        );
      }
    }
  }
  return {
    scoredGuessTurns: totals.guessTurns,
    scoredTargetTurns: totals.targetTurns,
    firstGuessAccuracy: ratio(
      totals.firstGuessHits,
      totals.guessTurns,
    ),
    guessRecallAtHumanCount: ratio(
      totals.guessRecall,
      totals.guessTurns,
    ),
    targetRecallAtCount: ratio(
      totals.targetRecall,
      totals.targetTurns,
    ),
    exactTargetSetAccuracy: ratio(
      totals.exactTargetSets,
      totals.targetTurns,
    ),
    avoidWordRate: ratio(
      totals.avoidHits,
      totals.targetTurns,
    ),
    pairwiseTargetAccuracy: ratio(
      totals.pairwiseCorrect,
      totals.pairwiseTotal,
    ),
  };
}

function rankWords(clue, words, clueNumberOrScorePair, maybeScorePair) {
  const scorePair =
    typeof clueNumberOrScorePair === "function"
      ? clueNumberOrScorePair
      : maybeScorePair;
  return words
    .map((word) => ({
      word,
      score: scorePair(clue, word),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.word.localeCompare(right.word),
    );
}

async function evaluateLatentVocabularyWalk() {
  const manifest = JSON.parse(
    await readFile(
      resolve(
        ROOT,
        "public/data/model-lab/bge-small/manifest.json",
      ),
      "utf8",
    ),
  );
  const shardFiles = manifest.shards
    .filter(({ start }) => start < 10_000)
    .map(({ file }) => file);
  const shards = await Promise.all(
    shardFiles.map(async (file) =>
      JSON.parse(
        await readFile(
          resolve(
            ROOT,
            "public/data/model-lab/bge-small",
            file,
          ),
          "utf8",
        ),
      ),
    ),
  );
  const clues = shards.flatMap(({ clues: values }) => values);
  const vectors = new Int8Array(
    clues.length * manifest.dimensions,
  );
  let offset = 0;
  for (const shard of shards) {
    const bytes = Buffer.from(shard.vectors, "base64");
    vectors.set(
      new Int8Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ),
      offset,
    );
    offset += bytes.byteLength;
  }
  const production = modelReports.find(
    ({ id }) => id === "bge-small",
  );
  const contextModel = MODEL_DEFINITIONS.find(
    ({ id }) => id === "bge-small",
  );
  const manifestModel = JSON.parse(
    await readFile(
      resolve(
        ROOT,
        `public/data/model-lab/${contextModel.id}/manifest.json`,
      ),
      "utf8",
    ),
  );
  const extractor = await pipeline(
    "feature-extraction",
    manifestModel.model,
    { dtype: "q8" },
  );
  const raw = await embedBatches(
    extractor,
    ["joust", ...JOUST_WORDS],
  );
  const centered = centerEmbeddings(
    raw,
    manifest.centering.mean,
  );
  const clueVector = centered[0];
  const bridgeRows = clues
    .map((word, row) => ({
      row,
      word,
      similarity: quantizedDot(
        vectors,
        row,
        clueVector,
        manifest,
      ),
    }))
    .filter(
      ({ word }) =>
        word !== "joust" && !JOUST_WORDS.includes(word),
    )
    .sort(
      (left, right) => right.similarity - left.similarity,
    )
    .slice(0, 64);
  const ranking = JOUST_WORDS.map((word, index) => {
    let best = null;
    for (const bridge of bridgeRows) {
      const cardSimilarity = quantizedDot(
        vectors,
        bridge.row,
        centered[index + 1],
        manifest,
      );
      const score =
        Math.max(0, bridge.similarity) *
        Math.max(0, cardSimilarity);
      if (!best || score > best.score) {
        best = {
          concept: bridge.word,
          score,
        };
      }
    }
    return {
      word: word.toUpperCase(),
      score: round(best?.score ?? 0),
      concept: best?.concept ?? null,
    };
  }).sort(
    (left, right) =>
      right.score - left.score ||
      left.word.localeCompare(right.word),
  );
  if (typeof extractor.dispose === "function") {
    await extractor.dispose();
  }
  return {
    description:
      "Top-64 local clue-vocabulary concepts, with the strongest positive two-edge cosine product used for each card.",
    scope: "preserved-fixture screen",
    result: ranking,
    outcome:
      ranking.findIndex(({ word }) => word === "PIANO") ===
      ranking.length - 1
        ? "passes"
        : "fails",
    productionDirectReference: production?.joust.direct ?? null,
  };
}

function quantizedDot(vectors, row, vector, manifest) {
  let total = 0;
  const vectorOffset = row * manifest.dimensions;
  for (
    let dimension = 0;
    dimension < manifest.dimensions;
    dimension += 1
  ) {
    total += vectors[vectorOffset + dimension] * vector[dimension];
  }
  return total / manifest.quantization.scale;
}

async function loadConceptDefinitions() {
  const manifest = JSON.parse(
    await readFile(
      resolve(CONCEPT_DIRECTORY, "manifest.json"),
      "utf8",
    ),
  );
  const payloads = await Promise.all(
    Object.values(manifest.shards).map(({ file }) =>
      readFile(resolve(CONCEPT_DIRECTORY, file), "utf8").then(
        JSON.parse,
      ),
    ),
  );
  return new Map(
    payloads.flatMap(({ entries }) => Object.entries(entries)),
  );
}

function requiredVector(vectors, term) {
  const vector = vectors.get(normalizeConceptTerm(term));
  if (!vector) {
    throw new Error(`No embedding for ${term}`);
  }
  return vector;
}

function intersectionSize(left, right) {
  const rightSet = new Set(right);
  return left.reduce(
    (total, value) => total + Number(rightSet.has(value)),
    0,
  );
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : null;
}

function round(value) {
  return Number(value.toFixed(4));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
