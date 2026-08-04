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
assert.equal(missingKey.body.code, "semantic_explanations_not_configured");

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
assert.match(requestBody.input[0].content, /immutable game token/);
assert.match(success.body.explanations[0].explanation, /^These words connect through/);

const sumnerRecommendation = [
  {
    id: "sumner-2",
    clue: "SUMNER",
    targets: ["STRAW", "ROSE"],
  },
];
let sumnerRequestBody;
const substitutedClue = await handleRecommendationExplanationRequest({
  method: "POST",
  body: { recommendations: sumnerRecommendation },
  apiKey: "test-key",
  fetchImpl: async (_url, init) => {
    sumnerRequestBody = JSON.parse(init.body);
    return Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                explanations: [
                  {
                    id: "sumner-2",
                    explanation:
                      "These words connect through season and flowers: STRAW is an element of summer farm life, and ROSE is a common summer-blooming flower.",
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
assert.equal(substitutedClue.status, 200);
assert.match(sumnerRequestBody.input[1].content, /"clue":"sumner"/);
assert.equal(
  substitutedClue.body.explanations[0].explanation,
  "No reliable explanation was found for the exact clue SUMNER with STRAW and ROSE.",
);

const exactSumnerWithNearNeighbor = await handleRecommendationExplanationRequest({
  method: "POST",
  body: { recommendations: sumnerRecommendation },
  apiKey: "test-key",
  fetchImpl: async () =>
    Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                explanations: [
                  {
                    id: "sumner-2",
                    explanation:
                      "These words connect through Sumner: STRAW suggests summer farm life, and ROSE is a summer-blooming flower.",
                  },
                ],
              }),
            },
          ],
        },
      ],
    }),
});
assert.equal(
  exactSumnerWithNearNeighbor.body.explanations[0].explanation,
  "No reliable explanation was found for the exact clue SUMNER with STRAW and ROSE.",
);

const exactSummer = await handleRecommendationExplanationRequest({
  method: "POST",
  body: {
    recommendations: [{ ...sumnerRecommendation[0], clue: "SUMMER" }],
  },
  apiKey: "test-key",
  fetchImpl: async () =>
    Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                explanations: [
                  {
                    id: "sumner-2",
                    explanation:
                      "These words connect through summer: STRAW appears in summer farm life, and ROSE is a common summer-blooming flower.",
                  },
                ],
              }),
            },
          ],
        },
      ],
    }),
});
assert.equal(exactSummer.status, 200);
assert.match(exactSummer.body.explanations[0].explanation, /through summer:/i);

let italianRequestBody;
const italian = await handleRecommendationExplanationRequest({
  method: "POST",
  body: {
    language: "it",
    recommendations: [
      {
        id: "medico-2",
        clue: "CURA",
        targets: ["MEDICO", "OSPEDALE"],
      },
    ],
  },
  apiKey: "test-key",
  fetchImpl: async (_url, init) => {
    italianRequestBody = JSON.parse(init.body);
    return Response.json({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                explanations: [
                  {
                    id: "medico-2",
                    explanation:
                      "Queste parole si collegano tramite la salute: il medico cura le persone, mentre l'ospedale organizza l'assistenza sanitaria.",
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
assert.equal(italian.status, 200);
assert.match(italianRequestBody.input[0].content, /Queste parole/);
assert.match(italianRequestBody.input[1].content, /"clue":"cura"/);
assert.match(
  italian.body.explanations[0].explanation,
  /^Queste parole si collegano tramite/,
);
assert.equal(
  (
    await handleRecommendationExplanationRequest({
      method: "POST",
      body: { language: "fr", recommendations },
      apiKey: "test-key",
    })
  ).status,
  400,
);

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
