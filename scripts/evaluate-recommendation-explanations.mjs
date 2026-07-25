import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSemanticExplanationInput,
  SEMANTIC_EXPLANATION_DEVELOPER_PROMPT,
  SEMANTIC_EXPLANATION_PROMPT_VERSION,
  semanticExplanationSchema,
} from "../server/recommendation-explanation-prompt.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CACHE_DIRECTORY = resolve(ROOT, ".cache/recommendation-explanation-eval");
const REPORT_PATH = resolve(
  ROOT,
  "scripts/generated/recommendation-explanation-evaluation.json",
);
const DEFAULT_MAX_COST_USD = 0.08;
const MIN_PRODUCTION_SCORE = 4.8;
const CASES = Object.freeze([
  { id: "medical-3", clue: "MEDICAL", targets: ["DOCTOR", "HOSPITAL", "NURSE"] },
  { id: "royal-3", clue: "ROYAL", targets: ["KING", "QUEEN", "CROWN"] },
  { id: "flight-3", clue: "FLIGHT", targets: ["PILOT", "PLANE", "AIR"] },
  { id: "space-3", clue: "SPACE", targets: ["MOON", "SATELLITE", "STAR"] },
  { id: "winter-3", clue: "WINTER", targets: ["SNOW", "ICE", "GLOVE"] },
  { id: "sailing-3", clue: "SAILING", targets: ["SHIP", "ANCHOR", "PORT"] },
  { id: "footwear-2", clue: "FOOTWEAR", targets: ["BOOT", "SHOE"] },
  { id: "cooking-3", clue: "COOKING", targets: ["COOK", "PAN", "FIRE"] },
]);
const CANDIDATES = Object.freeze([
  {
    id: "gpt-5-nano",
    inputUsdPerMillion: 0.05,
    outputUsdPerMillion: 0.4,
    reasoningEffort: "minimal",
  },
  {
    id: "gpt-5.4-nano",
    inputUsdPerMillion: 0.2,
    outputUsdPerMillion: 1.25,
    reasoningEffort: "none",
  },
  {
    id: "gpt-5.6-luna",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 6,
    reasoningEffort: "none",
  },
]);
const JUDGE = Object.freeze({
  id: "gpt-5.6-sol",
  inputUsdPerMillion: 5,
  outputUsdPerMillion: 30,
  reasoningEffort: "none",
});
const options = parseOptions(process.argv.slice(2));
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && !options.preflightOnly) {
  throw new Error("OPENAI_API_KEY is required unless --preflight-only is used.");
}

const cases = CASES;
const candidatePrompt = buildSemanticExplanationInput(cases);
const candidateMaxOutputTokens = 800;
const projectedCandidateCost = CANDIDATES.reduce(
  (total, model) =>
    total +
    projectedRequestCost(model, candidatePrompt, candidateMaxOutputTokens),
  0,
);
const projectedJudgeInput = buildJudgePrompt(
  cases,
  Object.fromEntries(
    CANDIDATES.map(({ id }) => [
      id,
      Object.fromEntries(cases.map(({ id: caseId }) => [caseId, "Placeholder explanation."])),
    ]),
  ),
);
const judgeMaxOutputTokens = 1_400;
const projectedJudgeCost = projectedRequestCost(
  JUDGE,
  projectedJudgeInput,
  judgeMaxOutputTokens,
);
const projectedCost = projectedCandidateCost + projectedJudgeCost;

console.log(
  `Explanation eval preflight: ${cases.length} cases, ${CANDIDATES.length} candidate models, ` +
    `${JUDGE.id} judge, at most $${projectedCost.toFixed(4)} projected cost.`,
);
if (projectedCost > options.maxCostUsd) {
  throw new Error(
    `Projected cost $${projectedCost.toFixed(4)} exceeds the $${options.maxCostUsd.toFixed(2)} cap.`,
  );
}
if (options.preflightOnly) {
  process.exit(0);
}

await mkdir(CACHE_DIRECTORY, { recursive: true });
let billedCostUsd = 0;
const modelOutputs = {};
const usage = {};

for (const model of CANDIDATES) {
  const result = await cachedModelExplanations(model, cases, candidatePrompt);
  modelOutputs[model.id] = result.explanations;
  usage[model.id] = result.usage;
  billedCostUsd += requestCost(model, result.usage);
  enforceBilledCost();
}

const judgePrompt = buildJudgePrompt(cases, modelOutputs);
const judgeResult = await cachedJudgeEvaluation(judgePrompt);
usage[JUDGE.id] = judgeResult.usage;
billedCostUsd += requestCost(JUDGE, judgeResult.usage);
enforceBilledCost();

const aggregate = aggregateRatings(judgeResult.evaluations);
const recommendation = recommendRuntime(aggregate);
const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  methodology: {
    caseCount: cases.length,
    candidateModels: CANDIDATES.map(({ id }) => id),
    judgeModel: JUDGE.id,
    judgeReasoningEffort: JUDGE.reasoningEffort,
    criteria: ["accuracy", "coverage", "specificity", "clarity", "concision"],
    scoreRange: [1, 5],
    selectionRule:
      "Choose the cheapest model with a mean semantic-explanation score of at least 4.8; fall back to the highest-scoring model if none qualify.",
    promptVersion: SEMANTIC_EXPLANATION_PROMPT_VERSION,
    pricingCheckedAt: "2026-07-26",
  },
  cost: {
    maxCostUsd: options.maxCostUsd,
    projectedMaxCostUsd: round(projectedCost, 6),
    billedCostUsd: round(billedCostUsd, 6),
    usage,
  },
  cases: cases.map(({ id, clue, targets }) => ({
    id,
    clue,
    targetWords: targets,
  })),
  aggregate,
  recommendation,
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Wrote ${REPORT_PATH}. Recommendation: ${recommendation.id} ` +
    `(${recommendation.meanScore.toFixed(2)}/5, $${billedCostUsd.toFixed(4)} eval cost).`,
);

async function cachedModelExplanations(model, casesToExplain, prompt) {
  const cacheKey = hashPayload({
    model: model.id,
    cases: casesToExplain,
    prompt,
    developerPrompt: SEMANTIC_EXPLANATION_DEVELOPER_PROMPT,
    promptVersion: SEMANTIC_EXPLANATION_PROMPT_VERSION,
  });
  const path = resolve(CACHE_DIRECTORY, `${model.id}-${cacheKey}.json`);
  const cached = await readJson(path);
  if (cached) return cached;

  const result = await requestStructuredJson({
    model,
    prompt,
    schemaName: "recommendation_explanations",
    schema: semanticExplanationSchema(casesToExplain.length),
    maxOutputTokens: candidateMaxOutputTokens,
  });
  const explanations = Object.fromEntries(
    result.value.explanations.map(({ id, explanation }) => [id, explanation]),
  );
  const payload = { explanations, usage: result.usage };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function buildJudgePrompt(casesToJudge, generatedOutputs) {
  return JSON.stringify({
    role: "Blindly judge semantic explanations for Codenames clue recommendations.",
    instructions: [
      "Score each candidate from 1 to 5 on accuracy, coverage, specificity, clarity, and concision.",
      "Accuracy requires broadly accepted relationships between the clue and targets.",
      "Coverage requires an explicit relationship for every target.",
      "Specificity rewards a shared concept followed by concrete target relationships.",
      "Penalize invented facts, vague restatements, raw scores, danger analysis, and strategy advice.",
      "Judge only the explanation text. Candidate labels are randomized and do not identify models.",
    ],
    cases: casesToJudge.map((testCase) => {
      const entries = CANDIDATES.map(({ id }) => [id, generatedOutputs[id][testCase.id]]);
      const randomized = deterministicShuffle(entries, testCase.id);
      return {
        input: testCase,
        candidates: randomized.map(([, text], index) => ({
          label: String.fromCharCode(65 + index),
          explanation: text,
        })),
        labelMap: Object.fromEntries(
          randomized.map(([id], index) => [String.fromCharCode(65 + index), id]),
        ),
      };
    }),
  });
}

async function cachedJudgeEvaluation(prompt) {
  const cacheKey = hashPayload({ model: JUDGE.id, prompt });
  const path = resolve(CACHE_DIRECTORY, `${JUDGE.id}-${cacheKey}.json`);
  const cached = await readJson(path);
  if (cached) return cached;

  const promptPayload = JSON.parse(prompt);
  const labelMaps = Object.fromEntries(
    promptPayload.cases.map(({ input, labelMap }) => [input.id, labelMap]),
  );
  const judgePrompt = JSON.stringify({
    ...promptPayload,
    cases: promptPayload.cases.map(({ labelMap: _labelMap, ...testCase }) => testCase),
  });
  const result = await requestStructuredJson({
    model: JUDGE,
    prompt: judgePrompt,
    schemaName: "recommendation_explanation_judgment",
    schema: {
      type: "object",
      properties: {
        evaluations: {
          type: "array",
          minItems: cases.length,
          maxItems: cases.length,
          items: {
            type: "object",
            properties: {
              caseId: { type: "string" },
              candidates: {
                type: "array",
                minItems: CANDIDATES.length,
                maxItems: CANDIDATES.length,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    accuracy: { type: "integer", minimum: 1, maximum: 5 },
                    coverage: { type: "integer", minimum: 1, maximum: 5 },
                    specificity: { type: "integer", minimum: 1, maximum: 5 },
                    clarity: { type: "integer", minimum: 1, maximum: 5 },
                    concision: { type: "integer", minimum: 1, maximum: 5 },
                  },
                  required: [
                    "label",
                    "accuracy",
                    "coverage",
                    "specificity",
                    "clarity",
                    "concision",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["caseId", "candidates"],
            additionalProperties: false,
          },
        },
      },
      required: ["evaluations"],
      additionalProperties: false,
    },
    maxOutputTokens: judgeMaxOutputTokens,
  });
  const evaluations = result.value.evaluations.map((evaluation) => ({
    caseId: evaluation.caseId,
    candidates: evaluation.candidates.map((candidate) => ({
      id: labelMaps[evaluation.caseId][candidate.label],
      ...candidate,
      label: undefined,
    })),
  }));
  const payload = { evaluations, usage: result.usage };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function requestStructuredJson({ model, prompt, schemaName, schema, maxOutputTokens }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      input: [
        {
          role: "developer",
          content:
            schemaName === "recommendation_explanations"
              ? SEMANTIC_EXPLANATION_DEVELOPER_PROMPT
              : "Follow the supplied evaluation contract exactly. Return only schema-valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      reasoning: { effort: model.reasoningEffort },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
      max_output_tokens: maxOutputTokens,
      store: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `${model.id} Responses API failed (${response.status}): ${JSON.stringify(payload).slice(0, 800)}`,
    );
  }
  const outputText = payload.output
    ?.flatMap(({ content = [] }) => content)
    .find(({ type }) => type === "output_text")?.text;
  if (!outputText) {
    throw new Error(`${model.id} returned no structured output text.`);
  }
  return {
    value: JSON.parse(outputText),
    usage: {
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    },
  };
}

function aggregateRatings(evaluations) {
  const totals = new Map(
    CANDIDATES.map(({ id }) => [
      id,
      { id, ratingTotal: 0, ratingCount: 0, caseWins: 0 },
    ]),
  );
  for (const evaluation of evaluations) {
    const rated = evaluation.candidates.map((candidate) => {
      const ratings = [
        candidate.accuracy,
        candidate.coverage,
        candidate.specificity,
        candidate.clarity,
        candidate.concision,
      ];
      const mean = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
      const total = totals.get(candidate.id);
      total.ratingTotal += ratings.reduce((sum, value) => sum + value, 0);
      total.ratingCount += ratings.length;
      return { id: candidate.id, mean };
    });
    const best = Math.max(...rated.map(({ mean }) => mean));
    for (const candidate of rated.filter(({ mean }) => mean === best)) {
      totals.get(candidate.id).caseWins += 1;
    }
  }

  return [...totals.values()]
    .map(({ id, ratingTotal, ratingCount, caseWins }) => ({
      id,
      meanScore: round(ratingTotal / ratingCount, 3),
      caseWins,
      estimatedUsdPerThousand: estimatedProductionCost(id),
    }))
    .sort((left, right) => right.meanScore - left.meanScore);
}

function recommendRuntime(aggregate) {
  const qualified = aggregate.filter(({ meanScore }) => meanScore >= MIN_PRODUCTION_SCORE);
  const selected = [...(qualified.length > 0 ? qualified : [aggregate[0]])].sort(
    (left, right) => left.estimatedUsdPerThousand - right.estimatedUsdPerThousand,
  )[0];
  return {
    ...selected,
    reason:
      qualified.length > 0
        ? `${selected.id} is the cheapest model scoring at least ${MIN_PRODUCTION_SCORE.toFixed(1)}.`
        : `${selected.id} is the highest-scoring model because no candidate met the production threshold.`,
  };
}

function estimatedProductionCost(id) {
  const model = CANDIDATES.find((candidate) => candidate.id === id);
  const inputTokensPerRequest = 600;
  const outputTokensPerRequest = 500;
  return round(
    1_000 *
      ((inputTokensPerRequest / 1_000_000) * model.inputUsdPerMillion +
        (outputTokensPerRequest / 1_000_000) * model.outputUsdPerMillion),
    4,
  );
}

function projectedRequestCost(model, prompt, maxOutputTokens) {
  return (
    (estimateTokens(prompt) / 1_000_000) * model.inputUsdPerMillion +
    (maxOutputTokens / 1_000_000) * model.outputUsdPerMillion
  );
}

function requestCost(model, requestUsage) {
  return (
    (requestUsage.inputTokens / 1_000_000) * model.inputUsdPerMillion +
    (requestUsage.outputTokens / 1_000_000) * model.outputUsdPerMillion
  );
}

function enforceBilledCost() {
  if (billedCostUsd > options.maxCostUsd) {
    throw new Error(
      `Billed cost guard exceeded at $${billedCostUsd.toFixed(4)} of $${options.maxCostUsd.toFixed(2)}.`,
    );
  }
}

function deterministicShuffle(entries, salt) {
  return [...entries].sort((left, right) =>
    hashPayload({ salt, id: left[0] }).localeCompare(hashPayload({ salt, id: right[0] })),
  );
}

function hashPayload(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function estimateTokens(value) {
  return Math.ceil(String(value).length / 4);
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseOptions(args) {
  const parsed = {
    maxCostUsd: DEFAULT_MAX_COST_USD,
    preflightOnly: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--max-cost-usd") {
      parsed.maxCostUsd = Number(args[index + 1]);
      index += 1;
    } else if (argument === "--preflight-only") {
      parsed.preflightOnly = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isFinite(parsed.maxCostUsd) || parsed.maxCostUsd <= 0) {
    throw new Error("--max-cost-usd must be a positive number.");
  }
  return parsed;
}
