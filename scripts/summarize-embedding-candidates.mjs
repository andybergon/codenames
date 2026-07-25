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
    directory: "qwen3-embedding-0.6b-instructed-1024",
    configuration:
      "8-bit MLX, 1,024 dimensions, symmetric semantic-similarity instruction",
  },
  {
    id: "conceptnet-numberbatch",
    label: "ConceptNet Numberbatch",
    directory: "conceptnet-numberbatch-300",
    configuration:
      "English 19.08 vectors, 300 dimensions, available-term centering",
  },
  {
    id: "jina-v5-text-small",
    label: "Jina v5 text-small",
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
  candidates.push({
    ...specification,
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
  gemini: {
    id: "gemini-embedding-2",
    status: "blocked",
    dimensions: 768,
    taskPrefix: "task: sentence similarity | query: ",
    preflight: {
      terms: 31_253,
      estimatedTokens: 483_607,
      maximumCostUsd: 0.1,
    },
    knownPaidCostUsd: 0,
    reason:
      "The existing Gemini project is limited to 100 free-tier embedding inputs, and async embedding batches fail their project precondition.",
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
      "Keep BGE-small. Qwen is the only candidate to improve same-model Fun, but it fails cross-model safety. Use ConceptNet as a human-alignment signal in a future ensemble experiment rather than replacing the production embedding.",
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
  const [qwenResult, conceptNet, jina] = result.candidates;
  const openAi = result.priorOpenAiExperiment;
  return `# Play fun optimization

## 🎯 Recommendation

Keep BGE-small as the production Play embedding. Qwen3 Embedding 0.6B is the first candidate to beat its 20-board same-model Fun Index, but it transfers poorly to a different operative embedding. ConceptNet is the strongest human-alignment signal and the most promising input to a future ensemble, not a standalone replacement.

| 🧠 Model | 🎯 Rating | 💵 Test cost | 👥 Human target recall | 🎉 Fun Index | ✅ Cross correct | 🔴 Cross wrong | ☠️ Cross assassin | 📌 Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 🟢 BGE-small | 🟢 5 | Local | ${percent(result.baselineHuman.culturalCodes.targetRecallAtCount)} | ${decimal(result.baseline.selfPlay.fun.score)} | ${decimal(result.baseline.crossModel.correctCardsPerTurn)} | ${decimal(result.baseline.crossModel.wrongTeamHitsPerGame)} | ${percent(result.baseline.crossModel.assassinRate)} | ✅ Keep |
| 🐉 Qwen3 0.6B | 🟢 4 | Local | ${percent(qwenResult.human.culturalCodes.targetRecallAtCount)} | ${decimal(qwenResult.selfPlay.fun)} | ${decimal(qwenResult.crossModel.correctCardsPerTurn)} | ${decimal(qwenResult.crossModel.wrongTeamHitsPerGame)} | ${percent(qwenResult.crossModel.assassinRate)} | ❌ Transfer |
| 🌐 ConceptNet | 🟡 3.5 | Local | ${percent(conceptNet.human.culturalCodes.targetRecallAtCount)} | ${decimal(conceptNet.selfPlay.fun)} | ${decimal(conceptNet.crossModel.correctCardsPerTurn)} | ${decimal(conceptNet.crossModel.wrongTeamHitsPerGame)} | ${percent(conceptNet.crossModel.assassinRate)} | 🧪 Ensemble |
| 🧩 Jina v5 small | 🟠 2.5 | Local | ${percent(jina.human.culturalCodes.targetRecallAtCount)} | ${decimal(jina.selfPlay.fun)} | ${decimal(jina.crossModel.correctCardsPerTurn)} | ${decimal(jina.crossModel.wrongTeamHitsPerGame)} | ${percent(jina.crossModel.assassinRate)} | ❌ Reject |
| 🔴 OpenAI large | 🔴 2 | $${result.priorOpenAiExperiment.cost.knownBilledCostUsd.toFixed(4)} | ${percent(openAi.human.culturalCodes.targetRecallAtCount)} | ${decimal(openAi.selfPlay.fun.score)} | ${decimal(openAi.crossModel.correctCardsPerTurn)} | ${decimal(openAi.crossModel.wrongTeamHitsPerGame)} | ${percent(openAi.crossModel.assassinRate)} | ❌ Reject |
| 🚫 Gemini 2 | 🔴 1 | $0 known | Not run | Not run | Not run | Not run | Not run | 🚫 Quota |

## 🎉 Objective

The 0-100 Fun Index balances ambitious clues, productive guesses, close finishes, and playable game length. Wrong-team hits, assassin losses, neutral hits, analyzer fallbacks, and human clue recovery remain separate promotion gates.

Human target recall replays a real human clue and its intended number of targets, ranks every target, neutral, and avoid word by embedding similarity, then measures how many intended targets appear in the top N. It is averaged across the recorded Cultural Codes turns.

The model sweep uses the same 20 deterministic boards, 10,000 clue candidates, hybrid scoring, five-point multi-clue tolerance, and passing at the declared clue number. Same-model scores measure the ceiling of a shared embedding space. MiniLM-L6 operative runs stress whether clues transfer beyond that space.

## 📈 Findings

- 🐉 Qwen raised same-model Fun from ${decimal(result.baseline.selfPlay.fun.score)} to ${decimal(qwenResult.selfPlay.fun)} and passed the human gate. Its cross-model wrong-team rate rose from ${decimal(result.baseline.crossModel.wrongTeamHitsPerGame)} to ${decimal(qwenResult.crossModel.wrongTeamHitsPerGame)}. Reducing multi-clue tolerance to zero lowered self Fun to ${decimal(qwenResult.toleranceZero.selfPlay.fun)} but still produced ${decimal(qwenResult.toleranceZero.crossModel.wrongTeamHitsPerGame)} cross-model wrong-team hits per game.
- 🌐 ConceptNet achieved ${percent(conceptNet.human.culturalCodes.targetRecallAtCount)} Cultural Codes target recall and ${percent(conceptNet.human.connector.exactTargetSetAccuracy)} exact Connector pairs, the best human results in this sweep. It covered ${percent(conceptNet.human.coverage.humanTurns.culturalCodes.rate)} of Cultural Codes turns, but its standalone Fun Index was only ${decimal(conceptNet.selfPlay.fun)}.
- 🧩 Jina passed the human gate only with the text-matching model's required \`Document:\` prefix. It remained too conservative in self-play and transferred poorly.
- 🚫 Gemini Embedding 2 passed the $0.10 preflight ceiling, but the existing project allows only 100 free-tier embedding inputs. Its async Batch API also rejected the project, so no comparable benchmark was produced and no known paid cost was incurred.

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
2. Generate local vectors with \`scripts/embed-local-candidate.py\`, or use the ConceptNet or Gemini provider script.
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

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function decimal(value) {
  return Number(value).toFixed(2);
}

function round(value, places = 4) {
  return Number(value.toFixed(places));
}
