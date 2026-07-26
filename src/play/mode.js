import { Check, Share2, TriangleAlert, createIcons } from "lucide";
import {
  BOARD_ORDER,
  createRandomSeed,
  encodeBoardParam,
} from "../board-share.js";
import PLAY_CLUE_BIAS_ANALYSIS from "../../scripts/generated/play-clue-bias-analysis.json" with { type: "json" };
import PLAY_MODEL_BENCHMARK from "../../scripts/generated/play-model-benchmark.json" with { type: "json" };
import {
  loadClueIndexManifest,
  loadShardedClueIndex,
} from "../clue-index.js";
import { centerEmbeddings, embedTerms } from "../embeddings.js";
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
  chooseBotClue,
  chooseBotGuess,
  createSeededRandom,
  shouldBotTakeAnotherGuess,
} from "./bots.js";
import {
  GAME_END_REASON,
  GAME_PHASE,
  PLAYER_ROLE,
  actorForSeat,
  canUndoPlayGame,
  createPlayGame,
  differentRandomHumanSeat,
  giveClue,
  guessCard,
  passTurn,
  publicGameView,
  randomHumanSeat,
  replayCompletedClueTurns,
  restorePlayGame,
  undoPlayGame,
} from "./game-state.js";
import {
  clearPlaySession,
  loadPlaySession,
  savePlaySession,
} from "./session-store.js";
import {
  PLAY_BONUS_POLICY,
  PLAY_OPERATIVE_AGGRESSION,
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

const RESULTS_PER_SIZE = 6;
const BOT_WAIT_DETAIL_DELAY = 1800;
const BOT_ACTION_DELAY = 720;
const BOT_ACTION_AFTER_UNDO_DELAY = 5000;
const PLAY_BOARD_ORDER = Object.freeze({
  TABLE: "table",
  TEAMS: "teams",
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
    note: "Open multi uses 80 controlled opening states. Game multi uses 100 complete same-model games with the recommended 10k, human-like, balanced, stop-at-number settings. Recall uses human target pairs. Bot benchmarks are not human win rates.",
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
        "⏱️ Work",
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
    note: "Open multi uses 80 controlled opening states per vocabulary size with MiniLM-L6. Larger vocabularies offer more multi-card clues, but their deeper clues are less familiar. This is not a full-game rate.",
  },
  cluePolicy: {
    id: "clue-scoring",
    label: "Clue scoring",
    table: {
      headers: ["🧮 Scoring", "🔢 Multi", "✅ Correct", "⏱️ Turns"],
      numericColumns: [1, 2, 3],
      rows: [
        ["🧪 Human-like", "50.4%", "1.58", "9.85"],
        ["📍 Conservative", "15.7%", "1.17", "13.34"],
      ],
    },
    note: "100 paired same-model bot games. These are not human win rates.",
  },
  multiTolerance: {
    id: "multi-clue-preference",
    label: "Prefer multi-card clues",
    table: {
      headers: ["🎛️ Setting", "🤖 Pick 2+ if", "🔢 Full-game multi"],
      numericColumns: [2],
      rows: [
        ["🛑 Off", "It has the best score", "Not measured"],
        ["⚖️ Balanced", "Within 5 points", "50.4%*"],
        ["🚀 Strong", "Within 10 points", "Not measured"],
      ],
    },
    note: "The bot compares its best clue overall with its best clue for 2+ cards. Allowing more points means accepting a lower-scoring 2+ clue more often. The score combines safety and expected progress. *50.4% comes from 100 paired games using all recommended defaults, so it is not the effect of this setting alone.",
  },
  operativeAggression: {
    id: "operative-aggression",
    label: "Operative aggression",
    table: {
      headers: ["🔎 Mode", "🎯 Threshold", "🏁 Game state"],
      rows: [
        ["🛡️ Conservative", "Highest", "Ignored"],
        ["🚀 Aggressive", "Lowest", "Ignored"],
        ["⚖️ Dynamic", "Adaptive", "Public score"],
      ],
    },
    note: "Dynamic becomes bolder when the team can win this turn or is trailing an opponent near victory, and more selective with a comfortable lead. It uses only clue similarities, revealed-card counts, and the public score.",
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
    note: "Allow uses only the current clue and cannot revisit unresolved earlier clues.",
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
  note: "When fewer than 25 unseen words remain, the next board uses only the least-recently-used repeats needed. Clear history makes every word available again without changing the selected policy.",
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
    multiTolerance: document.querySelector("#play-multi-tolerance"),
    multiToleranceInfo: document.querySelector("#play-multi-tolerance-info"),
    operativeAggression: document.querySelector("#play-operative-aggression"),
    operativeAggressionInfo: document.querySelector(
      "#play-operative-aggression-info",
    ),
    bonusGuesses: document.querySelector("#play-bonus-guesses"),
    bonusGuessesInfo: document.querySelector("#play-bonus-guesses-info"),
    settingsSummary: document.querySelector("#play-settings-summary"),
    startGame: document.querySelector("#start-play-game"),
    startGameLabel: document.querySelector("#start-play-game-label"),
    savedActions: document.querySelector("#saved-play-actions"),
    savedTitle: document.querySelector("#saved-play-title"),
    savedHelp: document.querySelector("#saved-play-help"),
    resumeSession: document.querySelector("#resume-play-session"),
    resumeSessionLabel: document.querySelector("#resume-play-session-label"),
    discardSession: document.querySelector("#discard-play-session"),
    leaveGame: document.querySelector("#leave-play-game"),
    undoAction: document.querySelector("#undo-play-action"),
    forwardAction: document.querySelector("#forward-play-action"),
    shareBoard: document.querySelector("#share-play-board"),
    humanSeat: document.querySelector("#play-human-seat"),
    score: document.querySelector("#play-score"),
    boardToolbar: document.querySelector("#play-board-toolbar"),
    boardOrderButtons: [...document.querySelectorAll("[data-play-board-order]")],
    boardGrid: document.querySelector("#play-board-grid"),
    clueDisplay: document.querySelector("#play-clue-display"),
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
    [elements.multiToleranceInfo, BOT_SETTING_INFO.multiTolerance],
    [
      elements.operativeAggressionInfo,
      BOT_SETTING_INFO.operativeAggression,
    ],
    [elements.bonusGuessesInfo, BOT_SETTING_INFO.bonusGuesses],
  ]) {
    container.append(createInfoControl(definition, "play-bot-setting"));
  }

  let active = false;
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
  let game = null;
  let analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
  let boardVectors = null;
  let clueIndex = null;
  let analysisRun = 0;
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
  let postGameScores = [];
  let postGameAnalysisState = "idle";
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

  for (const [element, key, transform] of [
    [elements.botModel, "modelId", String],
    [elements.botCandidates, "candidateCount", Number],
    [elements.cluePolicy, "cluePolicy", String],
    [elements.multiTolerance, "multiTolerance", Number],
    [elements.operativeAggression, "operativeAggression", String],
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
  elements.leaveGame.addEventListener("click", showSetup);
  elements.undoAction.addEventListener("click", undoAction);
  elements.forwardAction.addEventListener("click", forwardAction);
  elements.shareBoard.addEventListener("click", () => void copyBoardLink());
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
    runHumanAction((current) =>
      giveClue(current, {
        clue: elements.clueInput.value,
        number: Number(elements.clueNumber.value),
        actor: "human",
        intendedLayoutIds: selectedSuggestionTargets(),
      }),
    );
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
        analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
        boardVectors = null;
        renderGame();
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
    elements.multiTolerance.value = String(selectedBotSettings.multiTolerance);
    elements.operativeAggression.value =
      selectedBotSettings.operativeAggression;
    elements.bonusGuesses.value = selectedBotSettings.bonusGuesses;
    elements.settingsSummary.textContent = settingsLabel(
      selectedWordSet,
      wordReuseState.policy,
      selectedBotSettings,
      selectedLanguage,
    );
    const savedLanguage = savedGame?.language ?? LANGUAGE.ENGLISH;
    const savedLanguageDiffers =
      Boolean(savedGame) && savedLanguage !== selectedLanguage;
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
      savedLanguageDiffers ? "resumeOtherLanguageGame" : "resumeGame",
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
    savePlaySession(game);
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
    elements.setup.hidden = false;
    elements.game.hidden = true;
    renderSetup();
  }

  function showActiveGame() {
    elements.setup.hidden = true;
    elements.game.hidden = false;
    renderGame();
  }

  async function copyBoardLink() {
    if (!game) {
      return;
    }
    const code = encodeBoardParam({
      cards: game.cards.map((card) => ({ ...card, done: false })),
      randomLayoutOrder: game.cards.map((card) => card.layoutId),
      order: BOARD_ORDER.RANDOM,
      language: game.language ?? LANGUAGE.ENGLISH,
      wordSet: game.wordSet,
      source:
        game.wordReusePolicy === PLAY_WORD_REUSE_POLICY.AVOID_RECENT
          ? { type: "explicit" }
          : { type: "seed", seed: game.seed, version: "3" },
    });
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("mode", "train");
    url.searchParams.set("b", code);
    try {
      await writeClipboardText(url.href);
      setShareFeedback("copied");
    } catch {
      setShareFeedback("error");
    }
  }

  function setShareFeedback(state) {
    window.clearTimeout(shareFeedbackTimer);
    elements.shareBoard.dataset.state = state;
    const label =
      state === "copied"
        ? translate(gameLanguage(), "boardCopied")
        : state === "error"
          ? translate(gameLanguage(), "copyFailed")
          : translate(gameLanguage(), "shareBoard");
    const iconName =
      state === "copied" ? "check" : state === "error" ? "triangle-alert" : "share-2";
    elements.shareBoard.setAttribute("aria-label", label);
    elements.shareBoard.title =
      state === "idle"
        ? translate(gameLanguage(), "copyBoardLink")
        : label;
    const icon = document.createElement("i");
    icon.dataset.lucide = iconName;
    icon.setAttribute("aria-hidden", "true");
    elements.shareBoard.replaceChildren(icon);
    createIcons({
      icons: { Check, Share2, TriangleAlert },
      attrs: { width: 18, height: 18, "stroke-width": 2 },
      root: elements.shareBoard,
    });
    if (state !== "idle") {
      shareFeedbackTimer = window.setTimeout(() => setShareFeedback("idle"), 3000);
    }
  }

  function runHumanAction(action) {
    if (!game) {
      return;
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
    } catch (error) {
      const message = localizePlayError(
        error instanceof Error ? error.message : String(error),
        gameLanguage(),
      );
      elements.clueError.textContent = message;
      statusMessage = message;
      statusMessageIsError = true;
      renderGame();
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
    savePlaySession(game);
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
    savePlaySession(game);
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
    postGameTurns = [];
    selectedPostGameTurn = 0;
    postGameScores = [];
    postGameAnalysisState = "idle";
  }

  function commitGame() {
    savedGame = game;
    savePlaySession(game);
    renderGame();
    if (game.phase === GAME_PHASE.COMPLETE) {
      ensurePostGameAnalysis();
      return;
    }
    if (game.phase === GAME_PHASE.AWAITING_CLUE) {
      resetAnalysis();
      ensureAnalysis();
      return;
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
      if (!clueIndexPromises.has(configuration)) {
        const promise = loadShardedClueIndex(
          indexManifestUrl(modelId, language),
          candidateCount,
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
          limit: RESULTS_PER_SIZE,
          language,
        }),
        [SIDE.RED]: analyzeEmbeddedBoard(
          boardForSide(cards, SIDE.RED),
          centered,
          loadedIndex,
          { limit: RESULTS_PER_SIZE, language },
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
    if (
      game?.phase === GAME_PHASE.COMPLETE &&
      postGameTurns.length === 0
    ) {
      postGameTurns = replayCompletedClueTurns(game);
      selectedPostGameTurn = Math.max(
        0,
        Math.min(selectedPostGameTurn, postGameTurns.length - 1),
      );
    }
  }

  function ensurePostGameAnalysis() {
    preparePostGameTurns();
    if (
      !active ||
      !game ||
      game.phase !== GAME_PHASE.COMPLETE ||
      postGameTurns.length === 0 ||
      postGameAnalysisState !== "idle"
    ) {
      return;
    }
    void runPostGameAnalysis();
  }

  async function runPostGameAnalysis() {
    const runId = ++analysisRun;
    const gameAtStart = game;
    const turnsAtStart = postGameTurns;
    postGameAnalysisState = "loading";
    renderGame();

    try {
      const { modelId } = gameAtStart.botSettings;
      if (!manifestPromises.has(modelId)) {
        const promise = loadClueIndexManifest(indexManifestUrl(modelId)).catch(
          (error) => {
            manifestPromises.delete(modelId);
            throw error;
          },
        );
        manifestPromises.set(modelId, promise);
      }
      const model = modelOption(modelId);
      const terms = [
        ...gameAtStart.cards.map((card) => card.word),
        ...turnsAtStart.map((turn) => turn.clue),
      ];
      const [manifest, vectors] = await Promise.all([
        manifestPromises.get(modelId),
        embedTerms(terms, { model: model.model }),
      ]);
      if (runId !== analysisRun || game !== gameAtStart) {
        return;
      }

      const centered = centerEmbeddings(vectors, manifest.centering.mean);
      const cardVectors = centered.slice(0, gameAtStart.cards.length);
      const clueVectors = centered.slice(gameAtStart.cards.length);
      postGameScores = clueVectors.map((clueVector) =>
        Object.fromEntries(
          gameAtStart.cards.map((card, index) => [
            card.layoutId,
            dotVectors(clueVector, cardVectors[index]),
          ]),
        ),
      );
      postGameAnalysisState = "ready";
    } catch {
      if (runId !== analysisRun) {
        return;
      }
      postGameAnalysisState = "error";
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
        const clue = chooseBotClue({
          analysis: analysis[game.activeSide],
          ownRemaining: remainingCardsForSide(game.cards, game.activeSide),
          opponentRemaining: remainingCardsForSide(
            game.cards,
            game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
          ),
          policy: game.botSettings.cluePolicy,
          multiTolerance: game.botSettings.multiTolerance,
          random: decisionRandom,
        });
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
        const candidates = await buildBotGuessCandidates(game.currentTurn.clue);
        const layoutId =
          !shouldBotTakeAnotherGuess({
            bonusGuesses: game.botSettings.bonusGuesses,
            clueNumber: game.currentTurn.number,
            guessesMade: game.currentTurn.guesses.length,
          })
            ? null
            : chooseBotGuess({
                aggression: game.botSettings.operativeAggression,
                candidates,
                guessesMade: game.currentTurn.guesses.length,
                clueNumber: game.currentTurn.number,
                ownRemaining: remainingCardsForSide(
                  game.cards,
                  game.activeSide,
                ),
                opponentRemaining: remainingCardsForSide(
                  game.cards,
                  game.activeSide === SIDE.BLUE ? SIDE.RED : SIDE.BLUE,
                ),
                random: decisionRandom,
              });
        if (layoutId === null) {
          game = passTurn(game, { actor: "bot" });
          statusMessage = translate(gameLanguage(), "botPassed", {
            side: localizedSideLabel(actingSide),
          });
        } else {
          const word = game.cards.find((card) => card.layoutId === layoutId)?.word;
          game = guessCard(game, { layoutId, actor: "bot" });
          statusMessage = translate(gameLanguage(), "botGuessed", {
            side: localizedSideLabel(actingSide),
            word,
          });
        }
        statusMessageIsError = false;
      }
      forwardHistory = [];
      savedGame = game;
      savePlaySession(game);
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : String(error);
      statusMessageIsError = true;
    } finally {
      botBusy = false;
      renderGame();
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

  async function buildBotGuessCandidates(clue) {
    if (game && guessCandidateExecutor) {
      return guessCandidateExecutor({
        cards: game.cards.map(({ layoutId, word, done }) => ({
          layoutId,
          word,
          done,
        })),
        clue,
        language: gameLanguage(),
      });
    }
    if (!game || !boardVectors || !clueIndex) {
      return [];
    }
    const model = modelOption(activeModelId);
    const vectors = await embedTerms([clue], {
      model: model.model,
      revision: model.revision,
      inputPrefix: model.inputPrefix,
    });
    const clueVector = centerEmbeddings(vectors, clueIndex.centering.mean)[0];

    return game.cards
      .map((card, index) => ({
        layoutId: card.layoutId,
        done: card.done,
        similarity: dotVectors(clueVector, boardVectors[index]),
      }))
      .filter((candidate) => !candidate.done)
      .map(({ layoutId, similarity }) => ({ layoutId, similarity }));
  }

  function gameLanguage() {
    return game?.language ?? selectedLanguage;
  }

  function localizedSideLabel(side) {
    return translate(
      gameLanguage(),
      side === SIDE.RED ? "red" : "blue",
    );
  }

  function localizedRoleLabel(role) {
    return translate(
      gameLanguage(),
      role === PLAYER_ROLE.SPYMASTER ? "spymaster" : "operative",
    );
  }

  function localizedTeamLabel(team) {
    if (team === "friendly") {
      return translate(gameLanguage(), "blue");
    }
    if (team === "enemy") {
      return translate(gameLanguage(), "red");
    }
    if (team === "neutral") {
      return translate(gameLanguage(), "neutral");
    }
    if (team === "assassin") {
      return translate(gameLanguage(), "assassinTeam");
    }
    return team;
  }

  function renderGame() {
    if (!game) {
      return;
    }
    preparePostGameTurns();
    const selectedTurn =
      game.phase === GAME_PHASE.COMPLETE
        ? postGameTurns[selectedPostGameTurn] ?? null
        : null;
    const view = publicGameView(
      selectedTurn
        ? {
            ...game,
            activeSide: selectedTurn.side,
            cards: selectedTurn.cards,
          }
        : game,
    );
    const currentRole =
      game.phase === GAME_PHASE.AWAITING_CLUE
        ? PLAYER_ROLE.SPYMASTER
        : PLAYER_ROLE.OPERATIVE;
    const currentActor =
      game.phase === GAME_PHASE.COMPLETE
        ? null
        : actorForSeat(game, game.activeSide, currentRole);

    elements.humanSeat.dataset.side = game.humanSeat.side;
    const seatContext = document.createElement("span");
    seatContext.className = "play-seat-context";
    seatContext.textContent = translate(gameLanguage(), "yourView");
    const seatIdentity = document.createElement("strong");
    seatIdentity.className = "play-seat-identity";
    seatIdentity.textContent = `${sideEmoji(game.humanSeat.side)} ${localizedSideLabel(game.humanSeat.side)} ${roleEmoji(game.humanSeat.role)} ${localizedRoleLabel(game.humanSeat.role)}`;
    elements.humanSeat.setAttribute(
      "aria-label",
      translate(gameLanguage(), "yourViewLabel", {
        identity: seatIdentity.textContent,
      }),
    );
    elements.humanSeat.replaceChildren(seatContext, seatIdentity);
    elements.undoAction.disabled = !canUndoPlayGame(game) || botBusy;
    elements.forwardAction.disabled = forwardHistory.length === 0 || botBusy;
    renderScore(view.cards, selectedTurn);
    renderBoardToolbar();
    renderBoard(view, currentActor, currentRole, selectedTurn);
    renderTurnPanel(currentActor, currentRole, selectedTurn);
    renderPostGameAnalysis(selectedTurn);
    renderHistory(view.history);
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
      label.textContent = localizedSideLabel(side);
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

  function renderBoardToolbar() {
    const showOrderControls = game.humanSeat.role === PLAYER_ROLE.SPYMASTER;
    elements.boardToolbar.hidden = !showOrderControls;
    for (const button of elements.boardOrderButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playBoardOrder === playBoardOrder),
      );
    }
  }

  function renderBoard(view, currentActor, currentRole, selectedTurn) {
    const canGuess =
      game.phase === GAME_PHASE.AWAITING_GUESS &&
      currentActor === "human" &&
      currentRole === PLAYER_ROLE.OPERATIVE &&
      !botBusy;
    const visibleCards =
      playBoardOrder === PLAY_BOARD_ORDER.TEAMS &&
      game.humanSeat.role === PLAYER_ROLE.SPYMASTER
        ? [...view.cards].sort(
            (left, right) =>
              TEAM_ORDER[left.team] - TEAM_ORDER[right.team] ||
              left.layoutId - right.layoutId,
          )
        : view.cards;
    const turnScores = postGameScores[selectedPostGameTurn] ?? {};
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
      if (selectedTurn) {
        button.dataset.intended = String(intended.has(card.layoutId));
        button.dataset.guessed = String(Boolean(guess));
        if (guess) {
          button.dataset.outcome =
            sideForTeam(guess.team) === selectedTurn.side ? "correct" : "mistake";
        }
        const annotations = document.createElement("span");
        annotations.className = "play-card-annotations";
        if (intended.has(card.layoutId)) {
          const target = document.createElement("span");
          target.className = "play-card-marker is-target";
          target.textContent = translate(gameLanguage(), "target");
          annotations.append(target);
        }
        if (guess) {
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
      const reviewDetails = selectedTurn
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
      game.phase === GAME_PHASE.COMPLETE ? game.winner : game.activeSide;
    elements.clueDisplay.dataset.side = displaySide;
    const turnLabel = document.createElement("span");
    turnLabel.className = "play-turn-team";
    const turnAction = document.createElement("strong");
    const turnNote = document.createElement("span");
    turnNote.className = "play-turn-note";
    const botWaitDetail =
      currentActor === "bot"
        ? currentRole === PLAYER_ROLE.SPYMASTER
          ? translate(gameLanguage(), "botStudying")
          : translate(gameLanguage(), "botChoosingCard")
        : "";
    const waitDetailVisible = syncBotWaitDetail(
      currentActor === "bot" && !statusMessageIsError
        ? currentBotWaitKey()
        : "",
    );

    if (selectedTurn) {
      turnLabel.textContent = translate(gameLanguage(), "postGameTurn", {
        current: selectedPostGameTurn + 1,
        total: postGameTurns.length,
      });
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

    elements.clueForm.hidden = !humanSpymaster;
    elements.operativeControls.hidden = !humanOperative;
    renderClearClueButton();
    renderSuggestionVisibility(humanSpymaster);

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

  function renderPostGameAnalysis(selectedTurn) {
    elements.postGameAnalysis.hidden = !selectedTurn;
    if (!selectedTurn) {
      return;
    }

    elements.postGameOutcome.textContent = `${sideEmoji(game.winner)} ${translate(
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
    )}`;
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
    const visible = history.filter((event) =>
      ["clue-given", "card-guessed", "turn-passed", "game-ended"].includes(event.type),
    );
    elements.historyLabel.textContent = translate(
      gameLanguage(),
      game.phase === GAME_PHASE.COMPLETE ? "postGameAnalysis" : "gameLog",
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
    );
    renderHistoryList(
      elements.historyBlueList,
      visible.filter((event) => (event.side ?? event.winner) === SIDE.BLUE),
      translate(gameLanguage(), "noSideActions", {
        side: localizedSideLabel(SIDE.BLUE),
      }),
    );
    renderHistoryList(
      elements.historyRedList,
      visible.filter((event) => (event.side ?? event.winner) === SIDE.RED),
      translate(gameLanguage(), "noSideActions", {
        side: localizedSideLabel(SIDE.RED),
      }),
    );
  }

  function renderHistoryList(list, events, emptyMessage) {
    const items = events.length
      ? events.map(createHistoryItem)
      : [createEmptyHistoryItem(emptyMessage)];
    list.replaceChildren(...items);
    if (game.phase === GAME_PHASE.COMPLETE) {
      const selectedItem = list.querySelector(
        `[data-analysis-turn="${selectedPostGameTurn}"]`,
      );
      list.scrollTop = selectedItem
        ? selectedItem.offsetTop - list.offsetTop
        : list.scrollHeight;
    } else {
      list.scrollTop = list.scrollHeight;
    }
  }

  function createHistoryItem(event) {
    const item = document.createElement("li");
    item.dataset.side = event.side ?? event.winner ?? "";
    if (event.type === "clue-given") {
      const intendedTargets =
        game.phase === GAME_PHASE.COMPLETE && event.intendedLayoutIds?.length
          ? event.intendedLayoutIds
              .map((layoutId) =>
                game.cards.find((card) => card.layoutId === layoutId),
              )
              .filter(Boolean)
          : [];
      const intendedWords = intendedTargets.map(({ word }) => word);
      const turnIndex =
        game.phase === GAME_PHASE.COMPLETE
          ? postGameTurns.findIndex(
              (turn) =>
                turn.turn === event.turn &&
                turn.side === event.side,
            )
          : -1;
      if (turnIndex >= 0) {
        const button = document.createElement("button");
        const clueLabel = document.createElement("span");
        const actionLabel = document.createElement("span");
        const selected = turnIndex === selectedPostGameTurn;
        button.type = "button";
        button.className = "play-history-clue";
        clueLabel.className =
          "play-history-clue-label play-history-event-summary";
        appendHistoryClueSummary(clueLabel, event, intendedTargets);
        actionLabel.className = "play-history-clue-action";
        actionLabel.textContent = translate(
          gameLanguage(),
          selected ? "viewing" : "review",
        );
        actionLabel.setAttribute("aria-hidden", "true");
        button.setAttribute(
          "aria-label",
          translate(gameLanguage(), "reviewTurn", {
            turn: turnIndex + 1,
            side: localizedSideLabel(event.side),
            clue: event.clue,
            number: event.number,
          }),
        );
        button.setAttribute("aria-pressed", String(selected));
        item.classList.toggle("is-selected", selected);
        item.dataset.analysisTurn = String(turnIndex);
        button.addEventListener("click", () => {
          selectedPostGameTurn = turnIndex;
          renderGame();
        });
        button.append(clueLabel, actionLabel);
        item.append(button);
      } else {
        const summary = document.createElement("div");
        summary.className = "play-history-event-summary";
        appendHistoryClueSummary(summary, event, intendedTargets);
        item.append(summary);
      }
      if (intendedWords.length) {
        const explanation = createRecommendationExplanationControl(
          {
            clue: event.clue,
            targets: intendedTargets,
          },
          {
            wordPills: true,
            language: gameLanguage(),
          },
        );
        explanation.classList.add("play-history-explanation");
        if (turnIndex >= 0) {
          item.classList.add("has-clue-actions");
        }
        item.append(explanation);
      }
    } else if (event.type === "card-guessed") {
      item.append(
        translate(gameLanguage(), "historyGuessLead", {
          side: localizedSideLabel(event.side),
        }),
        createHistoryCardPill(event.word, event.team),
      );
    } else if (event.type === "turn-passed") {
      item.textContent = translate(gameLanguage(), "historyPass", {
        side: localizedSideLabel(event.side),
      });
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
    container.append(
      translate(gameLanguage(), "historyClueLead", {
        side: localizedSideLabel(event.side),
      }),
      createCluePill(event.clue),
      " ",
      createClueNumberPill(event.number),
    );
    if (intendedTargets.length) {
      container.append(
        translate(gameLanguage(), "intendedTargets", { words: "" }),
      );
      intendedTargets.forEach((target, index) => {
        if (index > 0) {
          container.append(" + ");
        }
        container.append(createHistoryCardPill(target.word, target.team));
      });
    }
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

function sideEmoji(side) {
  return side === SIDE.RED ? "🔴" : "🔵";
}

function roleEmoji(role) {
  return role === PLAYER_ROLE.SPYMASTER ? "🕵️" : "🔎";
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

function formatMegabytes(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatCompactCount(count) {
  return `${count / 1000}k`;
}

function formatRelativeWork(count) {
  const relative = count / 10_000;
  return relative === 1 ? "1×" : `~${Number(relative.toFixed(1))}×`;
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
  return `${words}, ${reuse}, ${model.label}, ${settings.candidateCount / 1000}k, ${style}, ${aggression}, ${bonus}`;
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
