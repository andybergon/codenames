import {
  buildSemanticExplanationInput,
  SEMANTIC_EXPLANATION_DEVELOPER_PROMPT,
  semanticExplanationSchema,
} from "./recommendation-explanation-prompt.js";

export const SEMANTIC_EXPLANATION_MODEL = "gpt-5.4-nano";
export const SEMANTIC_EXPLANATION_REASONING = "none";
const MAX_RECOMMENDATIONS = 15;
const MAX_WORD_LENGTH = 40;
const REQUEST_CHUNK_SIZE = 5;

export async function handleRecommendationExplanationRequest({
  method,
  body,
  apiKey,
  fetchImpl = fetch,
}) {
  if (method !== "POST") {
    return {
      status: 405,
      headers: { Allow: "POST" },
      body: { error: "Method not allowed." },
    };
  }

  if (!apiKey) {
    return {
      status: 503,
      body: { error: "Semantic explanations are not configured." },
    };
  }

  let recommendations;
  try {
    recommendations = validateRecommendations(body?.recommendations);
  } catch (error) {
    return {
      status: 400,
      body: { error: error.message },
    };
  }

  try {
    const explanations = await generateSemanticExplanations(recommendations, {
      apiKey,
      fetchImpl,
    });
    return {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
      body: {
        model: SEMANTIC_EXPLANATION_MODEL,
        explanations,
      },
    };
  } catch {
    return {
      status: 502,
      body: { error: "Semantic explanations are temporarily unavailable." },
    };
  }
}

export async function generateSemanticExplanations(
  recommendations,
  { apiKey, fetchImpl = fetch },
) {
  const chunks = [];
  for (let index = 0; index < recommendations.length; index += REQUEST_CHUNK_SIZE) {
    chunks.push(recommendations.slice(index, index + REQUEST_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) => requestSemanticExplanationChunk(chunk, { apiKey, fetchImpl })),
  );
  return results.flat();
}

async function requestSemanticExplanationChunk(recommendations, { apiKey, fetchImpl }) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SEMANTIC_EXPLANATION_MODEL,
      input: [
        {
          role: "developer",
          content: SEMANTIC_EXPLANATION_DEVELOPER_PROMPT,
        },
        {
          role: "user",
          content: buildSemanticExplanationInput(recommendations),
        },
      ],
      reasoning: { effort: SEMANTIC_EXPLANATION_REASONING },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "codenames_semantic_explanations",
          strict: true,
          schema: semanticExplanationSchema(recommendations.length),
        },
      },
      max_output_tokens: Math.min(1_400, 160 + recommendations.length * 90),
      store: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed with status ${response.status}.`);
  }

  const outputText = payload.output
    ?.flatMap(({ content = [] }) => content)
    .find(({ type }) => type === "output_text")?.text;
  if (!outputText) {
    throw new Error("OpenAI returned no structured output.");
  }

  const parsed = JSON.parse(outputText);
  return validateExplanations(parsed.explanations, recommendations);
}

export function validateRecommendations(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RECOMMENDATIONS) {
    throw new Error(`Provide between 1 and ${MAX_RECOMMENDATIONS} recommendations.`);
  }

  const ids = new Set();
  return value.map((recommendation) => {
    const id = validateIdentifier(recommendation?.id);
    if (ids.has(id)) {
      throw new Error("Recommendation IDs must be unique.");
    }
    ids.add(id);

    const clue = validateWord(recommendation?.clue, "clue");
    if (
      !Array.isArray(recommendation?.targets) ||
      recommendation.targets.length < 1 ||
      recommendation.targets.length > 9
    ) {
      throw new Error("Each recommendation needs between 1 and 9 targets.");
    }
    const targets = recommendation.targets.map((target) => validateWord(target, "target"));
    if (new Set(targets).size !== targets.length) {
      throw new Error("Targets must be unique within a recommendation.");
    }

    return { id, clue, targets };
  });
}

function validateExplanations(value, recommendations) {
  if (!Array.isArray(value) || value.length !== recommendations.length) {
    throw new Error("OpenAI returned the wrong number of explanations.");
  }

  const expectedIds = new Set(recommendations.map(({ id }) => id));
  const seenIds = new Set();
  const explanations = value.map(({ id, explanation }) => {
    if (!expectedIds.has(id) || seenIds.has(id)) {
      throw new Error("OpenAI returned an unexpected explanation ID.");
    }
    const normalized = String(explanation ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length < 20 || normalized.length > 320) {
      throw new Error("OpenAI returned an invalid explanation.");
    }
    seenIds.add(id);
    return { id, explanation: normalized };
  });

  if (seenIds.size !== expectedIds.size) {
    throw new Error("OpenAI omitted an explanation.");
  }
  return explanations;
}

function validateIdentifier(value) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Recommendation IDs must be 1 to 64 simple characters.");
  }
  return id;
}

function validateWord(value, label) {
  const word = String(value ?? "").trim();
  if (
    word.length < 1 ||
    word.length > MAX_WORD_LENGTH ||
    !/^[\p{L}][\p{L}' -]*$/u.test(word)
  ) {
    throw new Error(`Each ${label} must be a short word or phrase.`);
  }
  return word;
}
