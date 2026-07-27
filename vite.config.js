import { defineConfig, loadEnv } from "vite";
import {
  handleCalibrationSyncRequest,
  isLoopbackAddress,
} from "./server/calibration-sync-service.js";
import { handlePlayAnalyticsRequest } from "./server/play-analytics-service.js";
import { handleRecommendationExplanationRequest } from "./server/recommendation-explanation-service.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      semanticExplanationApi(env.OPENAI_API_KEY),
      calibrationSyncApi({
        databaseUrl: env.DATABASE_URL,
        syncSecret: env.CALIBRATION_SYNC_SECRET,
      }),
      playAnalyticsApi({
        databaseUrl: env.DATABASE_URL,
        reviewSecret:
          env.ANALYTICS_REVIEW_SECRET ||
          env.CALIBRATION_SYNC_SECRET,
      }),
    ],
  };
});

function semanticExplanationApi(apiKey) {
  return {
    name: "codenames-semantic-explanation-api",
    configureServer(server) {
      server.middlewares.use("/api/explain-recommendations", async (request, response) => {
        const body = await readJsonBody(request, response);
        if (body === null) {
          return;
        }
        const result = await handleRecommendationExplanationRequest({
          method: request.method,
          body,
          apiKey,
        });
        response.statusCode = result.status;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        for (const [name, value] of Object.entries(result.headers ?? {})) {
          response.setHeader(name, value);
        }
        response.end(JSON.stringify(result.body));
      });
    },
  };
}

function calibrationSyncApi({ databaseUrl, syncSecret }) {
  return {
    name: "codenames-calibration-sync-api",
    configureServer(server) {
      server.middlewares.use("/api/calibration", async (request, response) => {
        const body = await readJsonBody(request, response, [
          "POST",
          "PUT",
          "DELETE",
        ]);
        if (body === null) {
          return;
        }
        const result = await handleCalibrationSyncRequest({
          method: request.method,
          body,
          headers: request.headers,
          databaseUrl,
          syncSecret,
          secureCookie: false,
          trustLocalClient: isLoopbackAddress(
            request.socket?.remoteAddress,
          ),
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
      });
    },
  };
}

function playAnalyticsApi({ databaseUrl, reviewSecret }) {
  return {
    name: "codenames-play-analytics-api",
    configureServer(server) {
      server.middlewares.use(
        "/api/play-analytics",
        async (request, response) => {
          const body = await readJsonBody(
            request,
            response,
            ["POST", "PATCH"],
            24_576,
          );
          if (body === null) return;
          const result = await handlePlayAnalyticsRequest({
            method: request.method,
            body,
            headers: request.headers,
            url: request.url,
            databaseUrl,
            reviewSecret,
            secureCookie: false,
            trustLocalClient: isLoopbackAddress(
              request.socket?.remoteAddress,
            ),
          });
          response.statusCode = result.status;
          for (const [name, value] of Object.entries(result.headers ?? {})) {
            response.setHeader(name, value);
          }
          if (result.body === null) {
            response.end();
            return;
          }
          response.setHeader(
            "Content-Type",
            "application/json; charset=utf-8",
          );
          response.end(JSON.stringify(result.body));
        },
      );
    },
  };
}

async function readJsonBody(
  request,
  response,
  methods = ["POST"],
  maxBodyBytes = 8_192,
) {
  if (!methods.includes(request.method)) {
    return {};
  }

  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    byteLength += buffer.byteLength;
    if (byteLength > maxBodyBytes) {
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
