export const APP_NAME = "Treats";

const SIDE_COPY_KEYS = Object.freeze({
  blue: "blue",
  red: "red",
});

const PLAYER_COPY_KEYS = Object.freeze({
  "blue:spymaster": "catOwner",
  "blue:operative": "cat",
  "red:spymaster": "dogOwner",
  "red:operative": "dog",
});

const CARD_COPY_KEYS = Object.freeze({
  friendly: "fish",
  enemy: "bone",
  neutral: "neutral",
  assassin: "assassinTeam",
});

export function sideCopyKey(side) {
  return SIDE_COPY_KEYS[side] ?? SIDE_COPY_KEYS.blue;
}

export function playerCopyKey(side, role) {
  return PLAYER_COPY_KEYS[`${side}:${role}`] ?? "operative";
}

export function cardCopyKey(team) {
  return CARD_COPY_KEYS[team] ?? null;
}

export function sideEmoji(side) {
  return side === "red" ? "🐶" : "🐱";
}

export function playerEmoji(side, role) {
  if (role === "spymaster") {
    return "👤";
  }
  return sideEmoji(side);
}
