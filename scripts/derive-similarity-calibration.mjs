import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = parseOptions(process.argv.slice(2));
const [referenceReport, candidateReport] = await Promise.all([
  readReport(options.reference),
  readReport(options.candidate),
]);
const reference = geometry(referenceReport, options.reference);
const candidate = geometry(candidateReport, options.candidate);
if (reference.standardDeviation <= 0 || candidate.standardDeviation <= 0) {
  throw new Error("Similarity standard deviations must be positive.");
}
const scale = reference.standardDeviation / candidate.standardDeviation;
const offset = reference.mean - candidate.mean * scale;
const calibration = {
  schemaVersion: 1,
  reference: {
    modelId: referenceReport.methodology.modelId,
    report: options.reference,
    geometry: reference,
  },
  candidate: {
    modelId: candidateReport.methodology.modelId,
    report: options.candidate,
    geometry: candidate,
  },
  transform: {
    scale: rounded(scale),
    offset: rounded(offset),
  },
  commandArguments: [
    "--similarity-scale",
    String(rounded(scale)),
    "--similarity-offset",
    String(rounded(offset)),
  ],
};

if (options.output) {
  await writeFile(
    resolve(options.output),
    `${JSON.stringify(calibration, null, 2)}\n`,
  );
  console.log(`Wrote ${resolve(options.output)}`);
}
console.log(
  `--similarity-scale ${calibration.transform.scale} --similarity-offset ${calibration.transform.offset}`,
);

function geometry(report, label) {
  const value =
    report?.methodology?.similarityCalibration?.rawGeometry;
  if (
    !Number.isFinite(value?.mean) ||
    !Number.isFinite(value?.standardDeviation)
  ) {
    throw new Error(`${label} has no raw similarity geometry.`);
  }
  return value;
}

async function readReport(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function parseOptions(args) {
  const values = {
    reference: null,
    candidate: null,
    output: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--reference") {
      values.reference = required(value, option);
    } else if (option === "--candidate") {
      values.candidate = required(value, option);
    } else if (option === "--output") {
      values.output = required(value, option);
    } else {
      throw new Error(`Unknown similarity calibration option: ${option}`);
    }
    index += 1;
  }
  if (!values.reference || !values.candidate) {
    throw new Error("--reference and --candidate are required.");
  }
  return values;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function rounded(value) {
  return Number(value.toFixed(8));
}
