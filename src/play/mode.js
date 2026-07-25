import { Check, Share2, TriangleAlert, createIcons } from "lucide";
import {
  BOARD_ORDER,
  createGeneratedBoardState,
  createRandomSeed,
  encodeBoardParam,
} from "../board-share.js";
import PLAY_CLUE_BIAS_ANALYSIS from "../../scripts/generated/play-clue-bias-analysis.json" with { type: "json" };
import PLAY_MODEL_BENCHMARK from "../../scripts/generated/play-model-benchmark.json" with { type: "json" };
import { loadShardedClueIndex } from "../clue-index.js";
import { centerEmbeddings, embedTerms } from "../embeddings.js";
import {
  SIDE,
  boardForSide,
  remainingCardsForSide,
} from "../gameplay.js";
import { createInfoControl } from "../info-control.js";
import {
  CANDIDATE_OPTIONS,
  indexManifestUrl,
  modelOption,
} from "../model-lab.js";
import { analyzeEmbeddedBoard } from "../model.js";
import { WORD_SET } from "../word-data.js";
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
  createPlayGame,
  giveClue,
  guessCard,
  passTurn,
  publicGameView,
  randomHumanSeat,
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

const RESULTS_PER_SIZE = 6;
const PLAY_BOARD_ORDER = Object.freeze({
  TABLE: "table",
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

export function createPlayMode() {
  const elements = {
    setup: document.querySelector("#play-setup"),
    game: document.querySelector("#play-game"),
    seatButtons: [...document.querySelectorAll("[data-play-seat]")],
    randomizeSeat: document.querySelector("#randomize-play-seat"),
    wordSetButtons: [...document.querySelectorAll("[data-play-word-set]")],
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
    botSettingsSummary: document.querySelector("#play-bot-settings-summary"),
    startGame: document.querySelector("#start-play-game"),
    savedActions: document.querySelector("#saved-play-actions"),
    resumeSession: document.querySelector("#resume-play-session"),
    discardSession: document.querySelector("#discard-play-session"),
    leaveGame: document.querySelector("#leave-play-game"),
    undoAction: document.querySelector("#undo-play-action"),
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
    historyCount: document.querySelector("#play-history-count"),
    historyList: document.querySelector("#play-history-list"),
  };

  for (const [container, definition] of [
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
  let selectedHumanSeat = randomHumanSeat();
  let selectedWordSet = WORD_SET.OFFICIAL;
  let selectedBotSettings = normalizePlayBotSettings();
  let savedGame = loadPlaySession();
  let game = null;
  let analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
  let boardVectors = null;
  let clueIndex = null;
  let analysisRun = 0;
  let botTimer = 0;
  let botBusy = false;
  let undoSnapshot = null;
  let statusMessage = "";
  let selectedSuggestion = null;
  let suggestionsExpanded = false;
  let suggestionTurnKey = "";
  let playBoardOrder = PLAY_BOARD_ORDER.TABLE;
  let activeModelId = null;
  let shareFeedbackTimer = 0;
  const clueIndexPromises = new Map();

  for (const button of elements.seatButtons) {
    button.addEventListener("click", () => {
      const [side, role] = button.dataset.playSeat.split(":");
      selectedHumanSeat = { side, role };
      renderSetup();
    });
  }

  elements.randomizeSeat.addEventListener("click", () => {
    selectedHumanSeat = randomHumanSeat();
    renderSetup();
  });

  for (const button of elements.wordSetButtons) {
    button.addEventListener("click", () => {
      selectedWordSet = button.dataset.playWordSet;
      renderSetup();
    });
  }

  for (const [element, key, transform] of [
    [elements.botModel, "modelId", String],
    [elements.botCandidates, "candidateCount", Number],
    [elements.cluePolicy, "cluePolicy", String],
    [elements.multiTolerance, "multiTolerance", Number],
    [elements.operativeAggression, "operativeAggression", String],
    [elements.bonusGuesses, "bonusGuesses", String],
  ]) {
    element.addEventListener("change", () => {
      selectedBotSettings = normalizePlayBotSettings({
        ...selectedBotSettings,
        [key]: transform(element.value),
      });
      renderSetup();
    });
  }

  for (const button of elements.boardOrderButtons) {
    button.addEventListener("click", () => {
      playBoardOrder = button.dataset.playBoardOrder;
      renderGame();
    });
  }

  elements.startGame.addEventListener("click", startNewGame);
  elements.resumeSession.addEventListener("click", resumeSavedGame);
  elements.discardSession.addEventListener("click", discardSavedGame);
  elements.leaveGame.addEventListener("click", showSetup);
  elements.undoAction.addEventListener("click", undoAction);
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
  };

  function renderSetup() {
    for (const button of elements.seatButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playSeat === `${selectedHumanSeat.side}:${selectedHumanSeat.role}`),
      );
    }
    for (const button of elements.wordSetButtons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.playWordSet === selectedWordSet),
      );
    }
    elements.botModel.value = selectedBotSettings.modelId;
    elements.botCandidates.value = String(selectedBotSettings.candidateCount);
    elements.cluePolicy.value = selectedBotSettings.cluePolicy;
    elements.multiTolerance.value = String(selectedBotSettings.multiTolerance);
    elements.operativeAggression.value =
      selectedBotSettings.operativeAggression;
    elements.bonusGuesses.value = selectedBotSettings.bonusGuesses;
    elements.botSettingsSummary.textContent = botSettingsLabel(selectedBotSettings);
    elements.savedActions.hidden = !savedGame;
  }

  function startNewGame() {
    window.clearTimeout(botTimer);
    const seed = createRandomSeed();
    const generated = createGeneratedBoardState(seed, BOARD_ORDER.RANDOM, selectedWordSet);
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
      seed,
      wordSet: selectedWordSet,
    });
    savedGame = game;
    resetRuntimeState("Blue starts.");
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
    selectedHumanSeat = { ...game.humanSeat };
    selectedWordSet = game.wordSet ?? WORD_SET.OFFICIAL;
    selectedBotSettings = normalizePlayBotSettings(game.botSettings);
    resetRuntimeState("Saved game resumed.");
    showActiveGame();
    ensureAnalysis();
  }

  function resetRuntimeState(message) {
    analysisRun += 1;
    analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
    boardVectors = null;
    clueIndex = null;
    activeModelId = null;
    statusMessage = message;
    undoSnapshot = null;
    selectedSuggestion = null;
    suggestionsExpanded = false;
    suggestionTurnKey = "";
    playBoardOrder = PLAY_BOARD_ORDER.TABLE;
    elements.clueInput.value = "";
    elements.clueNumber.replaceChildren();
    elements.clueError.textContent = "";
    elements.suggestionList.replaceChildren();
  }

  function discardSavedGame() {
    clearPlaySession();
    savedGame = null;
    game = null;
    selectedHumanSeat = randomHumanSeat();
    renderSetup();
  }

  function showSetup() {
    window.clearTimeout(botTimer);
    botBusy = false;
    game = null;
    undoSnapshot = null;
    selectedHumanSeat = randomHumanSeat();
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
      wordSet: game.wordSet,
      source: { type: "seed", seed: game.seed, version: "3" },
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
        ? "Board copied"
        : state === "error"
          ? "Copy failed"
          : "Share board";
    const iconName =
      state === "copied" ? "check" : state === "error" ? "triangle-alert" : "share-2";
    elements.shareBoard.setAttribute("aria-label", label);
    elements.shareBoard.title =
      state === "idle" ? "Copy board share link" : label;
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
    const snapshot = structuredClone(game);
    try {
      game = action(game);
      undoSnapshot = snapshot;
      selectedSuggestion = null;
      elements.clueError.textContent = "";
      commitGame();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      elements.clueError.textContent = message;
      statusMessage = message;
      renderGame();
    }
  }

  function undoAction() {
    if (!undoSnapshot) {
      return;
    }
    window.clearTimeout(botTimer);
    game = undoSnapshot;
    undoSnapshot = null;
    resetAnalysis("Last action undone.");
    savePlaySession(game);
    renderGame();
    ensureAnalysis();
  }

  function resetAnalysis(message = "") {
    analysis = { [SIDE.BLUE]: null, [SIDE.RED]: null };
    boardVectors = null;
    clueIndex = null;
    selectedSuggestion = null;
    statusMessage = message;
  }

  function commitGame() {
    savedGame = game;
    savePlaySession(game);
    renderGame();
    if (game.phase === GAME_PHASE.AWAITING_CLUE) {
      resetAnalysis();
      ensureAnalysis();
      return;
    }
    queueBotAction();
  }

  function ensureAnalysis() {
    if (!game || game.phase === GAME_PHASE.COMPLETE || analysis[game.activeSide]) {
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
    statusMessage = `${sideEmoji(game.activeSide)} ${roleEmoji(PLAYER_ROLE.SPYMASTER)} ${sideLabel(game.activeSide)} spymaster is studying the board.`;
    renderGame();

    try {
      const { modelId, candidateCount } = gameAtStart.botSettings;
      const configuration = `${modelId}:${candidateCount}`;
      if (!clueIndexPromises.has(configuration)) {
        const promise = loadShardedClueIndex(
          indexManifestUrl(modelId),
          candidateCount,
        ).catch((error) => {
          clueIndexPromises.delete(configuration);
          throw error;
        });
        clueIndexPromises.set(configuration, promise);
      }
      const model = modelOption(modelId);
      const cards = gameAtStart.cards.map((card) => ({ ...card }));
      const [loadedIndex, vectors] = await Promise.all([
        clueIndexPromises.get(configuration),
        embedTerms(
          cards.map((card) => card.word),
          { model: model.model },
        ),
      ]);
      if (runId !== analysisRun || game !== gameAtStart) {
        return;
      }
      const centered = centerEmbeddings(vectors, loadedIndex.centering.mean);
      boardVectors = centered;
      clueIndex = loadedIndex;
      activeModelId = modelId;
      analysis = {
        [SIDE.BLUE]: analyzeEmbeddedBoard(cards, centered, loadedIndex, {
          limit: RESULTS_PER_SIZE,
        }),
        [SIDE.RED]: analyzeEmbeddedBoard(
          boardForSide(cards, SIDE.RED),
          centered,
          loadedIndex,
          { limit: RESULTS_PER_SIZE },
        ),
      };
      statusMessage = "";
      renderGame();
      queueBotAction();
    } catch (error) {
      if (runId !== analysisRun) {
        return;
      }
      statusMessage = error instanceof Error ? error.message : String(error);
      renderGame();
    }
  }

  function queueBotAction(delay = undoSnapshot ? 1200 : 720) {
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
    if (game.phase === GAME_PHASE.AWAITING_CLUE && !analysis[game.activeSide]) {
      ensureAnalysis();
      return;
    }
    botTimer = window.setTimeout(() => void performBotAction(), delay);
  }

  async function performBotAction() {
    if (!game || game.phase === GAME_PHASE.COMPLETE) {
      return;
    }
    botBusy = true;
    undoSnapshot = null;
    const decisionRandom = createSeededRandom(
      `${game.seed}:${game.turnNumber}:${game.history.length}`,
    );
    const actingSide = game.activeSide;

    try {
      if (game.phase === GAME_PHASE.AWAITING_CLUE) {
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
            `${roleEmoji(PLAYER_ROLE.SPYMASTER)} The bot spymaster could not find a legal clue.`,
          );
        }
        game = giveClue(game, {
          clue: clue.clue,
          number: clue.number,
          actor: "bot",
          intendedLayoutIds: clue.targets.map((target) => target.layoutId),
        });
        statusMessage = `${sideEmoji(actingSide)} 🤖 ${roleEmoji(PLAYER_ROLE.SPYMASTER)} ${sideLabel(actingSide)} bot spymaster gave ${clue.clue.toUpperCase()} ${clue.number}.`;
      } else {
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
          statusMessage = `${sideEmoji(actingSide)} 🤖 ${roleEmoji(PLAYER_ROLE.OPERATIVE)} ${sideLabel(actingSide)} bot operative passed.`;
        } else {
          const word = game.cards.find((card) => card.layoutId === layoutId)?.word;
          game = guessCard(game, { layoutId, actor: "bot" });
          statusMessage = `${sideEmoji(actingSide)} 🤖 ${roleEmoji(PLAYER_ROLE.OPERATIVE)} ${sideLabel(actingSide)} bot operative guessed ${word}.`;
        }
      }
      savedGame = game;
      savePlaySession(game);
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : String(error);
    } finally {
      botBusy = false;
      renderGame();
    }

    if (game?.phase === GAME_PHASE.AWAITING_CLUE) {
      resetAnalysis();
      ensureAnalysis();
    } else {
      queueBotAction();
    }
  }

  async function buildBotGuessCandidates(clue) {
    if (!game || !boardVectors || !clueIndex) {
      return [];
    }
    const model = modelOption(activeModelId);
    const vectors = await embedTerms([clue], { model: model.model });
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

  function renderGame() {
    if (!game) {
      return;
    }
    const view = publicGameView(game);
    const currentRole =
      game.phase === GAME_PHASE.AWAITING_CLUE
        ? PLAYER_ROLE.SPYMASTER
        : PLAYER_ROLE.OPERATIVE;
    const currentActor =
      game.phase === GAME_PHASE.COMPLETE
        ? null
        : actorForSeat(game, game.activeSide, currentRole);

    elements.humanSeat.dataset.side = game.humanSeat.side;
    elements.humanSeat.textContent = `${sideEmoji(game.humanSeat.side)} ${roleEmoji(game.humanSeat.role)} You are ${sideLabel(game.humanSeat.side)} ${roleLabel(game.humanSeat.role)}`;
    elements.undoAction.disabled = !undoSnapshot || botBusy;
    renderScore();
    renderBoardToolbar();
    renderBoard(view, currentActor, currentRole);
    renderTurnPanel(currentActor, currentRole);
    renderHistory(view.history);
  }

  function renderScore() {
    const scores = [SIDE.BLUE, SIDE.RED].map((side) => {
      const item = document.createElement("div");
      item.className = "play-score-team";
      item.dataset.side = side;
      item.classList.toggle(
        "is-active",
        game.phase !== GAME_PHASE.COMPLETE && game.activeSide === side,
      );
      const label = document.createElement("span");
      label.textContent = sideLabel(side);
      const value = document.createElement("strong");
      const remaining = remainingCardsForSide(game.cards, side);
      value.textContent = String(remaining);
      item.setAttribute(
        "aria-label",
        `${sideLabel(side)}, ${remaining} remaining`,
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

  function renderBoard(view, currentActor, currentRole) {
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
    const cards = visibleCards.map((card) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "play-card";
      button.dataset.layoutId = String(card.layoutId);
      button.dataset.team = card.team ?? "hidden";
      button.classList.toggle("is-done", card.done);
      button.disabled = !canGuess || card.done;
      button.textContent = card.word;
      const role = card.team ? teamLabel(card.team) : "unrevealed";
      button.setAttribute(
        "aria-label",
        card.done || card.team
          ? `${card.word}, ${role}${card.done ? ", revealed" : ""}`
          : `Guess ${card.word}`,
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

  function renderTurnPanel(currentActor, currentRole) {
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
    const turnAction = document.createElement("strong");
    const turnNote = document.createElement("span");
    turnNote.className = "play-turn-note";

    if (game.currentTurn) {
      turnLabel.textContent = `${sideEmoji(game.currentTurn.side)} ${sideLabel(game.currentTurn.side)} turn`;
      turnAction.textContent = `💬 ${game.currentTurn.clue} ${game.currentTurn.number}`;
      turnNote.textContent =
        currentActor === "human"
          ? `${roleEmoji(PLAYER_ROLE.OPERATIVE)} Choose a card or pass.`
          : `🤖 ${roleEmoji(PLAYER_ROLE.OPERATIVE)} Bot operative is choosing.`;
    } else if (game.phase === GAME_PHASE.COMPLETE) {
      const reason =
        game.endReason === GAME_END_REASON.ASSASSIN
          ? "The assassin ended the game."
          : "All agents were found.";
      turnLabel.textContent = "🏁 Game complete";
      turnAction.textContent = `${sideEmoji(game.winner)} ${sideLabel(game.winner)} wins`;
      turnNote.textContent = reason;
    } else {
      turnLabel.textContent = `${sideEmoji(game.activeSide)} ${sideLabel(game.activeSide)} turn`;
      turnAction.textContent =
        currentActor === "human"
          ? `${roleEmoji(PLAYER_ROLE.SPYMASTER)} Give a clue`
          : `🤖 ${roleEmoji(PLAYER_ROLE.SPYMASTER)} Choosing a clue`;
      turnNote.textContent =
        currentActor === "human"
          ? "One word and a number."
          : `${roleEmoji(PLAYER_ROLE.SPYMASTER)} The bot spymaster is studying the board.`;
    }
    if (statusMessage && !turnNote.textContent.includes(statusMessage)) {
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
      elements.guessProgress.textContent = `${guesses} of ${limit} guesses used`;
    }
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
    elements.toggleSuggestions.textContent = suggestionsExpanded
      ? "💡 Hide clue suggestions"
      : "💡 Show clue suggestions";
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
      message.textContent = "Loading suggestions...";
      elements.suggestionList.replaceChildren(message);
      return;
    }
    const buttons = suggestions.map((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "play-suggestion";
      const clue = document.createElement("strong");
      clue.textContent = `${suggestion.clue.toUpperCase()} ${suggestion.number}`;
      const worth = document.createElement("span");
      worth.className = "play-suggestion-metric";
      worth.dataset.tone = worthTone(suggestion.worth);
      worth.textContent = `Worth ${suggestion.worth}`;
      const safety = document.createElement("span");
      const safetyScore = Math.min(99, Math.round(suggestion.success * 100));
      safety.className = "play-suggestion-metric";
      safety.dataset.risk = suggestion.risk;
      safety.textContent = `${labelRisk(suggestion.risk)} ${safetyScore}`;
      safety.title =
        `${labelRisk(suggestion.risk)} safety: ${safetyScore} out of 99 estimated from the all-target hit chance. ` +
        "The color also reflects safety margin and assassin danger.";
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
    const items = visible.slice(-16).map((event) => {
      const item = document.createElement("li");
      item.dataset.side = event.side ?? event.winner ?? "";
      if (event.type === "clue-given") {
        const intendedWords =
          game.phase === GAME_PHASE.COMPLETE && event.intendedLayoutIds?.length
            ? event.intendedLayoutIds
                .map((layoutId) => game.cards.find((card) => card.layoutId === layoutId)?.word)
                .filter(Boolean)
            : [];
        item.textContent = `${sideEmoji(event.side)} ${roleEmoji(PLAYER_ROLE.SPYMASTER)} ${sideLabel(event.side)} clue: ${event.clue} ${event.number}${
          intendedWords.length ? `, intended ${intendedWords.join(" + ")}` : ""
        }`;
      } else if (event.type === "card-guessed") {
        item.textContent = `${sideEmoji(event.side)} ${roleEmoji(PLAYER_ROLE.OPERATIVE)} ${sideLabel(event.side)} guessed ${event.word}, ${teamLabel(event.team)}`;
      } else if (event.type === "turn-passed") {
        item.textContent = `${sideEmoji(event.side)} ${roleEmoji(PLAYER_ROLE.OPERATIVE)} ${sideLabel(event.side)} passed`;
      } else {
        item.textContent = `🏁 ${sideEmoji(event.winner)} ${sideLabel(event.winner)} won by ${
          event.reason === GAME_END_REASON.ASSASSIN ? "assassin" : "finding every agent"
        }`;
      }
      return item;
    });
    elements.historyCount.textContent = `${visible.length} events`;
    elements.historyList.replaceChildren(...items);
    elements.historyList.scrollTop = elements.historyList.scrollHeight;
  }

}

function sideLabel(side) {
  return side === SIDE.RED ? "Red" : "Blue";
}

function roleLabel(role) {
  return role === PLAYER_ROLE.SPYMASTER ? "Spymaster" : "Operative";
}

function sideEmoji(side) {
  return side === SIDE.RED ? "🔴" : "🔵";
}

function roleEmoji(role) {
  return role === PLAYER_ROLE.SPYMASTER ? "🕵️" : "🔎";
}

function teamLabel(team) {
  return {
    friendly: "Blue",
    enemy: "Red",
    neutral: "Neutral",
    assassin: "Assassin",
  }[team] ?? team;
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

function botSettingsLabel(settings) {
  const model = modelOption(settings.modelId);
  const style = settings.cluePolicy === "hybrid" ? "human-like" : "conservative";
  const aggression = {
    [PLAY_OPERATIVE_AGGRESSION.CONSERVATIVE]: "conservative operative",
    [PLAY_OPERATIVE_AGGRESSION.AGGRESSIVE]: "aggressive operative",
    [PLAY_OPERATIVE_AGGRESSION.DYNAMIC]: "dynamic operative",
  }[settings.operativeAggression];
  const bonus =
    settings.bonusGuesses === PLAY_BONUS_POLICY.PASS
      ? "stop at number"
      : "allow +1";
  return `${model.label}, ${settings.candidateCount / 1000}k, ${style}, ${aggression}, ${bonus}`;
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
