import { handlePlayAnalyticsRequest } from "../server/play-analytics-service.js";

const MAX_BODY_BYTES = 24_576;

export default async function playAnalytics(request, response) {
  const body = await readJsonBody(request, response);
  if (body === null) return;

  const result = await handlePlayAnalyticsRequest({
    method: request.method,
    body,
    headers: request.headers,
    url: request.url,
    databaseUrl: process.env.DATABASE_URL,
    reviewSecret:
      process.env.ANALYTICS_REVIEW_SECRET ||
      process.env.CALIBRATION_SYNC_SECRET,
  });
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  if (result.body === null) {
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(result.body));
}

async function readJsonBody(request, response) {
  if (!["POST", "PATCH"].includes(request.method)) {
    return {};
  }
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      sendBodyError(response, 413, "Request body is too large.");
      return null;
    }
  }
  try {
    const raw = Buffer.concat(chunks, byteLength).toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    sendBodyError(response, 400, "Request body must be valid JSON.");
    return null;
  }
}

function sendBodyError(response, status, error) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error }));
}
