const VARIANTS = Object.freeze({
  current: {
    title: "Current baseline",
    summary:
      "The clue action shares the turn header with Review, while every guess repeats a full Explain button.",
  },
  icons: {
    title: "Icon actions beside pills",
    summary:
      "A persistent sparkle icon sits beside the exact clue or guess it explains. Accessible names and paid-request tooltips retain the boundary without repeated text.",
  },
  adjacent: {
    title: "Compact actions beside pills",
    summary:
      "Small Explain chips sit beside the exact clue or guess. Association is strongest, but dense turns still repeat the label.",
  },
  selected: {
    title: "Selected row with one action",
    summary:
      "Selecting a clue or guess is free, then one turn-level Explain button sends the existing clue-plus-selected-words payload.",
  },
  inline: {
    title: "Selected item with inline action",
    summary:
      "No Explain actions show initially. Selecting a clue or guess is free, then one paid action appears directly beside that item.",
  },
});

const CLUE_TREATMENTS = Object.freeze({
  whole: {
    summary:
      "The clue and target words share one selectable line. The full request scope is obvious, but the line gets busy on phones.",
  },
  clue: {
    summary:
      "Only the clue pills select. Targets stay below as context, which makes the hit area literal but visually separates part of the request.",
  },
  grouped: {
    summary:
      "The clue and its target words form one two-line selectable group. “For” keeps the relationship natural and the full request scope visible.",
  },
});

const SCENARIOS = Object.freeze([
  {
    id: "completed",
    title: "Completed game",
    description: "Post-game analysis, selected turn 7 of 11",
    badge: "Completed",
    side: "blue",
    turn: 7,
    team: "🔵 Blue",
    clue: "ORBIT",
    number: 3,
    intended: [
      { word: "SATELLITE", team: "friendly" },
      { word: "MOON", team: "friendly" },
      { word: "SPACE", team: "friendly" },
    ],
    guesses: [
      { word: "SATELLITE", team: "friendly" },
      { word: "COMET", team: "neutral" },
      { word: "MOON", team: "friendly" },
      { word: "ROCKET", team: "enemy" },
    ],
    ending: "Passed",
  },
  {
    id: "live",
    title: "Developer live analysis",
    description: "Marked developer game, current turn review enabled",
    badge: "Live analysis",
    side: "red",
    turn: 8,
    team: "🔴 Red",
    clue: "CHARGE",
    number: 2,
    intended: [
      { word: "BATTERY", team: "enemy" },
      { word: "HORSE", team: "enemy" },
    ],
    guesses: [
      { word: "BATTERY", team: "enemy" },
      { word: "KNIGHT", team: "neutral" },
      { word: "HORSE", team: "enemy" },
    ],
    ending: "Waiting for bot operative",
  },
]);

const params = new URLSearchParams(window.location.search);
const requestedVariant = params.get("variant");
const variant = Object.hasOwn(VARIANTS, requestedVariant)
  ? requestedVariant
  : "icons";
const requestedClueTreatment = params.get("clue");
const clueTreatment = Object.hasOwn(CLUE_TREATMENTS, requestedClueTreatment)
  ? requestedClueTreatment
  : "grouped";
const variantCopy = VARIANTS[variant];

document.body.dataset.variant = variant;
document.body.dataset.clueTreatment = clueTreatment;
document.querySelector("#variant-title").textContent = variantCopy.title;
document.querySelector("#variant-summary").textContent =
  variant === "inline"
    ? `${variantCopy.summary} ${CLUE_TREATMENTS[clueTreatment].summary}`
    : variantCopy.summary;
document.querySelectorAll(".variant-switcher a").forEach((link) => {
  const linkVariant = new URL(link.href).searchParams.get("variant");
  if (linkVariant === variant) {
    link.setAttribute("aria-current", "page");
  }
});
if (variant === "inline") {
  const treatmentControls = document.querySelector(
    "#inline-treatment-controls",
  );
  treatmentControls.hidden = false;
  treatmentControls
    .querySelectorAll(".clue-treatment-switcher a")
    .forEach((link) => {
      const linkTreatment = new URL(link.href).searchParams.get("clue");
      if (linkTreatment === clueTreatment) {
        link.setAttribute("aria-current", "page");
      }
    });
}

const scenarioGrid = document.querySelector("#scenario-grid");
scenarioGrid.replaceChildren(
  ...SCENARIOS.map((scenario) => renderScenario(scenario, variant)),
);

scenarioGrid.addEventListener("click", (event) => {
  const explain = event.target.closest("[data-payload].explain-action");
  if (explain) {
    const payload = JSON.parse(explain.dataset.payload);
    const preview = document.querySelector("#request-preview");
    preview.classList.add("has-request");
    preview.textContent = `Paid request preview: clue ${payload.clue}, selected words ${payload.targets.join(", ")}`;
    return;
  }

  const inlineSelector = event.target.closest(".inline-row-select");
  if (inlineSelector) {
    const turn = inlineSelector.closest(".turn-card");
    const selectedRow = inlineSelector.closest(".inline-selectable-row");
    turn.querySelectorAll(".inline-selectable-row").forEach((row) => {
      row.classList.toggle("is-selected", row === selectedRow);
      row
        .querySelector(".inline-row-select")
        .setAttribute("aria-pressed", String(row === selectedRow));
      row.querySelector(".inline-selected-explain").hidden =
        row !== selectedRow;
    });
    return;
  }

  const selectable = event.target.closest(".selectable-row");
  if (selectable) {
    const turn = selectable.closest(".turn-card");
    turn.querySelectorAll(".selectable-row").forEach((row) => {
      row.setAttribute("aria-pressed", String(row === selectable));
    });
    const tray = turn.querySelector(".selection-tray");
    const payload = JSON.parse(selectable.dataset.payload);
    tray.querySelector(".selection-copy strong").textContent =
      selectable.dataset.selectionLabel;
    tray.querySelector(".selected-explain").dataset.payload =
      JSON.stringify(payload);
  }
});

function renderScenario(scenario, activeVariant) {
  const section = element("section", "scenario");
  section.dataset.scenario = scenario.id;

  const heading = element("div", "scenario-heading");
  const headingCopy = element("div");
  const title = element("h2");
  title.textContent = scenario.title;
  const description = element("p");
  description.textContent = scenario.description;
  headingCopy.append(title, description);
  const badge = element(
    "span",
    `scenario-badge${scenario.id === "live" ? " live" : ""}`,
  );
  badge.textContent = scenario.badge;
  heading.append(headingCopy, badge);

  const turn = element("article", "turn-card is-selected");
  turn.dataset.side = scenario.side;
  turn.dataset.turn = String(scenario.turn);

  const turnHeading = element("div", "turn-heading");
  const turnLabel = element("div", "turn-label");
  turnLabel.textContent = `${scenario.team} · Turn ${scenario.turn}`;
  const turnActions = element("div", "turn-actions");
  const review = button(
    "review-button",
    scenario.id === "completed" ? "Viewing" : "Review",
  );
  review.setAttribute("aria-pressed", String(scenario.id === "completed"));
  turnActions.append(review);
  if (activeVariant === "current") {
    turnActions.append(
      explainTextButton(
        cluePayload(scenario),
        `Explain why ${scenario.clue} connects ${words(scenario.intended)}`,
      ),
    );
  }
  turnHeading.append(turnLabel, turnActions);

  let content;
  if (activeVariant === "selected") {
    content = renderSelectedRows(scenario);
  } else if (activeVariant === "inline") {
    content = renderInlineSelectedRows(scenario, clueTreatment);
  } else {
    content = renderHistoryRows(scenario, activeVariant);
  }
  turn.append(turnHeading, content);
  section.append(heading, turn);
  return section;
}

function renderHistoryRows(scenario, activeVariant) {
  const list = element("ol", "history-actions");
  list.append(renderClueRow(scenario, activeVariant));
  scenario.guesses.forEach((guess) => {
    list.append(renderGuessRow(scenario, guess, activeVariant));
  });
  const ending = element(
    "li",
    `history-row ${scenario.id === "completed" ? "pass" : "outcome"}`,
  );
  const endingSummary = element("div", "history-summary");
  const endingLabel = element("strong", "history-label");
  endingLabel.textContent =
    scenario.id === "completed" ? "Passed" : "Bot operative";
  endingSummary.append(endingLabel);
  if (scenario.id === "live") {
    endingSummary.append(` · ${scenario.ending}`);
  }
  ending.append(endingSummary);
  list.append(ending);

  const note = element("li", "density-note");
  note.textContent =
    scenario.id === "completed"
      ? "Four guesses make the repeated-action density visible."
      : "Live analysis exposes the same actions before the game ends only in a marked developer session.";
  list.append(note);
  return list;
}

function renderClueRow(scenario, activeVariant) {
  const row = element("li", "history-row clue");
  const summary = element("div", "history-summary");
  const label = element("strong", "history-label");
  label.textContent = "Clue:";
  summary.append(label, pill(scenario.clue), pill(String(scenario.number)));
  if (activeVariant === "icons") {
    summary.append(
      explainIconButton(
        cluePayload(scenario),
        `Explain why ${scenario.clue} connects ${words(scenario.intended)}`,
      ),
    );
  } else if (activeVariant === "adjacent") {
    summary.append(
      explainTextButton(
        cluePayload(scenario),
        `Explain why ${scenario.clue} connects ${words(scenario.intended)}`,
      ),
    );
  }
  const intended = element("span");
  intended.textContent = " intended ";
  summary.append(intended);
  scenario.intended.forEach((target, index) => {
    if (index > 0) {
      summary.append(" + ");
    }
    summary.append(pill(target.word, target.team));
  });
  row.append(summary);
  return row;
}

function renderGuessRow(scenario, guess, activeVariant) {
  const row = element("li", "history-row guess");
  const summary = element("div", "history-summary");
  const label = element("strong", "history-label");
  label.textContent = "Guessed";
  summary.append(label, pill(guess.word, guess.team));
  if (activeVariant === "current" || activeVariant === "adjacent") {
    summary.append(
      explainTextButton(
        guessPayload(scenario, guess),
        `Explain why ${guess.word} was a plausible guess for ${scenario.clue}`,
      ),
    );
  } else if (activeVariant === "icons") {
    summary.append(
      explainIconButton(
        guessPayload(scenario, guess),
        `Explain why ${guess.word} was a plausible guess for ${scenario.clue}`,
      ),
    );
  }
  row.append(summary);
  return row;
}

function renderSelectedRows(scenario) {
  const wrapper = element("div");
  const stack = element("div", "selection-stack");
  const clueRow = selectableRow(
    `Clue ${scenario.clue} ${scenario.number}, intended ${words(scenario.intended)}`,
    cluePayload(scenario),
    true,
  );
  const clueSummary = element("div", "history-summary");
  const clueLabel = element("strong", "history-label");
  clueLabel.textContent = "Clue:";
  clueSummary.append(
    clueLabel,
    pill(scenario.clue),
    pill(String(scenario.number)),
    " intended ",
  );
  scenario.intended.forEach((target, index) => {
    if (index > 0) {
      clueSummary.append(" + ");
    }
    clueSummary.append(pill(target.word, target.team));
  });
  clueRow.append(clueSummary);
  stack.append(clueRow);

  scenario.guesses.forEach((guess) => {
    const row = selectableRow(
      `Guess ${guess.word} for ${scenario.clue}`,
      guessPayload(scenario, guess),
      false,
    );
    const summary = element("div", "history-summary");
    const label = element("strong", "history-label");
    label.textContent = "Guessed";
    summary.append(label, pill(guess.word, guess.team));
    row.append(summary);
    stack.append(row);
  });

  const tray = element("div", "selection-tray");
  const copy = element("div", "selection-copy");
  const selection = element("strong");
  selection.textContent = `Clue ${scenario.clue} with intended words`;
  copy.append(selection, "One paid request for the selected row");
  const explain = explainTextButton(
    cluePayload(scenario),
    `Explain selected clue ${scenario.clue}`,
    "selected-explain",
  );
  tray.append(copy, explain);
  wrapper.append(stack, tray);
  return wrapper;
}

function renderInlineSelectedRows(scenario, activeClueTreatment) {
  const wrapper = element("div");
  const hint = element("p", "inline-selection-hint");
  hint.textContent =
    "Select a clue or guess to reveal its paid Explain action.";
  const list = element("ol", "history-actions inline-selection-stack");

  const clueSelectionLabel =
    activeClueTreatment === "clue"
      ? `clue ${scenario.clue} ${scenario.number}`
      : `clue ${scenario.clue} ${scenario.number} with target words ${words(scenario.intended)}`;
  const clueRow = inlineSelectionRow(
    clueSelectionLabel,
    cluePayload(scenario),
    `Explain why ${scenario.clue} connects ${words(scenario.intended)}`,
  );
  clueRow.row.dataset.clueTreatment = activeClueTreatment;
  const clueSummary = element("span", "history-summary");
  const clueLabel = element("strong", "history-label");
  clueLabel.textContent = "Clue:";
  clueSummary.append(
    clueLabel,
    pill(scenario.clue),
    pill(String(scenario.number)),
  );
  const targets = inlineTargets(
    scenario,
    activeClueTreatment === "whole"
      ? "Targets"
      : activeClueTreatment === "clue"
        ? "Targets"
        : "For",
  );
  if (activeClueTreatment === "whole") {
    clueSummary.append(targets);
    clueRow.selector.append(clueSummary);
  } else if (activeClueTreatment === "clue") {
    clueRow.selector.append(clueSummary);
    clueRow.row.append(targets);
  } else {
    clueRow.selector.append(clueSummary, targets);
  }
  list.append(clueRow.row);

  scenario.guesses.forEach((guess) => {
    const guessRow = inlineSelectionRow(
      `guess ${guess.word} for ${scenario.clue}`,
      guessPayload(scenario, guess),
      `Explain why ${guess.word} was a plausible guess for ${scenario.clue}`,
      "guess",
    );
    const guessSummary = element("span", "history-summary");
    const guessLabel = element("strong", "history-label");
    guessLabel.textContent = "Guessed";
    guessSummary.append(guessLabel, pill(guess.word, guess.team));
    guessRow.selector.append(guessSummary);
    list.append(guessRow.row);
  });

  const ending = element(
    "li",
    `history-row ${scenario.id === "completed" ? "pass" : "outcome"}`,
  );
  const endingLabel = element("strong", "history-label");
  endingLabel.textContent =
    scenario.id === "completed" ? "Passed" : "Bot operative";
  ending.append(endingLabel);
  if (scenario.id === "live") {
    ending.append(` · ${scenario.ending}`);
  }
  list.append(ending);
  wrapper.append(hint, list);
  return wrapper;
}

function inlineTargets(scenario, label) {
  const targets = element("span", "inline-targets");
  const targetsLabel = element("span", "inline-targets-label");
  targetsLabel.textContent = label;
  targets.append(targetsLabel);
  scenario.intended.forEach((target, index) => {
    if (index > 0) {
      targets.append(" + ");
    }
    targets.append(pill(target.word, target.team));
  });
  return targets;
}

function inlineSelectionRow(
  label,
  payload,
  explanationLabel,
  rowType = "clue",
) {
  const row = element("li", `history-row ${rowType} inline-selectable-row`);
  const selector = button("inline-row-select");
  selector.setAttribute("aria-label", `Select ${label}`);
  selector.setAttribute("aria-pressed", "false");
  const explain = explainTextButton(
    payload,
    explanationLabel,
    "inline-selected-explain",
  );
  explain.hidden = true;
  row.append(selector, explain);
  return { row, selector };
}

function selectableRow(label, payload, selected) {
  const row = button("selectable-row");
  row.setAttribute("aria-label", `Select ${label}`);
  row.setAttribute("aria-pressed", String(selected));
  row.dataset.payload = JSON.stringify(payload);
  row.dataset.selectionLabel = label;
  return row;
}

function explainIconButton(payload, label) {
  const action = button("explain-icon explain-action");
  action.setAttribute("aria-label", label);
  action.dataset.tooltip = "Generate an AI explanation, one paid request";
  action.dataset.payload = JSON.stringify(payload);
  action.append(sparklesIcon());
  return action;
}

function explainTextButton(payload, label, extraClass = "") {
  const action = button(`explain-text explain-action ${extraClass}`.trim());
  action.setAttribute("aria-label", label);
  action.title = "Generate an AI explanation, one paid request";
  action.dataset.payload = JSON.stringify(payload);
  action.append(sparklesIcon(), document.createTextNode("Explain"));
  return action;
}

function sparklesIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<path d="M12 3l1.2 3.1L16 7.5l-2.8 1.4L12 12l-1.2-3.1L8 7.5l2.8-1.4L12 3z"/><path d="M19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13z"/><path d="M5 13l1.1 2.9L9 17l-2.9 1.1L5 21l-1.1-2.9L1 17l2.9-1.1L5 13z"/>';
  return svg;
}

function cluePayload(scenario) {
  return {
    clue: scenario.clue,
    targets: scenario.intended.map(({ word }) => word),
  };
}

function guessPayload(scenario, guess) {
  return {
    clue: scenario.clue,
    targets: [guess.word],
  };
}

function words(items) {
  return items.map(({ word }) => word).join(", ");
}

function pill(text, team = "") {
  const item = element("span", `pill ${team}`.trim());
  item.textContent = text;
  return item;
}

function button(className, text = "") {
  const item = element("button", className);
  item.type = "button";
  item.textContent = text;
  return item;
}

function element(tagName, className = "") {
  const item = document.createElement(tagName);
  if (className) {
    item.className = className;
  }
  return item;
}
