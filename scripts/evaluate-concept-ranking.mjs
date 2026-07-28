import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  pipeline,
} from "@huggingface/transformers";
import { execFile } from "node:child_process";
import {
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
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
const RERANKER_BATCH_SIZE = 128;
const RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
const RERANKER_REVISION =
  "a09144355adeed5f58c8ed011d209bf8ee5a1fec";
const RERANKER_SHORTLIST_SIZE = 8;
const RERANKER_ADJUSTMENT_CAPS = [0.005, 0.01, 0.02, 0.04];
const execFileAsync = promisify(execFile);

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
let rerankerEvaluation = null;

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
  if (definition.id === "bge-small") {
    rerankerEvaluation = await evaluateRerankerAblations({
      context,
      datasets,
    });
  }
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
  version: 4,
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
    pairwiseCrossEncoder: {
      description:
        "A local MS MARCO MiniLM cross-encoder scores each raw clue-card pair without WordNet evidence.",
      model: RERANKER_MODEL,
      revision: RERANKER_REVISION,
      license: "Apache-2.0",
    },
    boundedBridgeRerank: {
      description:
        "Direct BGE activates the existing WordNet expansion, then a local cross-encoder adds a capped adjustment within the top bridge shortlist.",
      shortlistSize: RERANKER_SHORTLIST_SIZE,
      adjustmentCaps: RERANKER_ADJUSTMENT_CAPS,
    },
    hostedLlmReranker: {
      status: "screened-without-paid-run",
      reason:
        "The local cross-encoder supplies the requested learned-reranker comparison without sending public game data to a service. Hosted listwise rerankers remain ineligible for automatic local-first turns.",
      paidCostUsd: 0,
    },
  },
  candidateScreen: [
    {
      candidate: "runtime WordNet glosses",
      representation: "explicit BGE-aligned senses",
      status: "evaluated",
      reason:
        "Current local bridge and comparison baseline.",
    },
    {
      candidate: "precomputed BGE WordNet vectors",
      representation: "explicit BGE-aligned senses",
      status: "score-equivalent",
      reason:
        "Changes packaging and first-use work, not ranking quality, because it stores the same centered vectors used by the runtime gloss bridge.",
    },
    {
      candidate: "AutoExtend",
      representation: "learned static synsets",
      status: "not comparable",
      reason:
        "Requires training from an input word-vector space and has no ready BGE-small-aligned artifact.",
    },
    {
      candidate: "LMMS",
      representation: "learned contextual senses",
      status: "not promoted",
      reason:
        "Uses a separate transformer sense space and would add a second large runtime model before Codenames-specific evidence.",
    },
    {
      candidate: "ARES",
      representation: "learned contextual senses",
      status: "license-blocked",
      reason:
        "The published sense embeddings are CC BY-NC-SA 4.0.",
    },
    {
      candidate: "ConceptNet Numberbatch",
      representation: "guarded graph ensemble",
      status: "not promoted",
      reason:
        "Prior standalone evaluation improved human recall but failed Fun and transfer gates; its CC BY-SA artifact remains unsuitable for redistribution without review.",
    },
    {
      candidate: "pairwise MiniLM cross-encoder",
      representation: "learned direct reranker",
      status: "evaluated",
      reason:
        "Small Apache-2.0 local ONNX model provides an offline pairwise ablation.",
    },
    {
      candidate: "hosted listwise reranker",
      representation: "learned listwise reranker",
      status: "comparison-only",
      reason:
        "Automatic turns must stay offline, bounded, and free per turn; no paid call was needed after the local ablation.",
    },
  ],
  rerankerEvaluation,
  selected: {
    approach: "wordnetSenseBridge",
    modelId: "bge-small",
    conceptOffset: 0.05,
    activationCeiling: 0.2,
    minimumClueNumber: 2,
    otherModelBehavior: "direct",
    rationale:
      "Retain the runtime WordNet bridge. The direct cross-encoder fails JOUST and every human-alignment gate. The best bounded bridge-rerank pipeline still depends on WordNet, adds a second 23.9 MB model, and produces no full-game improvement for only marginal aggregate movement.",
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

async function evaluateRerankerAblations({ context, datasets }) {
  const pairs = collectEvaluationPairs(datasets);
  const cacheDirectory = resolve(
    env.cacheDir,
    ...RERANKER_MODEL.split("/"),
  );
  const loadStartedAt = performance.now();
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(RERANKER_MODEL, {
      revision: RERANKER_REVISION,
    }),
    AutoModelForSequenceClassification.from_pretrained(
      RERANKER_MODEL,
      {
        dtype: "q8",
        revision: RERANKER_REVISION,
      },
    ),
  ]);
  const cachedLoadLatencyMs = round(
    performance.now() - loadStartedAt,
  );

  const directScores = await scoreRerankerPairs({
    label: "raw clue-card",
    model,
    pairs: pairs.map(({ clue, word }) => ({
      key: pairKey(clue, word),
      query: clue,
      passage: word,
    })),
    tokenizer,
  });
  const bridgeEvidence = new Map(
    pairs.map(({ clue, word }) => [
      pairKey(clue, word),
      strongestBridgeEvidence(context, clue, word),
    ]),
  );
  const expandedPairs = pairs.flatMap(({ clue, word }) => {
    const key = pairKey(clue, word);
    const evidence = bridgeEvidence.get(key);
    return evidence
      ? [
          {
            key,
            query: `${clue}: ${evidence.clueSense}`,
            passage: `${word}: ${evidence.cardSense}`,
          },
        ]
      : [];
  });
  const expandedScores = await scoreRerankerPairs({
    label: "bridge-expanded",
    model,
    pairs: expandedPairs,
    tokenizer,
  });

  const directReranker = {
    datasets: scoreDatasets(
      datasets,
      (clue, word) =>
        directScores.get(pairKey(clue, word)) ??
        Number.NEGATIVE_INFINITY,
    ),
    joust: rankWords(
      "joust",
      JOUST_WORDS,
      (clue, word) =>
        directScores.get(pairKey(clue, word)) ??
        Number.NEGATIVE_INFINITY,
    ).map(roundRankingRow),
    originalFixtures: evaluateRerankerFixtures(
      directScores,
      null,
    ),
  };
  const pipelines = Object.fromEntries(
    RERANKER_ADJUSTMENT_CAPS.map((adjustmentCap) => [
      adjustmentCap,
      {
        datasets: scorePipelineDatasets(datasets, context, {
          adjustmentCap,
          expandedScores,
        }),
        joust: rankPipelineWords(
          "joust",
          JOUST_WORDS,
          2,
          context,
          expandedScores,
          { adjustmentCap },
        ).map(roundRankingRow),
        originalFixtures: evaluateRerankerFixtures(
          expandedScores,
          {
            adjustmentCap,
            context,
          },
        ),
      },
    ]),
  );
  const latency = await measureRerankerLatency({
    expandedPairs,
    model,
    tokenizer,
  });
  const cachedAssetBytes = await directorySize(cacheDirectory);
  if (typeof model.dispose === "function") {
    await model.dispose();
  }
  const isolatedActivation = await measureRerankerActivation();

  return {
    model: RERANKER_MODEL,
    revision: RERANKER_REVISION,
    license: "Apache-2.0",
    trainingTask: "MS MARCO passage relevance",
    pairCount: pairs.length,
    bridgeExpandedPairCount: expandedPairs.length,
    shortlistSize: RERANKER_SHORTLIST_SIZE,
    cachedAssetBytes,
    cachedLoadLatencyMs,
    isolatedActivation,
    latency,
    directReranker,
    pipelines,
    paidCostUsd: 0,
  };
}

function collectEvaluationPairs(datasets) {
  const pairs = new Map();
  const add = (clue, word) => {
    const normalizedClue = normalizeConceptTerm(clue);
    const normalizedWord = normalizeConceptTerm(word);
    pairs.set(pairKey(normalizedClue, normalizedWord), {
      clue: normalizedClue,
      word: normalizedWord,
    });
  };
  for (const turns of Object.values(datasets)) {
    for (const turn of turns) {
      for (const word of [
        ...turn.remaining,
        ...turn.targets,
        ...turn.neutral,
        ...turn.avoid,
      ]) {
        add(turn.clue, word);
      }
    }
  }
  for (const { candidates, clue } of ORIGINAL_FIXTURES) {
    for (const word of candidates) add(clue, word);
  }
  for (const word of JOUST_WORDS) add("joust", word);
  return [...pairs.values()].sort(
    (left, right) =>
      left.clue.localeCompare(right.clue) ||
      left.word.localeCompare(right.word),
  );
}

async function scoreRerankerPairs({
  label,
  model,
  pairs,
  tokenizer,
}) {
  const scores = new Map();
  for (
    let start = 0;
    start < pairs.length;
    start += RERANKER_BATCH_SIZE
  ) {
    const batch = pairs.slice(
      start,
      start + RERANKER_BATCH_SIZE,
    );
    const inputs = await tokenizer(
      batch.map(({ query }) => query),
      {
        text_pair: batch.map(({ passage }) => passage),
        padding: true,
        truncation: true,
      },
    );
    const output = await model(inputs);
    const logits = output.logits.tolist();
    batch.forEach(({ key }, index) => {
      scores.set(key, logits[index][0]);
    });
    if (
      start > 0 &&
      start % (RERANKER_BATCH_SIZE * 200) === 0
    ) {
      console.log(
        `Scored ${start.toLocaleString("en-US")}/${pairs.length.toLocaleString("en-US")} ${label} pairs.`,
      );
    }
  }
  return scores;
}

function strongestBridgeEvidence(context, clue, word) {
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
          cardSense: wordDefinitions[wordIndex],
        };
      }
    }
  }
  return best;
}

function scorePipelineDatasets(
  datasets,
  context,
  { adjustmentCap, expandedScores },
) {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, turns]) => [
      name,
      scoreTurns(
        turns,
        (clue, word) => directScore(context, clue, word),
        {
          rankWords: (clue, words, clueNumber) =>
            rankPipelineWords(
              clue,
              words,
              clueNumber,
              context,
              expandedScores,
              { adjustmentCap },
            ),
        },
      ),
    ]),
  );
}

function rankPipelineWords(
  clue,
  words,
  clueNumber,
  context,
  expandedScores,
  { adjustmentCap },
) {
  const direct = rankWords(clue, words, (activeClue, word) =>
    directScore(context, activeClue, word),
  );
  if (
    clueNumber < 2 ||
    (direct[0]?.score ?? Number.POSITIVE_INFINITY) >= 0.2
  ) {
    return direct;
  }
  const association = rankWords(
    clue,
    words,
    (activeClue, word) =>
      scoreOperativeAssociation(
        directScore(context, activeClue, word),
        conceptScore(context, activeClue, word),
        { conceptOffset: 0.05 },
      ),
  );
  const shortlist = association.slice(0, RERANKER_SHORTLIST_SIZE);
  const rerankerRows = shortlist
    .map(({ word }) => ({
      word,
      score: expandedScores.get(pairKey(clue, word)),
    }))
    .filter(({ score }) => Number.isFinite(score));
  if (rerankerRows.length < 2) {
    return association;
  }
  const minimum = Math.min(
    ...rerankerRows.map(({ score }) => score),
  );
  const maximum = Math.max(
    ...rerankerRows.map(({ score }) => score),
  );
  if (maximum === minimum) {
    return association;
  }
  const adjustmentByWord = new Map(
    rerankerRows.map(({ score, word }) => [
      word,
      adjustmentCap *
        (2 * ((score - minimum) / (maximum - minimum)) - 1),
    ]),
  );
  return association
    .map(({ score, word }) => ({
      word,
      score: score + (adjustmentByWord.get(word) ?? 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.word.localeCompare(right.word),
    );
}

function evaluateRerankerFixtures(
  scores,
  pipelineOptions,
) {
  return ORIGINAL_FIXTURES.map((fixture) => {
    const ranking = pipelineOptions
      ? rankPipelineWords(
          fixture.clue,
          fixture.candidates,
          fixture.targets.length,
          pipelineOptions.context,
          scores,
          {
            adjustmentCap:
              pipelineOptions.adjustmentCap,
          },
        )
      : rankWords(
          fixture.clue,
          fixture.candidates,
          (clue, word) =>
            scores.get(pairKey(clue, word)) ??
            Number.NEGATIVE_INFINITY,
        );
    const top = ranking
      .slice(0, fixture.targets.length)
      .map(({ word }) => word);
    return {
      clue: fixture.clue.toUpperCase(),
      targets: fixture.targets.map((word) =>
        word.toUpperCase(),
      ),
      top: top.map((word) => word.toUpperCase()),
      targetHits: intersectionSize(top, fixture.targets),
    };
  });
}

async function measureRerankerLatency({
  expandedPairs,
  model,
  tokenizer,
}) {
  const words = DEFAULT_BOARD.map(({ word }) =>
    normalizeConceptTerm(word),
  );
  const directPairs = words.map((word) => ({
    query: "joust",
    passage: word,
  }));
  const bridgePairs = expandedPairs
    .slice(0, RERANKER_SHORTLIST_SIZE)
    .map(({ passage, query }) => ({ passage, query }));
  const directSamples = [];
  const bridgeSamples = [];
  await runRerankerBatch(model, tokenizer, directPairs);
  if (bridgePairs.length > 0) {
    await runRerankerBatch(model, tokenizer, bridgePairs);
  }
  for (let iteration = 0; iteration < 5; iteration += 1) {
    let startedAt = performance.now();
    await runRerankerBatch(model, tokenizer, directPairs);
    directSamples.push(performance.now() - startedAt);
    startedAt = performance.now();
    await runRerankerBatch(model, tokenizer, bridgePairs);
    bridgeSamples.push(performance.now() - startedAt);
  }
  return {
    directPairs: directPairs.length,
    bridgePairs: bridgePairs.length,
    directTurnMedianMs: round(median(directSamples)),
    bridgeShortlistMedianMs: round(median(bridgeSamples)),
  };
}

async function runRerankerBatch(model, tokenizer, pairs) {
  if (pairs.length === 0) return;
  const inputs = await tokenizer(
    pairs.map(({ query }) => query),
    {
      text_pair: pairs.map(({ passage }) => passage),
      padding: true,
      truncation: true,
    },
  );
  await model(inputs);
}

function roundRankingRow({ score, word }) {
  return {
    word: word.toUpperCase(),
    score: round(score),
  };
}

function pairKey(clue, word) {
  return `${normalizeConceptTerm(clue)}\u0000${normalizeConceptTerm(word)}`;
}

async function directorySize(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const entryPath = resolve(path, entry.name);
      total += entry.isDirectory()
        ? await directorySize(entryPath)
        : (await stat(entryPath)).size;
    }
    return total;
  } catch {
    return null;
  }
}

async function measureRerankerActivation() {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--expose-gc",
      resolve(ROOT, "scripts/measure-reranker-memory.mjs"),
    ],
    {
      env: {
        ...process.env,
        ALLOW_REMOTE_MODELS: "0",
        HF_CACHE_DIR: env.cacheDir,
      },
    },
  );
  return JSON.parse(stdout);
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
