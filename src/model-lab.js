import { LANGUAGE } from "./word-data.js";

export const DEFAULT_MODEL_ID = "minilm-l6";
export const DEFAULT_CANDIDATE_COUNT = 10_000;
export const ITALIAN_MODEL_ID = "multilingual-e5-small";

export const MODEL_OPTIONS = Object.freeze([
  {
    id: "minilm-l3",
    model: "Xenova/paraphrase-MiniLM-L3-v2",
    label: "MiniLM-L3",
    dimensions: 384,
    modelBytes: 17_452_106,
    humanQuality: 0.5609,
    avoidRate: 0.1037,
    note: "Smallest download; lower recall and more avoid errors.",
  },
  {
    id: "minilm-l6",
    model: "Xenova/all-MiniLM-L6-v2",
    label: "MiniLM-L6",
    dimensions: 384,
    modelBytes: 22_972_370,
    humanQuality: 0.5743,
    avoidRate: 0.0944,
    note: "Current default; strongest size/quality balance.",
  },
  {
    id: "bge-small",
    model: "Xenova/bge-small-en-v1.5",
    label: "BGE-small",
    dimensions: 384,
    modelBytes: 34_014_426,
    humanQuality: 0.5857,
    avoidRate: 0.0946,
    note: "Best target recall on played Duet turns.",
  },
  {
    id: "minilm-l12",
    model: "Xenova/all-MiniLM-L12-v2",
    label: "MiniLM-L12",
    dimensions: 384,
    modelBytes: 34_014_366,
    humanQuality: 0.5784,
    avoidRate: 0.1009,
    note: "Best exact-pair recovery; slightly more avoid errors.",
  },
  {
    id: "mpnet-base",
    model: "Xenova/all-mpnet-base-v2",
    label: "MPNet-base",
    dimensions: 768,
    modelBytes: 110_086_122,
    humanQuality: 0.5585,
    avoidRate: 0.1062,
    note: "Largest download and index; lower recall in this benchmark.",
  },
]);

export const ITALIAN_MODEL_OPTION = Object.freeze({
  id: ITALIAN_MODEL_ID,
  model: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  inputPrefix: "query: ",
  label: "Multilingual E5 small",
  dimensions: 384,
  modelBytes: 118_308_185,
  humanQuality: 0.8125,
  avoidRate: 0.125,
  languages: [LANGUAGE.ITALIAN],
  note: "Italian beta model, evaluated on the source-created feasibility fixture.",
});

// Keep the picker focused on models with a meaningful size, quality, or speed
// advantage. MiniLM-L12 is practically dominated by BGE-small at the same
// download size, while MPNet-base is slower, larger, and lower-recall here.
export const PICKER_MODEL_OPTIONS = Object.freeze(
  MODEL_OPTIONS.filter(({ id }) => ["minilm-l3", "minilm-l6", "bge-small"].includes(id)),
);

export const CANDIDATE_OPTIONS = Object.freeze([
  { count: 3_000, humanClueCoverage: 0.621, indexBytes: 1_578_554 },
  { count: 10_000, humanClueCoverage: 0.8547, indexBytes: 5_268_446 },
  { count: 30_000, humanClueCoverage: 0.9389, indexBytes: 15_820_717 },
  { count: 100_000, humanClueCoverage: 0.9627, indexBytes: 52_791_589 },
]);

export const ITALIAN_CANDIDATE_OPTIONS = Object.freeze(
  [
    { count: 3_000, indexBytes: 1_587_237 },
    { count: 10_000, indexBytes: 5_299_485 },
  ],
);

export function modelOption(id) {
  return (
    MODEL_OPTIONS.find((option) => option.id === id) ??
    (id === ITALIAN_MODEL_ID ? ITALIAN_MODEL_OPTION : MODEL_OPTIONS[0])
  );
}

export function modelConfigurationForLanguage(language) {
  if (language === LANGUAGE.ITALIAN) {
    return {
      modelId: ITALIAN_MODEL_ID,
      candidateCount: DEFAULT_CANDIDATE_COUNT,
      candidateOptions: ITALIAN_CANDIDATE_OPTIONS,
    };
  }
  return {
    modelId: DEFAULT_MODEL_ID,
    candidateCount: DEFAULT_CANDIDATE_COUNT,
    candidateOptions: CANDIDATE_OPTIONS,
  };
}

export function indexManifestUrl(modelId, language = LANGUAGE.ENGLISH) {
  if (language === LANGUAGE.ITALIAN) {
    return `/data/model-lab/it/${modelId}/manifest.json`;
  }
  return `/data/model-lab/${modelId}/manifest.json`;
}
