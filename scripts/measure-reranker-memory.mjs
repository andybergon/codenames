import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
} from "@huggingface/transformers";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
const REVISION = "a09144355adeed5f58c8ed011d209bf8ee5a1fec";

env.cacheDir =
  process.env.HF_CACHE_DIR ?? resolve(ROOT, ".cache/huggingface");
env.allowRemoteModels = false;

globalThis.gc?.();
const before = process.memoryUsage();
const loadStartedAt = performance.now();
const [tokenizer, model] = await Promise.all([
  AutoTokenizer.from_pretrained(MODEL, { revision: REVISION }),
  AutoModelForSequenceClassification.from_pretrained(MODEL, {
    dtype: "q8",
    revision: REVISION,
  }),
]);
const cachedLoadLatencyMs = performance.now() - loadStartedAt;
globalThis.gc?.();
const loaded = process.memoryUsage();
const queries = Array(25).fill("joust");
const passages = Array.from(
  { length: 25 },
  (_value, index) => `candidate ${index}`,
);
const inputs = await tokenizer(queries, {
  text_pair: passages,
  padding: true,
  truncation: true,
});
const inferenceStartedAt = performance.now();
await model(inputs);
const firstInferenceLatencyMs =
  performance.now() - inferenceStartedAt;
globalThis.gc?.();
const inferred = process.memoryUsage();

console.log(
  JSON.stringify({
    cachedLoadLatencyMs: Number(cachedLoadLatencyMs.toFixed(4)),
    firstInferenceLatencyMs: Number(
      firstInferenceLatencyMs.toFixed(4),
    ),
    residentLoadDeltaBytes: Math.max(0, loaded.rss - before.rss),
    residentPeakDeltaBytes: Math.max(0, inferred.rss - before.rss),
  }),
);

if (typeof model.dispose === "function") {
  await model.dispose();
}
