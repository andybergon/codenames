import { handleCalibrationSyncRequest } from "../server/calibration-sync-service.js";

const MAX_BODY_BYTES = 8_192;

export default async function calibration(request, response) {
  const body = await readJsonBody(request, response);
  if (body === null) return;

  const result = await handleCalibrationSyncRequest({
    method: request.method,
    body,
    headers: request.headers,
    databaseUrl: process.env.DATABASE_URL,
    syncSecret: process.env.CALIBRATION_SYNC_SECRET,
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
  if (!["POST", "PUT", "DELETE"].includes(request.method)) {
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
      response.statusCode = 413;
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "Request body is too large." }));
      return null;
    }
  }
  try {
    const raw = Buffer.concat(chunks, byteLength).toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    response.statusCode = 400;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Request body must be valid JSON." }));
    return null;
  }
}
