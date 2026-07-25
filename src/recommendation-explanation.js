const DANGER_LABELS = Object.freeze({
  neutral: "bystander",
  enemy: "opposing agent",
  assassin: "assassin",
});

export function explainRecommendation(suggestion) {
  const targets = [...suggestion.targets].sort((left, right) => right.sim - left.sim);
  const weakestTarget = targets.at(-1);
  const targetWords = targets.map(({ word }) => word);
  const targetSummary =
    targets.length === 1
      ? `A direct link to ${targetWords[0]}.`
      : `Connects ${formatNaturalList(targetWords)}, with ${weakestTarget.word} as the weakest match.`;

  return {
    targetSummary,
    riskSummary: explainMainRisk(suggestion, weakestTarget),
  };
}

function explainMainRisk(suggestion, weakestTarget) {
  const danger = suggestion.closestDanger;
  const dangerLabel = DANGER_LABELS[danger.team] ?? "non-target";

  if (danger.team === "assassin") {
    return `${danger.word} is the main risk: the assassin is also drawn to this clue.`;
  }

  if (suggestion.margin <= 0) {
    return `${danger.word} is the main risk: the ${dangerLabel} matches at least as strongly as ${weakestTarget.word}.`;
  }

  if (suggestion.margin < 0.11) {
    return `${danger.word} is the main risk: the ${dangerLabel} sits close behind ${weakestTarget.word}.`;
  }

  return `${danger.word} is the closest danger, but the ${dangerLabel} stays clearly behind every target.`;
}

function formatNaturalList(words) {
  if (words.length <= 1) {
    return words[0] ?? "";
  }
  if (words.length === 2) {
    return `${words[0]} and ${words[1]}`;
  }
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}
