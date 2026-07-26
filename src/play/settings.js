import {
  CANDIDATE_OPTIONS,
  ITALIAN_CANDIDATE_OPTIONS,
  ITALIAN_MODEL_ID,
  PICKER_MODEL_OPTIONS,
} from "../model-lab.js";
import { LANGUAGE } from "../word-data.js";

export const PLAY_CLUE_POLICY = Object.freeze({
  CURRENT: "current",
  HYBRID: "hybrid",
});

export const PLAY_BONUS_POLICY = Object.freeze({
  ALLOW: "allow",
  PASS: "pass",
});

export const PLAY_OPERATIVE_AGGRESSION = Object.freeze({
  CONSERVATIVE: "conservative",
  AGGRESSIVE: "aggressive",
  DYNAMIC: "dynamic",
});

export const PLAY_MISSED_TARGET_TIMING = Object.freeze({
  LATE: "late",
  BALANCED: "balanced",
  IMMEDIATE: "immediate",
});

export const DEFAULT_PLAY_BOT_SETTINGS = Object.freeze({
  modelId: "bge-small",
  candidateCount: 10_000,
  cluePolicy: PLAY_CLUE_POLICY.HYBRID,
  multiTolerance: 5,
  missedTargetTiming: PLAY_MISSED_TARGET_TIMING.LATE,
  operativeAggression: PLAY_OPERATIVE_AGGRESSION.DYNAMIC,
  bonusGuesses: PLAY_BONUS_POLICY.PASS,
});

const MODEL_IDS = new Set(PICKER_MODEL_OPTIONS.map(({ id }) => id));
const CANDIDATE_COUNTS = new Set(CANDIDATE_OPTIONS.map(({ count }) => count));
const ITALIAN_CANDIDATE_COUNTS = new Set(
  ITALIAN_CANDIDATE_OPTIONS.map(({ count }) => count),
);
const CLUE_POLICIES = new Set(Object.values(PLAY_CLUE_POLICY));
const BONUS_POLICIES = new Set(Object.values(PLAY_BONUS_POLICY));
const OPERATIVE_AGGRESSIONS = new Set(
  Object.values(PLAY_OPERATIVE_AGGRESSION),
);
const MISSED_TARGET_TIMINGS = new Set(
  Object.values(PLAY_MISSED_TARGET_TIMING),
);

export function normalizePlayBotSettings(
  value = {},
  language = LANGUAGE.ENGLISH,
) {
  const italian = language === LANGUAGE.ITALIAN;
  const defaultModelId = italian
    ? ITALIAN_MODEL_ID
    : DEFAULT_PLAY_BOT_SETTINGS.modelId;
  const modelIds = italian ? new Set([ITALIAN_MODEL_ID]) : MODEL_IDS;
  const candidateCounts = italian
    ? ITALIAN_CANDIDATE_COUNTS
    : CANDIDATE_COUNTS;
  const candidateCount = Number(value.candidateCount);
  const multiTolerance = Number(value.multiTolerance);
  return {
    modelId: modelIds.has(value.modelId)
      ? value.modelId
      : defaultModelId,
    candidateCount: candidateCounts.has(candidateCount)
      ? candidateCount
      : DEFAULT_PLAY_BOT_SETTINGS.candidateCount,
    cluePolicy: CLUE_POLICIES.has(value.cluePolicy)
      ? value.cluePolicy
      : DEFAULT_PLAY_BOT_SETTINGS.cluePolicy,
    multiTolerance: Number.isFinite(multiTolerance)
      ? Math.min(20, Math.max(0, multiTolerance))
      : DEFAULT_PLAY_BOT_SETTINGS.multiTolerance,
    missedTargetTiming: MISSED_TARGET_TIMINGS.has(value.missedTargetTiming)
      ? value.missedTargetTiming
      : DEFAULT_PLAY_BOT_SETTINGS.missedTargetTiming,
    operativeAggression: OPERATIVE_AGGRESSIONS.has(value.operativeAggression)
      ? value.operativeAggression
      : DEFAULT_PLAY_BOT_SETTINGS.operativeAggression,
    bonusGuesses: BONUS_POLICIES.has(value.bonusGuesses)
      ? value.bonusGuesses
      : DEFAULT_PLAY_BOT_SETTINGS.bonusGuesses,
  };
}
