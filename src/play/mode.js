import { Share2, createIcons } from "lucide";
import { createRandomSeed } from "../board-share.js";
import {
  cardCopyKey,
  playerCopyKey,
  playerEmoji,
  sideCopyKey,
  sideEmoji,
} from "../brand.js";
import PLAY_CLUE_BIAS_ANALYSIS from "../../scripts/generated/play-clue-bias-analysis.json" with { type: "json" };
import PLAY_MODEL_BENCHMARK from "../../scripts/generated/play-model-benchmark.json" with { type: "json" };
import {
  loadClueIndexManifest,
  loadShardedClueIndex,
} from "../clue-index.js";
import { centerEmbeddings, embedTerms } from "../embeddings.js";
import {
  loadDeveloperSettings,
  saveDeveloperSettings,
} from "../developer-settings.js";
import {
  SIDE,
  boardForSide,
  remainingCardsForSide,
} from "../gameplay.js";
import { createInfoControl } from "../info-control.js";
import {
  CANDIDATE_OPTIONS,
  ITALIAN_CANDIDATE_OPTIONS,
  indexManifestUrl,
  modelConfigurationForLanguage,
  modelOption,
} from "../model-lab.js";
import { analyzeEmbeddedBoard } from "../model.js";
import { createRecommendationExplanationControl } from "../recommendation-explanation-control.js";
import { translate } from "../locales.js";
import { LANGUAGE, WORD_SET } from "../word-data.js";
import {
  createSeededRandom,
  evaluateBotClue,
  evaluateBotGuess,
  botClueExclusions,
  operativeGuessThresholds,
  scorePlayClue,
  shouldBotTakeAnotherGuess,
} from "./bots.js";
import {
  GAME_END_REASON,
  GAME_ORIGIN,
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  canUndoPlayGame,
  createPlayGame,
  differentRandomHumanSeat,
  giveClue,
  guessCard,
  cluesForSide,
  markPlayGameAsDeveloper,
  passTurn,
  publicGameView,
  randomHumanSeat,
  recordCurrentClueDeveloperDiagnostics,
  replayCompletedClueTurns,
  replayDeveloperClueTurns,
  restorePlayGame,
  unresolvedIntendedTargetIds,
  undoPlayGame,
} from "./game-state.js";
import {
  completedGameIdentity,
  decodePlayGame,
  encodeCompletedGame,
  encodePlayGame,
} from "./game-share.js";
import {
  archiveCompletedPlayGame,
  clearCompletedPlayGames,
  clearPlaySession,
  decodeArchivedCompletedGame,
  loadCompletedPlayGames,
  loadPlaySession,
  removeCompletedPlayGame,
  savePlaySession,
} from "./session-store.js";
import {
  PLAY_BONUS_POLICY,
  PLAY_CLUE_REPEAT_POLICY,
  PLAY_CONCEPT_RANKING,
  PLAY_MISSED_TARGET_TIMING,
  PLAY_OPERATIVE_AGGRESSION,
  PLAY_OPERATIVE_NOISE,
  normalizePlayBotSettings,
} from "./settings.js";
import {
  PLAY_WORD_REUSE_POLICY,
  clearWordReuseHistory,
  createPlayBoardWithWordReuse,
  loadWordReuseState,
  recordBoardWords,
  saveWordReuseState,
  setWordReusePolicy,
  wordReuseStatus,
} from "./word-reuse.js";
import { loadConceptDefinitions } from "./concept-data.js";
import {
  CONCEPT_RANKING_MODEL_ID,
  buildConceptualGuessCandidates,
} from "./concept-ranking.js";
import { createPlayAnalyticsSync } from "./analytics.js";

const RESULTS_PER_SIZE = 6;
const BOT_WAIT_DETAIL_DELAY = 1800;
const BOT_ACTION_DELAY = 720;
const BOT_ACTION_AFTER_UNDO_DELAY = 5000;
const CONCEPT_BRIDGE_DISPLAY_LIMIT = 6;
const PLAY_BOARD_ORDER = Object.freeze({
  TABLE: "table",
  TEAMS: "teams",
  SCORE: "score",
});
const PLAY_HISTORY_VIEW = Object.freeze({
  TIMELINE: "timeline",
  TEAMS: "teams",
});
const TEAM_ORDER = Object.freeze({
  friendly: 0,
  enemy: 1,
  neutral: 2,
  assassin: 3,
});
const PLAY_MODEL_IDS = ["bge-small", "minilm-l6", "minilm-l3"];
const OPENING_MULTI_RATE_BY_MODEL = new Map(
  PLAY_CLUE_BIAS_ANALYSIS.results
    .filter(
      ({ candidateCount, modelId, wordSet }) =>
        candidateCount === 10_000 &&
        PLAY_MODEL_IDS.includes(modelId) &&
        wordSet === WORD_SET.OFFICIAL,
    )
    .map(({ modelId, selectedMultiRate }) => [modelId, selectedMultiRate]),
);
const OPENING_MULTI_RATE_BY_CANDIDATE_COUNT = new Map(
  PLAY_CLUE_BIAS_ANALYSIS.results
    .filter(
      ({ dimension, modelId, wordSet }) =>
        dimension === "candidate-depth" &&
        modelId === "minilm-l6" &&
        wordSet === WORD_SET.OFFICIAL,
    )
    .map(({ candidateCount, selectedMultiRate }) => [
      candidateCount,
      selectedMultiRate,
    ]),
);
const FULL_GAME_MULTI_RATE_BY_MODEL = new Map(
  PLAY_MODEL_BENCHMARK.results
    .filter(({ modelId }) => PLAY_MODEL_IDS.includes(modelId))
    .map(({ modelId, multiClueRate }) => [modelId, multiClueRate]),
);
const BOT_SETTING_INFO = Object.freeze({
  model: {
    id: "embedding-model",
    label: "Embedding model",
    table: {
      headers: [
        "🧠 Model",
        "🎯 Recall",
        "🏁 Open multi",
        "🎮 Game multi",
        "⬇️ Size",
      ],
      numericColumns: [1, 2, 3, 4],
      rows: PLAY_MODEL_IDS.map((id) => {
        const model = modelOption(id);
        return [
          `🧠 ${model.label}`,
          formatPercent(model.humanQuality),
          formatPercent(OPENING_MULTI_RATE_BY_MODEL.get(id)),
          formatPercent(FULL_GAME_MULTI_RATE_BY_MODEL.get(id)),
          formatMegabytes(model.modelBytes),
        ];
      }),
    },
    note: "Recall measures target recovery on human clue pairs. Open multi is the share of 80 controlled openings that produce a clue for 2+ cards. Game multi is the share across 100 full bot games with the recommended settings. These benchmarks compare models, not human win rates.",
  },
  candidates: {
    id: "clue-vocabulary",
    label: "Clue vocabulary",
    table: {
      headers: [
        "📚 Clues",
        "👥 Coverage",
        "🏁 Open multi",
        "⬇️ Index",
        "⏱️ Scoring",
      ],
      numericColumns: [1, 2, 3, 4],
      rows: CANDIDATE_OPTIONS.map(
        ({ count, humanClueCoverage, indexBytes }) => [
          `📚 ${formatCompactCount(count)}`,
          formatPercent(humanClueCoverage),
          formatPercent(OPENING_MULTI_RATE_BY_CANDIDATE_COUNT.get(count)),
          formatMegabytes(indexBytes),
          formatRelativeWork(count),
        ],
      ),
    },
    note: "Coverage is the share of human clues included. Open multi is the share of 80 controlled openings that produce a clue for 2+ cards with the same fixed setup. Scoring work is normalized to 3k = 1×; loading is excluded. Larger vocabularies offer more options, but take more work and can surface less familiar clues.",
  },
  cluePolicy: {
    id: "clue-scoring",
    label: "Clue scoring",
    table: {
      headers: ["🧮 Scoring", "🔢 Multi", "✅ Correct", "⏱️ Turns"],
      numericColumns: [1, 2, 3],
      rows: [
        ["🧪 Human-like", "58.4%", "1.60", "9.78"],
        ["📍 Conservative", "15.7%", "1.17", "13.34"],
      ],
    },
    note: "Multi is the share of clues for 2+ cards. Correct is the average number of correct cards per turn, and Turns is the average number of turns per game. Results come from 100 paired same-model bot games, not human win rates.",
  },
  clueRepeatPolicy: {
    id: "clue-repeat-policy",
    label: "Clue reuse",
    table: {
      headers: ["🧠 Policy", "🚫 Excludes"],
      rows: [
        ["🛡️ Never", "All side clues"],
        ["↩️ Previous", "Last side clue"],
        ["🔁 Allow", "Nothing"],
      ],
    },
    note: "Only clues previously given by the same side are affected. The other side's clues and earlier target words remain available.",
  },
  multiTolerance: {
    id: "multi-clue-preference",
    label: "Prefer multi-card clues",
    table: {
      headers: ["🎛️ Setting", "🤖 Pick 2+ if", "🔢 Full-game multi"],
      numericColumns: [2],
      rows: [
        ["🛑 Off", "It has the best score", "Not measured"],
        ["⚖️ Balanced", "Within 5 points", "58.4%*"],
        ["🚀 Strong", "Within 10 points", "Not measured"],
      ],
    },
    note: "Off always chooses the best-scoring clue. Balanced and Strong may choose a clue for 2+ cards when it scores within the shown distance of the best clue overall. A wider margin favors more multi-card clues. *58.4% is the rate for the full recommended setup, not this setting alone.",
  },
  missedTargetTiming: {
    id: "missed-target-timing",
    label: "Retry missed targets",
    table: {
      headers: ["👤 Timing", "🆕 Early game", "🔁 Retry"],
      rows: [
        ["🌱 Late", "Fresh first", "Late game"],
        ["⚖️ Mid-game", "Light bias", "Mid-game"],
        ["🔁 Immediately", "No bias", "Next turn"],
      ],
    },
    note: "A missed target is a friendly word targeted by an earlier clue but not guessed. Late favors new targets longest, Mid-game mixes missed targets sooner, and Immediately applies no new-target preference. This affects clue choice only.",
  },
  operativeAggression: {
    id: "operative-aggression",
    label: "Pet confidence",
    table: {
      headers: ["🐾 Mode", "🎯 Threshold", "🏁 Game state"],
      rows: [
        ["⚖️ Dynamic", "Adaptive", "Public score"],
        ["🛡️ Conservative", "Highest", "Ignored"],
        ["🚀 Aggressive", "Lowest", "Ignored"],
      ],
    },
    note: "Dynamic adapts to the public score, becoming bolder when behind and more selective when ahead. Conservative passes more readily when the next word is only loosely related. Aggressive is more willing to keep guessing toward the clue number.",
  },
  operativeConcepts: {
    id: "operative-concepts",
    label: "Concept bridges",
    table: {
      headers: ["🔗 Setting", "🧠 Ranking", "📦 Scope"],
      rows: [
        ["✅ On", "Guarded bridge", "English BGE"],
        ["🛑 Off", "Direct only", "Every model"],
      ],
    },
    note: "On uses generated Princeton WordNet sense definitions only for weak multi-card English clues with BGE-small. The definitions are generated data, not clue-specific rules. Other models and stronger direct matches keep exact direct ranking.",
  },
  operativeNoise: {
    id: "operative-noise",
    label: "Guess variation",
    table: {
      headers: ["🎲 Setting", "↕️ Adjustment", "🔁 Repeat"],
      numericColumns: [1],
      rows: [
        ["🛑 Off", "0", "Same ranking"],
        ["🎲 Standard", "±0.028", "Seeded variation"],
      ],
    },
    note: "Standard adds a reproducible offset to each candidate and can reorder words whose association scores are within 0.055. Off keeps the exact association-score order. Neither setting changes the passing thresholds.",
  },
  bonusGuesses: {
    id: "extra-guess",
    label: "Extra guess",
    table: {
      headers: ["➕ Policy", "🔢 Extra", "✅ Result"],
      numericColumns: [1],
      rows: [
        ["🛑 Stop", "0", "Recommended"],
        ["➕ Allow", "+1", "26.4% correct"],
      ],
    },
    note: "Stop ends the turn at the clue number. Allow lets the bot make one optional extra guess using only the current clue. In the benchmark, 26.4% of those extra guesses were correct.",
  },
});
const WORD_REUSE_INFO = Object.freeze({
  id: "new-board-words",
  label: "New board words",
  table: {
    headers: ["🔁 Policy", "🎲 Selection", "💾 History"],
    rows: [
      ["🎲 Fully random", "Any pool word", "Still recorded"],
      ["🧠 Avoid recent", "Unseen first", "Last 32 boards"],
    ],
  },
  note: "Fully random may reuse any word. Avoid recent prefers words absent from the last 32 boards, then uses the least-recently-used repeats needed. Clear history makes every word available again without changing this setting.",
});

export function createPlayMode(options = {}) {
  const initialLanguage =
    options.initialLanguage ?? LANGUAGE.ENGLISH;
  const onLanguageChange =
    typeof options.onLanguageChange === "function"
      ? options.onLanguageChange
      : () => {};
  const botActionDelay =
    import.meta.env.DEV && Number.isFinite(options.botActionDelay)
      ? Math.max(0, options.botActionDelay)
      : null;
  const botActionExecutor =
    import.meta.env.DEV && typeof options.botActionExecutor === "function"
      ? options.botActionExecutor
      : null;
  const analysisExecutor =
    import.meta.env.DEV && typeof options.analysisExecutor === "function"
      ? options.analysisExecutor
      : null;
  const guessCandidateExecutor =
    import.meta.env.DEV && typeof options.guessCandidateExecutor === "function"
      ? options.guessCandidateExecutor
      : null;
  const elements = {
    setup: document.querySelector("#play-setup"),
    game: document.querySelector("#play-game"),
    italianNote: document.querySelector("#italian-play-note"),
    seatButtons: [...document.querySelectorAll("[data-play-seat]")],
    randomizeSeat: document.querySelector("#randomize-play-seat"),
    wordSetButtons: [...document.querySelectorAll("[data-play-word-set]")],
    wordReusePolicy: document.querySelector("#play-word-reuse-policy"),
    wordReuseInfo: document.querySelector("#play-word-reuse-info"),
    wordReuseStatus: document.querySelector("#play-word-reuse-status"),
    clearWordHistory: document.querySelector("#clear-play-word-history"),
    botModel: document.querySelector("#play-bot-model"),
    botModelInfo: document.querySelector("#play-bot-model-info"),
    botCandidates: document.querySelector("#play-bot-candidates"),
    botCandidatesInfo: document.querySelector("#play-bot-candidates-info"),
    cluePolicy: document.querySelector("#play-clue-policy"),
    cluePolicyInfo: document.querySelector("#play-clue-policy-info"),
    clueRepeatPolicy: document.querySelector("#play-clue-repeat-policy"),
    clueRepeatPolicyInfo: document.querySelector(
      "#play-clue-repeat-policy-info",
    ),
    multiTolerance: document.querySelector("#play-multi-tolerance"),
    multiToleranceInfo: document.querySelector("#play-multi-tolerance-info"),
    missedTargetTiming: document.querySelector(
      "#play-missed-target-timing",
    ),
    missedTargetTimingInfo: document.querySelector(
      "#play-missed-target-timing-info",
    ),
    operativeAggression: document.querySelector("#play-operative-aggression"),
    operativeAggressionInfo: document.querySelector(
      "#play-operative-aggression-info",
    ),
    operativeConcepts: document.querySelector(
      "#play-operative-concepts",
    ),
    operativeConceptsInfo: document.querySelector(
      "#play-operative-concepts-info",
    ),
    operativeNoise: document.querySelector("#play-operative-noise"),
    operativeNoiseInfo: document.querySelector(
      "#play-operative-noise-info",
    ),
    bonusGuesses: document.querySelector("#play-bonus-guesses"),
    bonusGuessesInfo: document.querySelector("#play-bonus-guesses-info"),
    developerMode: document.querySelector("#play-developer-mode"),
    developerModeInfo: document.querySelector("#play-developer-mode-info"),
    settingsSummary: document.querySelector("#play-settings-summary"),
    startGame: document.querySelector("#start-play-game"),
    startGameLabel: document.querySelector("#start-play-game-label"),
    savedActions: document.querySelector("#saved-play-actions"),
    savedTitle: document.querySelector("#saved-play-title"),
    savedHelp: document.querySelector("#saved-play-help"),
    resumeSession: document.querySelector("#resume-play-session"),
    resumeSessionLabel: document.querySelector("#resume-play-session-label"),
    discardSession: document.querySelector("#discard-play-session"),
    completedGames: document.querySelector("#completed-play-games"),
    completedGamesCount: document.querySelector(
      "#completed-play-games-count",
    ),
    completedGamesList: document.querySelector(
      "#completed-play-games-list",
    ),
    clearCompletedGames: document.querySelector(
      "#clear-completed-play-games",
    ),
    leaveGame: document.querySelector("#leave-play-game"),
    undoAction: document.querySelector("#undo-play-action"),
    forwardAction: document.querySelector("#forward-play-action"),
    shareGame: document.querySelector("#share-play-game"),
    humanSeat: document.querySelector("#play-human-seat"),
    score: document.querySelector("#play-score"),
    boardToolbar: document.querySelector("#play-board-toolbar"),
    boardOrderButtons: [...document.querySelectorAll("[data-play-board-order]")],
    developerBoardOrder: document.querySelector(
      "[data-developer-board-order]",
    ),
    boardGrid: document.querySelector("#play-board-grid"),
    clueDisplay: document.querySelector("#play-clue-display"),
    liveDiagnosticsToggle: document.querySelector(
      "#play-live-diagnostics-toggle",
    ),
    liveDiagnostics: document.querySelector("#play-live-diagnostics"),
    clueForm: document.querySelector("#play-clue-form"),
    clueInput: document.querySelector("#play-clue-input"),
    clearClue: document.querySelector("#clear-play-clue"),
    clueNumber: document.querySelector("#play-clue-number"),
    clueError: document.querySelector("#play-clue-error"),
    toggleSuggestions: document.querySelector("#toggle-play-suggestions"),
    suggestions: document.querySelector("#play-suggestions"),
    suggestionList: document.querySelector("#play-suggestion-list"),
    operativeControls: document.querySelector("#play-operative-controls"),
    guessProgress: document.querySelector("#play-guess-progress"),
    passTurn: document.querySelector("#pass-play-turn"),
    postGameAnalysis: document.querySelector("#play-post-game-analysis"),
    postGameOutcome: document.querySelector("#play-post-game-outcome"),
    historicalReviewNote: document.querySelector(
      "#play-historical-review-note",
    ),
    postGameAnalysisStatus: document.querySelector(
      "#play-post-game-analysis-status",
    ),
    conceptBridges: document.querySelector("#play-concept-bridges"),
    feedbackActions: document.querySelector("#play-feedback-actions"),
    feedbackGame: document.querySelector("#play-feedback-game"),
    feedbackForm: document.querySelector("#play-feedback-form"),
    feedbackTarget: document.querySelector("#play-feedback-target"),
    feedbackCategory: document.querySelector("#play-feedback-category"),
    feedbackNote: document.querySelector("#play-feedback-note"),
    feedbackCancel: document.querySelector("#cancel-play-feedback"),
    feedbackSubmit: document.querySelector("#submit-play-feedback"),
    feedbackStatus: document.querySelector("#play-feedback-status"),
    historyLabel: document.querySelector("#play-history-heading-label"),
    historyCount: document.querySelector("#play-history-count"),
    historyViewButtons: [...document.querySelectorAll("[data-play-history-view]")],
    historyList: document.querySelector("#play-history-list"),
    historyTeamLists: document.querySelector("#play-history-team-lists"),
    historyBlueList: document.querySelector("#play-history-blue-list"),
    historyRedList: document.querySelector("#play-history-red-list"),
  };

  for (const [container, definition] of [
    [elements.wordReuseInfo, WORD_REUSE_INFO],
    [elements.botModelInfo, BOT_SETTING_INFO.model],
    [elements.botCandidatesInfo, BOT_SETTING_INFO.candidates],
    [elements.cluePolicyInfo, BOT_SETTING_INFO.cluePolicy],
    [
      elements.clueRepeatPolicyInfo,
      BOT_SETTING_INFO.clueRepeatPolicy,
    ],
    [elements.multiToleranceInfo, BOT_SETTING_INFO.multiTolerance],
    [
      elements.missedTargetTimingInfo,
      BOT_SETTING_INFO.missedTargetTiming,
    ],
    [
      elements.operativeAggressionInfo,
      BOT_SETTING_INFO.operativeAggression,
    ],
    [
      elements.operativeConceptsInfo,
      BOT_SETTING_INFO.operativeConcepts,
    ],
    [
      elements.operativeNoiseInfo,
      BOT_SETTING_INFO.operativeNoise,
    ],
    [elements.bonusGuessesInfo, BOT_SETTING_INFO.bonusGuesses],
  ]) {
    container.append(createInfoControl(definition, "play-bot-setting"));
  }

  let active = false;
  const analyticsSync =
    options.analyticsSync ?? createPlayAnalyticsSync();
  let selectedLanguage = initialLanguage;
  let savedGame = loadPlaySession();
  let selectedHumanSeat = savedGame
    ? { ...savedGame.humanSeat }
    : randomHumanSeat();
  let selectedEnglishWordSet = WORD_SET.OFFICIAL;
  let selectedWordSet =
    selectedLanguage === LANGUAGE.ITALIAN
      ? WORD_SET.EXTENDED
      : selectedEnglishWordSet;
  let selectedBotSettings = normalizePlayBotSettings(
    undefined,
    selectedLanguage,
  );
  let wordReuseState = loadWordReuseState();
  let developerSettings = loadDeveloperSettings();
  let completedGames = loadCompletedPlayGames();
  if (savedGame?.phase === GAME_PHASE.COMPLETE) {
    completedGames = archiveCompletedPlayGame(savedGame);
  }
  const sharedPlayGame = readSharedPlayGame();
  let game = sharedPlayGame?.game ?? null;
  if (game) {
    if (game.phase === GAME_PHASE.COMPLETE) {
      completedGames = archiveCompletedPlayGame(game, {
        sourceCode: sharedPlayGame.code,
      });
    } else {
      savedGame = game;
      persistPlayGame(game);
    }
    selectedLanguage = game.language;
    selectedHumanSeat = { ...game.humanSeat };
    selectedWordSet = game.wordSet;
    selectedBotSettings = normalizePlayBotSettings(
      game.botSettings,
      game.language,
    );
  }
  if (savedGame) {
    analyticsSync.record(savedGame, { flush: true });
  }
  let analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
  let boardVectors = null;
  let clueIndex = null;
  let analysisRun = 0;
  let postGameAnalysisRun = 0;
  let botTimer = 0;
  let botBusy = false;
  let botWaitDetailTimer = 0;
  let botWaitKey = "";
  let botWaitDetailVisible = false;
  let botActionAfterHistoryMove = false;
  let forwardHistory = [];
  let statusMessage = "";
  let statusMessageIsError = false;
  let selectedSuggestion = null;
  let suggestionsExpanded = false;
  let suggestionTurnKey = "";
  let playBoardOrder = PLAY_BOARD_ORDER.TABLE;
  let playHistoryView = PLAY_HISTORY_VIEW.TIMELINE;
  let activeModelId = null;
  let shareFeedbackTimer = 0;
  let postGameTurns = [];
  let selectedPostGameTurn = 0;
  let selectedHistoryExplanation = null;
  let postGameScores = [];
  let postGameConceptBridges = [];
  let postGameAnalysisState = "idle";
  let postGameAnalysisMessage = "";
  let feedbackScope = null;
  let feedbackSending = false;
  let liveDiagnosticsVisible = false;
  let liveDiagnosticsRun = 0;
  let liveDiagnosticsState = {
    candidates: [],
    key: "",
    status: "idle",
  };
  const clueIndexPromises = new Map();
  const manifestPromises = new Map();

  for (const button of elements.seatButtons) {
    button.addEventListener("click", () => {
      const [side, role] = button.dataset.playSeat.split(":");
      selectedHumanSeat = { side, role };
      renderSetup();
    });
  }

  elements.randomizeSeat.addEventListener("click", () => {
    selectedHumanSeat = differentRandomHumanSeat(selectedHumanSeat);
    renderSetup();
  });

  for (const button of elements.wordSetButtons) {
    button.addEventListener("click", () => {
      if (selectedLanguage === LANGUAGE.ITALIAN) {
        return;
      }
      selectedWordSet = button.dataset.playWordSet;
      selectedEnglishWordSet = selectedWordSet;
      renderSetup();
    });
  }

  elements.wordReusePolicy.addEventListener("change", () => {
    wordReuseState = setWordReusePolicy(
      wordReuseState,
      elements.wordReusePolicy.value,
    );
    saveWordReuseState(wordReuseState);
    renderSetup();
  });

  elements.clearWordHistory.addEventListener("click", () => {
    wordReuseState = clearWordReuseHistory(wordReuseState);
    saveWordReuseState(wordReuseState);
    renderSetup();
  });

  elements.developerMode.addEventListener("change", () => {
    const enabled = elements.developerMode.checked;
    developerSettings = {
      enabled,
    };
    saveDeveloperSettings(developerSettings);
    if (
      enabled &&
      savedGame &&
      savedGame.phase !== GAME_PHASE.COMPLETE &&
      !savedGame.developerMode
    ) {
      savedGame = markPlayGameAsDeveloper(savedGame);
      persistPlayGame(savedGame, { flush: true });
    }
    renderSetup();
  });

  elements.liveDiagnostics.addEventListener("change", () => {
    liveDiagnosticsVisible = elements.liveDiagnostics.checked;
    if (
      !liveDiagnosticsVisible &&
      playBoardOrder === PLAY_BOARD_ORDER.SCORE
    ) {
      playBoardOrder = PLAY_BOARD_ORDER.TABLE;
    }
    resetPostGameAnalysis();
    renderGame();
    ensurePostGameAnalysis();
  });

  elements.feedbackGame.addEventListener("click", () => {
    openFeedbackForm({ type: "game" });
  });
  elements.feedbackCancel.addEventListener("click", closeFeedbackForm);
  elements.feedbackForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPlayerFeedback();
  });

  for (const [element, key, transform] of [
    [elements.botModel, "modelId", String],
    [elements.botCandidates, "candidateCount", Number],
    [elements.cluePolicy, "cluePolicy", String],
    [elements.clueRepeatPolicy, "clueRepeatPolicy", String],
    [elements.multiTolerance, "multiTolerance", Number],
    [elements.missedTargetTiming, "missedTargetTiming", String],
    [elements.operativeAggression, "operativeAggression", String],
    [elements.operativeConcepts, "operativeConcepts", String],
    [elements.operativeNoise, "operativeNoise", String],
    [elements.bonusGuesses, "bonusGuesses", String],
  ]) {
    element.addEventListener("change", () => {
      selectedBotSettings = normalizePlayBotSettings(
        {
          ...selectedBotSettings,
          [key]: transform(element.value),
        },
        selectedLanguage,
      );
      renderSetup();
    });
  }

  for (const button of elements.boardOrderButtons) {
    button.addEventListener("click", () => {
      playBoardOrder = button.dataset.playBoardOrder;
      renderGame();
    });
  }

  for (const button of elements.historyViewButtons) {
    button.addEventListener("click", () => {
      playHistoryView = button.dataset.playHistoryView;
      renderGame();
    });
  }

  elements.startGame.addEventListener("click", startNewGame);
  elements.resumeSession.addEventListener("click", resumeSavedGame);
  elements.discardSession.addEventListener("click", discardSavedGame);
  elements.clearCompletedGames.addEventListener("click", () => {
    if (
      !window.confirm(
        translate(selectedLanguage, "clearArchiveConfirm"),
      )
    ) {
      return;
    }
    completedGames = clearCompletedPlayGames();
    renderSetup();
  });
  elements.leaveGame.addEventListener("click", showSetup);
  elements.undoAction.addEventListener("click", undoAction);
  elements.forwardAction.addEventListener("click", forwardAction);
  elements.shareGame.addEventListener("click", () => void copyGameLink());
  document.addEventListener("pointerdown", (event) => {
    if (
      elements.shareGame.dataset.state !== "idle" &&
      !elements.shareGame.contains(event.target)
    ) {
      setShareFeedback("idle");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      elements.shareGame.dataset.state !== "idle"
    ) {
      setShareFeedback("idle");
    }
  });
  elements.toggleSuggestions.addEventListener("click", () => {
    suggestionsExpanded = !suggestionsExpanded;
    renderSuggestionVisibility(true);
  });
  elements.clueInput.addEventListener("input", () => {
    selectedSuggestion = null;
    elements.clueError.textContent = "";
    renderClearClueButton();
  });
  elements.clearClue.addEventListener("click", () => {
    elements.clueInput.value = "";
    selectedSuggestion = null;
    elements.clueError.textContent = "";
    renderClearClueButton();
    elements.clueInput.focus();
  });
  elements.passTurn.addEventListener("click", () =>
    runHumanAction((current) => passTurn(current, { actor: "human" })),
  );
  elements.clueForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const clueGiven = runHumanAction((current) =>
      giveClue(current, {
        clue: elements.clueInput.value,
        number: Number(elements.clueNumber.value),
        actor: "human",
        intendedLayoutIds: selectedSuggestionTargets(),
        developerDiagnostics:
          current.developerMode && selectedSuggestion
            ? {
                diagnosticsVersion: 1,
                spymasterDecision: developerSuggestionDecision(
                  selectedSuggestion,
                  current,
                ),
              }
            : null,
      }),
    );
    if (clueGiven) {
      elements.clueInput.value = "";
      renderClearClueButton();
    }
  });

  renderSetup();

  return {
    setActive(nextActive) {
      active = nextActive;
      if (!active) {
        window.clearTimeout(botTimer);
        clearBotWaitDetail();
        return;
      }
      if (game) {
        onLanguageChange(game.language ?? LANGUAGE.ENGLISH);
        analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
        boardVectors = null;
        showActiveGame();
        ensureAnalysis();
      } else {
        renderSetup();
      }
    },
    setLanguage(nextLanguage) {
      if (
        !Object.values(LANGUAGE).includes(nextLanguage) ||
        nextLanguage === selectedLanguage
      ) {
        return;
      }
      selectedLanguage = nextLanguage;
      selectedWordSet =
        selectedLanguage === LANGUAGE.ITALIAN
          ? WORD_SET.EXTENDED
          : selectedEnglishWordSet;
      selectedBotSettings = normalizePlayBotSettings(
        selectedBotSettings,
        selectedLanguage,
      );
      if (game && game.language !== selectedLanguage) {
        showSetup();
      } else {
        renderSetup();
      }
    },
  };

  function renderSetup() {
    elements.developerModeInfo.replaceChildren(
      createInfoControl(
        {
          id: "developer-mode",
          label: translate(selectedLanguage, "enableDeveloperMode"),
          aboutLabel: translate(selectedLanguage, "developerModeAbout"),
          info: translate(selectedLanguage, "developerModeHelp"),
        },
        "play-developer-setting",
      ),
    );
    elements.italianNote.hidden =
      selectedLanguage !== LANGUAGE.ITALIAN;
    elements.italianNote.textContent = translate(
      selectedLanguage,
      "italianPlayBeta",
    );
    for (const button of elements.seatButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playSeat === `${selectedHumanSeat.side}:${selectedHumanSeat.role}`),
      );
    }
    for (const button of elements.wordSetButtons) {
      const unavailable =
        selectedLanguage === LANGUAGE.ITALIAN &&
        button.dataset.playWordSet === WORD_SET.OFFICIAL;
      button.hidden = unavailable;
      button.disabled = unavailable;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playWordSet === selectedWordSet),
      );
    }
    renderModelSettings();
    elements.botModel.value = selectedBotSettings.modelId;
    elements.botCandidates.value = String(selectedBotSettings.candidateCount);
    elements.cluePolicy.value = selectedBotSettings.cluePolicy;
    elements.clueRepeatPolicy.value =
      selectedBotSettings.clueRepeatPolicy;
    elements.multiTolerance.value = String(selectedBotSettings.multiTolerance);
    elements.missedTargetTiming.value =
      selectedBotSettings.missedTargetTiming;
    elements.operativeAggression.value =
      selectedBotSettings.operativeAggression;
    elements.operativeConcepts.value =
      selectedBotSettings.operativeConcepts;
    elements.operativeNoise.value =
      selectedBotSettings.operativeNoise;
    elements.bonusGuesses.value = selectedBotSettings.bonusGuesses;
    elements.developerMode.checked = developerSettings.enabled;
    elements.settingsSummary.textContent = settingsLabel(
      selectedWordSet,
      wordReuseState.policy,
      selectedBotSettings,
      selectedLanguage,
    );
    const savedLanguage = savedGame?.language ?? LANGUAGE.ENGLISH;
    const savedLanguageDiffers =
      Boolean(savedGame) && savedLanguage !== selectedLanguage;
    const savedGameIsComplete = savedGame?.phase === GAME_PHASE.COMPLETE;
    elements.savedTitle.textContent = translate(
      selectedLanguage,
      savedLanguageDiffers
        ? "savedGameOtherLanguage"
        : "savedGameAvailable",
      { language: savedLanguage },
    );
    elements.savedHelp.textContent = translate(
      selectedLanguage,
      savedLanguageDiffers
        ? "savedGameOtherLanguageHelp"
        : "savedGameHelp",
      { language: savedLanguage, selectedLanguage },
    );
    elements.resumeSessionLabel.textContent = translate(
      selectedLanguage,
      savedGameIsComplete
        ? savedLanguageDiffers
          ? "reviewFinishedOtherLanguageGame"
          : "reviewFinishedGame"
        : savedLanguageDiffers
          ? "resumeOtherLanguageGame"
          : "resumeGame",
      { language: savedLanguage },
    );
    elements.startGameLabel.textContent = translate(
      selectedLanguage,
      savedLanguageDiffers ? "startNewLanguageGame" : "startNewGame",
      { language: selectedLanguage },
    );
    elements.savedActions.hidden = !savedGame;
    elements.startGame.classList.toggle("primary", !savedGame);
    elements.startGame.classList.toggle("secondary", Boolean(savedGame));
    elements.wordReusePolicy.value = wordReuseState.policy;
    elements.clearWordHistory.disabled = wordReuseState.boards.length === 0;
    const reuseStatus = wordReuseStatus(
      wordReuseState,
      selectedWordSet,
      selectedLanguage,
    );
    elements.wordReuseStatus.textContent = reuseStatus.text;
    elements.wordReuseStatus.dataset.tone = reuseStatus.tone;
    elements.wordReuseStatus.hidden = reuseStatus.tone !== "warning";
    renderCompletedGames();
  }

  function renderCompletedGames() {
    const currentCompletedId =
      savedGame?.phase === GAME_PHASE.COMPLETE
        ? completedGameIdentity(savedGame)
        : null;
    const pastGames = completedGames.filter(
      (entry) => entry.id !== currentCompletedId,
    );
    elements.completedGames.hidden = pastGames.length === 0;
    elements.completedGamesCount.textContent = translate(
      selectedLanguage,
      "completedGameCount",
      { count: pastGames.length },
    );
    elements.clearCompletedGames.disabled = pastGames.length === 0;
    const items = pastGames.flatMap((entry) => {
      let completedGame;
      try {
        completedGame = decodeArchivedCompletedGame(entry.code);
      } catch {
        return [];
      }
      const item = document.createElement("li");
      const summary = document.createElement("span");
      const summaryLabel = document.createElement("strong");
      const savedAt = document.createElement("time");
      const actions = document.createElement("span");
      const review = document.createElement("button");
      const copy = document.createElement("button");
      const remove = document.createElement("button");
      const clueCount = completedGame.history.filter(
        (event) => event.type === "clue-given",
      ).length;

      item.className = "completed-play-game";
      summary.className = "completed-play-game-summary";
      const provenance = completedGame.developerMode
        ? `🛠️ ${translate(selectedLanguage, "developerGame")} · `
        : "";
      summaryLabel.textContent = `${provenance}${sideEmoji(
        completedGame.winner,
      )} ${translate(selectedLanguage, "completedGameSummary", {
        winner: localizedSideLabelForLanguage(
          completedGame.winner,
          selectedLanguage,
        ),
        reason: translate(
          selectedLanguage,
          completedGame.endReason === GAME_END_REASON.ASSASSIN
            ? "assassin"
            : "everyAgent",
        ),
        turns: clueCount,
      })}`;
      savedAt.dateTime = entry.savedAt;
      savedAt.textContent = new Intl.DateTimeFormat(selectedLanguage, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(entry.savedAt));
      summary.append(summaryLabel, savedAt);

      actions.className = "completed-play-game-actions";
      for (const [button, label] of [
        [review, "reviewGame"],
        [copy, "copyGame"],
        [remove, "removeGame"],
      ]) {
        button.type = "button";
        button.className = "button ghost";
        button.textContent = translate(selectedLanguage, label);
      }
      review.addEventListener("click", () => reviewCompletedGame(entry.code));
      copy.addEventListener("click", async () => {
        try {
          const shareCode =
            completedGame.reviewCompatibility === "history-only"
              ? entry.code
              : encodeCompletedGame(completedGame);
          await writeClipboardText(playGameUrl(shareCode));
          copy.textContent = translate(selectedLanguage, "gameCopied");
          window.setTimeout(() => {
            copy.textContent = translate(selectedLanguage, "copyGame");
          }, 3000);
        } catch {
          copy.textContent = translate(selectedLanguage, "copyFailed");
        }
      });
      remove.addEventListener("click", () => {
        completedGames = removeCompletedPlayGame(entry.id);
        renderSetup();
      });
      actions.append(review, copy, remove);
      item.append(summary, actions);
      return [item];
    });
    elements.completedGamesList.replaceChildren(...items);
  }

  function reviewCompletedGame(code) {
    const reviewedGame = decodeArchivedCompletedGame(code);
    if (reviewedGame.reviewCompatibility === "history-only") {
      reviewedGame.shareMetadata.sourceCode = code;
    }
    game = reviewedGame;
    selectedLanguage = reviewedGame.language ?? LANGUAGE.ENGLISH;
    onLanguageChange(selectedLanguage);
    selectedHumanSeat = { ...reviewedGame.humanSeat };
    selectedWordSet = reviewedGame.wordSet;
    selectedBotSettings = normalizePlayBotSettings(
      reviewedGame.botSettings,
      selectedLanguage,
    );
    resetRuntimeState("");
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("mode", "play");
    try {
      url.searchParams.set("g", completedGameShareCode(reviewedGame));
    } catch {
      url.searchParams.delete("g");
    }
    window.history.replaceState(null, "", url);
    showActiveGame();
    ensurePostGameAnalysis();
  }

  function renderModelSettings() {
    const configuration = modelConfigurationForLanguage(selectedLanguage);
    const models =
      selectedLanguage === LANGUAGE.ITALIAN
        ? [modelOption(configuration.modelId)]
        : PLAY_MODEL_IDS.map(modelOption);
    const modelOptions = models.map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.label}, ${Math.round(model.modelBytes / 1_000_000)} MB`;
      return option;
    });
    elements.botModel.replaceChildren(...modelOptions);
    elements.botModel.disabled = selectedLanguage === LANGUAGE.ITALIAN;

    const candidateOptions =
      selectedLanguage === LANGUAGE.ITALIAN
        ? ITALIAN_CANDIDATE_OPTIONS
        : CANDIDATE_OPTIONS;
    elements.botCandidates.replaceChildren(
      ...candidateOptions.map(({ count }) => {
        const option = document.createElement("option");
        option.value = String(count);
        option.textContent = `${count.toLocaleString(selectedLanguage)} ${translate(
          selectedLanguage,
          "clues",
        ).toLocaleLowerCase(selectedLanguage)}`;
        return option;
      }),
    );
  }

  function startNewGame() {
    window.clearTimeout(botTimer);
    clearSharedGameUrl();
    const seed = createRandomSeed();
    const { board: generated } = createPlayBoardWithWordReuse({
      language: selectedLanguage,
      seed,
      state: wordReuseState,
      wordSet: selectedWordSet,
    });
    const positions = new Map(
      generated.randomLayoutOrder.map((layoutId, index) => [layoutId, index]),
    );
    const cards = [...generated.cards].sort(
      (left, right) => positions.get(left.layoutId) - positions.get(right.layoutId),
    );
    game = createPlayGame({
      botSettings: selectedBotSettings,
      cards,
      developerMode: developerSettings.enabled,
      humanSeat: selectedHumanSeat,
      language: selectedLanguage,
      seed,
      wordSet: selectedWordSet,
      wordReusePolicy: wordReuseState.policy,
    });
    wordReuseState = recordBoardWords(wordReuseState, game.cards);
    saveWordReuseState(wordReuseState);
    savedGame = game;
    resetRuntimeState(
      selectedLanguage === LANGUAGE.ITALIAN
        ? translate(selectedLanguage, "blueStarts")
        : "",
    );
    persistPlayGame(game);
    showActiveGame();
    ensureAnalysis();
  }

  function resumeSavedGame() {
    if (!savedGame) {
      return;
    }
    window.clearTimeout(botTimer);
    game = structuredClone(savedGame);
    selectedLanguage = game.language ?? LANGUAGE.ENGLISH;
    onLanguageChange(selectedLanguage);
    selectedHumanSeat = { ...game.humanSeat };
    selectedWordSet = game.wordSet ?? WORD_SET.OFFICIAL;
    if (selectedLanguage === LANGUAGE.ENGLISH) {
      selectedEnglishWordSet = selectedWordSet;
    }
    selectedBotSettings = normalizePlayBotSettings(
      game.botSettings,
      selectedLanguage,
    );
    resetRuntimeState(translate(selectedLanguage, "savedGameResumed"));
    showActiveGame();
    ensureAnalysis();
  }

  function resetRuntimeState(message) {
    analysisRun += 1;
    clearBotWaitDetail();
    analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
    boardVectors = null;
    clueIndex = null;
    activeModelId = null;
    statusMessage = message;
    statusMessageIsError = false;
    botActionAfterHistoryMove = false;
    forwardHistory = [];
    selectedSuggestion = null;
    suggestionsExpanded = false;
    suggestionTurnKey = "";
    playBoardOrder = PLAY_BOARD_ORDER.TABLE;
    playHistoryView = PLAY_HISTORY_VIEW.TIMELINE;
    elements.clueInput.value = "";
    elements.clueNumber.replaceChildren();
    elements.clueError.textContent = "";
    elements.suggestionList.replaceChildren();
    resetPostGameAnalysis();
    resetLiveDiagnostics();
  }

  function discardSavedGame() {
    clearBotWaitDetail();
    clearPlaySession();
    savedGame = null;
    game = null;
    botActionAfterHistoryMove = false;
    forwardHistory = [];
    renderSetup();
  }

  function showSetup() {
    window.clearTimeout(botTimer);
    clearBotWaitDetail();
    botBusy = false;
    game = null;
    botActionAfterHistoryMove = false;
    forwardHistory = [];
    resetPostGameAnalysis();
    resetLiveDiagnostics();
    clearSharedGameUrl();
    elements.setup.hidden = false;
    elements.game.hidden = true;
    renderSetup();
  }

  function showActiveGame() {
    elements.setup.hidden = true;
    elements.game.hidden = false;
    renderGame();
  }

  async function copyGameLink() {
    if (!game) {
      return;
    }
    try {
      await writeClipboardText(
        playGameUrl(
          game.phase === GAME_PHASE.COMPLETE
            ? completedGameShareCode(game)
            : encodePlayGame(game),
        ),
      );
      setShareFeedback("copied");
    } catch {
      setShareFeedback("error");
    }
  }

  function setShareFeedback(state) {
    window.clearTimeout(shareFeedbackTimer);
    elements.shareGame.dataset.state = state;
    const label = translate(gameLanguage(), "shareGame");
    elements.shareGame.setAttribute("aria-label", label);
    elements.shareGame.title = translate(gameLanguage(), "copyGameLink");

    const feedback = elements.shareGame.querySelector(".copy-feedback-popup");
    feedback.hidden = state === "idle";
    feedback.textContent =
      state === "copied"
        ? translate(gameLanguage(), "copiedToClipboard")
        : state === "error"
          ? translate(gameLanguage(), "copyFailed")
          : "";

    const icon = document.createElement("i");
    icon.dataset.lucide = "share-2";
    icon.setAttribute("aria-hidden", "true");
    elements.shareGame.replaceChildren(icon, feedback);
    createIcons({
      icons: { Share2 },
      attrs: { width: 18, height: 18, "stroke-width": 2 },
      root: elements.shareGame,
    });
    if (state !== "idle") {
      shareFeedbackTimer = window.setTimeout(() => setShareFeedback("idle"), 3000);
    }
  }

  function runHumanAction(action) {
    if (!game) {
      return false;
    }
    try {
      game = action(game);
      botActionAfterHistoryMove = false;
      forwardHistory = [];
      selectedSuggestion = null;
      statusMessage = "";
      statusMessageIsError = false;
      elements.clueError.textContent = "";
      commitGame();
      return true;
    } catch (error) {
      const message = localizePlayError(
        error instanceof Error ? error.message : String(error),
        gameLanguage(),
      );
      elements.clueError.textContent = message;
      statusMessage = message;
      statusMessageIsError = true;
      renderGame();
      return false;
    }
  }

  function undoAction() {
    if (!game || !canUndoPlayGame(game)) {
      return;
    }
    window.clearTimeout(botTimer);
    forwardHistory.push(structuredClone(game));
    game = undoPlayGame(game);
    savedGame = game;
    botActionAfterHistoryMove = true;
    resetPostGameAnalysis();
    resetAnalysis(translate(gameLanguage(), "movedBack"));
    persistPlayGame(game, { flush: true });
    renderGame();
    ensureAnalysis();
    ensurePostGameAnalysis();
  }

  function forwardAction() {
    if (!game || forwardHistory.length === 0) {
      return;
    }
    window.clearTimeout(botTimer);
    game = restorePlayGame(forwardHistory.pop());
    savedGame = game;
    botActionAfterHistoryMove = true;
    resetPostGameAnalysis();
    resetAnalysis(translate(gameLanguage(), "restoredForward"));
    persistPlayGame(game, { flush: true });
    renderGame();
    ensureAnalysis();
    ensurePostGameAnalysis();
  }

  function resetAnalysis(message = "") {
    analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
    boardVectors = null;
    clueIndex = null;
    selectedSuggestion = null;
    statusMessage = message;
    statusMessageIsError = false;
  }

  function resetPostGameAnalysis() {
    postGameAnalysisRun += 1;
    postGameTurns = [];
    selectedPostGameTurn = 0;
    selectedHistoryExplanation = null;
    postGameScores = [];
    postGameConceptBridges = [];
    postGameAnalysisState = "idle";
    postGameAnalysisMessage = "";
  }

  function resetLiveDiagnostics() {
    liveDiagnosticsRun += 1;
    liveDiagnosticsVisible = false;
    elements.liveDiagnostics.checked = false;
    const savedScores =
      game?.currentTurn?.developerDiagnostics?.operativeScores ?? [];
    liveDiagnosticsState = {
      candidates: savedScores,
      key:
        savedScores.length > 0 && game?.currentTurn
          ? currentClueDiagnosticsKey()
          : "",
      status: savedScores.length > 0 ? "ready" : "idle",
    };
  }

  function persistPlayGame(target, { flush = false } = {}) {
    const saved = savePlaySession(target);
    if (saved) {
      analyticsSync.record(target, { flush });
    }
    return saved;
  }

  function commitGame() {
    savedGame = game;
    persistPlayGame(game, {
      flush:
        game.phase === GAME_PHASE.AWAITING_CLUE ||
        game.phase === GAME_PHASE.COMPLETE,
    });
    if (game.phase === GAME_PHASE.COMPLETE) {
      completedGames = archiveCompletedPlayGame(game);
    }
    renderGame();
    if (game.phase === GAME_PHASE.COMPLETE) {
      resetPostGameAnalysis();
      ensurePostGameAnalysis();
      return;
    }
    if (game.phase === GAME_PHASE.AWAITING_CLUE) {
      resetAnalysis();
      ensureAnalysis();
      return;
    }
    if (game.developerMode && liveDiagnosticsVisible) {
      ensurePostGameAnalysis();
    }
    queueBotAction();
  }

  function ensureAnalysis() {
    if (!game) {
      return;
    }
    if (game.phase === GAME_PHASE.COMPLETE) {
      ensurePostGameAnalysis();
      return;
    }
    if (analysis[game.activeSide]) {
      queueBotAction();
      return;
    }
    const role =
      game.phase === GAME_PHASE.AWAITING_CLUE
        ? PLAYER_ROLE.SPYMASTER
        : PLAYER_ROLE.OPERATIVE;
    if (
      botActionExecutor &&
      actorForSeat(game, game.activeSide, role) === "bot"
    ) {
      queueBotAction();
      return;
    }
    void runAnalysis();
  }

  async function runAnalysis() {
    if (!game) {
      return;
    }
    const runId = ++analysisRun;
    const gameAtStart = game;
    statusMessage = translate(gameLanguage(), "botStudying");
    statusMessageIsError = false;
    renderGame();

    try {
      const { modelId, candidateCount } = gameAtStart.botSettings;
      const language = gameAtStart.language ?? LANGUAGE.ENGLISH;
      const cards = gameAtStart.cards.map((card) => ({ ...card }));
      if (analysisExecutor) {
        const activeCards =
          gameAtStart.activeSide === SIDE.BLUE
            ? cards
            : boardForSide(cards, SIDE.RED);
        const nextAnalysis = await analysisExecutor({
          cards: activeCards,
          excludedClues: botClueExclusions(
            cluesForSide(gameAtStart, gameAtStart.activeSide),
            gameAtStart.botSettings.clueRepeatPolicy,
          ),
          language,
          modelId,
          candidateCount,
          side: gameAtStart.activeSide,
        });
        if (runId !== analysisRun || game !== gameAtStart) {
          return;
        }
        if (!Array.isArray(nextAnalysis?.suggestions)) {
          throw new Error("The analysis executor did not return suggestions.");
        }
        analysis = {
          ...analysis,
          [gameAtStart.activeSide]: nextAnalysis,
        };
        activeModelId = modelId;
        statusMessage = "";
        statusMessageIsError = false;
        renderGame();
        queueBotAction();
        return;
      }
      const configuration = `${language}:${modelId}:${candidateCount}`;
      const onLoadRetry = (event) => {
        if (runId !== analysisRun || game !== gameAtStart) {
          return;
        }
        statusMessage = retryLoadMessage(event);
        statusMessageIsError = false;
        renderGame();
      };
      if (!clueIndexPromises.has(configuration)) {
        const promise = loadShardedClueIndex(
          indexManifestUrl(modelId, language),
          candidateCount,
          { onRetry: onLoadRetry },
        ).catch((error) => {
          clueIndexPromises.delete(configuration);
          throw error;
        });
        clueIndexPromises.set(configuration, promise);
      }
      const model = modelOption(modelId);
      const [loadedIndex, vectors] = await Promise.all([
        clueIndexPromises.get(configuration),
        embedTerms(
          cards.map((card) => card.word),
          {
            model: model.model,
            revision: model.revision,
            inputPrefix: model.inputPrefix,
            onRetry: onLoadRetry,
          },
        ),
      ]);
      if (runId !== analysisRun || game !== gameAtStart) {
        return;
      }
      const centered = centerEmbeddings(vectors, loadedIndex.centering.mean);
      if (loadedIndex.language && loadedIndex.language !== language) {
        throw new Error(
          `Clue index language ${loadedIndex.language} is incompatible with ${language}.`,
        );
      }
      boardVectors = centered;
      clueIndex = loadedIndex;
      activeModelId = modelId;
      analysis = {
        [SIDE.BLUE]: analyzeEmbeddedBoard(cards, centered, loadedIndex, {
          excludedClues: botClueExclusions(
            cluesForSide(gameAtStart, SIDE.BLUE),
            gameAtStart.botSettings.clueRepeatPolicy,
          ),
          limit: RESULTS_PER_SIZE,
          language,
        }),
        [SIDE.RED]: analyzeEmbeddedBoard(
          boardForSide(cards, SIDE.RED),
          centered,
          loadedIndex,
          {
            excludedClues: botClueExclusions(
              cluesForSide(gameAtStart, SIDE.RED),
              gameAtStart.botSettings.clueRepeatPolicy,
            ),
            limit: RESULTS_PER_SIZE,
            language,
          },
        ),
      };
      statusMessage = "";
      statusMessageIsError = false;
      renderGame();
      queueBotAction();
    } catch (error) {
      if (runId !== analysisRun) {
        return;
      }
      statusMessage = error instanceof Error ? error.message : String(error);
      statusMessageIsError = true;
      renderGame();
    }
  }

  function preparePostGameTurns() {
    if (game?.phase === GAME_PHASE.COMPLETE && postGameTurns.length === 0) {
      postGameTurns = replayCompletedClueTurns(game);
      selectedPostGameTurn = Math.max(
        0,
        Math.min(selectedPostGameTurn, postGameTurns.length - 1),
      );
      return;
    }
    if (game?.developerMode && liveDiagnosticsVisible) {
      const nextTurns = replayDeveloperClueTurns(game);
      const previousLastTurn = postGameTurns.at(-1);
      const nextLastTurn = nextTurns.at(-1);
      const latestClueChanged =
        previousLastTurn?.turn !== nextLastTurn?.turn ||
        previousLastTurn?.side !== nextLastTurn?.side ||
        previousLastTurn?.clue !== nextLastTurn?.clue;
      postGameTurns = nextTurns;
      selectedPostGameTurn =
        latestClueChanged && nextTurns.length > 0
          ? nextTurns.length - 1
          : Math.max(
              0,
              Math.min(selectedPostGameTurn, nextTurns.length - 1),
            );
      const savedScores = nextTurns.map((turn) =>
        Object.fromEntries(
          (turn.developerDiagnostics?.operativeScores ?? []).map(
            ({ layoutId, similarity }) => [layoutId, similarity],
          ),
        ),
      );
      const savedConceptBridges = nextTurns.map((turn) =>
        conceptBridgeMap(
          turn.developerDiagnostics?.operativeScores ?? [],
        ),
      );
      const hasCompleteSavedScores =
        savedScores.length > 0 &&
        savedScores.every(
          (scores) => Object.keys(scores).length === game.cards.length,
        );
      if (latestClueChanged) {
        selectedHistoryExplanation = null;
        postGameAnalysisState = "idle";
      }
      if (hasCompleteSavedScores) {
        postGameScores = savedScores;
        postGameConceptBridges = savedConceptBridges;
        postGameAnalysisState = "ready";
      } else if (postGameAnalysisState !== "ready") {
        postGameScores = savedScores;
        postGameConceptBridges = savedConceptBridges;
      }
    }
  }

  function ensurePostGameAnalysis() {
    preparePostGameTurns();
    if (
      !active ||
      !game ||
      game.reviewCompatibility === "history-only" ||
      (game.phase !== GAME_PHASE.COMPLETE &&
        !(game.developerMode && liveDiagnosticsVisible)) ||
      postGameTurns.length === 0 ||
      postGameAnalysisState !== "idle"
    ) {
      return;
    }
    void runPostGameAnalysis();
  }

  async function runPostGameAnalysis() {
    const runId = ++postGameAnalysisRun;
    const gameAtStart = game;
    const turnsAtStart = postGameTurns;
    postGameAnalysisState = "loading";
    postGameAnalysisMessage = translate(
      gameLanguage(),
      "loadingOperativeScores",
    );
    renderGame();

    try {
      if (guessCandidateExecutor) {
        const scores = await Promise.all(
          turnsAtStart.map((turn) =>
            guessCandidateExecutor({
              cards: gameAtStart.cards.map(({ layoutId, word }) => ({
                layoutId,
                word,
                done: false,
              })),
              clue: turn.clue,
              clueNumber: turn.number,
              language: gameAtStart.language ?? LANGUAGE.ENGLISH,
            }),
          ),
        );
        if (runId !== postGameAnalysisRun || game !== gameAtStart) {
          return;
        }
        postGameScores = scores.map((candidates) =>
          Object.fromEntries(
            candidates.map(({ layoutId, rankingScore, similarity }) => [
              layoutId,
              rankingScore ?? similarity,
            ]),
          ),
        );
        postGameConceptBridges = scores.map(conceptBridgeMap);
        postGameAnalysisState = "ready";
        postGameAnalysisMessage = "";
        renderGame();
        return;
      }
      const { modelId } = gameAtStart.botSettings;
      const onLoadRetry = (event) => {
        if (runId !== postGameAnalysisRun || game !== gameAtStart) {
          return;
        }
        postGameAnalysisMessage = retryLoadMessage(event);
        renderGame();
      };
      if (!manifestPromises.has(modelId)) {
        const promise = loadClueIndexManifest(indexManifestUrl(modelId), {
          onRetry: onLoadRetry,
        }).catch((error) => {
          manifestPromises.delete(modelId);
          throw error;
        });
        manifestPromises.set(modelId, promise);
      }
      const model = modelOption(modelId);
      const terms = gameAtStart.cards.map((card) => card.word);
      const embeddingOptions = {
        model: model.model,
        revision: model.revision,
        inputPrefix: model.inputPrefix,
        onRetry: onLoadRetry,
      };
      const [manifest, vectors] = await Promise.all([
        manifestPromises.get(modelId),
        embedTerms(terms, embeddingOptions),
      ]);
      if (runId !== postGameAnalysisRun || game !== gameAtStart) {
        return;
      }

      const centered = centerEmbeddings(vectors, manifest.centering.mean);
      postGameScores = [];
      postGameConceptBridges = [];
      for (const turn of turnsAtStart) {
        const candidates = await buildConceptualGuessCandidates({
          boardVectors: centered,
          cards: gameAtStart.cards.map(({ layoutId, word }) => ({
            layoutId,
            word,
            done: false,
          })),
          centeringMean: manifest.centering.mean,
          clue: turn.clue,
          clueNumber: turn.number,
          embeddingOptions,
          includeRevealed: true,
          loadDefinitions:
            (gameAtStart.language ?? LANGUAGE.ENGLISH) ===
              LANGUAGE.ENGLISH &&
            modelId === CONCEPT_RANKING_MODEL_ID &&
            gameAtStart.botSettings.operativeConcepts ===
              PLAY_CONCEPT_RANKING.GUARDED
              ? () => loadConceptDefinitions(turn.clue)
              : undefined,
        });
        postGameScores.push(
          Object.fromEntries(
            candidates.map(
              ({ layoutId, rankingScore, similarity }) => [
                layoutId,
                rankingScore ?? similarity,
              ],
            ),
          ),
        );
        postGameConceptBridges.push(conceptBridgeMap(candidates));
      }
      postGameAnalysisState = "ready";
      postGameAnalysisMessage = "";
    } catch (error) {
      if (runId !== postGameAnalysisRun) {
        return;
      }
      postGameAnalysisState = "error";
      postGameAnalysisMessage =
        error instanceof Error ? error.message : String(error);
    }
    renderGame();
  }

  function queueBotAction(
    delay = botActionAfterHistoryMove ? BOT_ACTION_AFTER_UNDO_DELAY : BOT_ACTION_DELAY,
  ) {
    window.clearTimeout(botTimer);
    if (!active || !game || game.phase === GAME_PHASE.COMPLETE || botBusy) {
      return;
    }
    const role =
      game.phase === GAME_PHASE.AWAITING_CLUE
        ? PLAYER_ROLE.SPYMASTER
        : PLAYER_ROLE.OPERATIVE;
    if (actorForSeat(game, game.activeSide, role) !== "bot") {
      return;
    }
    if (
      !botActionExecutor &&
      game.phase === GAME_PHASE.AWAITING_CLUE &&
      !analysis[game.activeSide]
    ) {
      ensureAnalysis();
      return;
    }
    botTimer = window.setTimeout(
      () => void performBotAction(),
      botActionDelay ?? delay,
    );
  }

  async function performBotAction() {
    if (!game || game.phase === GAME_PHASE.COMPLETE) {
      return;
    }
    botBusy = true;
    botActionAfterHistoryMove = false;
    const gameAtStart = game;
    const actingSide = game.activeSide;
    try {
      if (botActionExecutor) {
        const result = await botActionExecutor(structuredClone(game));
        if (game !== gameAtStart) {
          return;
        }
        if (!result?.game) {
          throw new Error("The bot action executor did not return a game.");
        }
        game = result.game;
        statusMessage = result.statusMessage ?? "";
        statusMessageIsError = false;
      } else if (game.phase === GAME_PHASE.AWAITING_CLUE) {
        const decisionRandom = createSeededRandom(
          `${game.seed}:${game.turnNumber}:${game.history.length}`,
        );
        const missedTargetLayoutIds = unresolvedIntendedTargetIds(
          game,
          game.activeSide,
        );
        const ownRemaining = remainingCardsForSide(
          game.cards,
          game.activeSide,
        );
        const clueDecision = evaluateBotClue({
          analysis: analysis[game.activeSide],
          freshTargetCount: ownRemaining - missedTargetLayoutIds.length,
          missedTargetLayoutIds,
          missedTargetTiming: game.botSettings.missedTargetTiming,
          clueRepeatPolicy: game.botSettings.clueRepeatPolicy,
          ownRemaining,
          opponentRemaining: remainingCardsForSide(
            game.cards,
            game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
          ),
          teamClues: cluesForSide(game, game.activeSide),
          policy: game.botSettings.cluePolicy,
          multiTolerance: game.botSettings.multiTolerance,
          random: decisionRandom,
        });
        const clue = clueDecision.selected;
        if (!clue) {
          throw new Error(
            translate(gameLanguage(), "noLegalClue"),
          );
        }
        game = giveClue(game, {
          clue: clue.clue,
          number: clue.number,
          actor: "bot",
          intendedLayoutIds: clue.targets.map((target) => target.layoutId),
          developerDiagnostics: game.developerMode
            ? {
                diagnosticsVersion: 1,
                spymasterDecision:
                  serializeSpymasterDecision(clueDecision),
              }
            : null,
        });
        statusMessage = translate(gameLanguage(), "botClue", {
          side: localizedSideLabel(actingSide),
          clue: clue.clue.toLocaleUpperCase(gameLanguage()),
          number: clue.number,
        });
        statusMessageIsError = false;
      } else {
        const decisionRandom = createSeededRandom(
          `${game.seed}:${game.turnNumber}:${game.history.length}`,
        );
        const allCandidates = game.developerMode
          ? await buildBotGuessCandidates(game.currentTurn.clue, {
              includeRevealed: true,
            })
          : null;
        const candidates = allCandidates
          ? allCandidates.filter(
              ({ layoutId }) =>
                !game.cards.find((card) => card.layoutId === layoutId)?.done,
            )
          : await buildBotGuessCandidates(game.currentTurn.clue);
        if (game.developerMode) {
          game = recordCurrentClueDeveloperDiagnostics(game, {
            diagnosticsVersion: 1,
            modelId: activeModelId ?? game.botSettings.modelId,
            operativeScores: serializeOperativeScores(allCandidates),
          });
          liveDiagnosticsState = {
            candidates: serializeOperativeScores(allCandidates),
            key: currentClueDiagnosticsKey(),
            status: "ready",
          };
        }
        const canTakeAnotherGuess = shouldBotTakeAnotherGuess({
            bonusGuesses: game.botSettings.bonusGuesses,
            clueNumber: game.currentTurn.number,
            guessesMade: game.currentTurn.guesses.length,
          });
        const guessDecision = canTakeAnotherGuess
          ? evaluateBotGuess({
              aggression: game.botSettings.operativeAggression,
              candidates,
              guessesMade: game.currentTurn.guesses.length,
              clueNumber: game.currentTurn.number,
              noise: game.botSettings.operativeNoise,
              ownRemaining: remainingCardsForSide(
                game.cards,
                game.activeSide,
              ),
              opponentRemaining: remainingCardsForSide(
                game.cards,
                game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
              ),
              random: decisionRandom,
            })
          : {
              gap: null,
              layoutId: null,
              ranked: candidates.map((candidate) => ({
                ...candidate,
                botScore: candidate.similarity,
              })),
              reason: "guess-limit",
              thresholds: operativeGuessThresholds({
                aggression: game.botSettings.operativeAggression,
                clueNumber: game.currentTurn.number,
                guessesMade: game.currentTurn.guesses.length,
                ownRemaining: remainingCardsForSide(
                  game.cards,
                  game.activeSide,
                ),
                opponentRemaining: remainingCardsForSide(
                  game.cards,
                  game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
                ),
              }),
            };
        const layoutId = guessDecision.layoutId;
        const operativeDiagnostics = game.developerMode
          ? {
              diagnosticsVersion: 1,
              operativeDecision: serializeOperativeDecision(
                guessDecision,
                game,
              ),
            }
          : null;
        if (layoutId === null) {
          game = passTurn(game, {
            actor: "bot",
            developerDiagnostics: operativeDiagnostics,
          });
          statusMessage = translate(gameLanguage(), "botPassed", {
            side: localizedSideLabel(actingSide),
          });
        } else {
          const word = game.cards.find((card) => card.layoutId === layoutId)?.word;
          game = guessCard(game, {
            layoutId,
            actor: "bot",
            developerDiagnostics: operativeDiagnostics,
          });
          statusMessage = translate(gameLanguage(), "botGuessed", {
            side: localizedSideLabel(actingSide),
            word,
          });
        }
        statusMessageIsError = false;
      }
      forwardHistory = [];
      savedGame = game;
      persistPlayGame(game, {
        flush:
          game.phase === GAME_PHASE.AWAITING_CLUE ||
          game.phase === GAME_PHASE.COMPLETE,
      });
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : String(error);
      statusMessageIsError = true;
    } finally {
      botBusy = false;
      renderGame();
    }

    if (game?.developerMode && liveDiagnosticsVisible) {
      ensurePostGameAnalysis();
    }
    if (game?.phase === GAME_PHASE.COMPLETE) {
      ensurePostGameAnalysis();
    } else if (game?.phase === GAME_PHASE.AWAITING_CLUE) {
      resetAnalysis();
      ensureAnalysis();
    } else {
      queueBotAction();
    }
  }

  async function buildBotGuessCandidates(
    clue,
    {
      clueNumber = game?.currentTurn?.number ?? 1,
      includeRevealed = false,
    } = {},
  ) {
    if (game && guessCandidateExecutor) {
      return guessCandidateExecutor({
        cards: game.cards.map(({ layoutId, word, done }) => ({
          layoutId,
          word,
          done,
        })),
        clue,
        clueNumber,
        includeRevealed,
        language: gameLanguage(),
      });
    }
    if (!game || !boardVectors || !clueIndex) {
      return [];
    }
    const model = modelOption(activeModelId);
    const embeddingOptions = {
      model: model.model,
      revision: model.revision,
      inputPrefix: model.inputPrefix,
    };
    const candidates =
      gameLanguage() === LANGUAGE.ENGLISH &&
      activeModelId === CONCEPT_RANKING_MODEL_ID &&
      game.botSettings.operativeConcepts ===
        PLAY_CONCEPT_RANKING.GUARDED
        ? await buildConceptualGuessCandidates({
            boardVectors,
            cards: game.cards.map(
              ({ done, layoutId, word }) => ({
                done,
                layoutId,
                word,
              }),
            ),
            centeringMean: clueIndex.centering.mean,
            clue,
            clueNumber,
            embeddingOptions,
            includeRevealed,
            loadDefinitions: () =>
              loadConceptDefinitions(clue),
          })
        : await buildConceptualGuessCandidates({
            boardVectors,
            cards: game.cards.map(
              ({ done, layoutId, word }) => ({
                done,
                layoutId,
                word,
              }),
            ),
            centeringMean: clueIndex.centering.mean,
            clue,
            clueNumber: 1,
            embeddingOptions,
            includeRevealed,
          });
    return candidates
      .filter((candidate) => includeRevealed || !candidate.done)
      .map(({ done: _done, ...candidate }) => candidate);
  }

  function gameLanguage() {
    return game?.language ?? selectedLanguage;
  }

  function localizedSideLabel(side) {
    return translate(gameLanguage(), sideCopyKey(side));
  }

  function localizedRoleLabel(side, role) {
    return translate(gameLanguage(), playerCopyKey(side, role));
  }

  function localizedTeamLabel(team) {
    const key = cardCopyKey(team);
    return key ? translate(gameLanguage(), key) : team;
  }

  function renderGame() {
    if (!game) {
      return;
    }
    preparePostGameTurns();
    const selectedTurn = turnAnalysisEnabled()
      ? postGameTurns[selectedPostGameTurn] ?? null
      : null;
    const view = publicGameView(
      selectedTurn
        ? {
            ...game,
            activeSide: selectedTurn.side,
            cards: selectedTurn.cards,
            phase: GAME_PHASE.COMPLETE,
          }
        : game,
    );
    const currentRole =
      game.phase === GAME_PHASE.AWAITING_CLUE
        ? PLAYER_ROLE.SPYMASTER
        : PLAYER_ROLE.OPERATIVE;
    const currentActor =
      selectedTurn || game.phase === GAME_PHASE.COMPLETE
        ? null
        : actorForSeat(game, game.activeSide, currentRole);

    elements.humanSeat.dataset.side = game.humanSeat.side;
    const seatContext = document.createElement("span");
    seatContext.className = "play-seat-context";
    seatContext.textContent = translate(gameLanguage(), "yourView");
    const seatIdentity = document.createElement("strong");
    seatIdentity.className = "play-seat-identity";
    const roleLabel = localizedRoleLabel(
      game.humanSeat.side,
      game.humanSeat.role,
    );
    seatIdentity.textContent = `${playerEmoji(game.humanSeat.side, game.humanSeat.role)} ${roleLabel}`;
    elements.humanSeat.setAttribute(
      "aria-label",
      translate(gameLanguage(), "yourViewLabel", {
        identity: `${localizedSideLabel(game.humanSeat.side)}, ${roleLabel}`,
      }),
    );
    elements.humanSeat.replaceChildren(seatContext, seatIdentity);
    elements.undoAction.disabled = !canUndoPlayGame(game) || botBusy;
    elements.forwardAction.disabled = forwardHistory.length === 0 || botBusy;
    renderScore(selectedTurn?.cards ?? game.cards, selectedTurn);
    renderBoardToolbar(selectedTurn);
    renderBoard(view, currentActor, currentRole, selectedTurn);
    renderTurnPanel(currentActor, currentRole, selectedTurn);
    renderLiveDiagnosticsToggle();
    renderPostGameAnalysis(selectedTurn);
    renderHistory(view.history);
    ensureCurrentClueDeveloperDiagnostics();
  }

  function renderScore(cards, selectedTurn) {
    const scores = [SIDE.BLUE, SIDE.RED].map((side) => {
      const item = document.createElement("div");
      item.className = "play-score-team";
      item.dataset.side = side;
      item.classList.toggle(
        "is-active",
        (game.phase !== GAME_PHASE.COMPLETE && game.activeSide === side) ||
          selectedTurn?.side === side,
      );
      const label = document.createElement("span");
      label.textContent = sideEmoji(side);
      label.setAttribute("aria-hidden", "true");
      const value = document.createElement("strong");
      const remaining = remainingCardsForSide(cards, side);
      value.textContent = String(remaining);
      item.setAttribute(
        "aria-label",
        translate(gameLanguage(), "remaining", {
          side: localizedSideLabel(side),
          count: remaining,
        }),
      );
      item.append(label, value);
      return item;
    });
    elements.score.replaceChildren(...scores);
  }

  function renderBoardToolbar(selectedTurn) {
    const showOrderControls = game.humanSeat.role === PLAYER_ROLE.SPYMASTER;
    const showScoreOrder =
      showOrderControls &&
      game.developerMode &&
      liveDiagnosticsVisible &&
      Boolean(selectedTurn);
    const turnScores = postGameScores[selectedPostGameTurn] ?? {};
    const scoreOrderReady = Object.values(turnScores).some(Number.isFinite);
    if (!showScoreOrder && playBoardOrder === PLAY_BOARD_ORDER.SCORE) {
      playBoardOrder = PLAY_BOARD_ORDER.TABLE;
    }
    elements.boardToolbar.hidden = !showOrderControls;
    elements.developerBoardOrder.hidden = !showScoreOrder;
    elements.developerBoardOrder.disabled = !scoreOrderReady;
    for (const button of elements.boardOrderButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playBoardOrder === playBoardOrder),
      );
    }
  }

  function renderBoard(view, currentActor, currentRole, selectedTurn) {
    const canGuess =
      !selectedTurn &&
      game.phase === GAME_PHASE.AWAITING_GUESS &&
      currentActor === "human" &&
      currentRole === PLAYER_ROLE.OPERATIVE &&
      !botBusy;
    const turnScores = selectedTurn
      ? postGameScores[selectedPostGameTurn] ?? {}
      : {};
    const visibleCards =
      playBoardOrder === PLAY_BOARD_ORDER.TEAMS &&
      game.humanSeat.role === PLAYER_ROLE.SPYMASTER
        ? [...view.cards].sort(
            (left, right) =>
              TEAM_ORDER[left.team] - TEAM_ORDER[right.team] ||
              left.layoutId - right.layoutId,
          )
        : playBoardOrder === PLAY_BOARD_ORDER.SCORE
          ? [...view.cards].sort(
              (left, right) =>
                compareScoreDescending(
                  turnScores[left.layoutId],
                  turnScores[right.layoutId],
                ) || left.layoutId - right.layoutId,
            )
          : view.cards;
    const intended = new Set(selectedTurn?.intendedLayoutIds ?? []);
    const guesses = new Map(
      (selectedTurn?.guesses ?? []).map((guess, index) => [
        guess.layoutId,
        { ...guess, index: index + 1 },
      ]),
    );
    const cards = visibleCards.map((card) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "play-card";
      button.dataset.layoutId = String(card.layoutId);
      button.dataset.team = card.team ?? "hidden";
      button.classList.toggle("is-done", card.done);
      button.disabled = !canGuess || card.done;
      const word = document.createElement("span");
      word.className = "play-card-word";
      word.textContent = card.word;
      button.append(word);
      const score = turnScores[card.layoutId];
      const guess = guesses.get(card.layoutId);
      if (selectedTurn || Number.isFinite(score)) {
        button.dataset.intended = String(intended.has(card.layoutId));
        button.dataset.guessed = String(Boolean(guess));
        if (guess) {
          button.dataset.outcome =
            sideForTeam(guess.team) === selectedTurn.side ? "correct" : "mistake";
        }
        const annotations = document.createElement("span");
        annotations.className = "play-card-annotations";
        if (selectedTurn && intended.has(card.layoutId)) {
          const target = document.createElement("span");
          target.className = "play-card-marker is-target";
          target.textContent = translate(gameLanguage(), "target");
          annotations.append(target);
        }
        if (selectedTurn && guess) {
          const outcome = document.createElement("span");
          outcome.className = "play-card-marker is-guess";
          outcome.dataset.outcome =
            sideForTeam(guess.team) === selectedTurn.side ? "correct" : "mistake";
          outcome.textContent = translate(gameLanguage(), "guessOrdinal", {
            index: guess.index,
          });
          annotations.append(outcome);
        }
        if (Number.isFinite(score)) {
          button.dataset.operativeScore = score.toFixed(3);
          const scoreLabel = document.createElement("span");
          scoreLabel.className = "play-card-operative-score";
          scoreLabel.textContent = score.toFixed(3);
          scoreLabel.title = translate(
            gameLanguage(),
            "operativeCosineSimilarity",
          );
          annotations.append(scoreLabel);
        }
        button.append(annotations);
      }
      const role = card.team
        ? localizedTeamLabel(card.team)
        : translate(gameLanguage(), "unrevealed");
      const reviewDetails =
        selectedTurn || Number.isFinite(score)
          ? [
            intended.has(card.layoutId)
              ? translate(gameLanguage(), "intendedTarget")
              : null,
            guess
              ? translate(gameLanguage(), "guessReview", {
                  index: guess.index,
                  outcome: translate(
                    gameLanguage(),
                    sideForTeam(guess.team) === selectedTurn.side
                      ? "correct"
                      : "mistake",
                  ),
                })
              : null,
            Number.isFinite(score)
              ? translate(gameLanguage(), "operativeScore", {
                  score: score.toFixed(3),
                })
              : null,
            ].filter(Boolean)
          : [];
      const cardLabel =
        card.done || card.team
          ? `${card.word}, ${role}`
          : translate(gameLanguage(), "guessWord", { word: card.word });
      button.setAttribute(
        "aria-label",
        `${cardLabel}${
          card.done
            ? translate(gameLanguage(), "revealedBeforeClue")
            : ""
        }${reviewDetails.length ? `, ${reviewDetails.join(", ")}` : ""}`,
      );
      if (canGuess && !card.done) {
        button.addEventListener("click", () =>
          runHumanAction((current) =>
            guessCard(current, { layoutId: card.layoutId, actor: "human" }),
          ),
        );
      }
      return button;
    });
    elements.boardGrid.replaceChildren(...cards);
  }

  function renderTurnPanel(currentActor, currentRole, selectedTurn) {
    const humanSpymaster =
      game.phase === GAME_PHASE.AWAITING_CLUE &&
      currentActor === "human" &&
      currentRole === PLAYER_ROLE.SPYMASTER;
    const humanOperative =
      game.phase === GAME_PHASE.AWAITING_GUESS &&
      currentActor === "human" &&
      currentRole === PLAYER_ROLE.OPERATIVE;

    const displaySide =
      selectedTurn?.side ??
      (game.phase === GAME_PHASE.COMPLETE ? game.winner : game.activeSide);
    elements.clueDisplay.dataset.side = displaySide;
    const turnLabel = document.createElement("span");
    turnLabel.className = "play-turn-team";
    const turnAction = document.createElement("strong");
    const turnNote = document.createElement("span");
    turnNote.className = "play-turn-note";
    const botWaitDetail =
      currentActor === "bot"
        ? currentRole === PLAYER_ROLE.SPYMASTER
          ? statusMessage || translate(gameLanguage(), "botStudying")
          : translate(gameLanguage(), "botChoosingCard")
        : "";
    const waitDetailVisible = syncBotWaitDetail(
      currentActor === "bot" && !statusMessageIsError
        ? currentBotWaitKey()
        : "",
    );

    if (selectedTurn) {
      turnLabel.textContent = translate(
        gameLanguage(),
        game.phase === GAME_PHASE.COMPLETE
          ? "postGameTurn"
          : "liveAnalysisTurn",
        {
          current: selectedPostGameTurn + 1,
          total: postGameTurns.length,
        },
      );
      turnAction.className = "play-current-clue";
      turnAction.append(
        createCluePill(selectedTurn.clue),
        createClueNumberPill(selectedTurn.number),
      );
      turnNote.hidden = true;
    } else if (game.currentTurn) {
      turnLabel.textContent = translate(gameLanguage(), "turn", {
        side: localizedSideLabel(game.currentTurn.side),
      });
      turnAction.className = "play-current-clue";
      turnAction.append(
        createCluePill(game.currentTurn.clue),
        createClueNumberPill(game.currentTurn.number),
      );
      turnNote.textContent =
        currentActor === "human"
          ? translate(gameLanguage(), "chooseOrPass")
          : "";
    } else if (game.phase === GAME_PHASE.COMPLETE) {
      const reason =
        game.endReason === GAME_END_REASON.ASSASSIN
          ? translate(gameLanguage(), "assassinEnded")
          : translate(gameLanguage(), "agentsFound");
      turnLabel.textContent = translate(gameLanguage(), "gameComplete");
      turnAction.textContent = translate(gameLanguage(), "wins", {
        side: localizedSideLabel(game.winner),
      });
      turnNote.textContent = reason;
    } else {
      turnLabel.textContent = translate(gameLanguage(), "turn", {
        side: localizedSideLabel(game.activeSide),
      });
      turnAction.textContent =
        currentActor === "human"
          ? translate(gameLanguage(), "giveClue")
          : translate(gameLanguage(), "turnInProgress");
      turnNote.textContent =
        currentActor === "human"
          ? translate(gameLanguage(), "oneWordNumber")
          : "";
    }
    if (currentActor === "bot" && !statusMessageIsError) {
      renderBotWaitNote(turnNote, botWaitDetail, waitDetailVisible);
    } else if (
      !selectedTurn &&
      statusMessage &&
      !turnNote.textContent.includes(statusMessage)
    ) {
      turnNote.textContent = statusMessage;
    }
    elements.clueDisplay.replaceChildren(turnLabel, turnAction, turnNote);

    elements.clueForm.hidden = !humanSpymaster || Boolean(selectedTurn);
    elements.operativeControls.hidden =
      !humanOperative || Boolean(selectedTurn);
    renderClearClueButton();
    renderSuggestionVisibility(humanSpymaster && !selectedTurn);

    if (humanSpymaster) {
      renderClueNumber();
    }
    if (humanOperative) {
      const guesses = game.currentTurn.guesses.length;
      const limit = game.currentTurn.number + 1;
      elements.guessProgress.textContent = translate(
        gameLanguage(),
        "guessesUsed",
        { used: guesses, limit },
      );
    }
  }

  function currentBotWaitKey() {
    if (!game || game.phase === GAME_PHASE.COMPLETE) {
      return "";
    }
    const role =
      game.phase === GAME_PHASE.AWAITING_CLUE
        ? PLAYER_ROLE.SPYMASTER
        : PLAYER_ROLE.OPERATIVE;
    if (actorForSeat(game, game.activeSide, role) !== "bot") {
      return "";
    }
    return [
      game.turnNumber,
      game.activeSide,
      game.phase,
      role,
      game.history.length,
    ].join(":");
  }

  function syncBotWaitDetail(nextKey) {
    if (!nextKey) {
      clearBotWaitDetail();
      return false;
    }
    if (nextKey === botWaitKey) {
      return botWaitDetailVisible;
    }
    clearBotWaitDetail();
    botWaitKey = nextKey;
    botWaitDetailTimer = window.setTimeout(() => {
      botWaitDetailTimer = 0;
      if (!active || botWaitKey !== nextKey || currentBotWaitKey() !== nextKey) {
        return;
      }
      botWaitDetailVisible = true;
      renderGame();
    }, BOT_WAIT_DETAIL_DELAY);
    return false;
  }

  function clearBotWaitDetail() {
    window.clearTimeout(botWaitDetailTimer);
    botWaitDetailTimer = 0;
    botWaitKey = "";
    botWaitDetailVisible = false;
  }

  function renderBotWaitNote(note, detail, detailVisible) {
    note.classList.add("is-bot-wait");
    note.classList.toggle("is-detailed", detailVisible);
    note.dataset.waitDetail = detailVisible ? "visible" : "pending";
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");

    const progress = document.createElement("span");
    progress.className = "play-turn-progress";
    const spinner = document.createElement("span");
    spinner.className = "play-turn-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const progressLabel = document.createElement("span");
    progressLabel.textContent = translate(
      gameLanguage(),
      "turnInProgress",
    );
    progress.append(spinner, progressLabel);

    const detailText = document.createElement("span");
    detailText.className = "play-turn-wait-detail";
    detailText.textContent = detail;
    note.replaceChildren(progress, detailText);
  }

  function renderLiveDiagnosticsToggle() {
    const developerGame = game.developerMode === true;
    elements.liveDiagnosticsToggle.hidden = !developerGame;
    elements.liveDiagnostics.checked =
      developerGame && liveDiagnosticsVisible;
  }

  function currentClueDiagnosticsKey() {
    if (!game?.currentTurn) {
      return "";
    }
    return [
      game.seed,
      game.turnNumber,
      game.currentTurn.clue,
      game.botSettings.modelId,
    ].join(":");
  }

  function ensureCurrentClueDeveloperDiagnostics() {
    if (
      !active ||
      !game?.developerMode ||
      game.phase !== GAME_PHASE.AWAITING_GUESS ||
      !game.currentTurn
    ) {
      return;
    }
    if (!guessCandidateExecutor && (!boardVectors || !clueIndex)) {
      return;
    }
    const key = currentClueDiagnosticsKey();
    const savedScores =
      game.currentTurn.developerDiagnostics?.operativeScores;
    if (
      Array.isArray(savedScores) &&
      savedScores.length === game.cards.length
    ) {
      if (
        liveDiagnosticsState.key !== key ||
        liveDiagnosticsState.status !== "ready"
      ) {
        liveDiagnosticsState = {
          candidates: savedScores,
          key,
          status: "ready",
        };
      }
      return;
    }
    if (
      liveDiagnosticsState.key === key &&
      liveDiagnosticsState.status === "loading"
    ) {
      return;
    }

    const runId = ++liveDiagnosticsRun;
    const clue = game.currentTurn.clue;
    liveDiagnosticsState = {
      candidates: [],
      key,
      status: "loading",
    };
    void buildBotGuessCandidates(clue, { includeRevealed: true })
      .then((candidates) => {
        if (
          runId !== liveDiagnosticsRun ||
          !game?.currentTurn ||
          currentClueDiagnosticsKey() !== key
        ) {
          return;
        }
        const operativeScores = serializeOperativeScores(candidates);
        game = recordCurrentClueDeveloperDiagnostics(game, {
          diagnosticsVersion: 1,
          modelId: activeModelId ?? game.botSettings.modelId,
          operativeScores,
        });
        savedGame = game;
        persistPlayGame(game);
        liveDiagnosticsState = {
          candidates: operativeScores,
          key,
          status: "ready",
        };
        renderGame();
        ensurePostGameAnalysis();
      })
      .catch(() => {
        if (runId !== liveDiagnosticsRun) {
          return;
        }
        liveDiagnosticsState = {
          candidates: [],
          key,
          status: "error",
        };
        renderGame();
      });
  }

  function canCollectPlayerFeedback() {
    return (
      game?.phase === GAME_PHASE.COMPLETE &&
      game.origin === GAME_ORIGIN.LOCAL
    );
  }

  function openFeedbackForm(scope) {
    if (!canCollectPlayerFeedback()) return;
    feedbackScope = scope;
    elements.feedbackForm.hidden = false;
    elements.feedbackStatus.textContent = "";
    elements.feedbackTarget.textContent =
      scope.type === "game"
        ? translate(gameLanguage(), "feedbackForGame")
        : scope.type === "turn"
          ? translate(gameLanguage(), "feedbackForTurn", {
              turn: scope.turn,
            })
          : translate(gameLanguage(), "feedbackForAction", {
              action: localizedFeedbackAction(scope.actionType),
              turn: scope.turn,
            });
    elements.feedbackNote.focus({ preventScroll: true });
  }

  function closeFeedbackForm() {
    if (feedbackSending) return;
    feedbackScope = null;
    elements.feedbackForm.hidden = true;
    elements.feedbackStatus.textContent = "";
  }

  async function submitPlayerFeedback() {
    if (!feedbackScope || !game || feedbackSending) return;
    feedbackSending = true;
    elements.feedbackSubmit.disabled = true;
    elements.feedbackCancel.disabled = true;
    elements.feedbackStatus.textContent = "";
    try {
      await analyticsSync.submitFeedback(game, {
        scope: feedbackScope,
        category: elements.feedbackCategory.value,
        note: elements.feedbackNote.value,
      });
      elements.feedbackNote.value = "";
      elements.feedbackStatus.textContent = translate(
        gameLanguage(),
        "feedbackSent",
      );
    } catch {
      elements.feedbackStatus.textContent = translate(
        gameLanguage(),
        "feedbackFailed",
      );
    } finally {
      feedbackSending = false;
      elements.feedbackSubmit.disabled = false;
      elements.feedbackCancel.disabled = false;
    }
  }

  function localizedFeedbackAction(actionType) {
    const key = {
      "clue-given": "historyClueAction",
      "card-guessed": "historyGuessAction",
      "turn-passed": "historyPassAction",
    }[actionType];
    return key
      ? translate(gameLanguage(), key).toLocaleLowerCase(gameLanguage())
      : actionType;
  }

  function renderPostGameAnalysis(selectedTurn) {
    const feedbackAvailable = canCollectPlayerFeedback();
    elements.postGameAnalysis.hidden = !selectedTurn && !feedbackAvailable;
    elements.feedbackActions.hidden = !feedbackAvailable;
    if (!feedbackAvailable) {
      feedbackScope = null;
      elements.feedbackForm.hidden = true;
    }
    if (!selectedTurn) {
      elements.conceptBridges.hidden = true;
      elements.conceptBridges.replaceChildren();
      return;
    }
    elements.historicalReviewNote.hidden =
      game.reviewCompatibility !== "history-only";
    elements.postGameAnalysisStatus.hidden =
      postGameAnalysisState === "ready" ||
      postGameAnalysisState === "idle";
    elements.postGameAnalysisStatus.classList.toggle(
      "is-error",
      postGameAnalysisState === "error",
    );
    elements.postGameAnalysisStatus.textContent = postGameAnalysisMessage;
    renderConceptBridges(selectedTurn);
    elements.postGameOutcome.textContent =
      game.phase === GAME_PHASE.COMPLETE
        ? `${sideEmoji(game.winner)} ${translate(
            gameLanguage(),
            "postGameOutcome",
            {
              winner: localizedSideLabel(game.winner),
              reason: translate(
                gameLanguage(),
                game.endReason === GAME_END_REASON.ASSASSIN
                  ? "assassin"
                  : "allAgents",
              ),
            },
          )}`
        : translate(gameLanguage(), "developerGame");
  }

  function renderConceptBridges(selectedTurn) {
    const bridgeByLayoutId =
      postGameConceptBridges[selectedPostGameTurn] ?? {};
    const turnScores = postGameScores[selectedPostGameTurn] ?? {};
    const bridges = Object.entries(bridgeByLayoutId)
      .map(([layoutId, bridge]) => ({
        bridge,
        card: game.cards.find(
          (candidate) => candidate.layoutId === Number(layoutId),
        ),
        score: turnScores[layoutId],
      }))
      .filter(({ bridge, card }) =>
        Boolean(
          bridge?.clueSense &&
            bridge?.cardSense &&
            card,
        ),
      )
      .sort(
        (left, right) =>
          compareScoreDescending(left.score, right.score) ||
          left.card.layoutId - right.card.layoutId,
      );
    elements.conceptBridges.hidden = bridges.length === 0;
    if (bridges.length === 0) {
      elements.conceptBridges.replaceChildren();
      return;
    }

    const heading = document.createElement("div");
    heading.className = "play-concept-bridges-heading";
    const title = document.createElement("strong");
    title.textContent = translate(gameLanguage(), "conceptBridgeHeading");
    const count = document.createElement("span");
    count.textContent = translate(gameLanguage(), "conceptBridgeCount", {
      count: bridges.length,
    });
    heading.append(title, count);

    const help = document.createElement("p");
    help.className = "play-concept-bridges-help";
    help.textContent = translate(gameLanguage(), "conceptBridgeHelp", {
      clue: selectedTurn.clue,
    });

    const list = document.createElement("ul");
    list.className = "play-concept-bridges-list";
    for (const { bridge, card } of bridges.slice(
      0,
      CONCEPT_BRIDGE_DISPLAY_LIMIT,
    )) {
      const item = document.createElement("li");
      const cardName = document.createElement("strong");
      cardName.textContent = card.word;
      const path = document.createElement("span");
      path.textContent = `${bridge.clueSense} → ${bridge.cardSense}`;
      item.append(cardName, path);
      list.append(item);
    }

    const extraCount = bridges.length - list.children.length;
    const extra = document.createElement("p");
    extra.className = "play-concept-bridges-extra";
    extra.hidden = extraCount === 0;
    extra.textContent = translate(gameLanguage(), "moreConceptBridges", {
      count: extraCount,
    });
    elements.conceptBridges.replaceChildren(heading, help, list, extra);
  }

  function turnAnalysisEnabled() {
    return (
      game?.phase === GAME_PHASE.COMPLETE ||
      (game?.developerMode === true && liveDiagnosticsVisible)
    );
  }

  function retryLoadMessage(event) {
    return translate(
      gameLanguage(),
      event.resource === "model"
        ? "retryingModelLoad"
        : "retryingIndexLoad",
      event,
    );
  }

  function renderSuggestionVisibility(humanSpymaster) {
    const nextTurnKey = game ? `${game.turnNumber}:${game.activeSide}` : "";
    if (suggestionTurnKey !== nextTurnKey) {
      suggestionTurnKey = nextTurnKey;
      suggestionsExpanded = false;
    }
    elements.toggleSuggestions.hidden = !humanSpymaster;
    elements.toggleSuggestions.setAttribute(
      "aria-expanded",
      String(humanSpymaster && suggestionsExpanded),
    );
    const toggleLabel = translate(
      gameLanguage(),
      suggestionsExpanded ? "hideSuggestions" : "showSuggestions",
    );
    elements.toggleSuggestions.setAttribute("aria-label", toggleLabel);
    elements.toggleSuggestions.title = toggleLabel;
    elements.suggestions.hidden = !humanSpymaster || !suggestionsExpanded;
    if (humanSpymaster && suggestionsExpanded) {
      renderSuggestions();
    }
  }

  function renderClueNumber() {
    const maximum = remainingCardsForSide(game.cards, game.activeSide);
    const previous = Number(elements.clueNumber.value) || Math.min(2, maximum);
    const options = Array.from({ length: maximum }, (_, index) => {
      const option = document.createElement("option");
      option.value = String(index + 1);
      option.textContent = String(index + 1);
      return option;
    });
    elements.clueNumber.replaceChildren(...options);
    elements.clueNumber.value = String(Math.min(previous, maximum));
  }

  function renderSuggestions() {
    const suggestions = [...(analysis[game.activeSide]?.suggestions ?? [])]
      .sort((left, right) => right.worth - left.worth)
      .slice(0, 5);
    if (suggestions.length === 0) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = translate(gameLanguage(), "loadingSuggestions");
      elements.suggestionList.replaceChildren(message);
      return;
    }
    const buttons = suggestions.map((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "play-suggestion";
      button.classList.toggle(
        "is-developer",
        game.developerMode && liveDiagnosticsVisible,
      );
      const clue = document.createElement("strong");
      clue.textContent = `${suggestion.clue.toLocaleUpperCase(
        gameLanguage(),
      )} ${suggestion.number}`;
      const worth = document.createElement("span");
      worth.className = "play-suggestion-metric";
      worth.dataset.tone = worthTone(suggestion.worth);
      worth.textContent = translate(gameLanguage(), "worth", {
        value: suggestion.worth,
      });
      const safety = document.createElement("span");
      const safetyScore = Math.min(99, Math.round(suggestion.success * 100));
      safety.className = "play-suggestion-metric";
      safety.dataset.risk = suggestion.risk;
      const riskLabel = translate(gameLanguage(), suggestion.risk);
      safety.textContent = translate(gameLanguage(), "safety", {
        label: riskLabel,
        score: safetyScore,
      });
      safety.title =
        `${riskLabel}: ${safetyScore}/99`;
      button.append(clue, worth, safety);
      if (game.developerMode && liveDiagnosticsVisible) {
        const playScore = scorePlayClue(suggestion, {
          ownRemaining: remainingCardsForSide(game.cards, game.activeSide),
          opponentRemaining: remainingCardsForSide(
            game.cards,
            game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
          ),
          policy: game.botSettings.cluePolicy,
        });
        const score = document.createElement("span");
        score.className = "play-suggestion-metric";
        score.dataset.developerScore = "true";
        score.textContent = translate(gameLanguage(), "playScore", {
          score: playScore.toFixed(2),
        });
        const debug = document.createElement("span");
        debug.className = "play-suggestion-debug";
        debug.textContent = [
          `Net ${formatDeveloperNumber(suggestion.expectedNet)}`,
          `Margin ${formatDeveloperNumber(suggestion.margin)}`,
          `Hit ${formatDeveloperNumber(suggestion.success)}`,
          `Targets ${suggestion.targets
            .map(
              (target) =>
                `${target.word} ${formatDeveloperNumber(target.sim)}`,
            )
            .join(", ")}`,
        ].join(" · ");
        button.append(score, debug);
      }
      button.addEventListener("click", () => {
        selectedSuggestion = suggestion;
        elements.clueInput.value = suggestion.clue;
        elements.clueNumber.value = String(suggestion.number);
        renderClearClueButton();
        elements.clueInput.focus();
      });
      return button;
    });
    elements.suggestionList.replaceChildren(...buttons);
  }

  function renderClearClueButton() {
    elements.clearClue.hidden = elements.clueInput.value.length === 0;
  }

  function selectedSuggestionTargets() {
    if (
      !selectedSuggestion ||
      selectedSuggestion.clue.toLowerCase() !==
        elements.clueInput.value.trim().toLowerCase() ||
      selectedSuggestion.number !== Number(elements.clueNumber.value)
    ) {
      return [];
    }
    return selectedSuggestion.targets.map((target) => target.layoutId);
  }

  function renderHistory(history) {
    let actionIndex = 0;
    const visible = history.flatMap((event) => {
      if (![
        "clue-given",
        "card-guessed",
        "turn-passed",
        "game-ended",
      ].includes(event.type)) {
        return [];
      }
      if (!["clue-given", "card-guessed", "turn-passed"].includes(event.type)) {
        return [event];
      }
      const visibleEvent = {
        ...event,
        analyticsActionIndex: actionIndex,
      };
      actionIndex += 1;
      return [visibleEvent];
    });
    elements.historyLabel.textContent = translate(
      gameLanguage(),
      game.phase === GAME_PHASE.COMPLETE
        ? "postGameAnalysis"
        : turnAnalysisEnabled()
          ? "liveAnalysis"
          : "gameLog",
    );
    elements.historyCount.textContent = translate(gameLanguage(), "events", {
      count: visible.length,
    });
    for (const button of elements.historyViewButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playHistoryView === playHistoryView),
      );
    }
    elements.historyList.hidden = playHistoryView !== PLAY_HISTORY_VIEW.TIMELINE;
    elements.historyTeamLists.hidden = playHistoryView !== PLAY_HISTORY_VIEW.TEAMS;

    renderHistoryList(
      elements.historyList,
      visible,
      translate(gameLanguage(), "noGameActions"),
      { showSide: true },
    );
    renderHistoryList(
      elements.historyBlueList,
      visible.filter((event) => (event.side ?? event.winner) === SIDE.BLUE),
      translate(gameLanguage(), "noSideActions", {
        side: localizedSideLabel(SIDE.BLUE),
      }),
      { showSide: false },
    );
    renderHistoryList(
      elements.historyRedList,
      visible.filter((event) => (event.side ?? event.winner) === SIDE.RED),
      translate(gameLanguage(), "noSideActions", {
        side: localizedSideLabel(SIDE.RED),
      }),
      { showSide: false },
    );
  }

  function renderHistoryList(list, events, emptyMessage, { showSide }) {
    const items = events.length
      ? groupHistoryEvents(events).map((turn) =>
          createHistoryTurn(turn, { showSide }),
        )
      : [createEmptyHistoryItem(emptyMessage)];
    list.replaceChildren(...items);
    if (turnAnalysisEnabled()) {
      const selectedItem = list.querySelector(
        `[data-analysis-turn="${selectedPostGameTurn}"]`,
      );
      const selectedTurn = selectedItem?.closest(".play-history-turn");
      list.scrollTop = selectedTurn
        ? selectedTurn.offsetTop - list.offsetTop
        : list.scrollHeight;
    } else {
      list.scrollTop = list.scrollHeight;
    }
  }

  function previewHistoryTurn(turnIndex, previewed) {
    for (const list of [
      elements.historyList,
      elements.historyBlueList,
      elements.historyRedList,
    ]) {
      for (const item of list.querySelectorAll(
        `[data-analysis-turn="${turnIndex}"]`,
      )) {
        item.classList.toggle("is-previewed", previewed);
      }
    }
  }

  function groupHistoryEvents(events) {
    const turns = [];
    for (const event of events) {
      const side = event.side ?? event.winner ?? "";
      const currentTurn = turns.at(-1);
      const continuesCurrentTurn =
        currentTurn &&
        event.type !== "clue-given" &&
        currentTurn.turn === event.turn &&
        (event.type === "game-ended" || currentTurn.side === side);
      if (continuesCurrentTurn) {
        currentTurn.events.push(event);
      } else {
        turns.push({
          turn: event.turn,
          side,
          events: [event],
        });
      }
    }
    return turns;
  }

  function createHistoryTurn(turn, { showSide }) {
    const item = document.createElement("li");
    const header = document.createElement("div");
    const actions = document.createElement("ol");
    const turnIndex =
      turnAnalysisEnabled() && Number.isInteger(turn.turn)
        ? postGameTurns.findIndex(
            (candidate) =>
              candidate.turn === turn.turn && candidate.side === turn.side,
          )
        : -1;
    const clueEvent = turn.events.find((event) => event.type === "clue-given");
    const heading = document.createElement(turnIndex >= 0 ? "button" : "div");
    item.className = "play-history-turn";
    item.dataset.side = turn.side;
    item.dataset.turn = String(turn.turn);
    if (turnIndex >= 0) {
      item.dataset.analysisTurn = String(turnIndex);
      item.classList.toggle(
        "is-selected",
        turnIndex === selectedPostGameTurn,
      );
      item.classList.add("is-reviewable");
      heading.type = "button";
      heading.setAttribute(
        "aria-label",
        translate(gameLanguage(), "reviewTurn", {
          turn: turnIndex + 1,
          side: localizedSideLabel(turn.side),
          clue: clueEvent?.clue,
          number: clueEvent?.number,
        }),
      );
      heading.setAttribute(
        "aria-pressed",
        String(turnIndex === selectedPostGameTurn),
      );
      let pointerPreviewed = false;
      let focusPreviewed = false;
      const updatePreview = () =>
        previewHistoryTurn(
          turnIndex,
          pointerPreviewed || focusPreviewed,
        );
      item.addEventListener("pointerenter", () => {
        pointerPreviewed = true;
        updatePreview();
      });
      item.addEventListener("pointerleave", () => {
        pointerPreviewed = false;
        updatePreview();
      });
      heading.addEventListener("focus", () => {
        focusPreviewed = true;
        updatePreview();
      });
      heading.addEventListener("blur", () => {
        focusPreviewed = false;
        updatePreview();
      });
      heading.addEventListener("click", (event) => {
        event.stopPropagation();
        selectHistoryTurn(turnIndex);
      });
      item.addEventListener("click", (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, a")
        ) {
          return;
        }
        selectHistoryTurn(turnIndex);
      });
    }
    heading.className =
      turnIndex >= 0
        ? "play-history-turn-heading play-history-turn-review"
        : "play-history-turn-heading";
    header.className = "play-history-turn-header";
    header.textContent = showSide
      ? `${sideEmoji(turn.side)} ${localizedSideLabel(turn.side)} · ${translate(
          gameLanguage(),
          "historyTurnNumber",
          { turn: turn.turn },
        )}`
      : translate(gameLanguage(), "historyTurnNumber", { turn: turn.turn });
    heading.append(header);
    if (turnIndex === selectedPostGameTurn) {
      const viewing = document.createElement("span");
      viewing.className = "play-history-viewing";
      viewing.textContent = translate(gameLanguage(), "viewing");
      heading.append(viewing);
    }
    actions.className = "play-history-actions";
    let turnFeedback = null;
    if (canCollectPlayerFeedback() && Number.isInteger(turn.turn)) {
      turnFeedback = document.createElement("button");
      turnFeedback.type = "button";
      turnFeedback.className = "play-feedback-link";
      turnFeedback.textContent = translate(
        gameLanguage(),
        "sendTurnFeedback",
      );
      turnFeedback.addEventListener("click", () => {
        openFeedbackForm({ type: "turn", turn: turn.turn });
      });
    }
    actions.append(
      ...turn.events.map((event) =>
        createHistoryItem(event, turnIndex, clueEvent),
      ),
    );
    item.append(
      heading,
      ...(turnFeedback ? [turnFeedback] : []),
      actions,
    );
    return item;
  }

  function selectHistoryTurn(turnIndex, explanation = null) {
    const scrollPositions = [
      elements.historyList,
      elements.historyBlueList,
      elements.historyRedList,
    ].map((list) => [list, list.scrollTop]);
    selectedPostGameTurn = turnIndex;
    selectedHistoryExplanation = explanation;
    renderGame();
    for (const [list, scrollTop] of scrollPositions) {
      list.scrollTop = scrollTop;
    }
  }

  function createHistoryItem(
    event,
    turnIndex = -1,
    clueEvent = null,
  ) {
    const item = document.createElement("li");
    item.className = "play-history-action";
    item.dataset.action = event.type;
    if (event.type === "clue-given") {
      const analysisEnabled = turnAnalysisEnabled();
      const intendedTargets =
        analysisEnabled && event.intendedLayoutIds?.length
          ? event.intendedLayoutIds
              .map((layoutId) =>
                game.cards.find((card) => card.layoutId === layoutId),
              )
              .filter(Boolean)
          : [];
      const intendedWords = intendedTargets.map(({ word }) => word);
      const summary = document.createElement("div");
      summary.className = "play-history-event-summary";
      appendHistoryClueSummary(summary, event, intendedTargets);
      if (analysisEnabled && intendedWords.length) {
        appendHistoryExplanationSelection(
          item,
          summary,
          {
            clue: event.clue,
            targets: intendedTargets,
          },
          {
            selectionKey: `${turnIndex}:clue`,
            selectionLabel: translate(
              gameLanguage(),
              "selectClueExplanation",
              {
                clue: event.clue,
                targets: intendedWords.join(", "),
              },
            ),
            turnIndex,
          },
        );
      } else {
        item.append(summary);
      }
    } else if (event.type === "card-guessed") {
      const guessSummary = document.createElement("div");
      guessSummary.className = "play-history-guess-summary";
      guessSummary.append(
        createHistoryActionLabel("historyGuessAction"),
        ": ",
        createHistoryCardPill(event.word, event.team),
      );
      if (turnAnalysisEnabled() && clueEvent?.clue) {
        const guessedCard =
          game.cards.find((card) => card.layoutId === event.layoutId) ?? event;
        appendHistoryExplanationSelection(
          item,
          guessSummary,
          {
            clue: clueEvent.clue,
            targets: [guessedCard],
          },
          {
            explanationType: "guess",
            selectionKey: `${turnIndex}:guess:${event.layoutId}`,
            selectionLabel: translate(
              gameLanguage(),
              "selectGuessExplanation",
              {
                clue: clueEvent.clue,
                guess: event.word,
              },
            ),
            turnIndex,
          },
        );
      } else {
        item.append(guessSummary);
      }
    } else if (event.type === "turn-passed") {
      item.append(createHistoryActionLabel("historyPassAction"));
    } else {
      item.textContent = `🏁 ${translate(gameLanguage(), "historyWin", {
        side: localizedSideLabel(event.winner),
        reason: translate(
          gameLanguage(),
          event.reason === GAME_END_REASON.ASSASSIN
            ? "assassin"
            : "everyAgent",
        ),
      })}`;
    }
    if (
      canCollectPlayerFeedback() &&
      Number.isInteger(event.analyticsActionIndex)
    ) {
      const feedback = document.createElement("button");
      feedback.type = "button";
      feedback.className = "play-feedback-link play-feedback-action-link";
      feedback.textContent = translate(
        gameLanguage(),
        "sendActionFeedback",
      );
      feedback.addEventListener("click", () => {
        openFeedbackForm({
          type: "action",
          turn: event.turn,
          actionIndex: event.analyticsActionIndex,
          actionType: event.type,
        });
      });
      item.append(feedback);
    }
    return item;
  }

  function createCluePill(clue) {
    const pill = document.createElement("span");
    pill.className = "play-clue-pill";
    pill.textContent = clue;
    return pill;
  }

  function createClueNumberPill(number) {
    const pill = document.createElement("span");
    pill.className = "play-history-clue-number";
    pill.textContent = String(number);
    pill.setAttribute(
      "aria-label",
      translate(gameLanguage(), "clueNumberLabel", { number }),
    );
    pill.title = translate(gameLanguage(), "clueNumber");
    return pill;
  }

  function appendHistoryClueSummary(container, event, intendedTargets) {
    const clueLine = document.createElement("span");
    clueLine.className = "play-history-clue-line";
    clueLine.append(
      createHistoryActionLabel("historyClueAction"),
      ": ",
      createCluePill(event.clue),
      " ",
      createClueNumberPill(event.number),
    );
    container.append(clueLine);
    if (intendedTargets.length) {
      const targetsLine = document.createElement("span");
      targetsLine.className = "play-history-targets-line";
      targetsLine.append(
        createHistoryActionLabel("historyTargetsAction"),
        " ",
      );
      intendedTargets.forEach((target, index) => {
        if (index > 0) {
          targetsLine.append(" + ");
        }
        targetsLine.append(createHistoryCardPill(target.word, target.team));
      });
      container.append(targetsLine);
    }
  }

  function appendHistoryExplanationSelection(
    item,
    summary,
    suggestion,
    {
      explanationType = "clue",
      selectionKey,
      selectionLabel,
      turnIndex,
    },
  ) {
    const row = document.createElement("div");
    const selector = document.createElement("button");
    const actionSlot = document.createElement("span");
    const explanation = createRecommendationExplanationControl(suggestion, {
      wordPills: true,
      language: gameLanguage(),
      explanationType,
      buttonContainer: actionSlot,
    });
    const explainButton = actionSlot.querySelector(
      ".explain-recommendation-button",
    );
    explanation.classList.add("play-history-explanation");
    if (explanationType === "guess") {
      explanation.classList.add("play-history-guess-explanation");
    }
    if (!explainButton) {
      item.append(summary, explanation);
      return;
    }

    row.className = "play-history-selectable-row";
    row.classList.toggle(
      "is-selected",
      selectedHistoryExplanation === selectionKey,
    );
    selector.type = "button";
    selector.className = "play-history-row-select";
    selector.setAttribute("aria-label", selectionLabel);
    selector.setAttribute(
      "aria-pressed",
      String(selectedHistoryExplanation === selectionKey),
    );
    selector.append(summary);
    actionSlot.className = "play-history-inline-actions";
    actionSlot.hidden = selectedHistoryExplanation !== selectionKey;
    selector.addEventListener("click", (event) => {
      event.stopPropagation();
      selectHistoryTurn(turnIndex, selectionKey);
    });
    row.append(selector, actionSlot);
    item.append(row, explanation);
  }

  function createHistoryActionLabel(key) {
    const label = document.createElement("strong");
    label.className = "play-history-action-label";
    label.textContent = translate(gameLanguage(), key);
    return label;
  }

  function createHistoryCardPill(word, team) {
    const pill = document.createElement("span");
    pill.className = "play-history-card";
    pill.dataset.team = team;
    pill.textContent = word;
    const teamLabel = localizedTeamLabel(team);
    pill.setAttribute(
      "aria-label",
      translate(gameLanguage(), "teamCard", { word, team: teamLabel }),
    );
    pill.title = translate(gameLanguage(), "cardRole", { team: teamLabel });
    return pill;
  }

  function createEmptyHistoryItem(message) {
    const item = document.createElement("li");
    item.className = "play-history-empty";
    item.textContent = message;
    return item;
  }

}

function serializeSuggestionDiagnostics(suggestion, playScore) {
  return {
    clue: suggestion.clue,
    number: suggestion.number,
    playScore,
    worth: suggestion.worth,
    expectedNet: suggestion.expectedNet,
    success: suggestion.success,
    margin: suggestion.margin,
    risk: suggestion.risk,
    targets: suggestion.targets.map(({ layoutId, word, sim }) => ({
      layoutId,
      word,
      similarity: sim,
    })),
    ...(suggestion.closestDanger
      ? {
          closestDanger: {
            layoutId: suggestion.closestDanger.layoutId,
            word: suggestion.closestDanger.word,
            team: suggestion.closestDanger.team,
            similarity: suggestion.closestDanger.sim,
            weighted: suggestion.closestDanger.weighted,
          },
        }
      : {}),
  };
}

function serializeSpymasterDecision(decision) {
  const ranked = decision.ranked.map(({ suggestion, playScore }) =>
    serializeSuggestionDiagnostics(suggestion, playScore),
  );
  const selected =
    ranked.find(
      (candidate) =>
        candidate.clue === decision.selected.clue &&
        candidate.number === decision.selected.number,
    ) ?? ranked[0];
  return {
    kind: "spymaster",
    ranked,
    selected,
    selection: decision.selection,
  };
}

function developerSuggestionDecision(suggestion, game) {
  const playScore = scorePlayClue(suggestion, {
    ownRemaining: remainingCardsForSide(game.cards, game.activeSide),
    opponentRemaining: remainingCardsForSide(
      game.cards,
      game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
    ),
    policy: game.botSettings.cluePolicy,
  });
  return {
    kind: "spymaster",
    ranked: [serializeSuggestionDiagnostics(suggestion, playScore)],
    selected: serializeSuggestionDiagnostics(suggestion, playScore),
    selection: "human-selection",
  };
}

function serializeOperativeScores(candidates) {
  const retainedConceptBridgeIds = new Set(
    [...candidates]
      .filter(({ conceptBridge }) => conceptBridge)
      .sort(
        (left, right) =>
          compareScoreDescending(
            left.rankingScore ?? left.similarity,
            right.rankingScore ?? right.similarity,
          ) || left.layoutId - right.layoutId,
      )
      .slice(0, CONCEPT_BRIDGE_DISPLAY_LIMIT)
      .map(({ layoutId }) => layoutId),
  );
  return candidates.map(
    ({
      conceptBridge,
      conceptSimilarity,
      layoutId,
      rankingScore,
      similarity,
    }) => ({
    layoutId,
    similarity: rankingScore ?? similarity,
    directSimilarity: similarity,
    ...(Number.isFinite(conceptSimilarity)
      ? { conceptSimilarity }
      : {}),
    ...(conceptBridge && retainedConceptBridgeIds.has(layoutId)
      ? {
          conceptBridge: {
            clueSense: conceptBridge.clueSense,
            cardSense: conceptBridge.cardSense,
            similarity: conceptBridge.similarity,
          },
        }
      : {}),
  }),
  );
}

function conceptBridgeMap(candidates) {
  return Object.fromEntries(
    candidates
      .filter(
        ({ conceptBridge }) =>
          conceptBridge?.clueSense && conceptBridge?.cardSense,
      )
      .map(({ layoutId, conceptBridge }) => [
        layoutId,
        {
          clueSense: conceptBridge.clueSense,
          cardSense: conceptBridge.cardSense,
          similarity: conceptBridge.similarity,
        },
      ]),
  );
}

function serializeOperativeDecision(decision, game) {
  return {
    kind: "operative",
    clue: game.currentTurn.clue,
    turn: game.turnNumber,
    layoutId: decision.layoutId,
    gap: decision.gap,
    reason: decision.reason,
    thresholds: { ...decision.thresholds },
    ranked: decision.ranked.map(
      ({
        conceptSimilarity,
        layoutId,
        rankingScore,
        similarity,
        botScore,
      }) => ({
        layoutId,
        similarity,
        rankingScore: rankingScore ?? similarity,
        ...(Number.isFinite(conceptSimilarity)
          ? { conceptSimilarity }
          : {}),
        botScore,
      }),
    ),
  };
}

function formatDeveloperNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "N/A";
}

function localizedSideLabelForLanguage(side, language) {
  return translate(language, sideCopyKey(side));
}

function sideForTeam(team) {
  if (team === "friendly") {
    return SIDE.BLUE;
  }
  if (team === "enemy") {
    return SIDE.RED;
  }
  return null;
}

function labelRisk(risk) {
  return risk === "safe" ? "Safe" : risk === "risky" ? "Risky" : "Medium";
}
function worthTone(worth) {
  return worth >= 85 ? "high" : worth >= 70 ? "medium" : "low";
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function compareScoreDescending(leftScore, rightScore) {
  const leftIsFinite = Number.isFinite(leftScore);
  const rightIsFinite = Number.isFinite(rightScore);
  if (leftIsFinite && rightIsFinite) {
    return rightScore - leftScore;
  }
  if (leftIsFinite) {
    return -1;
  }
  if (rightIsFinite) {
    return 1;
  }
  return 0;
}

function formatMegabytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatCompactCount(count) {
  return `${count / 1000}k`;
}

function formatRelativeWork(count) {
  const relative = count / CANDIDATE_OPTIONS[0].count;
  return Number.isInteger(relative)
    ? `${relative}×`
    : `~${Number(relative.toFixed(1))}×`;
}

function settingsLabel(
  wordSet,
  wordReusePolicy,
  settings,
  language,
) {
  const model = modelOption(settings.modelId);
  const style = translate(
    language,
    settings.cluePolicy === "hybrid"
      ? "humanLike"
      : "conservative",
  ).toLocaleLowerCase(language);
  const clueReuse = translate(
    language,
    {
      [PLAY_CLUE_REPEAT_POLICY.NEVER]: "neverRepeatClues",
      [PLAY_CLUE_REPEAT_POLICY.PREVIOUS]: "blockPreviousClue",
      [PLAY_CLUE_REPEAT_POLICY.ALLOW]: "allowClueRepeats",
    }[settings.clueRepeatPolicy],
  ).toLocaleLowerCase(language);
  const aggression = translate(
    language,
    {
      [PLAY_OPERATIVE_AGGRESSION.CONSERVATIVE]:
        "conservativeOperative",
      [PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE]:
        "aggressiveOperative",
      [PLAY_OPERATIVE_AGGRESSION.DYNAMIC]: "dynamicOperative",
    }[settings.operativeAggression],
  ).toLocaleLowerCase(language);
  const missedTargets = translate(
    language,
    {
      [PLAY_MISSED_TARGET_TIMING.LATE]: "freshTargetsFirst",
      [PLAY_MISSED_TARGET_TIMING.BALANCED]: "missedTargetsMidGame",
      [PLAY_MISSED_TARGET_TIMING.IMMEDIATE]: "missedTargetsImmediate",
    }[settings.missedTargetTiming],
  ).toLocaleLowerCase(language);
  const operativeNoise = translate(
    language,
    settings.operativeNoise === PLAY_OPERATIVE_NOISE.STANDARD
      ? "variedGuesses"
      : "deterministicGuesses",
  ).toLocaleLowerCase(language);
  const operativeConcepts = translate(
    language,
    language === LANGUAGE.ENGLISH &&
      settings.modelId === CONCEPT_RANKING_MODEL_ID &&
      settings.operativeConcepts === PLAY_CONCEPT_RANKING.GUARDED
      ? "conceptBridges"
      : "directSimilarity",
  ).toLocaleLowerCase(language);
  const bonus =
    settings.bonusGuesses === PLAY_BONUS_POLICY.PASS
      ? translate(language, "stopAtNumber").toLocaleLowerCase(language)
      : translate(language, "allowExtraShort").toLocaleLowerCase(language);
  const words = translate(
    language,
    wordSet === WORD_SET.EXTENDED ? "extended" : "official",
  );
  const reuse =
    wordReusePolicy === PLAY_WORD_REUSE_POLICY.AVOID_RECENT
      ? translate(language, "avoidRecent").toLocaleLowerCase(language)
      : translate(language, "fullyRandom").toLocaleLowerCase(language);
  return `${words}, ${reuse}, ${model.label}, ${settings.candidateCount / 1000}k, ${style}, ${clueReuse}, ${missedTargets}, ${aggression}, ${operativeConcepts}, ${operativeNoise}, ${bonus}`;
}

function localizePlayError(message, language) {
  if (message === "A clue must be one word.") {
    return translate(language, "clueOneWordError");
  }
  if (
    message ===
    "A clue cannot match the stem or inflection of an unrevealed board word."
  ) {
    return translate(language, "clueBoardWordError");
  }
  const clueNumber = message.match(
    /^Clue number must be between 1 and (\d+)\.$/u,
  );
  return clueNumber
    ? translate(language, "clueNumberError", {
        maximum: Number(clueNumber[1]),
      })
    : message;
}

function dotVectors(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function playGameUrl(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("mode", "play");
  url.searchParams.set("g", code);
  return url.href;
}

function readSharedPlayGame() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("g");
  if (!code) {
    return null;
  }
  try {
    const game = decodePlayGame(code);
    if (game.reviewCompatibility === "history-only") {
      game.shareMetadata.sourceCode = code;
    }
    return { code, game };
  } catch (error) {
    console.warn("Ignoring invalid shared Play game.", error);
    url.searchParams.delete("g");
    window.history.replaceState(null, "", url);
    return null;
  }
}

function completedGameShareCode(game) {
  if (
    game.reviewCompatibility === "history-only" &&
    typeof game.shareMetadata?.sourceCode === "string"
  ) {
    return game.shareMetadata.sourceCode;
  }
  return encodeCompletedGame(game);
}

function clearSharedGameUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("g")) {
    return;
  }
  url.searchParams.delete("g");
  window.history.replaceState(null, "", url);
}
