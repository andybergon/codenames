import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_WORDS_PATH = resolve(ROOT, "scripts/italian/extended-words.txt");
const GENERATED_WORDS_PATH = resolve(ROOT, "src/generated/italian-word-data.js");
const CACHE_DIR = resolve(ROOT, ".cache/italian");
const ARCHIVE_NAME = "ita_news_2024_100K.tar.gz";
const ARCHIVE_PATH = resolve(CACHE_DIR, ARCHIVE_NAME);
const ARCHIVE_URL = `https://downloads.wortschatz-leipzig.de/corpora/${ARCHIVE_NAME}`;
const ARCHIVE_SHA256 =
  "669acde110a865bbdcd974ccff6838461ed3aff9106a9a743bde22153e6b7a6c";
const ARCHIVE_WORDS_PATH =
  "ita_news_2024_100K/ita_news_2024_100K-words.txt";
const MODEL_ID = "Xenova/multilingual-e5-small";
const MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const MODEL_SHA256 =
  "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193";
const MODEL_PREFIX = "query: ";
const MODEL_OUTPUT_ID = "multilingual-e5-small";
const OUTPUT_DIR = resolve(
  ROOT,
  `public/data/model-lab/it/${MODEL_OUTPUT_ID}`,
);
const BOARD_WORD_COUNT = 800;
const CENTERING_COUNT = 30_000;
const CUTS = [3_000, 10_000];
const SCALE = 127;
const BATCH_SIZE = 128;

const STOPWORDS = new Set(
  `
  a ad al alla alle allo anche ancora avere avendo che chi ci cioè come con contro
  cui da dal dalla dalle dallo dei del della delle dello di dopo dove due e ed era
  erano essere fa fare fra gli ha hai hanno ho i il in io la le lei li lo loro lui
  ma mai mentre mi mia mie miei mio molto nei nel nella nelle nello no noi non o
  ogni oppure per perché però più prima può quale quando quanto quattro quella
  quelle quelli quello questa queste questi questo qui quindi se sei senza sia
  siamo siete sono sua sue sul sulla sulle sullo suo te tra tre tu tua tue tuo tutti
  tutto un una uno vi voi
  `.trim().split(/\s+/),
);

env.cacheDir = resolve(ROOT, ".cache/huggingface");
env.allowLocalModels = false;

await mkdir(CACHE_DIR, { recursive: true });
await ensurePinnedArchive();

const boardWords = await readBoardWords();
const frequencyRows = readFrequencyRows();
const candidates = buildCandidateCorpus(frequencyRows, boardWords);
if (candidates.length < CENTERING_COUNT) {
  throw new Error(
    `Need ${CENTERING_COUNT.toLocaleString()} Italian candidates, found ${candidates.length.toLocaleString()}`,
  );
}

await writeGeneratedWordData(boardWords, candidates);
await writeClueIndex(candidates.slice(0, CENTERING_COUNT));

async function ensurePinnedArchive() {
  try {
    if ((await sha256File(ARCHIVE_PATH)) === ARCHIVE_SHA256) {
      return;
    }
  } catch {}

  const response = await fetch(ARCHIVE_URL);
  if (!response.ok) {
    throw new Error(`Could not download Leipzig corpus (${response.status})`);
  }
  await writeFile(ARCHIVE_PATH, Buffer.from(await response.arrayBuffer()));
  const checksum = await sha256File(ARCHIVE_PATH);
  if (checksum !== ARCHIVE_SHA256) {
    throw new Error(
      `Leipzig archive checksum mismatch: expected ${ARCHIVE_SHA256}, got ${checksum}`,
    );
  }
}

async function readBoardWords() {
  const source = await readFile(SOURCE_WORDS_PATH, "utf8");
  const words = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const normalized = words.map((word) =>
    word.normalize("NFKC").toLocaleLowerCase("it"),
  );

  if (normalized.length !== BOARD_WORD_COUNT) {
    throw new Error(
      `Italian Extended must contain ${BOARD_WORD_COUNT} words, found ${normalized.length}`,
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Italian Extended contains duplicate words");
  }
  const invalid = normalized.filter((word) => !/^\p{L}+$/u.test(word));
  if (invalid.length) {
    throw new Error(`Italian Extended contains invalid words: ${invalid.join(", ")}`);
  }
  return normalized.sort((left, right) => left.localeCompare(right, "it"));
}

function readFrequencyRows() {
  const output = execFileSync(
    "tar",
    ["-xOzf", ARCHIVE_PATH, ARCHIVE_WORDS_PATH],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [, word, count] = line.split("\t");
      return { word, count: Number(count) };
    });
}

function buildCandidateCorpus(rows, seedWords) {
  const totalTokens = rows.reduce((total, row) => total + row.count, 0);
  const filtered = rows
    .filter(({ word, count }) => {
      if (
        count < 2 ||
        !word ||
        !/^\p{L}{3,24}$/u.test(word) ||
        word !== word.toLocaleLowerCase("it") ||
        STOPWORDS.has(word)
      ) {
        return false;
      }
      return true;
    })
    .map(({ word, count }) => ({
      word: word.normalize("NFKC"),
      count,
      zipf: Number(Math.log10((count / totalTokens) * 1_000_000_000).toFixed(4)),
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.word.localeCompare(right.word, "it"),
    );
  const byWord = new Map(filtered.map((candidate) => [candidate.word, candidate]));
  const seen = new Set();
  return [
    ...seedWords.map((word) => {
      seen.add(word);
      return byWord.get(word) ?? { word, count: 0, zipf: 3.4 };
    }),
    ...filtered.filter(({ word }) => {
      if (seen.has(word)) {
        return false;
      }
      seen.add(word);
      return true;
    }),
  ];
}

async function writeGeneratedWordData(words, candidates) {
  const sourceHash = createHash("sha256")
    .update(`${words.join("\n")}\n`)
    .digest("hex");
  const content = `// Generated by npm run generate:italian. Do not edit directly.
export const ITALIAN_EXTENDED_WORDS = Object.freeze(${JSON.stringify(words, null, 2)});

export const ITALIAN_WORD_REPORT = Object.freeze(${JSON.stringify(
    {
      id: "it:extended-v1",
      language: "it",
      license: "CC0 1.0",
      method:
        "Source-created semantic-category pool. It is not copied from or aligned to an official Codenames list.",
      count: words.length,
      sourceSha256: sourceHash,
      clueCorpus: {
        source: "Leipzig Corpora Collection, Italian news 2024 100K",
        url: ARCHIVE_URL,
        archiveSha256: ARCHIVE_SHA256,
        license: "CC BY 4.0",
        filteredCandidates: candidates.length,
        centeringCount: CENTERING_COUNT,
      },
    },
    null,
    2,
  )});
`;
  await writeFile(GENERATED_WORDS_PATH, content);
}

async function writeClueIndex(candidates) {
  console.log(`Loading ${MODEL_ID} at ${MODEL_REVISION}`);
  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    dtype: "q8",
    revision: MODEL_REVISION,
  });
  const terms = candidates.map(({ word }) => `${MODEL_PREFIX}${word}`);
  const raw = await embedInBatches(extractor, terms);
  const dimensions = raw[0].length;
  const mean = meanVector(raw, dimensions);
  const quantized = new Int8Array(raw.length * dimensions);

  raw.forEach((vector, row) => {
    const centered = centerAndNormalize(vector, mean);
    centered.forEach((value, column) => {
      quantized[row * dimensions + column] = Math.round(
        Math.max(-1, Math.min(1, value)) * SCALE,
      );
    });
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  const shards = [];
  let start = 0;
  for (const end of CUTS) {
    const payload = {
      clues: candidates.slice(start, end).map(({ word }) => word),
      frequencies: candidates.slice(start, end).map(({ zipf }) => zipf),
      vectors: Buffer.from(
        quantized.subarray(start * dimensions, end * dimensions),
      ).toString("base64"),
    };
    const file = `clues-${start}-${end}.json`;
    const content = `${JSON.stringify(payload)}\n`;
    await writeFile(resolve(OUTPUT_DIR, file), content);
    shards.push({ start, end, file, bytes: Buffer.byteLength(content) });
    start = end;
  }

  const modelPath = resolve(
    env.cacheDir,
    MODEL_ID,
    MODEL_REVISION,
    "onnx/model_quantized.onnx",
  );
  const fallbackModelPath = resolve(
    env.cacheDir,
    MODEL_ID,
    "onnx/model_quantized.onnx",
  );
  const resolvedModelPath = await existingPath(modelPath, fallbackModelPath);
  const manifest = {
    version: 3,
    language: "it",
    wordSet: "it:extended-v1",
    model: MODEL_ID,
    modelRevision: MODEL_REVISION,
    modelSha256: MODEL_SHA256,
    modelBytes: (await stat(resolvedModelPath)).size,
    dimensions,
    taskPrefix: MODEL_PREFIX,
    quantization: { type: "symmetric-int8", scale: SCALE },
    centering: {
      method: "30000-italian-clue-corpus-mean",
      count: CENTERING_COUNT,
      mean: mean.map((value) => Number(value.toFixed(8))),
    },
    vocabulary: {
      source: "Leipzig Corpora Collection, Italian news 2024 100K",
      sourceUrl: ARCHIVE_URL,
      sourceArchiveSha256: ARCHIVE_SHA256,
      license: "CC BY 4.0",
      filters: [
        "Unicode letters only",
        "3 to 24 letters",
        "lowercase corpus forms",
        "minimum count 2",
        "Italian stopwords removed",
        "frequency order",
      ],
      availableCandidates: candidates.length,
    },
    shards,
  };
  await writeFile(
    resolve(OUTPUT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (typeof extractor.dispose === "function") {
    await extractor.dispose();
  }
  console.log(
    `Wrote Italian Extended ${boardWords.length} words and ${CUTS.at(-1).toLocaleString()} clues`,
  );
}

async function embedInBatches(extractor, terms) {
  const vectors = [];
  for (let start = 0; start < terms.length; start += BATCH_SIZE) {
    const batch = terms.slice(start, start + BATCH_SIZE);
    const output = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });
    vectors.push(...output.tolist());
    if (start % (BATCH_SIZE * 10) === 0) {
      console.log(
        `Italian clues: ${Math.min(start + batch.length, terms.length).toLocaleString()}/${terms.length.toLocaleString()}`,
      );
    }
  }
  return vectors;
}

function meanVector(vectors, dimensions) {
  const mean = new Array(dimensions).fill(0);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      mean[index] += value / vectors.length;
    });
  }
  return mean;
}

function centerAndNormalize(vector, mean) {
  const centered = vector.map((value, index) => value - mean[index]);
  const magnitude = Math.sqrt(
    centered.reduce((total, value) => total + value * value, 0),
  );
  return centered.map((value) => value / magnitude);
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function existingPath(...paths) {
  for (const path of paths) {
    try {
      await stat(path);
      return path;
    } catch {}
  }
  throw new Error(`Could not find generated model artifact under ${env.cacheDir}`);
}
