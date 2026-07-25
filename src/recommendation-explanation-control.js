import { LoaderCircle, Sparkles, createIcons } from "lucide";
import {
  cachedSemanticExplanation,
  loadSemanticExplanations,
  recommendationExplanationKey,
} from "./recommendation-explanation-client.js";

const pendingExplanations = new Map();

export function createRecommendationExplanationControl(suggestion) {
  const control = document.createElement("div");
  control.className = "recommendation-explanation-control";

  const output = document.createElement("span");
  output.className = "explanation-targets";
  const cached = cachedSemanticExplanation(suggestion);
  if (cached) {
    output.textContent = cached;
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
    void requestExplanation(suggestion, control, button, output);
  });
  control.append(button, output);
  renderControlIcons(control);
  return control;
}

async function requestExplanation(suggestion, control, button, output) {
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
    output.textContent = explanation;
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
