export const SIDE = Object.freeze({
  BLUE: "blue",
  RED: "red",
});

const TEAM_FOR_SIDE = Object.freeze({
  [SIDE.BLUE]: "friendly",
  [SIDE.RED]: "enemy",
});

export function teamForSide(side) {
  validateSide(side);
  return TEAM_FOR_SIDE[side];
}

export function otherSide(side) {
  validateSide(side);
  return side === SIDE.BLUE ? SIDE.RED : SIDE.BLUE;
}

export function boardForSide(cards, side) {
  validateSide(side);
  if (side === SIDE.BLUE) {
    return cards;
  }

  return cards.map((card) => ({
    ...card,
    team: swapCompetitiveTeam(card.team),
  }));
}

export function boardTeamFromPerspective(team, side) {
  validateSide(side);
  return side === SIDE.RED ? swapCompetitiveTeam(team) : team;
}

export function remainingCardsForSide(cards, side) {
  const team = teamForSide(side);
  return cards.filter((card) => !card.done && card.team === team).length;
}

export function winningSide(cards) {
  if (remainingCardsForSide(cards, SIDE.BLUE) === 0) {
    return SIDE.BLUE;
  }
  if (remainingCardsForSide(cards, SIDE.RED) === 0) {
    return SIDE.RED;
  }
  return null;
}

export function applySuggestionToBoard(cards, suggestion) {
  const targetLayoutIds = new Set(
    suggestion.targets.map((target) => target.layoutId).filter(Number.isInteger),
  );
  const appliedLayoutIds = [];
  const nextCards = cards.map((card) => {
    if (!targetLayoutIds.has(card.layoutId) || card.done) {
      return card;
    }
    appliedLayoutIds.push(card.layoutId);
    return { ...card, done: true };
  });

  return { cards: nextCards, appliedLayoutIds };
}

export function applySuggestionTurn(cards, suggestion, playedSide, autoSwitch = true) {
  validateSide(playedSide);
  const applied = applySuggestionToBoard(cards, suggestion);
  const winner = winningSide(applied.cards);
  const nextSide = autoSwitch && !winner ? otherSide(playedSide) : playedSide;
  return { ...applied, playedSide, nextSide, winner };
}

function swapCompetitiveTeam(team) {
  if (team === "friendly") {
    return "enemy";
  }
  if (team === "enemy") {
    return "friendly";
  }
  return team;
}

function validateSide(side) {
  if (side !== SIDE.BLUE && side !== SIDE.RED) {
    throw new Error(`Unknown side: ${side}`);
  }
}
