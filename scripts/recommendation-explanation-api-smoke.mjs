import assert from "node:assert/strict";
import {
  handleRecommendationExplanationRequest,
  SEMANTIC_EXPLANATION_MODEL,
  SEMANTIC_EXPLANATION_REASONING,
  validateRecommendations,
} from "../server/recommendation-explanation-service.js";

const recommendations = [
  {
    id: "medical-3",
    clue: "MEDICAL",
    targets: ["DOCTOR", "HOSPITAL", "NURSE"],
  },
];

assert.deepEqual(validateRecommendations(recommendations), recommendations);
assert.throws(
  () =>
    validateRecommendations([
      ...recommendations,
      { ...recommendations[0] },
    ]),
  /unique/,
);

const missingKey = await handleRecommendationExplanationRequest({
  method: "POST",
  body: { recommendations },
});
assert.equal(missingKey.status, 503);

let requestBody;
const success = await handleRecommendationExplanationRequest({
  method: "POST",
  body: { recommendations },
  apiKey: "test-key",
  fetchImpl: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                explanations: [
                  {
                    id: "medical-3",
                    explanation:
                      "These words connect through healthcare: doctor treats patients, hospital provides medical care, and nurse supports patients during treatment.",
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
  },
});

assert.equal(success.status, 200);
assert.equal(success.body.model, SEMANTIC_EXPLANATION_MODEL);
assert.equal(requestBody.model, "gpt-5.4-nano");
assert.deepEqual(requestBody.reasoning, { effort: SEMANTIC_EXPLANATION_REASONING });
assert.equal(requestBody.store, false);
assert.match(requestBody.input[0].content, /shared concept/);
assert.match(success.body.explanations[0].explanation, /^These words connect through/);

let chunkCalls = 0;
const chunkedRecommendations = Array.from({ length: 6 }, (_value, index) => ({
  id: `case-${index + 1}`,
  clue: "MEDICAL",
  targets: ["DOCTOR", "HOSPITAL"],
}));
const chunked = await handleRecommendationExplanationRequest({
  method: "POST",
  body: { recommendations: chunkedRecommendations },
  apiKey: "test-key",
  fetchImpl: async (_url, init) => {
    chunkCalls += 1;
    const chunk = JSON.parse(JSON.parse(init.body).input[1].content).recommendations;
    return Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                explanations: chunk.map(({ id }) => ({
                  id,
                  explanation:
                    "These words connect through healthcare: doctor treats patients, and hospital provides organized medical care.",
                })),
              }),
            },
          ],
        },
      ],
    });
  },
});
assert.equal(chunked.status, 200);
assert.equal(chunkCalls, 2);
assert.equal(chunked.body.explanations.length, 6);

console.log("Recommendation explanation API smoke passed.");
