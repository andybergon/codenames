import {
  CANDIDATE_OPTIONS,
  PICKER_MODEL_OPTIONS,
} from "../model-lab.js";

export const PLAY_CLUE_POLICY = Object.freeze({
  CURRENT: "current",
  HYBRID: "hybrid",
});

export const PLAY_BONUS_POLICY = Object.freeze({
  ALLOW: "allow",
  PASS: "pass",
});

export const DEFAULT_PLAY_BOT_SETTINGS = Object.freeze({
  modelId: "bge-small",
  candidateCount: 10_000,
  cluePolicy: PLAY_CLUE_POLICY.HYBRID,
  multiTolerance: 5,
  bonusGuesses: PLAY_BONUS_POLICY.PASS,
});

const MODEL_IDS = new Set(PICKER_MODEL_OPTIONS.map(({ id }) => id));
const CANDIDATE_COUNTS = new Set(CANDIDATE_OPTIONS.map(({ count }) => count));
const CLUE_POLICIES = new Set(Object.values(PLAY_CLUE_POLICY));
const BONUS_POLICIES = new Set(Object.values(PLAY_BONUS_POLICY));

export function normalizePlayBotSettings(value = {}) {
  const candidateCount = Number(value.candidateCount);
  const multiTolerance = Number(value.multiTolerance);
  return {
    modelId: MODEL_IDS.has(value.modelId)
      ? value.modelId
      : DEFAULT_PLAY_BOT_SETTINGS.modelId,
    candidateCount: CANDIDATE_COUNTS.has(candidateCount)
      ? candidateCount
      : DEFAULT_PLAY_BOT_SETTINGS.candidateCount,
    cluePolicy: CLUE_POLICIES.has(value.cluePolicy)
      ? value.cluePolicy
      : DEFAULT_PLAY_BOT_SETTINGS.cluePolicy,
    multiTolerance: Number.isFinite(multiTolerance)
      ? Math.min(20, Math.max(0, multiTolerance))
      : DEFAULT_PLAY_BOT_SETTINGS.multiTolerance,
    bonusGuesses: BONUS_POLICIES.has(value.bonusGuesses)
      ? value.bonusGuesses
      : DEFAULT_PLAY_BOT_SETTINGS.bonusGuesses,
  };
}
