import { LoaderCircle, Sparkles, createIcons } from "lucide";
import {
  cachedSemanticExplanation,
  loadSemanticExplanations,
  recommendationExplanationKey,
} from "./recommendation-explanation-client.js";

const pendingExplanations = new Map();

export function createRecommendationExplanationControl(
  suggestion,
  { wordPills = false } = {},
) {
  const control = document.createElement("div");
  control.className = "recommendation-explanation-control";

  const output = document.createElement("span");
  output.className = "explanation-targets";
  const cached = cachedSemanticExplanation(suggestion);
  if (cached) {
    renderExplanation(output, cached, suggestion, wordPills);
    output.title = "Generated from the clue and intended target words.";
    control.append(output);
    return control;
  }

  output.hidden = true;
  const button = document.createElement("button");
  button.className = "explain-recommendation-button";
  button.type = "button";
  const targetWords = suggestion.targets.map(({ word }) => word).join(", ");
  const label = `Explain why ${suggestion.clue} connects ${targetWords}`;
  button.setAttribute("aria-label", label);
  button.title = "Generate an AI explanation (paid request, cached in this tab)";
  setButtonContent(button, "sparkles", "Explain");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void requestExplanation(
      suggestion,
      control,
      button,
      output,
      wordPills,
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
) {
  const key = recommendationExplanationKey(suggestion);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  setButtonContent(button, "loader-circle", "Explaining");
  renderControlIcons(control);
  output.hidden = true;
  output.classList.remove("is-error");

  let pending = pendingExplanations.get(key);
  if (!pending) {
    pending = loadSemanticExplanations([suggestion]).finally(() => {
      pendingExplanations.delete(key);
    });
    pendingExplanations.set(key, pending);
  }

  try {
    const explanations = await pending;
    const explanation = explanations.get(key);
    if (!explanation) {
      throw new Error("The explanation response was empty.");
    }
    renderExplanation(output, explanation, suggestion, wordPills);
    output.title = "Generated from the clue and intended target words.";
    output.hidden = false;
    button.remove();
  } catch {
    output.textContent = "Could not generate an explanation. Try again.";
    output.title = "";
    output.hidden = false;
    output.classList.add("is-error");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    setButtonContent(button, "sparkles", "Retry");
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
