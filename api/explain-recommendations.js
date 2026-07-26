import { handleRecommendationExplanationRequest } from "../server/recommendation-explanation-service.js";

const MAX_BODY_BYTES = 8_192;

export default async function explainRecommendations(request, response) {
  const body = await readJsonBody(request, response);
  if (body === null) {
    return;
  }

  const result = await handleRecommendationExplanationRequest({
    method: request.method,
    body,
    apiKey: process.env.OPENAI_API_KEY,
  });
  response.statusCode = result.status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(result.body));
}

async function readJsonBody(request, response) {
  if (request.method !== "POST") {
    return {};
  }
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      response.statusCode = 413;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "Request body is too large." }));
      return null;
    }
  }

  try {
    return JSON.parse(raw || "{}");
  } catch {
    response.statusCode = 400;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Request body must be valid JSON." }));
    return null;
  }
}
