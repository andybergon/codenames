import { LANGUAGE } from "./word-data.js";

const COPY = Object.freeze({
  [LANGUAGE.ENGLISH]: Object.freeze({
    play: "Play",
    train: "Train",
    loadingTrainer: "Loading trainer",
    preparingTrainer: "Preparing the board and recommendations",
    board: "Board",
    newBoard: "New",
    sampleBoard: "Sample",
    nextLanguage: "Next board language",
    words: "Words",
    order: "Order",
    sorted: "Sorted",
    random: "Random",
    recommendations: "Recommendations",
    modelPicker: "Model picker",
    modelPickerDescription:
      "Choose using human-game quality, download size, and measured speed. Alternatives load only when selected.",
    embeddingModel: "Embedding model",
    clueVocabulary: "Clue vocabulary",
    officialUnavailable:
      "The official Italian vocabulary is unavailable pending redistribution permission.",
    italianBetaSummary:
      "Italian beta uses Multilingual E5 small and an independently authored 800-word Extended pool.",
    loadingClues: ({ count, megabytes }) =>
      `Loading ${count} clues (${megabytes} MB index)`,
    loadingModel: ({ progress }) => `Loading local model ${progress}%`,
    scoringCandidates: "Scoring candidates",
    analysisSummary: ({ count, milliseconds }) =>
      `${count} candidates | ${milliseconds} ms score`,
  }),
  [LANGUAGE.ITALIAN]: Object.freeze({
    play: "Gioca",
    train: "Allenati",
    loadingTrainer: "Caricamento allenamento",
    preparingTrainer: "Preparazione del tabellone e dei suggerimenti",
    board: "Tabellone",
    newBoard: "Nuovo",
    sampleBoard: "Esempio",
    nextLanguage: "Lingua del prossimo tabellone",
    words: "Parole",
    order: "Ordine",
    sorted: "Raggruppato",
    random: "Casuale",
    recommendations: "Suggerimenti",
    modelPicker: "Modello",
    modelPickerDescription:
      "La beta italiana usa un modello e un vocabolario di indizi dedicati.",
    embeddingModel: "Modello semantico",
    clueVocabulary: "Vocabolario indizi",
    officialUnavailable:
      "Il vocabolario italiano ufficiale non è disponibile senza un permesso di ridistribuzione.",
    italianBetaSummary:
      "La beta italiana usa Multilingual E5 small e un insieme Esteso originale di 800 parole.",
    loadingClues: ({ count, megabytes }) =>
      `Caricamento di ${count} indizi (${megabytes} MB)`,
    loadingModel: ({ progress }) => `Caricamento modello locale ${progress}%`,
    scoringCandidates: "Calcolo suggerimenti",
    analysisSummary: ({ count, milliseconds }) =>
      `${count} candidati | ${milliseconds} ms`,
  }),
});

export function translate(language, key, values = {}) {
  const value = COPY[language]?.[key] ?? COPY[LANGUAGE.ENGLISH][key] ?? key;
  return typeof value === "function" ? value(values) : value;
}

export function applyStaticLocale(language, root = document) {
  root.documentElement.lang = language;
  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = translate(language, element.dataset.i18n);
  }
}
