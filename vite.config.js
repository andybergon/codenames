import { defineConfig, loadEnv } from "vite";
import { handleRecommendationExplanationRequest } from "./server/recommendation-explanation-service.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [semanticExplanationApi(env.OPENAI_API_KEY)],
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

async function readJsonBody(request, response) {
  if (request.method !== "POST") {
    return {};
  }

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 8_192) {
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
