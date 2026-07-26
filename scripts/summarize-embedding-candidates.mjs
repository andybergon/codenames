import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_PATH = resolve(
  ROOT,
  "scripts/generated/play-embedding-candidate-experiments.json",
);
const DOC_PATH = resolve(ROOT, "docs/play-fun-optimization.md");
const experimentRoot = resolve(ROOT, ".cache/embedding-experiments");
const prior = await readJson(
  resolve(ROOT, "scripts/generated/play-fun-experiments.json"),
);
const previousReport = await readJsonIfExists(OUTPUT_PATH);
const baseline = prior.candidates.baseline;
const specifications = [
  {
    id: "qwen3-embedding-0.6b",
    label: "Qwen3 Embedding 0.6B",
    icon: "🐉",
    rating: "🟢 4",
    generalBenchmark: "70.70 MTEB v2",
    decision: "❌ Transfer",
    testCost: "Local",
    directory: "qwen3-embedding-0.6b-instructed-1024",
    configuration:
      "8-bit MLX, 1,024 dimensions, symmetric semantic-similarity instruction",
  },
  {
    id: "gemini-embedding-2",
    label: "Gemini Embedding 2",
    icon: "💎",
    rating: "🟡 3.5",
    generalBenchmark: "N/A",
    decision: "❌ Low Fun",
    directory: "openrouter-gemini-embedding-2-768",
    configuration:
      "OpenRouter, 768 dimensions, symmetric semantic-similarity instruction",
    hosted: true,
  },
  {
    id: "voyage-4-large",
    label: "Voyage 4 Large",
    icon: "🚢",
    rating: "🟡 3.5",
    generalBenchmark: "#1 RTEB",
    decision: "❌ Transfer",
    directory: "voyage-4-large-1024",
    configuration:
      "Vercel AI Gateway, 1,024 dimensions, symmetric retrieval task prefix",
    hosted: true,
  },
  {
    id: "conceptnet-numberbatch",
    label: "ConceptNet Numberbatch",
    icon: "🌐",
    rating: "🟡 3.5",
    generalBenchmark: "N/A",
    decision: "🧪 Ensemble",
    testCost: "Local",
    directory: "conceptnet-numberbatch-300",
    configuration:
      "English 19.08 vectors, 300 dimensions, available-term centering",
  },
  {
    id: "qwen3-embedding-8b",
    label: "Qwen3 Embedding 8B",
    icon: "🐲",
    rating: "🟠 3",
    generalBenchmark: "75.22 MTEB v2",
    decision: "❌ Low Fun",
    directory: "openrouter-qwen3-embedding-8b-768-b1024",
    configuration:
      "OpenRouter, 768 dimensions, symmetric semantic-similarity instruction",
    hosted: true,
  },
  {
    id: "jina-v5-text-small",
    label: "Jina v5 text-small",
    icon: "🧩",
    rating: "🟠 2.5",
    generalBenchmark: "71.7 MTEB v2",
    decision: "❌ Reject",
    testCost: "Local",
    directory: "jina-v5-small-text-matching-1024",
    configuration:
      "FP16 MLX, 1,024 dimensions, text-matching adapter with Document prefix",
  },
  {
    id: "cohere-embed-v4",
    label: "Cohere Embed v4",
    icon: "🪸",
    rating: "🔴 2",
    generalBenchmark: "N/A",
    decision: "❌ Low Fun",
    directory: "cohere-embed-v4-1536",
    configuration:
      "Vercel AI Gateway, 1,536 dimensions, symmetric retrieval task prefix",
    hosted: true,
  },
];
const candidates = [];
for (const specification of specifications) {
  const liveCandidate = await readCandidateFromCache(specification);
  const priorCandidate = previousReport?.candidates.find(
    ({ id }) => id === specification.id,
  );
  if (!liveCandidate && !priorCandidate) {
    throw new Error(`Missing benchmark artifacts for ${specification.label}.`);
  }
  candidates.push(
    liveCandidate ?? {
      ...priorCandidate,
      ...specification,
    },
  );
}

const qwen = candidates.find(({ id }) => id === "qwen3-embedding-0.6b");
const qwenDirectory = resolve(
  experimentRoot,
  "qwen3-embedding-0.6b-instructed-1024",
);
const qwenTunedSelf = await readJsonIfExists(
  resolve(qwenDirectory, "play-self-tolerance-0.json"),
);
const qwenTunedCross = await readJsonIfExists(
  resolve(qwenDirectory, "play-cross-minilm-tolerance-0.json"),
);
if (qwenTunedSelf && qwenTunedCross) {
  qwen.toleranceZero = {
    selfPlay: playSummary(qwenTunedSelf.policies.hybrid),
    crossModel: playSummary(qwenTunedCross.policies.hybrid),
  };
}

for (const candidate of candidates) {
  if (candidate.crossModel.boundedCompletion === undefined) {
    candidate.crossModel.boundedCompletion = true;
    candidate.crossModel.status = "completed";
  }
  candidate.promotionGates = promotionGates(candidate, baseline);
  candidate.promote = candidate.promotionGates.every(({ passed }) => passed);
}
const report = {
  generatedAt: new Date().toISOString(),
  sample: {
    boards: 20,
    candidates: 10_000,
    cluePolicy: "hybrid",
    clueSelection: "tempo",
    multiTolerance: 5,
    bonusGuesses: "pass after declared number",
    centeringCorpus: "30,000 clue words when available",
  },
  baseline,
  baselineGeneralBenchmark: "62.17 MTEB",
  baselineHuman: prior.humanAlignment.baseline,
  candidates,
  vercelFreeTier: {
    observedCreditBalanceBeforeUsd: 2.56,
    freeTierTermsBeforeThrottle: 480,
    topUpCreditUsd: 10,
    paymentProcessingFeeUsd: 0.59,
    estimatedTaxUsd: 2.44,
    totalChargedUsd: 13.03,
    observedCreditBalanceAfterUsd: 12.55,
    paidModelCostUsd: 0.063988,
    credentialsTested: ["project OIDC token"],
    models: [
      {
        id: "cohere/embed-v4.0",
        probeSucceeded: true,
        dimensions: 1_536,
        termCount: 31_253,
        routesTested: ["cohere"],
        freeTierStatus: 429,
        paidStatus: "completed",
        billedCostUsd: 0.031938,
      },
      {
        id: "voyage/voyage-4-large",
        probeSucceeded: true,
        dimensions: 1_024,
        termCount: 31_253,
        routesTested: ["voyage"],
        freeTierStatus: 429,
        paidStatus: "completed",
        billedCostUsd: 0.03205,
      },
    ],
    conclusion:
      "Free-tier probes did not establish sustained throughput. Paid credits removed the model-level throttle and completed both resumable 31,253-term generations within the per-model cost caps.",
  },
  priorOpenAiExperiment: {
    model: prior.candidates.api.model,
    generalBenchmark: "64.6 MTEB",
    human: prior.humanAlignment.candidate,
    selfPlay: prior.candidates.api.selfPlay,
    crossModel: prior.candidates.api.crossModel,
    cost: prior.cost,
  },
  verdict: {
    promote: false,
    productionModel: baseline.model,
    recommendation:
      "Keep BGE-small. Voyage 4 Large substantially improves human clue recovery but lowers same-model Fun and fails bounded MiniLM transfer completion. Cohere Embed v4 also lowers Fun and fails the transfer bound. Use Voyage, Gemini, or ConceptNet as future ensemble signals rather than standalone replacements.",
  },
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(DOC_PATH, renderMarkdown(report));
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Wrote ${DOC_PATH}`);

function promotionGates(candidate, activeBaseline) {
  const selfFun = candidate.selfPlay.fun;
  const boundedCompletion = candidate.crossModel.boundedCompletion;
  const crossCorrect = candidate.crossModel.correctCardsPerTurn;
  const crossWrong = candidate.crossModel.wrongTeamHitsPerGame;
  const crossAssassin = candidate.crossModel.assassinRate;
  return [
    {
      gate: "Human validity",
      passed: candidate.human.guardrailsPassed,
      candidate: candidate.human.guardrailsPassed ? "Pass" : "Fail",
      requirement: "Pass",
    },
    {
      gate: "Default Fun Index",
      passed: selfFun >= activeBaseline.selfPlay.fun.score,
      candidate: selfFun,
      requirement: `>= ${activeBaseline.selfPlay.fun.score}`,
    },
    {
      gate: "Cross-model bounded completion",
      passed: boundedCompletion,
      candidate: boundedCompletion ? "Complete" : "Exceeded 500 actions",
      requirement: "Complete",
    },
    {
      gate: "Cross-model correct per turn",
      passed:
        boundedCompletion &&
        Number.isFinite(crossCorrect) &&
        crossCorrect >=
        activeBaseline.crossModel.correctCardsPerTurn - 0.05,
      candidate: Number.isFinite(crossCorrect) ? crossCorrect : "No result",
      requirement: `>= ${round(activeBaseline.crossModel.correctCardsPerTurn - 0.05)}`,
    },
    {
      gate: "Cross-model wrong per game",
      passed:
        boundedCompletion &&
        Number.isFinite(crossWrong) &&
        crossWrong <=
        activeBaseline.crossModel.wrongTeamHitsPerGame + 0.1,
      candidate: Number.isFinite(crossWrong) ? crossWrong : "No result",
      requirement: `<= ${round(activeBaseline.crossModel.wrongTeamHitsPerGame + 0.1)}`,
    },
    {
      gate: "Cross-model assassin rate",
      passed:
        boundedCompletion &&
        Number.isFinite(crossAssassin) &&
        crossAssassin <= activeBaseline.crossModel.assassinRate + 0.05,
      candidate: Number.isFinite(crossAssassin)
        ? crossAssassin
        : "No result",
      requirement: `<= ${percent(activeBaseline.crossModel.assassinRate + 0.05)}`,
    },
  ];
}

async function readCandidateFromCache(specification) {
  const directory = resolve(experimentRoot, specification.directory);
  const human = await readJsonIfExists(resolve(directory, "human-report.json"));
  const self = await readJsonIfExists(resolve(directory, "play-self.json"));
  if (!human || !self) {
    return null;
  }
  const cross = await readJsonIfExists(
    resolve(directory, "play-cross-minilm.json"),
  );
  const crossFailure = cross
    ? null
    : await readJsonIfExists(resolve(directory, "play-cross-failure.json"));
  if (!cross && !crossFailure) {
    throw new Error(
      `Missing cross-model result or failure record for ${specification.label}.`,
    );
  }
  const vectorMetadata = specification.hosted
    ? await readJson(resolve(directory, "vector-metadata.json"))
    : null;
  return {
    ...specification,
    testCost:
      specification.testCost ??
      `$${vectorMetadata.cost.billedCostUsd.toFixed(4)}`,
    cost: vectorMetadata?.cost ?? null,
    human: {
      guardrailsPassed: human.humanValidityGuardrails.passed,
      coverage: human.vocabularyCoverage,
      culturalCodes: human.transforms.centered.culturalCodes,
      connector: human.transforms.centered.connector,
    },
    selfPlay: playSummary(self.policies.hybrid),
    crossModel: cross
      ? {
          status: "completed",
          boundedCompletion: true,
          operativeModel: cross.methodology.operativeModel,
          ...playSummary(cross.policies.hybrid),
        }
      : {
          status: crossFailure.status,
          boundedCompletion: false,
          operativeModel: crossFailure.operativeModel,
          failure: {
            reason: crossFailure.reason,
            policy: crossFailure.policy,
            board: crossFailure.board,
            maxActions: crossFailure.maxActions,
            message: crossFailure.message,
          },
        },
  };
}

function playSummary(policy) {
  return {
    fun: policy.fun.score,
    multiClueRate: policy.multiClueRate,
    firstHalfMeanClueNumber: policy.firstHalfMeanClueNumber,
    correctCardsPerTurn: policy.correctCardsPerTurn,
    wrongTeamHitsPerGame: policy.wrongTeamHitsPerGame,
    assassinRate: policy.assassinRate,
    meanTurnsPerGame: policy.meanTurnsPerGame,
  };
}

function renderMarkdown(result) {
  const qwenResult = result.candidates.find(
    ({ id }) => id === "qwen3-embedding-0.6b",
  );
  const gemini = result.candidates.find(
    ({ id }) => id === "gemini-embedding-2",
  );
  const voyage = result.candidates.find(
    ({ id }) => id === "voyage-4-large",
  );
  const conceptNet = result.candidates.find(
    ({ id }) => id === "conceptnet-numberbatch",
  );
  const qwen8b = result.candidates.find(
    ({ id }) => id === "qwen3-embedding-8b",
  );
  const jina = result.candidates.find(
    ({ id }) => id === "jina-v5-text-small",
  );
  const cohere = result.candidates.find(
    ({ id }) => id === "cohere-embed-v4",
  );
  const openAi = result.priorOpenAiExperiment;
  return `# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. Voyage 4 Large substantially improves human clue recovery, but its same-model Fun is lower and its MiniLM transfer run exceeds the bounded game limit. Cohere Embed v4 also lowers Fun and fails the same transfer guardrail. Voyage, Gemini, and ConceptNet remain promising ensemble signals, not standalone replacements.

| 🧠 Model | 🎯 Rating | 🌐 General benchmark | 💵 Test cost | 👥 Human target recall | 🎉 Fun Index | ✅ Cross correct | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | ${result.baselineGeneralBenchmark} | Local | ${percent(result.baselineHuman.culturalCodes.targetRecallAtCount)} | ${decimal(result.baseline.selfPlay.fun.score)} | ${decimal(result.baseline.crossModel.correctCardsPerTurn)} | ${decimal(result.baseline.crossModel.wrongTeamHitsPerGame)} | ${percent(result.baseline.crossModel.assassinRate)} | ✅ Keep |
${result.candidates.map(candidateRow).join("\n")}
| 🔴 OpenAI large | 🔴 2 | ${openAi.generalBenchmark} | $${result.priorOpenAiExperiment.cost.knownBilledCostUsd.toFixed(4)} | ${percent(openAi.human.culturalCodes.targetRecallAtCount)} | ${decimal(openAi.selfPlay.fun.score)} | ${decimal(openAi.crossModel.correctCardsPerTurn)} | ${decimal(openAi.crossModel.wrongTeamHitsPerGame)} | ${percent(openAi.crossModel.assassinRate)} | ❌ Reject |

The general benchmark column provides broad embedding context from published model cards. MTEB and MTEB English v2 are different suites, so their scores are not a strict ranking. Voyage publishes an RTEB rank instead of an MTEB score. N/A means no defensible model-specific result was published. Sources: [BGE-small](https://huggingface.co/BAAI/bge-small-en-v1.5), [Qwen3 Embedding](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [Jina v5 text-small](https://huggingface.co/jinaai/jina-embeddings-v5-text-small), [Voyage 4](https://blog.voyageai.com/2026/01/15/voyage-4/), and [OpenAI large](https://openai.com/index/new-embedding-models-and-api-updates/).

## 🎉 Objective

The 0-100 Fun Index balances ambitious clues, productive guesses, close finishes, and playable game length. Wrong-team hits, assassin losses, neutral hits, analyzer fallbacks, and human clue recovery remain separate promotion gates.

Human target recall replays a real human clue and its intended number of targets, ranks every target, neutral, and avoid word by embedding similarity, then measures how many intended targets appear in the top N. It is averaged across the recorded Cultural Codes turns.

The historical model sweep uses the same 20 deterministic boards, 10,000 clue candidates, hybrid scoring, five-point multi-clue tolerance, the former Aggressive operative thresholds, and passing at the declared clue number. Same-model scores measure the ceiling of a shared embedding space. MiniLM-L6 operative runs stress whether clues transfer beyond that space. The current Conservative, Aggressive, and Dynamic comparison is documented in [Clue engine](clue-engine.md#-play-operative-policy).

## 📈 Findings

- 🐉 Qwen raised same-model Fun from ${decimal(result.baseline.selfPlay.fun.score)} to ${decimal(qwenResult.selfPlay.fun)} and passed the human gate. Its cross-model wrong-team rate rose from ${decimal(result.baseline.crossModel.wrongTeamHitsPerGame)} to ${decimal(qwenResult.crossModel.wrongTeamHitsPerGame)}. Reducing multi-clue tolerance to zero lowered self Fun to ${decimal(qwenResult.toleranceZero.selfPlay.fun)} but still produced ${decimal(qwenResult.toleranceZero.crossModel.wrongTeamHitsPerGame)} cross-model wrong-team hits per game.
- 💎 Gemini achieved ${percent(gemini.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall and ${percent(gemini.human.connector.exactTargetSetAccuracy)} exact Connector pairs, the strongest human result in the sweep. Its same-model Fun was only ${decimal(gemini.selfPlay.fun)}, and cross-model correct cards per turn fell to ${decimal(gemini.crossModel.correctCardsPerTurn)}.
- 🚢 Voyage achieved ${percent(voyage.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall and ${percent(voyage.human.connector.exactTargetSetAccuracy)} exact Connector pairs. Its same-model Fun was ${decimal(voyage.selfPlay.fun)}, and ${transferFinding(voyage)}.
- 🌐 ConceptNet achieved ${percent(conceptNet.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall and ${percent(conceptNet.human.connector.exactTargetSetAccuracy)} exact Connector pairs. It covered ${percent(conceptNet.human.coverage.humanTurns.culturalCodes.rate)} of Cultural Codes turns, but its standalone Fun Index was only ${decimal(conceptNet.selfPlay.fun)}.
- 🐲 Qwen 8B reached ${percent(qwen8b.human.culturalCodes.targetRecallAtCount)} human target recall, but its same-model Fun was ${decimal(qwen8b.selfPlay.fun)} and it produced ${decimal(qwen8b.crossModel.wrongTeamHitsPerGame)} cross-model wrong-team hits per game.
- 🧩 Jina passed the human gate only with the text-matching model's required \`Document:\` prefix. It remained too conservative in self-play and transferred poorly.
- 🪸 Cohere achieved ${percent(cohere.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall, but same-model Fun fell to ${decimal(cohere.selfPlay.fun)}. ${capitalize(transferFinding(cohere))}.
- 💵 The full OpenRouter Gemini and Qwen 8B generations cost ${money(gemini.cost.billedCostUsd + qwen8b.cost.billedCostUsd)} combined.
- 💳 Vercel free-tier generation reached ${result.vercelFreeTier.freeTierTermsBeforeThrottle} terms before a model-level 429. Adding ${money(result.vercelFreeTier.topUpCreditUsd)} of paid credit cost ${money(result.vercelFreeTier.totalChargedUsd)} after fees and tax, then completed both 31,253-term corpora for ${money(result.vercelFreeTier.paidModelCostUsd)} of model usage.

## 🧪 Promotion gates

| 🧠 Candidate | 🚦 Human | 🚦 Fun | 🚦 Bounded | 🚦 Cross correct | 🚦 Cross wrong | 🚦 Assassin |
| --- | --- | --- | --- | --- | --- | --- |
${result.candidates
  .map((candidate) => {
    const statuses = candidate.promotionGates.map(({ passed }) =>
      passed ? "✅ Pass" : "❌ Fail",
    );
    return `| 🧪 ${candidate.label} | ${statuses.join(" | ")} |`;
  })
  .join("\n")}

## 🔁 Reproduction

1. Prepare the shared terms with \`node scripts/prepare-embedding-candidate.mjs --output <experiment-dir>\`.
2. Generate local vectors with \`scripts/embed-local-candidate.py\`, or hosted vectors with \`npm run embed:gateway-candidate\` and an explicit cost cap.
3. Build the human report and precomputed 10,000-clue index with \`node scripts/finalize-embedding-candidate.mjs --experiment-dir <experiment-dir>\`.
4. Run same-model and MiniLM operative Play benchmarks with \`scripts/benchmark-play-policy.mjs\`.
5. Refresh this report with \`node scripts/summarize-embedding-candidates.mjs\`.

The checked machine-readable result is [play-embedding-candidate-experiments.json](../scripts/generated/play-embedding-candidate-experiments.json).

## ⚠️ Distribution constraints

Jina v5 text-small is CC BY-NC 4.0, and ConceptNet Numberbatch is CC BY-SA 4.0. Their local benchmark artifacts remain gitignored. Review licensing before distributing either model or a derived production index.
`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function candidateRow(candidate) {
  const transfer = candidate.crossModel.boundedCompletion
    ? [
        decimal(candidate.crossModel.correctCardsPerTurn),
        decimal(candidate.crossModel.wrongTeamHitsPerGame),
        percent(candidate.crossModel.assassinRate),
      ]
    : ["🚫 Bound", "🚫 Bound", "🚫 Bound"];
  return `| ${candidate.icon} ${candidate.label} | ${candidate.rating} | ${candidate.generalBenchmark} | ${candidate.testCost} | ${percent(candidate.human.culturalCodes.targetRecallAtCount)} | ${decimal(candidate.selfPlay.fun)} | ${transfer.join(" | ")} | ${candidate.decision} |`;
}

function transferFinding(candidate) {
  return candidate.crossModel.boundedCompletion
    ? `the MiniLM transfer run reached ${decimal(candidate.crossModel.correctCardsPerTurn)} correct cards per turn`
    : `the MiniLM transfer run exceeded ${candidate.crossModel.failure.maxActions} actions on board ${candidate.crossModel.failure.board}`;
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function decimal(value) {
  return Number(value).toFixed(2);
}

function money(value) {
  return `$${Number(value).toFixed(4)}`;
}

function round(value, places = 4) {
  return Number(value.toFixed(places));
}
