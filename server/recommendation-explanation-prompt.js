export const SEMANTIC_EXPLANATION_PROMPT_VERSION = 4;

export const SEMANTIC_EXPLANATION_DEVELOPER_PROMPT = `You explain why Codenames target words fit a proposed clue.

Goal:
- Write one natural sentence for each recommendation.
- Begin with "These words connect through [short shared concept]:".
- After the colon, give every target its own short clause explaining the relationship.

Constraints:
- Use common, broadly accepted meanings only.
- Mention every target exactly once.
- Do not group multiple targets into one clause, even when their relationships are similar.
- Write clue and target words in ordinary sentence case.
- Do not mention scores, embeddings, safety, danger words, guessing, or strategy.
- Do not invent a relationship when the connection is weak. State the weaker association plainly.
- Keep each explanation between 12 and 36 words.
- Return only schema-valid JSON.`;

export function buildSemanticExplanationInput(recommendations) {
  return JSON.stringify({
    recommendations: recommendations.map(({ id, clue, targets }) => ({
      id,
      clue: clue.toLocaleLowerCase("en"),
      targets: targets.map((target) => target.toLocaleLowerCase("en")),
    })),
  });
}

export function semanticExplanationSchema(count) {
  return {
    type: "object",
    properties: {
      explanations: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["id", "explanation"],
          additionalProperties: false,
        },
      },
    },
    required: ["explanations"],
    additionalProperties: false,
  };
}
