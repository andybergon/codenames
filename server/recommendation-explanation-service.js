import {
  buildSemanticExplanationInput,
  semanticExplanationDeveloperPrompt,
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
      body: {
        code: "semantic_explanations_not_configured",
        error: "Semantic explanations are not configured.",
      },
    };
  }

  let recommendations;
  let language;
  try {
    language = validateLanguage(body?.language);
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
      language,
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
      body: {
        code: "semantic_explanations_temporarily_unavailable",
        error: "Semantic explanations are temporarily unavailable.",
      },
    };
  }
}

export async function generateSemanticExplanations(
  recommendations,
  { apiKey, fetchImpl = fetch, language = "en" },
) {
  const chunks = [];
  for (let index = 0; index < recommendations.length; index += REQUEST_CHUNK_SIZE) {
    chunks.push(recommendations.slice(index, index + REQUEST_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      requestSemanticExplanationChunk(chunk, {
        apiKey,
        fetchImpl,
        language,
      }),
    ),
  );
  return results.flat();
}

async function requestSemanticExplanationChunk(
  recommendations,
  { apiKey, fetchImpl, language },
) {
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
          content: semanticExplanationDeveloperPrompt(language),
        },
        {
          role: "user",
          content: buildSemanticExplanationInput(recommendations, language),
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
  return validateExplanations(parsed.explanations, recommendations, language);
}

function validateLanguage(value) {
  const language = value ?? "en";
  if (language !== "en" && language !== "it") {
    throw new Error("Language must be en or it.");
  }
  return language;
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

function validateExplanations(value, recommendations, language) {
  if (!Array.isArray(value) || value.length !== recommendations.length) {
    throw new Error("OpenAI returned the wrong number of explanations.");
  }

  const expectedIds = new Set(recommendations.map(({ id }) => id));
  const seenIds = new Set();
  const recommendationById = new Map(
    recommendations.map((recommendation) => [recommendation.id, recommendation]),
  );
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
    const recommendation = recommendationById.get(id);
    seenIds.add(id);
    return {
      id,
      explanation: explanationPreservesClue(normalized, recommendation)
        ? normalized
        : unsupportedClueExplanation(recommendation, language),
    };
  });

  if (seenIds.size !== expectedIds.size) {
    throw new Error("OpenAI omitted an explanation.");
  }
  return explanations;
}

function explanationPreservesClue(explanation, { clue, targets }) {
  if (!containsExactTerm(explanation, clue)) {
    return false;
  }

  if (!/^\p{L}+$/u.test(clue) || [...clue].length < 5) {
    return true;
  }

  const exactTerms = new Set(
    [clue, ...targets].map((term) => term.toLocaleLowerCase()),
  );
  const clueToken = clue.toLocaleLowerCase();
  return ![...explanation.matchAll(/[\p{L}]+/gu)].some(({ 0: token }) => {
    const normalizedToken = token.toLocaleLowerCase();
    return (
      !exactTerms.has(normalizedToken) &&
      isSingleEditNeighbor(clueToken, normalizedToken)
    );
  });
}

function containsExactTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu").test(text);
}

function isSingleEditNeighbor(left, right) {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  if (Math.abs(leftCharacters.length - rightCharacters.length) > 1) {
    return false;
  }

  if (leftCharacters.length === rightCharacters.length) {
    const differences = [];
    for (let index = 0; index < leftCharacters.length; index += 1) {
      if (leftCharacters[index] !== rightCharacters[index]) {
        differences.push(index);
      }
      if (differences.length > 2) {
        return false;
      }
    }
    if (differences.length === 1) {
      return true;
    }
    return (
      differences.length === 2 &&
      differences[1] === differences[0] + 1 &&
      leftCharacters[differences[0]] === rightCharacters[differences[1]] &&
      leftCharacters[differences[1]] === rightCharacters[differences[0]]
    );
  }

  const [shorter, longer] =
    leftCharacters.length < rightCharacters.length
      ? [leftCharacters, rightCharacters]
      : [rightCharacters, leftCharacters];
  let shorterIndex = 0;
  let longerIndex = 0;
  let skipped = false;
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1;
      longerIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longerIndex += 1;
    }
  }
  return true;
}

function unsupportedClueExplanation({ clue, targets }, language) {
  if (language === "it") {
    return `Non è stata trovata una spiegazione affidabile per l'indizio esatto ${clue} con ${formatTermList(targets, "it")}.`;
  }
  return `No reliable explanation was found for the exact clue ${clue} with ${formatTermList(targets, "en")}.`;
}

function formatTermList(terms, language) {
  if (terms.length === 1) {
    return terms[0];
  }
  const conjunction = language === "it" ? "e" : "and";
  if (terms.length === 2) {
    return `${terms[0]} ${conjunction} ${terms[1]}`;
  }
  return `${terms.slice(0, -1).join(", ")}, ${conjunction} ${terms.at(-1)}`;
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
