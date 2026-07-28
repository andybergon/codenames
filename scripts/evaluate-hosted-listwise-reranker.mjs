import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conceptShardForTerm } from "../src/play/concept-shards.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIRECTORY = resolve(
  ROOT,
  ".cache/hosted-listwise-reranker",
);
const REPORT_PATH = resolve(
  ROOT,
  "docs/evaluations/operative-ranking/hosted-listwise-reranker-evaluation.json",
);
const MODEL = {
  id: "gpt-5.4-nano-2026-03-17",
  inputUsdPerMillion: 0.2,
  outputUsdPerMillion: 1.25,
};
const MAX_OUTPUT_TOKENS = 800;
const FIXTURES = [
  {
    id: "joust",
    clue: "joust",
    targets: ["match", "crown", "glove", "belt"],
    candidates: ["match", "crown", "glove", "belt", "piano"],
  },
  {
    id: "paleography",
    clue: "paleography",
    targets: ["paper", "journal"],
    candidates: ["paper", "journal", "teeth", "vinyl", "shakespeare"],
  },
  {
    id: "heraldry",
    clue: "heraldry",
    targets: ["crown", "eagle"],
    candidates: ["crown", "eagle", "weapon", "sorcerer", "siege"],
  },
  {
    id: "specter",
    clue: "specter",
    targets: ["ghost", "shadow"],
    candidates: ["ghost", "shadow", "genius", "mirror", "radar"],
  },
  {
    id: "thespian",
    clue: "thespian",
    targets: ["play", "actor"],
    candidates: ["play", "actor", "agent", "surgeon", "alien"],
  },
  {
    id: "seance",
    clue: "seance",
    targets: ["ghost", "spirit"],
    candidates: ["ghost", "spirit", "scorpion", "oasis", "undertaker"],
  },
];

const options = parseOptions(process.argv.slice(2));
const definitions = await loadConceptDefinitions();
const prompts = {
  direct: buildPrompt(false),
  wordnet: buildPrompt(true),
};
const projectedMaxCostUsd = Object.values(prompts).reduce(
  (total, prompt) =>
    total +
    requestCost({
      inputTokens: Math.ceil(prompt.length / 3),
      outputTokens: MAX_OUTPUT_TOKENS,
    }),
  0,
);

console.log(
  `Hosted listwise preflight: ${FIXTURES.length} public fixtures, 2 requests, ` +
    `at most $${projectedMaxCostUsd.toFixed(4)} projected cost.`,
);
if (projectedMaxCostUsd > options.maxCostUsd) {
  throw new Error(
    `Projected cost $${projectedMaxCostUsd.toFixed(4)} exceeds the $${options.maxCostUsd.toFixed(4)} cap.`,
  );
}
if (options.preflightOnly) process.exit(0);
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required after preflight.");
}

await mkdir(CACHE_DIRECTORY, { recursive: true });
const results = {};
const usage = {};
let billedCostUsd = 0;
for (const [mode, prompt] of Object.entries(prompts)) {
  const response = await cachedRanking(mode, prompt);
  results[mode] = validateRankings(response.rankings);
  usage[mode] = response.usage;
  billedCostUsd += requestCost(response.usage);
  if (billedCostUsd > options.maxCostUsd) {
    throw new Error(
      `Measured cost $${billedCostUsd.toFixed(4)} exceeded the $${options.maxCostUsd.toFixed(4)} cap.`,
    );
  }
}

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  methodology: {
    model: MODEL.id,
    fixtureCount: FIXTURES.length,
    modes: ["direct public clue-card list", "WordNet-expanded public clue-card list"],
    prompt:
      "Rank each public card list by human Codenames association, including indirect thematic, cultural, functional, and wordplay relationships.",
    automaticRuntimeEligible: false,
    reason:
      "Hosted listwise inference is comparison-only because Play must remain offline, local-first, bounded, and free per turn.",
    pricingCheckedAt: "2026-07-28",
  },
  cost: {
    capUsd: options.maxCostUsd,
    projectedMaxCostUsd: round(projectedMaxCostUsd),
    billedCostUsd: round(billedCostUsd),
    usage,
  },
  fixtures: FIXTURES.map((fixture) => {
    const modes = Object.fromEntries(
      Object.entries(results).map(([mode, rankings]) => {
        const ranking = rankings.find(({ id }) => id === fixture.id);
        const top = ranking.orderedCandidates.slice(
          0,
          fixture.targets.length,
        );
        return [
          mode,
          {
            ranking: ranking.orderedCandidates.map((word) =>
              word.toUpperCase(),
            ),
            targetHits: intersectionSize(top, fixture.targets),
          },
        ];
      }),
    );
    return {
      id: fixture.id,
      clue: fixture.clue.toUpperCase(),
      targets: fixture.targets.map((word) => word.toUpperCase()),
      ...modes,
    };
  }),
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Wrote ${REPORT_PATH} at $${billedCostUsd.toFixed(4)} measured cost.`,
);

function buildPrompt(includeWordNet) {
  return JSON.stringify({
    task:
      "For each independent Codenames fixture, rank every candidate card from strongest to weakest association with the public clue.",
    rules: [
      "Act as a human operative who sees only the public clue and public candidate card words.",
      "Indirect thematic, cultural, functional, and wordplay relationships count.",
      "Do not infer hidden roles or intended targets.",
      "Return every candidate exactly once.",
    ],
    evidence: includeWordNet
      ? "Each term includes local Princeton WordNet definitions as optional public bridge evidence."
      : "Use only the direct clue and card words.",
    fixtures: FIXTURES.map((fixture) => ({
      id: fixture.id,
      clue: includeWordNet
        ? expand(fixture.clue)
        : fixture.clue,
      candidates: fixture.candidates.map((word) =>
        includeWordNet ? expand(word) : word,
      ),
    })),
  });
}

async function cachedRanking(mode, prompt) {
  const key = createHash("sha256")
    .update(JSON.stringify({ mode, model: MODEL.id, prompt }))
    .digest("hex")
    .slice(0, 20);
  const path = resolve(CACHE_DIRECTORY, `${mode}-${key}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {}

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL.id,
      reasoning: { effort: "none" },
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text:
                "Return only the requested structured ranking. Treat each fixture independently.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: {
        format: {
          type: "json_schema",
          name: "codenames_listwise_rankings",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["rankings"],
            properties: {
              rankings: {
                type: "array",
                minItems: FIXTURES.length,
                maxItems: FIXTURES.length,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "orderedCandidates"],
                  properties: {
                    id: {
                      type: "string",
                      enum: FIXTURES.map(({ id }) => id),
                    },
                    orderedCandidates: {
                      type: "array",
                      minItems: 5,
                      maxItems: 5,
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `OpenAI request failed with ${response.status}.`,
    );
  }
  const text = payload.output
    ?.flatMap(({ content = [] }) => content)
    .find(({ type }) => type === "output_text")?.text;
  if (!text) throw new Error("Hosted reranker returned no structured output.");
  const result = {
    rankings: JSON.parse(text).rankings,
    usage: {
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    },
  };
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function validateRankings(rankings) {
  if (!Array.isArray(rankings) || rankings.length !== FIXTURES.length) {
    throw new Error("Hosted reranker returned the wrong fixture count.");
  }
  return FIXTURES.map((fixture) => {
    const ranking = rankings.find(({ id }) => id === fixture.id);
    const normalized = ranking?.orderedCandidates.map((word) =>
      normalizeCandidate(word),
    );
    if (
      !normalized ||
      new Set(normalized).size !== fixture.candidates.length ||
      fixture.candidates.some((word) => !normalized.includes(word))
    ) {
      throw new Error(`Invalid candidate permutation for ${fixture.id}.`);
    }
    return { id: fixture.id, orderedCandidates: normalized };
  });
}

function normalizeCandidate(value) {
  return String(value)
    .toLowerCase()
    .split(":")[0]
    .trim();
}

function requestCost({ inputTokens, outputTokens }) {
  return (
    (inputTokens / 1_000_000) * MODEL.inputUsdPerMillion +
    (outputTokens / 1_000_000) * MODEL.outputUsdPerMillion
  );
}

function expand(term) {
  const values = definitions.get(term) ?? [];
  return values.length > 0
    ? `${term}: ${values.join("; ")}`
    : term;
}

async function loadConceptDefinitions() {
  const directory = resolve(ROOT, "public/data/concepts");
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  );
  const board = JSON.parse(
    await readFile(resolve(directory, manifest.boardFile), "utf8"),
  ).entries;
  const clueTerms = [...new Set(FIXTURES.map(({ clue }) => clue))];
  const shards = await Promise.all(
    [...new Set(clueTerms.map(conceptShardForTerm))].map(async (id) =>
      JSON.parse(
        await readFile(
          resolve(directory, manifest.shards[id].file),
          "utf8",
        ),
      ),
    ),
  );
  return new Map([
    ...Object.entries(board),
    ...shards.flatMap(({ entries }) => Object.entries(entries)),
  ]);
}

function intersectionSize(left, right) {
  const values = new Set(right);
  return left.filter((value) => values.has(value)).length;
}

function round(value) {
  return Number(value.toFixed(6));
}

function parseOptions(args) {
  const values = { maxCostUsd: null, preflightOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--max-cost-usd") {
      values.maxCostUsd = Number(value);
      index += 1;
    } else if (option === "--preflight-only") {
      values.preflightOnly = true;
    } else {
      throw new Error(`Unknown option ${option}.`);
    }
  }
  if (!Number.isFinite(values.maxCostUsd) || values.maxCostUsd <= 0) {
    throw new Error("--max-cost-usd must be a positive number.");
  }
  return values;
}
