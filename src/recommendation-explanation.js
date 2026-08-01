const COPY = Object.freeze({
  en: {
    dangerLabels: {
      neutral: "vegetable",
      enemy: "other side's treat",
      assassin: "Veterinarian",
    },
    nonTarget: "non-target",
    directLink: (word) => `A direct link to ${word}.`,
    connects: (words, weakest) =>
      `Connects ${formatNaturalList(words, "en")}, with ${weakest} as the weakest match.`,
    assassinRisk: (danger) =>
      `${danger} is the main risk: the Veterinarian is also drawn to this clue.`,
    strongerRisk: (danger, dangerLabel, weakest) =>
      `${danger} is the main risk: the ${dangerLabel} matches at least as strongly as ${weakest}.`,
    closeRisk: (danger, dangerLabel, weakest) =>
      `${danger} is the main risk: the ${dangerLabel} sits close behind ${weakest}.`,
    clearRisk: (danger, dangerLabel) =>
      `${danger} is the closest danger, but the ${dangerLabel} stays clearly behind every target.`,
  },
  it: {
    dangerLabels: {
      neutral: "verdura",
      enemy: "premio dell'altro lato",
      assassin: "veterinario",
    },
    nonTarget: "carta non obiettivo",
    directLink: (word) => `Un collegamento diretto con ${word}.`,
    connects: (words, weakest) =>
      `Collega ${formatNaturalList(words, "it")}; ${weakest} è l'associazione più debole.`,
    assassinRisk: (danger) =>
      `${danger} è il rischio principale: anche il veterinario è vicino a questo indizio.`,
    strongerRisk: (danger, dangerLabel, weakest) =>
      `${danger} è il rischio principale: ${dangerLabel} è almeno altrettanto vicino quanto ${weakest}.`,
    closeRisk: (danger, dangerLabel, weakest) =>
      `${danger} è il rischio principale: ${dangerLabel} è poco dietro ${weakest}.`,
    clearRisk: (danger, dangerLabel) =>
      `${danger} è il pericolo più vicino, ma ${dangerLabel} resta chiaramente dietro ogni obiettivo.`,
  },
});

export function explainRecommendation(suggestion, language = "en") {
  const copy = COPY[language] ?? COPY.en;
  const targets = [...suggestion.targets].sort((left, right) => right.sim - left.sim);
  const weakestTarget = targets.at(-1);
  const targetWords = targets.map(({ word }) => word);
  const targetSummary =
    targets.length === 1
      ? copy.directLink(targetWords[0])
      : copy.connects(targetWords, weakestTarget.word);

  return {
    targetSummary,
    riskSummary: explainMainRisk(suggestion, weakestTarget, copy),
  };
}

function explainMainRisk(suggestion, weakestTarget, copy) {
  const danger = suggestion.closestDanger;
  const dangerLabel = copy.dangerLabels[danger.team] ?? copy.nonTarget;

  if (danger.team === "assassin") {
    return copy.assassinRisk(danger.word);
  }

  if (suggestion.margin <= 0) {
    return copy.strongerRisk(danger.word, dangerLabel, weakestTarget.word);
  }

  if (suggestion.margin < 0.11) {
    return copy.closeRisk(danger.word, dangerLabel, weakestTarget.word);
  }

  return copy.clearRisk(danger.word, dangerLabel);
}

function formatNaturalList(words, language) {
  if (words.length <= 1) {
    return words[0] ?? "";
  }
  if (words.length === 2) {
    return `${words[0]} ${language === "it" ? "e" : "and"} ${words[1]}`;
  }
  return `${words.slice(0, -1).join(", ")}, ${language === "it" ? "e" : "and"} ${words.at(-1)}`;
}
