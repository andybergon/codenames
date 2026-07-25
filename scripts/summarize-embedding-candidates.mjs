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
const baseline = prior.candidates.baseline;
const specifications = [
  {
    id: "qwen3-embedding-0.6b",
    label: "Qwen3 Embedding 0.6B",
    icon: "🐉",
    rating: "🟢 4",
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
    decision: "❌ Low Fun",
    directory: "openrouter-gemini-embedding-2-768",
    configuration:
      "OpenRouter, 768 dimensions, symmetric semantic-similarity instruction",
    hosted: true,
  },
  {
    id: "conceptnet-numberbatch",
    label: "ConceptNet Numberbatch",
    icon: "🌐",
    rating: "🟡 3.5",
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
    decision: "❌ Reject",
    testCost: "Local",
    directory: "jina-v5-small-text-matching-1024",
    configuration:
      "FP16 MLX, 1,024 dimensions, text-matching adapter with Document prefix",
  },
];
const candidates = [];
for (const specification of specifications) {
  const directory = resolve(experimentRoot, specification.directory);
  const human = await readJson(resolve(directory, "human-report.json"));
  const self = await readJson(resolve(directory, "play-self.json"));
  const cross = await readJson(
    resolve(directory, "play-cross-minilm.json"),
  );
  const vectorMetadata = specification.hosted
    ? await readJson(resolve(directory, "vector-metadata.json"))
    : null;
  candidates.push({
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
    crossModel: {
      operativeModel: cross.methodology.operativeModel,
      ...playSummary(cross.policies.hybrid),
    },
  });
}

const qwen = candidates.find(({ id }) => id === "qwen3-embedding-0.6b");
const qwenDirectory = resolve(
  experimentRoot,
  "qwen3-embedding-0.6b-instructed-1024",
);
const qwenTunedSelf = await readJson(
  resolve(qwenDirectory, "play-self-tolerance-0.json"),
);
const qwenTunedCross = await readJson(
  resolve(qwenDirectory, "play-cross-minilm-tolerance-0.json"),
);
qwen.toleranceZero = {
  selfPlay: playSummary(qwenTunedSelf.policies.hybrid),
  crossModel: playSummary(qwenTunedCross.policies.hybrid),
};

for (const candidate of candidates) {
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
  baselineHuman: prior.humanAlignment.baseline,
  candidates,
  vercelFreeTier: {
    observedCreditBalanceUsd: 3.13,
    projectBudgetUsd: 1,
    apiKeyBudgetUsd: 1,
    credentialsTested: ["project OIDC token", "project API key"],
    models: [
      {
        id: "cohere/embed-v4.0",
        probeSucceeded: true,
        dimensions: 1_536,
        routesTested: ["cohere", "bedrock"],
        sustainedStatus: 429,
      },
      {
        id: "voyage/voyage-4-large",
        probeSucceeded: true,
        dimensions: 1_024,
        routesTested: ["voyage"],
        sustainedStatus: 429,
        rateLimitResetObserved: true,
      },
    ],
    conclusion:
      "Free credits remain visible, but model-level anti-abuse limits allow isolated probes rather than sustained embedding generation. Authentication method and provider routing do not remove the limit.",
  },
  priorOpenAiExperiment: {
    model: prior.candidates.api.model,
    human: prior.humanAlignment.candidate,
    selfPlay: prior.candidates.api.selfPlay,
    crossModel: prior.candidates.api.crossModel,
    cost: prior.cost,
  },
  verdict: {
    promote: false,
    productionModel: baseline.model,
    recommendation:
      "Keep BGE-small. Qwen 0.6B is the only candidate to improve same-model Fun, but it fails cross-model safety. Gemini produces the strongest human clue recovery but much lower Fun. Use the stronger human-alignment models as future ensemble signals rather than production replacements.",
  },
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(DOC_PATH, renderMarkdown(report));
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Wrote ${DOC_PATH}`);

function promotionGates(candidate, activeBaseline) {
  const selfFun = candidate.selfPlay.fun;
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
      gate: "Cross-model correct per turn",
      passed:
        crossCorrect >=
        activeBaseline.crossModel.correctCardsPerTurn - 0.05,
      candidate: crossCorrect,
      requirement: `>= ${round(activeBaseline.crossModel.correctCardsPerTurn - 0.05)}`,
    },
    {
      gate: "Cross-model wrong per game",
      passed:
        crossWrong <=
        activeBaseline.crossModel.wrongTeamHitsPerGame + 0.1,
      candidate: crossWrong,
      requirement: `<= ${round(activeBaseline.crossModel.wrongTeamHitsPerGame + 0.1)}`,
    },
    {
      gate: "Cross-model assassin rate",
      passed:
        crossAssassin <= activeBaseline.crossModel.assassinRate + 0.05,
      candidate: crossAssassin,
      requirement: `<= ${percent(activeBaseline.crossModel.assassinRate + 0.05)}`,
    },
  ];
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
  const conceptNet = result.candidates.find(
    ({ id }) => id === "conceptnet-numberbatch",
  );
  const qwen8b = result.candidates.find(
    ({ id }) => id === "qwen3-embedding-8b",
  );
  const jina = result.candidates.find(
    ({ id }) => id === "jina-v5-text-small",
  );
  const openAi = result.priorOpenAiExperiment;
  return `# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. Qwen3 Embedding 0.6B is the only candidate to beat its 20-board same-model Fun Index, but it transfers poorly to a different operative embedding. Gemini Embedding 2 has the strongest human clue recovery, but its full-game Fun is much lower. These human-alignment gains are promising ensemble signals, not standalone replacements.

| 🧠 Model | 🎯 Rating | 💵 Test cost | 👥 Human target recall | 🎉 Fun Index | ✅ Cross correct | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | Local | ${percent(result.baselineHuman.culturalCodes.targetRecallAtCount)} | ${decimal(result.baseline.selfPlay.fun.score)} | ${decimal(result.baseline.crossModel.correctCardsPerTurn)} | ${decimal(result.baseline.crossModel.wrongTeamHitsPerGame)} | ${percent(result.baseline.crossModel.assassinRate)} | ✅ Keep |
${result.candidates.map(candidateRow).join("\n")}
| 🔴 OpenAI large | 🔴 2 | $${result.priorOpenAiExperiment.cost.knownBilledCostUsd.toFixed(4)} | ${percent(openAi.human.culturalCodes.targetRecallAtCount)} | ${decimal(openAi.selfPlay.fun.score)} | ${decimal(openAi.crossModel.correctCardsPerTurn)} | ${decimal(openAi.crossModel.wrongTeamHitsPerGame)} | ${percent(openAi.crossModel.assassinRate)} | ❌ Reject |
| 🚫 Cohere Embed v4 | 🔴 1 | $0.00 rounded | Not run | Not run | Not run | Not run | Not run | 🚫 Vercel limit |
| 🚫 Voyage 4 Large | 🔴 1 | $0.00 rounded | Not run | Not run | Not run | Not run | Not run | 🚫 Vercel limit |

## 🎉 Objective

The 0-100 Fun Index balances ambitious clues, productive guesses, close finishes, and playable game length. Wrong-team hits, assassin losses, neutral hits, analyzer fallbacks, and human clue recovery remain separate promotion gates.

Human target recall replays a real human clue and its intended number of targets, ranks every target, neutral, and avoid word by embedding similarity, then measures how many intended targets appear in the top N. It is averaged across the recorded Cultural Codes turns.

The model sweep uses the same 20 deterministic boards, 10,000 clue candidates, hybrid scoring, five-point multi-clue tolerance, and passing at the declared clue number. Same-model scores measure the ceiling of a shared embedding space. MiniLM-L6 operative runs stress whether clues transfer beyond that space.

## 📈 Findings

- 🐉 Qwen raised same-model Fun from ${decimal(result.baseline.selfPlay.fun.score)} to ${decimal(qwenResult.selfPlay.fun)} and passed the human gate. Its cross-model wrong-team rate rose from ${decimal(result.baseline.crossModel.wrongTeamHitsPerGame)} to ${decimal(qwenResult.crossModel.wrongTeamHitsPerGame)}. Reducing multi-clue tolerance to zero lowered self Fun to ${decimal(qwenResult.toleranceZero.selfPlay.fun)} but still produced ${decimal(qwenResult.toleranceZero.crossModel.wrongTeamHitsPerGame)} cross-model wrong-team hits per game.
- 💎 Gemini achieved ${percent(gemini.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall and ${percent(gemini.human.connector.exactTargetSetAccuracy)} exact Connector pairs, the strongest human result in the sweep. Its same-model Fun was only ${decimal(gemini.selfPlay.fun)}, and cross-model correct cards per turn fell to ${decimal(gemini.crossModel.correctCardsPerTurn)}.
- 🌐 ConceptNet achieved ${percent(conceptNet.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall and ${percent(conceptNet.human.connector.exactTargetSetAccuracy)} exact Connector pairs. It covered ${percent(conceptNet.human.coverage.humanTurns.culturalCodes.rate)} of Cultural Codes turns, but its standalone Fun Index was only ${decimal(conceptNet.selfPlay.fun)}.
- 🐲 Qwen 8B reached ${percent(qwen8b.human.culturalCodes.targetRecallAtCount)} human target recall, but its same-model Fun was ${decimal(qwen8b.selfPlay.fun)} and it produced ${decimal(qwen8b.crossModel.wrongTeamHitsPerGame)} cross-model wrong-team hits per game.
- 🧩 Jina passed the human gate only with the text-matching model's required \`Document:\` prefix. It remained too conservative in self-play and transferred poorly.
- 💵 The full OpenRouter Gemini and Qwen 8B generations cost ${money(gemini.cost.billedCostUsd + qwen8b.cost.billedCostUsd)} combined.
- 🚫 Vercel showed ${money(result.vercelFreeTier.observedCreditBalanceUsd)} of free credit, but Cohere and Voyage returned model-level 429 responses after isolated successful probes. A project API key, OIDC, and Cohere routing through both Cohere and Bedrock produced the same sustained restriction.

## 🧪 Promotion gates

| 🧠 Candidate | 🚦 Human | 🚦 Fun | 🚦 Cross correct | 🚦 Cross wrong | 🚦 Assassin |
| --- | --- | --- | --- | --- | --- |
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

function candidateRow(candidate) {
  return `| ${candidate.icon} ${candidate.label} | ${candidate.rating} | ${candidate.testCost} | ${percent(candidate.human.culturalCodes.targetRecallAtCount)} | ${decimal(candidate.selfPlay.fun)} | ${decimal(candidate.crossModel.correctCardsPerTurn)} | ${decimal(candidate.crossModel.wrongTeamHitsPerGame)} | ${percent(candidate.crossModel.assassinRate)} | ${candidate.decision} |`;
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
