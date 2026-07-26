import { LoaderCircle, Sparkles, createIcons } from "lucide";
import {
  cachedSemanticExplanation,
  loadSemanticExplanations,
  recommendationExplanationKey,
} from "./recommendation-explanation-client.js";

const pendingExplanations = new Map();
const COPY = Object.freeze({
  en: {
    generated: "Generated from the clue and intended target words.",
    explainLabel: (clue, targets) => `Explain why ${clue} connects ${targets}`,
    explainTitle: "Generate an AI explanation (paid request, cached in this tab)",
    explain: "Explain",
    explaining: "Explaining",
    empty: "The explanation response was empty.",
    error: "Could not generate an explanation. Try again.",
    retry: "Retry",
  },
  it: {
    generated: "Generata dall'indizio e dalle parole obiettivo.",
    explainLabel: (clue, targets) =>
      `Spiega perché ${clue} collega ${targets}`,
    explainTitle:
      "Genera una spiegazione IA (richiesta a pagamento, memorizzata in questa scheda)",
    explain: "Spiega",
    explaining: "Generazione",
    empty: "La risposta non contiene una spiegazione.",
    error: "Impossibile generare una spiegazione. Riprova.",
    retry: "Riprova",
  },
});

export function createRecommendationExplanationControl(
  suggestion,
  { wordPills = false, language = "en" } = {},
) {
  const copy = COPY[language] ?? COPY.en;
  const control = document.createElement("div");
  control.className = "recommendation-explanation-control";

  const output = document.createElement("span");
  output.className = "explanation-targets";
  const cached = cachedSemanticExplanation(suggestion, language);
  if (cached) {
    renderExplanation(output, cached, suggestion, wordPills);
    output.title = copy.generated;
    control.append(output);
    return control;
  }

  output.hidden = true;
  const button = document.createElement("button");
  button.className = "explain-recommendation-button";
  button.type = "button";
  const targetWords = suggestion.targets.map(({ word }) => word).join(", ");
  const label = copy.explainLabel(suggestion.clue, targetWords);
  button.setAttribute("aria-label", label);
  button.title = copy.explainTitle;
  setButtonContent(button, "sparkles", copy.explain);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void requestExplanation(
      suggestion,
      control,
      button,
      output,
      wordPills,
      language,
      copy,
    );
  });
  control.append(button, output);
  renderControlIcons(control);
  return control;
}

async function requestExplanation(
  suggestion,
  control,
  button,
  output,
  wordPills,
  language,
  copy,
) {
  const key = recommendationExplanationKey(suggestion, language);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  setButtonContent(button, "loader-circle", copy.explaining);
  renderControlIcons(control);
  output.hidden = true;
  output.classList.remove("is-error");

  let pending = pendingExplanations.get(key);
  if (!pending) {
    pending = loadSemanticExplanations([suggestion], { language }).finally(() => {
      pendingExplanations.delete(key);
    });
    pendingExplanations.set(key, pending);
  }

  try {
    const explanations = await pending;
    const explanation = explanations.get(key);
    if (!explanation) {
      throw new Error(copy.empty);
    }
    renderExplanation(output, explanation, suggestion, wordPills);
    output.title = copy.generated;
    output.hidden = false;
    button.remove();
  } catch {
    output.textContent = copy.error;
    output.title = "";
    output.hidden = false;
    output.classList.add("is-error");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    setButtonContent(button, "sparkles", copy.retry);
    renderControlIcons(control);
  }
}

function renderExplanation(output, explanation, suggestion, wordPills) {
  if (!wordPills) {
    output.textContent = explanation;
    return;
  }

  const terms = [
    { word: suggestion.clue, type: "clue" },
    ...suggestion.targets.map(({ word, team }) => ({
      word,
      type: "target",
      team,
    })),
  ].filter(({ word }) => word?.trim());
  const termByWord = new Map(
    terms.map((term) => [term.word.trim().toUpperCase(), term]),
  );
  const alternatives = [...termByWord.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex);
  if (alternatives.length === 0) {
    output.textContent = explanation;
    return;
  }

  const pattern = new RegExp(`\\b(?:${alternatives.join("|")})\\b`, "gi");
  const children = [];
  let cursor = 0;
  for (const match of explanation.matchAll(pattern)) {
    if (match.index > cursor) {
      children.push(document.createTextNode(explanation.slice(cursor, match.index)));
    }
    const term = termByWord.get(match[0].toUpperCase());
    const pill = document.createElement("span");
    pill.className =
      term.type === "clue" ? "play-clue-pill" : "play-history-card";
    if (term.type === "target" && term.team) {
      pill.dataset.team = term.team;
    }
    pill.textContent = match[0];
    children.push(pill);
    cursor = match.index + match[0].length;
  }
  if (cursor < explanation.length) {
    children.push(document.createTextNode(explanation.slice(cursor)));
  }
  output.replaceChildren(...children);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setButtonContent(button, iconName, label) {
  const icon = document.createElement("i");
  icon.dataset.lucide = iconName;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.replaceChildren(icon, text);
}

function renderControlIcons(root) {
  createIcons({
    icons: { LoaderCircle, Sparkles },
    attrs: { width: 14, height: 14, "stroke-width": 2.25 },
    root,
  });
}
