import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIMENSIONS = 300;
const options = parseOptions(process.argv.slice(2));
const experimentDirectory = resolve(ROOT, options.experimentDir);
const sourcePath = resolve(ROOT, options.source);
const termsData = JSON.parse(
  await readFile(resolve(experimentDirectory, "terms.json"), "utf8"),
);
const needed = new Map();
termsData.terms.forEach((term, index) => {
  const key = conceptKey(term);
  if (!needed.has(key)) needed.set(key, []);
  needed.get(key).push({ term, index });
});
const vectors = new Map();
const input = createReadStream(sourcePath).pipe(createGunzip());
const lines = createInterface({ input, crlfDelay: Infinity });
let lineNumber = 0;
const startedAt = performance.now();

for await (const line of lines) {
  lineNumber += 1;
  if (lineNumber === 1) continue;
  const firstSpace = line.indexOf(" ");
  if (firstSpace < 0) continue;
  const matches = needed.get(line.slice(0, firstSpace));
  if (!matches) continue;
  const values = line
    .slice(firstSpace + 1)
    .split(" ")
    .map(Number);
  if (values.length !== DIMENSIONS) {
    throw new Error(
      `ConceptNet returned ${values.length} dimensions for ${matches[0].term}.`,
    );
  }
  const vector = normalize(values);
  matches.forEach(({ index }) => vectors.set(index, vector));
}

const vectorDirectory = resolve(experimentDirectory, "vectors");
await mkdir(vectorDirectory, { recursive: true });
const missingTerms = [];
for (let start = 0; start < termsData.terms.length; start += options.chunkSize) {
  const end = Math.min(start + options.chunkSize, termsData.terms.length);
  const buffer = Buffer.alloc((end - start) * DIMENSIONS * 4);
  for (let index = start; index < end; index += 1) {
    const vector = vectors.get(index);
    if (!vector) {
      missingTerms.push(termsData.terms[index]);
      continue;
    }
    vector.forEach((value, dimension) => {
      buffer.writeFloatLE(value, ((index - start) * DIMENSIONS + dimension) * 4);
    });
  }
  await writeFile(chunkPath(vectorDirectory, start, end), buffer);
}

const availableTerms = termsData.terms.filter(
  (_, index) => vectors.has(index),
);
await writeFile(
  resolve(experimentDirectory, "available-terms.json"),
  `${JSON.stringify(availableTerms)}\n`,
);
await writeFile(
  resolve(experimentDirectory, "vector-metadata.json"),
  `${JSON.stringify(
    {
      version: 1,
      provider: "conceptnet",
      model: "numberbatch-en-19.08",
      dimensions: DIMENSIONS,
      inputHash: termsData.inputHash,
      termCount: termsData.terms.length,
      availableTermCount: availableTerms.length,
      missingTermCount: missingTerms.length,
      missingTerms: missingTerms.slice(0, 100),
      runtime: "static-word-vectors",
      source: "numberbatch-en-19.08.txt.gz",
      elapsedSeconds: Number(
        ((performance.now() - startedAt) / 1000).toFixed(3),
      ),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `ConceptNet covered ${availableTerms.length.toLocaleString("en-US")}/${termsData.terms.length.toLocaleString("en-US")} terms.`,
);

function conceptKey(term) {
  return term
    .toLowerCase()
    .replace(/\s+/gu, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

function normalize(vector) {
  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function parseOptions(args) {
  const values = {
    experimentDir: null,
    source: null,
    chunkSize: 512,
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--experiment-dir") values.experimentDir = value;
    else if (option === "--source") values.source = value;
    else if (option === "--chunk-size") values.chunkSize = Number(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!values.experimentDir || !values.source) {
    throw new Error("--experiment-dir and --source are required.");
  }
  return values;
}

function chunkPath(directory, start, end) {
  return resolve(
    directory,
    `${String(start).padStart(6, "0")}-${String(end).padStart(6, "0")}.f32`,
  );
}
