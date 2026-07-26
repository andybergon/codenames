import { expect, test } from "@playwright/test";
import pickerBenchmark from "../scripts/generated/model-picker-benchmark.json" with { type: "json" };
import calibrationRound from "../public/data/calibration/embedding-finalists-v1.json" with { type: "json" };
import {
  decodeCompletedGame,
  decodePlayGame,
  encodeCompletedGame,
  encodePlayGame,
} from "../src/play/game-share.js";
import { OFFICIAL_WORDS } from "../src/word-data.js";

const SHARED_BOARD = "/?mode=train&b=2sw7fIwN9dL7Yos";

async function useTestBotAction(page, delay) {
  await page.addInitScript((botActionDelay) => {
    window.__codenamesPlayModeOptions = {
      ...window.__codenamesPlayModeOptions,
      botActionDelay,
      botActionExecutor(game) {
        return {
          game: {
            ...game,
            phase: "complete",
            currentTurn: null,
            winner: game.activeSide,
            endReason: "agents",
          },
        };
      },
    };
  }, delay);
}

async function useTestPlayAnalysis(page) {
  const externalRequests = [];
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }
    externalRequests.push(route.request().url());
    await route.abort();
  });
  await page.addInitScript(() => {
    window.__codenamesPlayModeOptions = {
      ...window.__codenamesPlayModeOptions,
      analysisExecutor({ cards }) {
        const targets = cards
          .filter((card) => card.team === "friendly" && !card.done)
          .slice(0, 2)
          .map((card, index) => ({
            layoutId: card.layoutId,
            word: card.word,
            sim: 0.82 - index * 0.04,
          }));
        return {
          safe: [],
          stretch: [],
          suggestions: targets.length
            ? [
                {
                  clue: "fixture",
                  number: targets.length,
                  targets,
                  worth: 78,
                  expectedNet: 1.6,
                  success: 0.88,
                  margin: 0.24,
                  risk: "safe",
                },
              ]
            : [],
          summary: {
            friendlyTotal: targets.length,
            candidateTotal: 1,
            bestMargin: 0.24,
            bestNet: 1.6,
          },
        };
      },
      guessCandidateExecutor({ cards }) {
        return cards
          .filter((card) => !card.done)
          .map((card, index) => ({
            layoutId: card.layoutId,
            similarity: 0.9 - index * 0.02,
          }));
      },
    };
  });
  return externalRequests;
}

function playSessionWithHistory(history) {
  const teams = [
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  return {
    schemaVersion: 1,
    seed: "history-ui",
    wordSet: "official",
    humanSeat: { side: "blue", role: "spymaster" },
    cards: teams.map((team, layoutId) => ({
      word: `WORD${layoutId}`,
      team,
      layoutId,
      done: false,
      revealedBy: null,
      revealedTurn: null,
    })),
    activeSide: "blue",
    phase: "awaiting-clue",
    turnNumber: 7,
    currentTurn: null,
    winner: null,
    endReason: null,
    history: [
      {
        type: "game-started",
        humanSeat: { side: "blue", role: "spymaster" },
        activeSide: "blue",
      },
      ...history,
    ],
  };
}

function completedShareGame() {
  const teams = [
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  const cards = teams.map((team, layoutId) => ({
    word: `WORD${layoutId}`,
    team,
    layoutId,
    done: layoutId === 24,
    revealedBy: layoutId === 24 ? "blue" : null,
    revealedTurn: layoutId === 24 ? 1 : null,
  }));
  const humanSeat = { side: "blue", role: "spymaster" };
  return {
    schemaVersion: 1,
    seed: "shared-complete",
    language: "en",
    wordSet: "official",
    wordReusePolicy: "fully-random",
    botSettings: {
      modelId: "bge-small",
      candidateCount: 10_000,
      cluePolicy: "hybrid",
      multiTolerance: 5,
      operativeAggression: "dynamic",
      bonusGuesses: "pass",
    },
    humanSeat,
    cards,
    activeSide: "blue",
    phase: "complete",
    turnNumber: 1,
    currentTurn: {
      side: "blue",
      clue: "FIRST",
      number: 1,
      actor: "human",
      intendedLayoutIds: [0],
      guesses: [
        {
          layoutId: 24,
          word: "WORD24",
          team: "assassin",
          actor: "bot",
        },
      ],
    },
    winner: "red",
    endReason: "assassin",
    history: [
      {
        type: "game-started",
        humanSeat,
        language: "en",
        botSettings: {
          modelId: "bge-small",
          candidateCount: 10_000,
          cluePolicy: "hybrid",
          multiTolerance: 5,
          operativeAggression: "dynamic",
          bonusGuesses: "pass",
        },
        activeSide: "blue",
      },
      {
        type: "clue-given",
        turn: 1,
        side: "blue",
        actor: "human",
        clue: "FIRST",
        number: 1,
        intendedLayoutIds: [0],
      },
      {
        type: "card-guessed",
        turn: 1,
        side: "blue",
        actor: "bot",
        layoutId: 24,
        word: "WORD24",
        team: "assassin",
      },
      {
        type: "game-ended",
        turn: 1,
        winner: "red",
        reason: "assassin",
      },
    ],
  };
}

function activeShareGame() {
  const completed = completedShareGame();
  const humanSeat = { side: "red", role: "spymaster" };
  const cards = completed.cards.map((card) => ({
    ...card,
    done: card.layoutId === 0,
    revealedBy: card.layoutId === 0 ? "blue" : null,
    revealedTurn: card.layoutId === 0 ? 1 : null,
  }));
  const guess = {
    layoutId: 0,
    word: "WORD0",
    team: "friendly",
    actor: "bot",
  };
  return {
    ...completed,
    seed: "shared-active",
    humanSeat,
    cards,
    activeSide: "red",
    phase: "awaiting-clue",
    turnNumber: 2,
    currentTurn: null,
    winner: null,
    endReason: null,
    history: [
      {
        type: "game-started",
        humanSeat,
        language: "en",
        botSettings: completed.botSettings,
        activeSide: "blue",
      },
      {
        type: "clue-given",
        turn: 1,
        side: "blue",
        actor: "bot",
        clue: "FIRST",
        number: 1,
        intendedLayoutIds: [0],
      },
      {
        type: "card-guessed",
        turn: 1,
        side: "blue",
        ...guess,
      },
      {
        type: "turn-passed",
        turn: 1,
        side: "blue",
        actor: "bot",
      },
      {
        type: "turn-ended",
        turn: 1,
        side: "blue",
        reason: "pass",
        clue: "FIRST",
        number: 1,
        guesses: [guess],
      },
    ],
  };
}

async function resumePlaySession(page, history) {
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, playSessionWithHistory(history));
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
}

test("saved Play CTA distinguishes active games from finished reviews", async ({
  page,
}) => {
  const activeGame = playSessionWithHistory([]);
  await page.goto("/");
  await page.evaluate((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, activeGame);
  await page.reload();

  const resumeGame = page.getByRole("button", {
    name: "Resume game",
    exact: true,
  });
  await expect(resumeGame).toBeVisible();
  await resumeGame.click();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#play-game")).toBeVisible();
  await expect(page.locator("#play-post-game-outcome")).toBeHidden();

  const completedGame = {
    ...activeGame,
    phase: "complete",
    winner: "blue",
    endReason: "agents",
    history: [
      ...activeGame.history,
      {
        type: "game-ended",
        turn: activeGame.turnNumber,
        winner: "blue",
        reason: "agents",
      },
    ],
  };
  await page.evaluate((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, completedGame);
  await page.reload();

  const reviewFinishedGame = page.getByRole("button", {
    name: "Review finished game",
    exact: true,
  });
  const savedBeforeReview = await page.evaluate(() =>
    localStorage.getItem("codenames-play-session-v1"),
  );
  await expect(reviewFinishedGame).toBeVisible();
  await reviewFinishedGame.click();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#play-game")).toBeVisible();
  await expect(page.locator("#play-clue-display")).toContainText(
    "Game complete",
  );
  await expect(page.locator("#play-history-heading-label")).toHaveText(
    "Post-game analysis",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("codenames-play-session-v1"),
      ),
    )
    .toBe(savedBeforeReview);
});

test("mobile board and metric help remain fully usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(SHARED_BOARD);

  const boardGrid = page.locator(".board-grid");
  await expect(boardGrid).toBeVisible();
  await expect
    .poll(() => boardGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns))
    .toMatch(/\S+\s+\S+/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await expect(page.locator(".turn-controls")).toBeVisible();

  const metricHelp = page.getByRole("button", { name: "About Recommendation metrics" });
  await expect(metricHelp).toHaveCSS("width", "28px");
  await expect(metricHelp).toHaveCSS("height", "28px");
  await metricHelp.click();

  const popover = page.locator("#info-mobile-recommendations-recommendation-metrics");
  await expect(popover).toBeVisible();
  const bounds = await popover.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
});

test("mobile recommendation cards keep the explanation action visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/fixtures/recommendations.html");

  await expect(page.locator(".suggestion-row")).toBeVisible();
  const layout = await page.evaluate(() => {
    const row = document.querySelector(".suggestion-row");
    const table = document.querySelector(".suggestion-table");
    return {
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      rowWidth: row.getBoundingClientRect().width,
      tableWidth: table.getBoundingClientRect().width,
      visibleLabels: [...row.querySelectorAll("td")]
        .filter((cell) => cell.getBoundingClientRect().width > 0)
        .map((cell) => cell.dataset.label),
      targetLayout: [...row.querySelectorAll(".target-chip")].map((chip) => ({
        width: chip.getBoundingClientRect().width,
        scoreFits:
          chip.querySelector(".target-score").getBoundingClientRect().right <=
          chip.getBoundingClientRect().right,
      })),
    };
  });

  expect(layout.pageOverflows).toBe(false);
  expect(layout.tableWidth).toBeLessThanOrEqual(344);
  expect(layout.rowWidth).toBeLessThanOrEqual(344);
  expect(layout.visibleLabels).toEqual([
    "Clue",
    "Items",
    "Targets",
    "Why it works",
    "Risk",
    "Apply",
  ]);
  await expect(
    page.getByRole("button", {
      name: "Explain why Province connects Microscope, Hospital, Nurse",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".explanation-targets")).toBeHidden();
  await expect(page.locator(".explanation-risk")).toContainText(
    "Australia is the closest danger",
  );
  expect(layout.targetLayout.every((target) => target.scoreFits)).toBe(true);
  expect(Math.max(...layout.targetLayout.map((target) => target.width))).toBeLessThanOrEqual(
    Math.min(...layout.targetLayout.map((target) => target.width)) + 1,
  );
});

test("recommendation values remain visible across responsive breakpoints", async ({ page }) => {
  await page.goto("/tests/fixtures/recommendations.html");

  for (const width of [320, 390, 720, 721, 900, 1115, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => {
      const chips = [...document.querySelectorAll(".target-chip")];
      const protectedValues = [
        ...document.querySelectorAll(
          ".target-score, .item-cell strong",
        ),
      ];
      return {
        pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        chipWidths: chips.map((chip) => Math.round(chip.getBoundingClientRect().width)),
        protectedValuesFit: protectedValues.every((value) => {
          const valueRect = value.getBoundingClientRect();
          const parentRect = value.parentElement.getBoundingClientRect();
          return valueRect.left >= parentRect.left - 1 && valueRect.right <= parentRect.right + 1;
        }),
      };
    });

    expect(layout.pageOverflows, `page overflow at ${width}px`).toBe(false);
    expect(layout.protectedValuesFit, `cropped value at ${width}px`).toBe(true);
    expect(
      Math.max(...layout.chipWidths) - Math.min(...layout.chipWidths),
      `uneven target chips at ${width}px`,
    ).toBeLessThanOrEqual(1);
  }
});

test("recommendation headers keep labels and info controls separate", async ({ page }) => {
  await page.goto("/tests/fixtures/recommendations.html");
  await expect(page.locator('th[data-column="explanation"]')).toBeVisible();

  for (const width of [900, 1011, 1115]) {
    await page.setViewportSize({ width, height: 900 });
    const headers = await page.evaluate(() =>
      ["explanation", "risk"].map((column) => {
        const header = document.querySelector(`th[data-column="${column}"]`);
        const label = header.querySelector(".sort-button, .column-label").getBoundingClientRect();
        const info = header.querySelector(".info-control").getBoundingClientRect();
        const bounds = header.getBoundingClientRect();
        return {
          column,
          controlsOverlap: label.right > info.left,
          infoOverflows: info.right > bounds.right,
        };
      }),
    );

    expect(
      headers.filter((header) => header.controlsOverlap || header.infoOverflows),
      `header overlap at ${width}px`,
    ).toEqual([]);
  }
});

test("recommendations explain one clue only after an uncached click", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const explanationRequests = [];
  await page.route("**/api/explain-recommendations", async (route) => {
    const request = route.request().postDataJSON();
    explanationRequests.push(request);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        explanations: request.recommendations.map(({ id, clue, targets }) => ({
          id,
          explanation: `These words connect through ${clue.toLowerCase()}: ${targets
            .map((target) => target.toLowerCase())
            .join(", ")} each has a direct relationship to the clue.`,
        })),
      }),
    });
  });
  await page.goto("/tests/fixtures/recommendations.html");

  const explainButtons = page.getByRole("button", { name: /^Explain why/ });
  await expect(explainButtons).toHaveCount(1);
  expect(explanationRequests).toHaveLength(0);
  await expect(explainButtons.locator("svg.lucide-sparkles")).toHaveCount(1);
  await explainButtons.click();
  await expect(page.locator(".explanation-targets")).toContainText(
    "These words connect through",
  );
  expect(explanationRequests).toHaveLength(1);
  expect(explanationRequests[0].recommendations).toHaveLength(1);

  await page.reload();
  expect(explanationRequests).toHaveLength(1);
  await expect(page.getByRole("button", { name: /^Explain why/ })).toHaveCount(0);
  await expect(page.locator(".explanation-targets")).toContainText(
    "These words connect through",
  );
});

test("an unconfigured explanation reports the deployment issue without retrying", async ({
  page,
}) => {
  let explanationRequests = 0;
  await page.route("**/api/explain-recommendations", async (route) => {
    explanationRequests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "semantic_explanations_not_configured",
        error: "Semantic explanations are not configured.",
      }),
    });
  });
  await page.goto("/tests/fixtures/recommendations.html");

  const explainButton = page.getByRole("button", {
    name: "Explain why Province connects Microscope, Hospital, Nurse",
    exact: true,
  });
  await expect(explainButton).toBeVisible();
  await explainButton.click();

  await expect(page.locator(".explanation-targets.is-error")).toHaveText(
    "Semantic explanations are not configured for this deployment.",
  );
  await expect(explainButton).toHaveCount(0);
  expect(explanationRequests).toBe(1);
});

test("choosing a word pool does not replace the current board", async ({ page }) => {
  await page.goto(SHARED_BOARD);

  const firstWord = page.getByRole("textbox", { name: "Word 1", exact: true });
  const extended = page.getByRole("button", {
    name: "Use Extended words for the next new board",
  });
  const originalWord = await firstWord.inputValue();
  const originalUrl = page.url();

  await extended.click();

  await expect(extended).toHaveAttribute("aria-pressed", "true");
  await expect(firstWord).toHaveValue(originalWord);
  expect(page.url()).toBe(originalUrl);
});

test("global language switch creates a versioned Italian Train board and survives reload", async ({
  page,
}) => {
  await page.goto(SHARED_BOARD);
  const firstWord = page.getByRole("textbox", { name: "Word 1", exact: true });
  const originalWord = await firstWord.inputValue();
  await page.getByRole("button", { name: "Use Italian", exact: true }).click();

  await expect(
    page.getByRole("button", {
      name: "Usa le parole italiane Estese per il prossimo tabellone",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('[data-word-set-value="official"]'),
  ).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.getByRole("heading", { name: "Tabellone" })).toBeVisible();
  await expect(page.locator("#model-lab-model")).toHaveValue(
    "multilingual-e5-small",
  );
  await expect(page.locator("#model-lab-model")).toBeDisabled();
  await expect(page.locator("#model-lab-candidates")).toHaveValue("10000");
  await expect(page.locator(".italian-model-summary")).toContainText(
    "insieme Esteso originale di 800 parole",
  );
  await expect(page.locator("#board-counts")).toContainText(
    "Blu9Rossa8Neutrale7Assassino1",
  );
  await expect(page.locator("#board-metrics")).toContainText(
    "Complessità",
  );
  await expect(page.locator("#board-metrics")).toContainText(
    "Blu contro Rossa",
  );
  for (const [column, label] of [
    ["clue", "Indizio"],
    ["items", "Carte"],
    ["targets", "Obiettivi"],
    ["explanation", "Perché funziona"],
    ["risk", "Rischio"],
    ["action", "Applica"],
  ]) {
    await expect(
      page.locator(`.suggestion-table [data-column="${column}"]`),
    ).toContainText(label);
  }
  await expect(
    page.locator(".explain-recommendation-button").first(),
  ).toContainText("Spiega");
  await expect(
    page.getByRole("button", {
      name: "Informazioni su Perché funziona",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".explanation-risk").first()).toContainText(
    /rischio principale|pericolo più vicino/,
  );
  await expect(
    page.locator('.suggestion-table [data-column="worth"]'),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Dettagli punteggi" }).check();
  for (const [column, label] of [
    ["worth", "Worth"],
    ["hit", "Successo stim."],
    ["danger", "Pericolo più vicino"],
  ]) {
    await expect(
      page.locator(`.suggestion-table [data-column="${column}"]`),
    ).toContainText(label);
  }
  expect(new URL(page.url()).searchParams.get("b")).toMatch(
    /^4s[A-Za-z0-9_-]{11}i1xs$/,
  );

  const words = await page
    .locator(".word-input")
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(words).toHaveLength(25);
  expect(new Set(words).size).toBe(25);
  expect(words).not.toContain(originalWord);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.locator(".word-input")).toHaveCount(25);
  await expect(page.locator(".word-input").first()).toHaveValue(words[0]);
});

test("Italian Train controls fit phone, tablet, and desktop viewports", async ({
  page,
}) => {
  await page.goto(SHARED_BOARD);
  await page.getByRole("button", { name: "Use Italian", exact: true }).click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => ({
      pageOverflows:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      languageControlVisible:
        document.querySelector(".app-language-switch").getBoundingClientRect().width >
        0,
      boardWidth: document.querySelector(".board-panel").getBoundingClientRect()
        .width,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(layout.pageOverflows, `overflow at ${viewport.width}px`).toBe(false);
    expect(
      layout.languageControlVisible,
      `language control hidden at ${viewport.width}px`,
    ).toBe(true);
    expect(layout.boardWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});

test("recommendation perspective can switch between Blue and Red", async ({ page }) => {
  await page.goto(SHARED_BOARD);

  const blue = page.getByRole("button", { name: "Blue", exact: true });
  const red = page.getByRole("button", { name: "Red", exact: true });

  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await red.click();

  await expect(red).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".results-panel")).toHaveAttribute("data-active-side", "red");
  await expect(page.locator("#turn-status")).toBeEmpty();
});

test("Play randomly assigns a seat and keeps all four overrides available", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#app-title")).toHaveText("Codenames");
  await expect(page).toHaveTitle("Codenames");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(new URL(page.url()).searchParams.has("mode")).toBe(false);
  expect(
    await page.locator("[data-app-mode]").evaluateAll((buttons) =>
      buttons.map((button) => button.textContent.trim()),
    ),
  ).toEqual(["Play", "Train"]);
  await expect(page.locator("#play-setup .eyebrow")).toHaveCount(0);
  await expect(page.locator("#play-seat-note")).toHaveCount(0);
  await expect(page.locator("[data-play-seat][aria-pressed='true']")).toHaveCount(1);

  for (const seat of [
    "blue:spymaster",
    "blue:operative",
    "red:spymaster",
    "red:operative",
  ]) {
    const button = page.locator(`[data-play-seat="${seat}"]`);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }

  const randomize = page.getByRole("button", {
    name: "Pick a different random role",
    exact: true,
  });
  await expect(randomize).toHaveAttribute(
    "title",
    "Pick a different random role",
  );
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const before = await page
      .locator("[data-play-seat][aria-pressed='true']")
      .getAttribute("data-play-seat");
    await randomize.click();
    const after = await page
      .locator("[data-play-seat][aria-pressed='true']")
      .getAttribute("data-play-seat");
    expect(after).not.toBe(before);
  }
});

for (const storageCase of [
  {
    name: "no saved session",
    value: null,
  },
  {
    name: "a stale saved session",
    value: JSON.stringify({ schemaVersion: 0 }),
  },
  {
    name: "an invalid saved seat",
    value: JSON.stringify({
      ...playSessionWithHistory([]),
      humanSeat: { side: "green", role: "operative" },
    }),
  },
]) {
  test(`Play assigns a fresh random seat with ${storageCase.name}`, async ({
    page,
  }) => {
    await page.addInitScript((storedSession) => {
      if (storedSession === null) {
        localStorage.removeItem("codenames-play-session-v1");
      } else {
        localStorage.setItem("codenames-play-session-v1", storedSession);
      }
      Math.random = () => 0.9;
    }, storageCase.value);

    await page.goto("/?mode=play");

    await expect(
      page.locator('[data-play-seat="red:operative"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#saved-play-actions")).toBeHidden();

    await page.getByRole("button", { name: "Start new game", exact: true }).click();
    const storedSeat = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("codenames-play-session-v1"))
          .humanSeat,
    );
    expect(storedSeat).toEqual({ side: "red", role: "operative" });
  });
}

test("Play reuses the saved seat until Random explicitly changes it", async ({
  page,
}) => {
  const completedSession = {
    ...playSessionWithHistory([]),
    phase: "complete",
    winner: "blue",
    endReason: "agents",
    history: [
      ...playSessionWithHistory([]).history,
      {
        type: "game-ended",
        turn: 7,
        winner: "blue",
        reason: "agents",
      },
    ],
  };
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, completedSession);

  await page.goto("/?mode=play");
  const savedSeat = page.locator('[data-play-seat="blue:spymaster"]');
  await expect(savedSeat).toHaveAttribute("aria-pressed", "true");

  await page
    .getByRole("button", { name: "Review finished game", exact: true })
    .click();
  await expect(page.locator("#play-human-seat .play-seat-identity")).toHaveText(
    "🔵 Blue 🕵️ Spymaster",
  );

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(savedSeat).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(page.locator("#play-human-seat .play-seat-identity")).toHaveText(
    "🔵 Blue 🕵️ Spymaster",
  );

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(savedSeat).toHaveAttribute("aria-pressed", "true");

  await page
    .getByRole("button", {
      name: "Pick a different random role",
      exact: true,
    })
    .click();
  await expect(savedSeat).toHaveAttribute("aria-pressed", "false");

  const randomizedSeat = await page
    .locator("[data-play-seat][aria-pressed='true']")
    .getAttribute("data-play-seat");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const storedSeat = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("codenames-play-session-v1")).humanSeat,
  );
  expect(`${storedSeat.side}:${storedSeat.role}`).toBe(randomizedSeat);
});

test("Codenames title returns shared and Train views to Play home", async ({
  page,
}) => {
  for (const source of [SHARED_BOARD, "/?mode=train"]) {
    await page.goto(source);
    const title = page.getByRole("link", { name: "Codenames", exact: true });
    await expect(title).toHaveAttribute("href", "/");
    await title.click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
});

test("select option menus follow the dark theme", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();

  const optionColors = await page.locator("#play-bot-model option").first().evaluate(
    (option) => {
      const style = getComputedStyle(option);
      return {
        background: style.backgroundColor,
        color: style.color,
      };
    },
  );

  expect(optionColors).toEqual({
    background: "rgb(32, 34, 36)",
    color: "rgb(243, 241, 236)",
  });
});

test("human calibration stays hidden outside its direct URL", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#calibration-mode")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Human calibration" }),
  ).toHaveCount(0);
  expect(
    await page.locator("[data-app-mode]").evaluateAll((buttons) =>
      buttons.map((button) => button.textContent.trim()),
    ),
  ).toEqual(["Play", "Train"]);
});

test("human calibration auto-saves answers and corrections across navigation", async ({
  page,
}) => {
  await page.goto("/?mode=calibrate");

  await expect(page.locator("#calibration-clue")).not.toHaveText(
    "Loading calibration",
  );
  await expect(page.locator("#calibration-progress")).toHaveText(
    "0/30 answered",
  );
  const firstWord = page.locator(".calibration-word").first();
  const secondWord = page.locator(".calibration-word").nth(1);
  await firstWord.click();
  await expect(firstWord).toBeFocused();
  await secondWord.click();
  await page.locator("#calibration-judgment").selectOption("good");
  await page.locator("#calibration-note").fill("First pass");
  await expect(page.locator("#calibration-progress")).toHaveText(
    "1/30 answered",
  );
  await expect(page.locator("#calibration-round option:checked")).toHaveText(
    "Embedding finalists (1/30)",
  );
  await expect(
    page.getByRole("button", {
      name: "Open calibration task 1, answered",
      exact: true,
    }),
  ).toHaveAttribute("data-state", "answered");
  await expect(page.locator("#calibration-status")).toHaveText(
    "Saved automatically in this browser.",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("#calibration-status")).toBeEmpty();

  await page.reload();
  await expect(page.locator("#calibration-progress")).toHaveText(
    "1/30 answered",
  );
  await page
    .getByRole("button", {
      name: "Open calibration task 1, answered",
      exact: true,
    })
    .click();
  await expect(page.locator(".calibration-word[data-selected='true']")).toHaveCount(
    2,
  );
  await secondWord.click();
  await page.locator("#calibration-note").fill("Corrected");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Open calibration task 1, answered",
      exact: true,
    })
    .click();
  await expect(page.locator(".calibration-word[data-selected='true']")).toHaveCount(
    1,
  );
  await expect(page.locator("#calibration-note")).toHaveValue("Corrected");
});

test("human calibration restores and updates database answers automatically", async ({
  page,
}) => {
  const writes = [];
  await page.route("**/api/calibration", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          answers: [
            {
              roundId: "embedding-finalists-v1",
              taskId: "embedding-finalists-v1-f000ee0bab49c800",
              guessedLayoutIds: [11],
              judgment: "good",
              note: "Restored from database",
              updatedAt: "2026-07-26T12:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (method === "PUT") {
      writes.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ answer: writes.at(-1) }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.goto("/?mode=calibrate");

  await expect(page.locator("#calibration-sync-status")).toHaveText(
    "Database synced",
  );
  await expect(page.locator("#calibration-progress")).toHaveText(
    "1/30 answered",
  );
  await expect(
    page.getByRole("button", {
      name: "Open calibration task 2, unanswered",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "true");
  await page
    .getByRole("button", {
      name: "Open calibration task 1, answered",
      exact: true,
    })
    .click();
  await expect(page.locator(".calibration-word[data-selected='true']")).toHaveCount(
    1,
  );
  await expect(page.locator("#calibration-note")).toHaveValue(
    "Restored from database",
  );

  await page.locator(".calibration-word").nth(1).click();
  await expect
    .poll(() => writes.length)
    .toBe(1);
  expect(writes[0]).toMatchObject({
    roundId: "embedding-finalists-v1",
    taskId: "embedding-finalists-v1-f000ee0bab49c800",
    guessedLayoutIds: [11, 24],
    judgment: "good",
    note: "Restored from database",
  });
});

test("human calibration distinguishes browsing from an explicit pass", async ({
  page,
}) => {
  await page.goto("/?mode=calibrate");

  await expect(page.locator("#calibration-progress")).toHaveText(
    "0/30 answered",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("#calibration-progress")).toHaveText(
    "0/30 answered",
  );

  await page
    .getByRole("button", { name: "Record pass and next", exact: true })
    .click();
  await expect(page.locator("#calibration-progress")).toHaveText(
    "1/30 answered",
  );
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Open calibration task 2, answered",
      exact: true,
    }),
  ).toHaveAttribute("data-state", "answered");
});

test("human calibration renders locally before database restore completes", async ({
  page,
}) => {
  let releaseRemote;
  const remoteReleased = new Promise((resolve) => {
    releaseRemote = resolve;
  });
  await page.route("**/api/calibration", async (route) => {
    await remoteReleased;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ answers: [] }),
    });
  });

  await page.goto("/?mode=calibrate");
  await expect(page.locator("#calibration-clue")).not.toHaveText(
    "Loading calibration",
  );
  await expect(page.locator(".calibration-word")).toHaveCount(25);
  releaseRemote();
  await expect(page.locator("#calibration-sync-status")).toHaveText(
    "Database synced",
  );
});

test("human calibration preserves an explicit pass when its draft returns to empty", async ({
  page,
}) => {
  await page.goto("/?mode=calibrate");
  await page
    .getByRole("button", { name: "Record pass and next", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Open calibration task 1, answered",
      exact: true,
    })
    .click();
  const firstWord = page.locator(".calibration-word").first();
  await firstWord.click();
  await firstWord.click();
  await expect(page.locator("#calibration-status")).toHaveText(
    "Explicit pass preserved.",
  );
  await expect(page.locator("#calibration-progress")).toHaveText(
    "1/30 answered",
  );
});

test("human calibration rejects an older imported answer", async ({ page }) => {
  await page.goto("/?mode=calibrate");
  const firstWord = page.locator(".calibration-word").first();
  const firstLayoutId = Number(await firstWord.getAttribute("data-layout-id"));
  await firstWord.click();

  const task = calibrationRound.tasks[0];
  const olderLayoutId = task.words.find(
    ({ layoutId }) => layoutId !== firstLayoutId,
  ).layoutId;
  const imported = {
    schemaVersion: 1,
    rounds: [
      {
        round: calibrationRound,
        answers: {
          [task.taskId]: {
            guessedLayoutIds: [olderLayoutId],
            judgment: "bad",
            note: "Older export",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        },
      },
    ],
  };
  await page.locator("#calibration-import-input").setInputFiles({
    name: "older-calibration.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page
    .getByRole("button", {
      name: "Open calibration task 1, answered",
      exact: true,
    })
    .click();

  await expect(
    page.locator(
      `.calibration-word[data-layout-id="${firstLayoutId}"][data-selected="true"]`,
    ),
  ).toHaveCount(1);
  await expect(page.locator("#calibration-note")).not.toHaveValue("Older export");
});

test("human calibration fits the required responsive viewports", async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?mode=calibrate");
    await expect(page.locator(".calibration-board")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
      `page overflow at ${viewport.width}x${viewport.height}`,
    ).toBe(false);
    await expect(page.locator(".calibration-word")).toHaveCount(25);
  }
});

test("human calibration imports later rounds and exports answers", async ({
  page,
}) => {
  await page.goto("/?mode=calibrate");
  const importedRound = {
    schemaVersion: 1,
    roundId: "future-round",
    title: "Future round",
    tasks: [
      {
        taskId: "future-001",
        clue: "orbit",
        number: 1,
        activeSide: "blue",
        words: [
          { layoutId: 1, word: "MOON", team: "friendly" },
          { layoutId: 2, word: "BOMB", team: "assassin" },
        ],
        intendedLayoutIds: [1],
        source: { modelId: "future-model", board: 1, turn: 1 },
      },
    ],
  };
  await page.locator("#calibration-import-input").setInputFiles({
    name: "future-round.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedRound)),
  });

  await expect(page.locator("#calibration-clue")).toHaveText("orbit");
  await expect(page.locator("#calibration-round")).toHaveValue("future-round");
  await page.getByRole("button", { name: "MOON" }).click();
  await expect(page.locator("#calibration-progress")).toHaveText(
    "1/1 answered",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export answers" }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const future = exported.rounds.find(
    ({ round }) => round.roundId === "future-round",
  );
  expect(future.answers["future-001"].guessedLayoutIds).toEqual([1]);
});

test("switching modes keeps shared layout positions stable", async ({ page }) => {
  await page.setViewportSize({ width: 857, height: 998 });
  await page.goto("/?mode=play");

  const positions = async () =>
    page.evaluate(() => ({
      title: document.querySelector("#app-title").getBoundingClientRect().left,
      modeSwitch: document
        .querySelector(".app-mode-switch")
        .getBoundingClientRect().left,
      mainCard: document
        .querySelector(
          document.querySelector("#play-mode").hidden
            ? ".board-panel"
            : "#play-setup",
        )
        .getBoundingClientRect().left,
    }));

  const playPositions = await positions();
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await expect(page.locator("#train-mode-loading")).toBeVisible();
  await expect(page.locator(".board-panel")).toBeVisible();
  const trainPositions = await positions();

  expect(trainPositions.title).toBeCloseTo(playPositions.title, 1);
  expect(trainPositions.modeSwitch).toBeCloseTo(playPositions.modeSwitch, 1);
  expect(trainPositions.mainCard).toBeCloseTo(playPositions.mainCard, 1);
});

test("header centers the mode switch across responsive layouts", async ({ page }) => {
  await page.goto("/?mode=play");

  for (const viewport of [
    { width: 390, height: 844, compact: true },
    { width: 430, height: 998, compact: true },
    { width: 768, height: 1024, compact: false },
    { width: 1440, height: 900, compact: false },
    { width: 1920, height: 1080, compact: false },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const topbar = document.querySelector(".topbar").getBoundingClientRect();
      const title = document.querySelector("#app-title").getBoundingClientRect();
      const mode = document.querySelector(".app-mode-switch").getBoundingClientRect();
      const theme = document.querySelector(".theme-switcher").getBoundingClientRect();
      const controls = document
        .querySelector(".topbar-controls")
        .getBoundingClientRect();
      const setup = document.querySelector(".play-setup").getBoundingClientRect();
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        controlsEndOffset: topbar.right - controls.right,
        setupEndOffset: setup.right - controls.right,
        modeCenterOffset:
          mode.left + mode.width / 2 - (topbar.left + topbar.width / 2),
        titleThemeCenterOffset:
          title.top + title.height / 2 - (theme.top + theme.height / 2),
        modeThemeCenterOffset:
          mode.top + mode.height / 2 - (theme.top + theme.height / 2),
        titleAboveControls:
          title.bottom <= Math.min(mode.top, controls.top) + 1,
      };
    });

    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(
      Math.abs(layout.controlsEndOffset),
      `topbar controls end alignment at ${viewport.width}px`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(layout.setupEndOffset),
      `setup card end alignment at ${viewport.width}px`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(layout.modeThemeCenterOffset),
      `mode and controls alignment at ${viewport.width}px`,
    ).toBeLessThanOrEqual(1);
    if (viewport.compact) {
      expect(
        layout.titleAboveControls,
        `compact title row at ${viewport.width}px`,
      ).toBe(true);
    } else {
      expect(
        Math.abs(layout.modeCenterOffset),
        `mode centering at ${viewport.width}px`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(layout.titleThemeCenterOffset),
        `title and theme alignment at ${viewport.width}px`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("returning to an initialized Train mode reuses its rendered UI", async ({
  page,
}) => {
  await page.goto("/?mode=train");
  await expect(page.locator(".board-panel")).toBeVisible();

  await page.evaluate(() => {
    window.__trainModeMatrixMutations = 0;
    const observer = new MutationObserver((records) => {
      window.__trainModeMatrixMutations += records.length;
    });
    observer.observe(document.querySelector("#model-lab-matrix"), {
      childList: true,
      subtree: true,
    });
  });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await expect(page.locator(".board-panel")).toBeVisible();
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.__trainModeMatrixMutations)).toBe(0);
  await expect(page.locator("#train-mode-loading")).toBeHidden();
});

test("Play exposes and saves bot policy settings", async ({ page }) => {
  await page.goto("/?mode=play");

  const settings = page.locator(".play-settings");
  await expect(settings).toContainText(
    "Official, fully random, BGE-small, 10k, human-like, fresh targets first, dynamic operative, stop at number",
  );
  await expect(settings).not.toHaveAttribute("open", "");
  await expect(settings.locator(".play-settings-toggle")).toContainText("Edit");
  expect(
    await settings.evaluate((details) =>
      details.previousElementSibling?.classList.contains("seat-grid"),
    ),
  ).toBe(true);
  await expect(page.locator(".play-setup > .play-word-set")).toHaveCount(0);
  await settings.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(settings).toHaveAttribute("open", "");

  const gameSettings = settings.locator('[data-play-settings-section="game"]');
  const allBotSettings = settings.locator(
    '[data-play-settings-section="all-bots"]',
  );
  const spymasterSettings = settings.locator(
    '[data-play-settings-section="spymaster"]',
  );
  const operativeSettings = settings.locator(
    '[data-play-settings-section="operative"]',
  );
  const developerSettings = settings.locator(
    '[data-play-settings-section="developer"]',
  );
  await expect(gameSettings.locator("legend")).toHaveText("🎮 Game");
  await expect(allBotSettings.locator("legend")).toHaveText("🤖 All bots");
  await expect(spymasterSettings.locator("legend")).toHaveText("🕵️ Spymaster");
  await expect(operativeSettings.locator("legend")).toHaveText("🔎 Operative");
  await expect(developerSettings.locator("legend")).toHaveText("🧪 Developer");
  await expect(
    settings.locator(".play-settings-section").last(),
  ).toHaveAttribute("data-play-settings-section", "developer");
  await expect(gameSettings.locator("[data-play-word-set]")).toHaveCount(2);
  await expect(
    gameSettings.locator(".play-settings-fields > #play-word-reuse-setting"),
  ).toHaveCount(1);
  await expect(gameSettings.locator(".play-word-set.play-setting")).toHaveCount(
    0,
  );
  await expect(allBotSettings.locator("#play-bot-model")).toHaveCount(1);
  await expect(spymasterSettings.locator("select")).toHaveCount(4);
  await expect(operativeSettings.locator("select")).toHaveCount(2);
  await expect(developerSettings.locator("#play-developer-mode")).not.toBeChecked();

  await expect(page.locator("#play-bot-model")).toHaveValue("bge-small");
  await expect(page.locator("#play-bot-candidates")).toHaveValue("10000");
  await expect(page.locator("#play-clue-policy")).toHaveValue("hybrid");
  await expect(page.locator("#play-multi-tolerance")).toHaveValue("5");
  await expect(page.locator("#play-missed-target-timing")).toHaveValue("late");
  await expect(page.locator("#play-operative-aggression")).toHaveValue(
    "dynamic",
  );
  await expect(page.locator("#play-bonus-guesses")).toHaveValue("pass");
  await expect(settings.locator(".play-setting-label .info-button")).toHaveCount(8);

  await page.getByRole("button", { name: "Extended 800", exact: true }).click();
  await expect(settings).toContainText(
    "Extended, fully random, BGE-small, 10k, human-like, fresh targets first, dynamic operative, stop at number",
  );
  await page.locator("#play-bot-model").selectOption("minilm-l6");
  await page.locator("#play-bot-candidates").selectOption("30000");
  await page.locator("#play-clue-policy").selectOption("current");
  await page.locator("#play-multi-tolerance").selectOption("10");
  await page.locator("#play-missed-target-timing").selectOption("balanced");
  await page.locator("#play-operative-aggression").selectOption("conservative");
  await page.locator("#play-bonus-guesses").selectOption("allow");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  const storedGame = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-session-v1")),
  );
  expect(storedGame.wordSet).toBe("extended");
  expect(storedGame.wordReusePolicy).toBe("fully-random");
  expect(storedGame.botSettings).toEqual({
    modelId: "minilm-l6",
    candidateCount: 30000,
    cluePolicy: "current",
    multiTolerance: 10,
    missedTargetTiming: "balanced",
    operativeAggression: "conservative",
    bonusGuesses: "allow",
  });
  expect(storedGame.botSettings).not.toHaveProperty("wordReusePolicy");
  expect(storedGame.developerMode).toBe(false);
  expect(storedGame.history[0].developerMode).toBe(false);
});

test("Developer mode reuses turn analysis and retains score diagnostics", async ({
  page,
}) => {
  const externalRequests = await useTestPlayAnalysis(page);
  const explanationRequests = [];
  await page.route("**/api/explain-recommendations", async (route) => {
    const request = route.request().postDataJSON();
    explanationRequests.push(request);
    const recommendation = request.recommendations[0];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        explanations: [
          {
            id: recommendation.id,
            explanation: "Developer review explanation.",
          },
        ],
      }),
    });
  });
  await page.addInitScript(() => {
    window.__codenamesPlayModeOptions = {
      ...window.__codenamesPlayModeOptions,
      botActionDelay: 5000,
    };
  });
  await page.goto("/?mode=play");

  const settings = page.locator(".play-settings");
  await settings.locator("summary").click();
  const developerMode = page.locator("#play-developer-mode");
  await developerMode.check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("codenames-developer-settings-v1"),
        ),
      ),
    )
    .toEqual({ enabled: true });

  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  const liveToggle = page.locator("#play-live-diagnostics-toggle");
  const liveCheckbox = page.locator("#play-live-diagnostics");
  await expect(liveToggle).toBeVisible();
  await expect(liveCheckbox).not.toBeChecked();
  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(0);

  await liveCheckbox.check();
  await page.getByRole("button", {
    name: "Show clue suggestions",
    exact: true,
  }).click();
  const suggestion = page.locator(".play-suggestion").first();
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await expect(
    suggestion.locator('[data-developer-score="true"]'),
  ).toContainText(/Play \d+\.\d{2}/);
  await suggestion.click();
  await page.getByRole("button", { name: "Give clue", exact: true }).click();

  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(
    25,
  );
  await expect(page.locator("#play-post-game-analysis")).toBeVisible();
  await expect(page.locator("#play-post-game-outcome")).toHaveText(
    "Developer game",
  );
  await expect(page.locator("#play-history-heading-label")).toHaveText(
    "Live turn analysis",
  );
  await expect(page.locator(".play-card[data-intended='true']")).toHaveCount(2);
  await expect(
    page.locator("#play-history-list .play-history-clue"),
  ).toHaveCount(1);
  await expect(
    page.locator("#play-history-list .explain-recommendation-button"),
  ).toHaveCount(1);
  expect(explanationRequests).toHaveLength(0);
  await page
    .locator("#play-history-list .explain-recommendation-button")
    .click();
  await expect(
    page.locator(
      "#play-history-list .play-history-explanation .explanation-targets",
    ),
  ).toContainText("Developer review explanation.");
  expect(explanationRequests).toHaveLength(1);
  expect(explanationRequests[0].recommendations).toHaveLength(1);
  await expect(page.locator("#play-live-diagnostics-panel")).toHaveCount(0);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#play-post-game-analysis")).toBeVisible();
    await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(
      25,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
      `live analysis overflow at ${viewport.width}px`,
    ).toBe(false);
  }

  const storedGame = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-session-v1")),
  );
  expect(storedGame.developerMode).toBe(true);
  expect(storedGame.history[0].developerMode).toBe(true);
  const clueEvent = storedGame.history.find(
    (event) => event.type === "clue-given",
  );
  expect(clueEvent.developerDiagnostics.diagnosticsVersion).toBe(1);
  expect(clueEvent.developerDiagnostics.spymasterDecision.kind).toBe(
    "spymaster",
  );
  expect(clueEvent.developerDiagnostics.operativeScores).toHaveLength(25);

  await page.reload();
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await expect(liveToggle).toBeVisible();
  await expect(liveCheckbox).not.toBeChecked();
  await expect(page.locator("#play-post-game-analysis")).toBeHidden();
  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(0);
  await liveCheckbox.check();
  await expect(page.locator("#play-post-game-analysis")).toBeVisible();
  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(
    25,
  );
  expect(externalRequests).toEqual([]);
});

test("Developer mode can mark and diagnose a saved game in progress", async ({
  page,
}) => {
  const externalRequests = await useTestPlayAnalysis(page);
  await page.addInitScript(() => {
    window.__codenamesPlayModeOptions = {
      ...window.__codenamesPlayModeOptions,
      botActionDelay: 5000,
    };
  });
  await page.goto("/?mode=play");

  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const originalGame = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-session-v1")),
  );
  expect(originalGame.developerMode).toBe(false);

  await page.locator("#leave-play-game").click();
  const settings = page.locator(".play-settings");
  await settings.locator("summary").click();
  const developerModeHelp = page.locator('[data-i18n="developerModeHelp"]');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(developerModeHelp).toBeVisible();
    await expect(developerModeHelp).toContainText("Unlike other settings");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  }
  const developerMode = page.locator("#play-developer-mode");
  await developerMode.check();

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("codenames-play-session-v1")),
      ),
    )
    .toMatchObject({
      developerMode: true,
      seed: originalGame.seed,
      history: [{ type: "game-started", developerMode: true }],
    });

  await developerMode.uncheck();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("codenames-developer-settings-v1"),
        ),
      ),
    )
    .toEqual({ enabled: false });
  const stillMarkedGame = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-session-v1")),
  );
  expect(stillMarkedGame.developerMode).toBe(true);
  expect(stillMarkedGame.history[0].developerMode).toBe(true);

  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  const liveToggle = page.locator("#play-live-diagnostics-toggle");
  await expect(liveToggle).toBeVisible();
  await page.locator("#play-live-diagnostics").check();
  await page.getByRole("button", {
    name: "Show clue suggestions",
    exact: true,
  }).click();
  const suggestion = page.locator(".play-suggestion").first();
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await suggestion.click();
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(page.locator("#play-history-heading-label")).toHaveText(
    "Live turn analysis",
  );
  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(
    25,
  );
  expect(externalRequests).toEqual([]);
});

test("Developer mode resumes a saved opponent guess turn before diagnostics are ready", async ({
  page,
}) => {
  await useTestBotAction(page, 0);
  const savedGame = playSessionWithHistory([
    {
      type: "clue-given",
      turn: 7,
      side: "red",
      actor: "bot",
      clue: "FIXTURE",
      number: 2,
      intendedLayoutIds: [9, 10],
    },
    {
      type: "card-guessed",
      turn: 7,
      side: "red",
      actor: "bot",
      layoutId: 9,
      word: "WORD9",
      team: "enemy",
    },
  ]);
  savedGame.humanSeat = { side: "blue", role: "operative" };
  savedGame.activeSide = "red";
  savedGame.phase = "awaiting-guess";
  savedGame.currentTurn = {
    side: "red",
    clue: "FIXTURE",
    number: 2,
    actor: "bot",
    intendedLayoutIds: [9, 10],
    guesses: [
      {
        layoutId: 9,
        word: "WORD9",
        team: "enemy",
        actor: "bot",
      },
    ],
  };

  await page.addInitScript((session) => {
    localStorage.setItem(
      "codenames-play-session-v1",
      JSON.stringify(session),
    );
  }, savedGame);
  await page.goto("/?mode=play");

  const settings = page.locator(".play-settings");
  await settings.locator("summary").click();
  await page.locator("#play-developer-mode").check();
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  await expect(page.locator("#play-game")).toBeVisible();
  await expect(page.locator("#play-post-game-outcome")).toBeVisible();
});

test("Developer live analysis matches post-game role and target review", async ({
  page,
}) => {
  const session = playSessionWithHistory([
    {
      type: "clue-given",
      turn: 7,
      side: "blue",
      actor: "bot",
      clue: "FIXTURE",
      number: 2,
      intendedLayoutIds: [0, 1],
      developerDiagnostics: {
        diagnosticsVersion: 1,
        modelId: "bge-small",
        operativeScores: Array.from({ length: 25 }, (_, layoutId) => ({
          layoutId,
          similarity: 0.9 - layoutId * 0.02,
        })),
      },
    },
  ]);
  session.developerMode = true;
  session.humanSeat = { side: "blue", role: "operative" };
  session.phase = "awaiting-guess";
  session.currentTurn = {
    side: "blue",
    clue: "FIXTURE",
    number: 2,
    actor: "bot",
    intendedLayoutIds: [0, 1],
    guesses: [],
    developerDiagnostics:
      session.history.at(-1).developerDiagnostics,
  };
  session.history[0].developerMode = true;
  await page.addInitScript((saved) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(saved));
  }, session);
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  await expect(page.locator('.play-card[data-team="hidden"]')).toHaveCount(25);
  await expect(page.locator("#play-post-game-analysis")).toBeHidden();
  await page.locator("#play-live-diagnostics").check();

  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(
    25,
  );
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator('.play-card[data-team="neutral"]')).toHaveCount(7);
  await expect(page.locator('.play-card[data-team="assassin"]')).toHaveCount(1);
  await expect(page.locator(".play-card[data-intended='true']")).toHaveCount(2);
  await expect(page.locator("#play-operative-controls")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Review turn 1: Blue clue FIXTURE 2",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.locator("#play-live-diagnostics").uncheck();
  await expect(page.locator('.play-card[data-team="hidden"]')).toHaveCount(25);
  await expect(page.locator("#play-operative-controls")).toBeVisible();
});

test("Play avoids recent words across pools and persists policy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedPlayGame = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto("/?mode=play");
  await page.locator(".play-settings summary").click();
  const reusePolicy = page.locator("#play-word-reuse-policy");
  const reuseStatus = page.locator("#play-word-reuse-status");
  await expect(reusePolicy).toHaveValue("fully-random");
  await expect(reuseStatus).toBeHidden();
  await reusePolicy.selectOption("avoid-recent");
  await expect(reuseStatus).toBeHidden();
  await page.locator('[data-play-seat="blue:spymaster"]').click();

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const firstOfficial = await page
    .locator(".play-card")
    .evaluateAll((cards) => cards.map((card) => card.textContent.trim()));
  await page.getByRole("button", { name: "Share game", exact: true }).click();
  const shared = decodePlayGame(
    new URL(await page.evaluate(() => window.__copiedPlayGame)).searchParams.get("g"),
  );
  expect(shared.wordReusePolicy).toBe("avoid-recent");
  expect(shared.cards.map(({ word }) => word).sort()).toEqual(
    [...firstOfficial].sort(),
  );
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(reusePolicy).toHaveValue("avoid-recent");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const secondOfficial = await page
    .locator(".play-card")
    .evaluateAll((cards) => cards.map((card) => card.textContent.trim()));
  expect(secondOfficial.filter((word) => firstOfficial.includes(word))).toEqual([]);

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator('[data-play-word-set="extended"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const extended = await page
    .locator(".play-card")
    .evaluateAll((cards) => cards.map((card) => card.textContent.trim()));
  expect(
    extended.filter((word) => [...firstOfficial, ...secondOfficial].includes(word)),
  ).toEqual([]);

  await page.reload();
  await page.locator(".play-settings summary").click();
  await expect(reusePolicy).toHaveValue("avoid-recent");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("codenames-play-word-reuse-v1"))
          .boards.length,
    ),
  ).toBe(3);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page
      .locator('[data-play-settings-section="game"] .play-settings-fields')
      .evaluate((fields) => {
        const reuse = fields
          .querySelector("#play-word-reuse-setting")
          .getBoundingClientRect();
        const wordSet = fields
          .querySelector(".play-word-set")
          .getBoundingClientRect();
        const overlaps =
          reuse.left < wordSet.right &&
          reuse.right > wordSet.left &&
          reuse.top < wordSet.bottom &&
          reuse.bottom > wordSet.top;
        return {
          overlaps,
          pageOverflows:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
    expect(layout.overlaps, `Game setting overlap at ${viewport.width}px`).toBe(false);
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
  }

  await reusePolicy.selectOption("fully-random");
  await page.reload();
  await expect(reusePolicy).toHaveValue("fully-random");
  await page.locator(".play-settings summary").click();
  await reusePolicy.selectOption("avoid-recent");
  await page.getByRole("button", { name: "Clear history", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clear history", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("codenames-play-word-reuse-v1")),
    ),
  ).toMatchObject({ policy: "avoid-recent", boards: [] });
});

test("Play explains new-board reuse in a responsive info control", async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?mode=play");
    await page.locator(".play-settings summary").click();
    const help = page.getByRole("button", {
      name: "About New board words",
      exact: true,
    });
    await help.hover();
    const popover = page.locator(`#${await help.getAttribute("aria-controls")}`);
    await expect(popover).toBeVisible();
    await expect(popover.locator("tbody tr")).toHaveCount(2);
    await expect(popover).toContainText("Any pool word");
    await expect(popover).toContainText("least-recently-used repeats");
    const bounds = await popover.boundingBox();
    const clientViewport = await page.evaluate(() => ({
      height: document.documentElement.clientHeight,
      width: document.documentElement.clientWidth,
    }));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(clientViewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(clientViewport.height);
  }
});

test("Play warns and fills a board when recent words exhaust the pool", async ({
  page,
}) => {
  await page.addInitScript((words) => {
    const boards = [];
    for (let index = 0; index < words.length; index += 25) {
      boards.push(words.slice(index, index + 25));
    }
    localStorage.setItem(
      "codenames-play-word-reuse-v1",
      JSON.stringify({
        schemaVersion: 1,
        policy: "avoid-recent",
        boards,
      }),
    );
  }, OFFICIAL_WORDS);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?mode=play");
    await page.locator(".play-settings summary").click();
    await expect(page.locator("#play-word-reuse-status")).toContainText(
      "must reuse at least 25",
    );
    const layout = await page.locator("#play-word-reuse-setting").evaluate(
      (setting) => ({
        pageOverflows:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        settingOverflows: setting.scrollWidth > setting.clientWidth,
      }),
    );
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(
      layout.settingOverflows,
      `reuse setting overflow at ${viewport.width}px`,
    ).toBe(false);
  }

  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const words = await page
    .locator(".play-card")
    .evaluateAll((cards) => cards.map((card) => card.textContent.trim()));
  expect(words).toHaveLength(25);
  expect(new Set(words).size).toBe(25);
  expect(words.every((word) => OFFICIAL_WORDS.includes(word))).toBe(true);
});

test("Play bot setting help explains measured tradeoffs and stays on-screen", async ({
  page,
}) => {
  const settingHelp = [
    ["Embedding model", 3, "58.57%"],
    ["Clue vocabulary", 4, "85.47%"],
    ["Clue scoring", 2, "50.4%"],
    ["Prefer multi-card clues", 3, "best clue for 2+ cards"],
    ["Retry missed targets", 3, "fresh-target bias fades"],
    ["Operative aggression", 3, "revealed-card counts"],
    ["Extra guess", 2, "26.4% correct"],
  ];

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?mode=play");
    await page.locator(".play-settings summary").click();

    for (const [label, rowCount, explanation] of settingHelp) {
      const button = page.getByRole("button", { name: `About ${label}`, exact: true });
      await button.hover();
      const popover = page.locator(`#${await button.getAttribute("aria-controls")}`);
      await expect(popover).toBeVisible();
      await expect(popover).toContainText(explanation);
      await expect(popover.locator("table.info-table")).toBeVisible();
      await expect(popover.locator("tbody tr")).toHaveCount(rowCount);
      expect(
        await popover.locator("table.info-table").evaluate(
          (table) => table.scrollWidth > table.clientWidth,
        ),
      ).toBe(false);
      const bounds = await popover.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    }
  }

  const extraGuess = page.getByRole("button", {
    name: "About Extra guess",
    exact: true,
  });
  await extraGuess.click();
  await expect(extraGuess).toHaveAttribute("aria-expanded", "true");
  const extraGuessPopover = page.locator(
    `#${await extraGuess.getAttribute("aria-controls")}`,
  );
  await expect(extraGuessPopover).toBeVisible();
  await extraGuess.click();
  await expect(extraGuess).toHaveAttribute("aria-expanded", "false");
  await expect(extraGuessPopover).toBeHidden();

  const modelHelp = page.getByRole("button", {
    name: "About Embedding model",
    exact: true,
  });
  const vocabularyHelp = page.getByRole("button", {
    name: "About Clue vocabulary",
    exact: true,
  });
  const modelPopover = page.locator(`#${await modelHelp.getAttribute("aria-controls")}`);
  const vocabularyPopover = page.locator(
    `#${await vocabularyHelp.getAttribute("aria-controls")}`,
  );
  await expect(modelPopover.locator("thead")).toContainText("Open multi");
  await expect(modelPopover.locator("thead")).toContainText("Game multi");
  await expect(modelPopover.locator("tbody tr").nth(0)).toContainText("87.50%");
  await expect(modelPopover.locator("tbody tr").nth(0)).toContainText("50.36%");
  await expect(modelPopover.locator("tbody tr").nth(1)).toContainText("71.25%");
  await expect(modelPopover.locator("tbody tr").nth(1)).toContainText("31.65%");
  await expect(modelPopover.locator("tbody tr").nth(2)).toContainText("93.75%");
  await expect(modelPopover.locator("tbody tr").nth(2)).toContainText("54.58%");
  await expect(vocabularyPopover.locator("thead")).toContainText("Open multi");
  await expect(vocabularyPopover.locator("tbody tr").nth(0)).toContainText(
    "48.75%",
  );
  await expect(vocabularyPopover.locator("tbody tr").nth(1)).toContainText(
    "71.25%",
  );
  await expect(vocabularyPopover.locator("tbody tr").nth(2)).toContainText(
    "81.25%",
  );
  await expect(vocabularyPopover.locator("tbody tr").nth(3)).toContainText(
    "88.75%",
  );
  const multiHelp = page.getByRole("button", {
    name: "About Prefer multi-card clues",
    exact: true,
  });
  await multiHelp.click();
  const multiPopover = page.locator(
    `#${await multiHelp.getAttribute("aria-controls")}`,
  );
  await expect(multiPopover.locator("thead")).toContainText("Pick 2+ if");
  await expect(multiPopover.locator("tbody tr").nth(1)).toContainText(
    "Within 5 points",
  );
  await expect(multiPopover.locator("tbody tr").nth(1)).toContainText("50.4%");
  await multiHelp.click();

  await modelHelp.hover();
  await expect(modelPopover).toBeVisible();
  await vocabularyHelp.hover();
  await expect(modelPopover).toBeHidden();
  await expect(vocabularyPopover).toBeVisible();
  await page.locator(".play-setup-heading").hover();
  await expect(vocabularyPopover).toBeHidden();

  await modelHelp.click();
  await expect(modelPopover).toBeVisible();
  await vocabularyHelp.hover();
  await expect(modelHelp).toHaveAttribute("aria-expanded", "false");
  await expect(modelPopover).toBeHidden();
  await expect(vocabularyPopover).toBeVisible();
});

test("Play uses one fresh-game icon and accessible label at every viewport", async ({
  page,
}) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);

    const setupAction = page.getByRole("button", {
      name: "Start new game",
      exact: true,
    });
    await expect(setupAction).toBeVisible();
    await expect(setupAction.locator("svg.lucide-refresh-cw")).toHaveCount(1);
    await setupAction.click();

    const gameAction = page.getByRole("button", {
      name: "Start new game",
      exact: true,
    });
    await expect(gameAction).toBeVisible();
    await expect(gameAction.locator("svg.lucide-refresh-cw")).toHaveCount(1);
    await expect(page.locator("#leave-play-game svg.lucide-plus")).toHaveCount(0);

    const iconFits = await gameAction.evaluate((button) => {
      const iconBounds = button.querySelector("svg").getBoundingClientRect();
      const buttonBounds = button.getBoundingClientRect();
      return (
        iconBounds.left >= buttonBounds.left &&
        iconBounds.right <= buttonBounds.right &&
        iconBounds.top >= buttonBounds.top &&
        iconBounds.bottom <= buttonBounds.bottom
      );
    });
    expect(iconFits, `new game icon fits at ${viewport.width}px`).toBe(true);

    await gameAction.click();
  }
});

test("Play enforces operative and spymaster information views", async ({ page }) => {
  const externalRequests = await useTestPlayAnalysis(page);
  await page.goto("/?mode=play");

  await expect(page.locator('[data-play-seat="blue:spymaster"] strong')).toHaveText(
    "🕵️ Spymaster",
  );
  await expect(page.locator('[data-play-seat="blue:operative"] strong')).toHaveText(
    "🔎 Operative",
  );

  await page.locator('[data-play-seat="blue:operative"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await expect(page.locator("#play-human-seat .play-seat-context")).toHaveText(
    "Your view",
  );
  await expect(page.locator("#play-human-seat .play-seat-identity")).toHaveText(
    "🔵 Blue 🔎 Operative",
  );
  await expect(page.locator(".play-card")).toHaveCount(25);
  await expect(page.locator('.play-card[data-team="hidden"]')).toHaveCount(25);
  await expect(page.locator("#play-post-game-analysis")).toBeHidden();
  await expect(page.locator(".play-card[data-operative-score]")).toHaveCount(0);
  await expect(page.locator("#play-clue-form")).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Clue", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await expect(page.locator("#play-clue-form")).toBeVisible();
  await expect(page.locator("#undo-play-action svg.lucide-undo-2")).toHaveCount(1);
  await expect(page.locator("#forward-play-action svg.lucide-redo-2")).toHaveCount(1);
  await expect(page.locator("#share-play-game svg.lucide-share-2")).toHaveCount(1);
  await expect(page.locator("#leave-play-game svg.lucide-refresh-cw")).toHaveCount(1);
  const clueInput = page.getByRole("textbox", { name: "Clue", exact: true });
  const clearClue = page.getByRole("button", { name: "Clear clue", exact: true });
  await expect(clearClue).toBeHidden();
  await clueInput.fill("garden");
  await expect(clearClue).toBeVisible();
  await clearClue.click();
  await expect(clueInput).toHaveValue("");
  await expect(clearClue).toBeHidden();
  await expect(page.locator("#play-suggestions")).toBeHidden();
  const hintsButton = page.getByRole("button", {
    name: "Show clue suggestions",
    exact: true,
  });
  await expect(hintsButton).toBeVisible();
  await expect(hintsButton).toHaveText("💡 Hints");
  await expect(hintsButton).toHaveAttribute("aria-expanded", "false");
  await hintsButton.click();
  await expect(page.locator("#play-suggestions")).toBeVisible();
  await expect(page.getByText("Optional assistant", { exact: true })).toHaveCount(0);
  const firstPlaySuggestion = page.locator(".play-suggestion").first();
  await expect(firstPlaySuggestion).toBeVisible({ timeout: 15_000 });
  await expect(
    firstPlaySuggestion.locator('.play-suggestion-metric[data-tone]'),
  ).toContainText(/Worth \d+/);
  await expect(
    firstPlaySuggestion.locator('.play-suggestion-metric[data-risk]'),
  ).toContainText(/(Safe|Medium|Risky) \d+/);
  await expect(
    page.getByRole("button", { name: "Hide clue suggestions", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator('.play-card[data-team="neutral"]')).toHaveCount(7);
  await expect(page.locator('.play-card[data-team="assassin"]')).toHaveCount(1);
  expect(externalRequests).toEqual([]);
});

test("Play keeps brief bot turns neutral and delays readable wait detail", async ({
  page,
}) => {
  await useTestBotAction(page, 700);
  await page.goto("/?mode=play");
  await page.evaluate(() => {
    window.__visibleBotWaitDetails = [];
    window.__botWaitObserver = new MutationObserver(() => {
      const note = document.querySelector(".play-turn-note");
      if (
        note?.dataset.waitDetail === "visible" &&
        !window.__visibleBotWaitDetails.includes(note.textContent)
      ) {
        window.__visibleBotWaitDetails.push(note.textContent);
      }
    });
    window.__botWaitObserver.observe(document.querySelector("#play-clue-display"), {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });

  await page.locator('[data-play-seat="blue:operative"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const waitNote = page.locator(".play-turn-note");
  await expect(waitNote).toHaveAttribute("data-wait-detail", "pending");
  await expect(waitNote.locator(".play-turn-spinner")).toBeVisible();
  await expect(waitNote.locator(".play-turn-wait-detail")).toBeHidden();

  await expect(page.locator("#play-clue-display")).toContainText("Game complete", {
    timeout: 2_000,
  });
  expect(
    await page.evaluate(() => {
      window.__botWaitObserver.disconnect();
      return window.__visibleBotWaitDetails;
    }),
  ).toEqual([]);
});

test("Play reveals long bot wait detail without shifting or leaking stale timers", async ({
  page,
}) => {
  await useTestBotAction(page, 3200);
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:operative"]').click();

  const startedAt = Date.now();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  const waitNote = page.locator(".play-turn-note");
  const clueDisplay = page.locator("#play-clue-display");
  await expect(waitNote).toHaveAttribute("data-wait-detail", "pending");
  const pendingHeight = await clueDisplay.evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  await page.waitForTimeout(1000);
  await expect(waitNote).toHaveAttribute("data-wait-detail", "pending");
  await expect(waitNote.locator(".play-turn-wait-detail")).toBeHidden();

  await expect(waitNote).toHaveAttribute("data-wait-detail", "visible", {
    timeout: 2_000,
  });
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1700);
  await expect(waitNote).toContainText("The bot is studying the board.");
  await expect(waitNote.locator(".play-turn-spinner")).toBeHidden();
  expect(
    await clueDisplay.evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(pendingHeight);

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(page.locator("#play-setup")).toBeVisible();

  await page.locator('[data-play-seat="blue:operative"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(waitNote).toHaveAttribute("data-wait-detail", "pending");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator("#play-setup")).toBeVisible();
  await expect(waitNote).toHaveAttribute("data-wait-detail", "pending");
});

test("Play keeps game creation actions prominent across responsive states", async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844, setupActionBelow: true },
    { width: 430, height: 998, setupActionBelow: true },
    { width: 625, height: 998, setupActionBelow: false },
    { width: 768, height: 1024, setupActionBelow: false },
    { width: 846, height: 998, setupActionBelow: false },
    { width: 1440, height: 900, setupActionBelow: false },
    { width: 1920, height: 1080, setupActionBelow: false },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?mode=play");
    await page.evaluate(() => localStorage.removeItem("codenames-play-session-v1"));
    await page.reload();

    const setupActions = page.locator(".play-setup-heading .play-primary-actions");
    const randomize = page.getByRole("button", {
      name: "Pick a different random role",
      exact: true,
    });
    const startGame = page.getByRole("button", {
      name: "Start new game",
      exact: true,
    });
    await expect(setupActions).toBeVisible();
    await expect(page.locator(".play-setup-title #randomize-play-seat")).toHaveCount(1);
    await expect(page.locator("#randomize-play-seat svg.lucide-dices")).toHaveCount(1);
    await expect(setupActions.locator("#start-play-game")).toHaveCount(1);
    await expect(startGame).toHaveClass(/primary/);

    const setupLayout = await page.evaluate(() => {
      const randomizeBounds = document
        .querySelector("#randomize-play-seat")
        .getBoundingClientRect();
      const newGameBounds = document
        .querySelector("#start-play-game")
        .getBoundingClientRect();
      const setupHeadingBounds = document
        .querySelector(".play-setup-heading")
        .getBoundingClientRect();
      const setupTitleBounds = document
        .querySelector(".play-setup-title")
        .getBoundingClientRect();
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        newGameIsLarger:
          newGameBounds.width > randomizeBounds.width &&
          newGameBounds.height > randomizeBounds.height,
        randomizeIsBesideTitle:
          randomizeBounds.left >=
            document.querySelector("#play-title").getBoundingClientRect().right &&
          randomizeBounds.top <
            document.querySelector("#play-title").getBoundingClientRect().bottom,
        newGameAtRightEdge:
          Math.abs(setupHeadingBounds.right - newGameBounds.right) <= 1,
        newGameIsBelowTitle: newGameBounds.top >= setupTitleBounds.bottom,
        newGameIsBesideTitle:
          newGameBounds.left >= setupTitleBounds.right &&
          newGameBounds.top < setupTitleBounds.bottom,
      };
    });
    expect(setupLayout.pageOverflows, `setup overflow at ${viewport.width}px`).toBe(false);
    expect(
      setupLayout.newGameIsLarger,
      `new game prominence at ${viewport.width}px`,
    ).toBe(true);
    expect(
      setupLayout.randomizeIsBesideTitle,
      `randomize placement at ${viewport.width}px`,
    ).toBe(true);
    expect(
      setupLayout.newGameIsBelowTitle,
      `new game placement at ${viewport.width}px`,
    ).toBe(viewport.setupActionBelow);
    expect(
      setupLayout.newGameAtRightEdge,
      `new game right alignment at ${viewport.width}px`,
    ).toBe(true);
    expect(
      setupLayout.newGameIsBesideTitle,
      `new game inline placement at ${viewport.width}px`,
    ).toBe(!viewport.setupActionBelow);

    await startGame.click();
    const gameActions = page.locator(".play-game-header .play-game-actions");
    const newGame = page.getByRole("button", {
      name: "Start new game",
      exact: true,
    });
    await expect(gameActions).toBeVisible();
    await expect(gameActions.locator(".icon-button")).toHaveCount(3);
    await expect(gameActions.locator("#leave-play-game")).toHaveCount(1);
    await expect(newGame).toContainText("Start new game");
    await expect(newGame).toHaveClass(/primary/);
    await expect(newGame.locator("svg.lucide-refresh-cw")).toHaveCount(1);

    const activeLayout = await page.evaluate(() => {
      const header = document.querySelector(".play-game-header");
      const actions = document.querySelector(".play-game-actions");
      const newGameButton = document.querySelector("#leave-play-game");
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        headerOverflows: header.scrollWidth > header.clientWidth,
        actionsFit:
          actions.getBoundingClientRect().right <= header.getBoundingClientRect().right + 1,
        newGameIsLarger:
          newGameButton.getBoundingClientRect().width >
          actions.querySelector(".icon-button").getBoundingClientRect().width,
      };
    });
    expect(activeLayout.pageOverflows, `active overflow at ${viewport.width}px`).toBe(false);
    expect(activeLayout.headerOverflows, `active header overflow at ${viewport.width}px`).toBe(
      false,
    );
    expect(activeLayout.actionsFit, `active actions fit at ${viewport.width}px`).toBe(true);
    expect(
      activeLayout.newGameIsLarger,
      `active new game prominence at ${viewport.width}px`,
    ).toBe(true);

    await newGame.click();
    await expect(page.locator("#play-setup")).toBeVisible();
    await expect(page.locator("#play-game")).toBeHidden();
    await expect(page.locator("#play-setup #start-play-game")).toBeVisible();
    const savedActions = page.locator("#saved-play-actions");
    await expect(savedActions).toBeVisible();
    await expect(savedActions).toContainText("Saved game available");
    await expect(
      savedActions.getByRole("button", { name: "Resume game", exact: true }),
    ).toHaveClass(/primary/);
    await expect(
      savedActions.getByRole("button", { name: "Discard saved", exact: true }),
    ).toHaveClass(/ghost/);
    await expect(startGame).toHaveClass(/secondary/);
    expect(
      await savedActions.evaluate((actions) =>
        actions.previousElementSibling?.classList.contains("play-setup-heading"),
      ),
    ).toBe(true);
    await randomize.click();
  }
});

test("Play validates human clues and resumes the saved seat", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await page.getByRole("textbox", { name: "Clue", exact: true }).fill("two words");
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(page.locator("#play-clue-error")).toHaveText("A clue must be one word.");

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume game", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await expect(page.locator("#play-human-seat .play-seat-context")).toHaveText(
    "Your view",
  );
  await expect(page.locator("#play-human-seat .play-seat-identity")).toHaveText(
    "🔵 Blue 🕵️ Spymaster",
  );
  await expect(page.getByRole("textbox", { name: "Clue", exact: true })).toBeVisible();
});

test("Play identifies a saved game in another language before resuming it", async ({
  page,
}) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator('[data-language-value="it"]').click();

  const savedActions = page.locator("#saved-play-actions");
  await expect(savedActions).toContainText(
    "Partita salvata in inglese disponibile",
  );
  await expect(savedActions).toContainText(
    "Riprendi per passare all'inglese",
  );
  await expect(
    savedActions.getByRole("button", {
      name: "Riprendi partita in inglese",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Nuova partita in italiano",
      exact: true,
    }),
  ).toBeVisible();

  await savedActions
    .getByRole("button", {
      name: "Riprendi partita in inglese",
      exact: true,
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#play-board-grid .play-card")).toHaveCount(25);
});

test("Play starts a new game in the selected language despite another saved game", async ({
  page,
}) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator('[data-language-value="it"]').click();

  await page
    .getByRole("button", {
      name: "Nuova partita in italiano",
      exact: true,
    })
    .click();

  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-session-v1")),
  );
  expect(saved.language).toBe("it");
  expect(saved.wordSet).toBe("extended");
  expect(saved.botSettings.modelId).toBe("multilingual-e5-small");
});

test("starting a second Play game clears the previous clue and analysis", async ({
  page,
}) => {
  const externalRequests = await useTestPlayAnalysis(page);
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.locator(".play-settings summary").click();
  await page.locator("#play-bot-model").selectOption("minilm-l3");
  await page.locator("#play-bot-candidates").selectOption("3000");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await page.getByRole("button", {
    name: "Show clue suggestions",
    exact: true,
  }).click();
  await expect(page.locator(".play-suggestion").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("textbox", { name: "Clue", exact: true }).fill("hibernation");
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(page.locator("#play-history-list")).toContainText(
    "Clue: HIBERNATION 2",
  );
  await expect(page.locator("#play-history-list")).toContainText("Guessed", {
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "Clue", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Clear clue", exact: true })).toBeHidden();
  await expect(page.locator("#play-clue-error")).toBeEmpty();
  await expect(page.locator("#play-clue-display")).not.toContainText("HIBERNATION 2");
  await expect(page.locator("#play-history-count")).toHaveText("0 events");
  await expect(page.locator("#play-history-list")).toHaveText("No game actions yet.");
  await expect(page.locator("#play-suggestion-list")).toBeEmpty();
  expect(externalRequests).toEqual([]);
});

test("Play rejects a clue inflection of an unrevealed board word", async ({ page }) => {
  const teams = [
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  const savedGame = {
    schemaVersion: 1,
    seed: "clue-inflection-ui",
    wordSet: "official",
    humanSeat: { side: "blue", role: "spymaster" },
    cards: teams.map((team, layoutId) => ({
      word: layoutId === 0 ? "LIFE" : `WORD${layoutId}`,
      team,
      layoutId,
      done: false,
      revealedBy: null,
      revealedTurn: null,
    })),
    activeSide: "blue",
    phase: "awaiting-clue",
    turnNumber: 1,
    currentTurn: null,
    winner: null,
    endReason: null,
    history: [
      {
        type: "game-started",
        humanSeat: { side: "blue", role: "spymaster" },
        activeSide: "blue",
      },
    ],
  };
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, savedGame);
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  await page.getByRole("textbox", { name: "Clue", exact: true }).fill("lives");
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(page.locator("#play-clue-error")).toHaveText(
    "A clue cannot match the stem or inflection of an unrevealed board word.",
  );
  await expect(page.locator(".play-card", { hasText: "LIFE" })).not.toHaveClass(/is-done/);
});

test("Play moves through history and groups fully automated turns", async ({ page }) => {
  const teams = [
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  const blueGuess = {
    layoutId: 0,
    word: "WORD0",
    team: "friendly",
    actor: "bot",
  };
  const redGuess = {
    layoutId: 9,
    word: "WORD9",
    team: "enemy",
    actor: "bot",
  };
  const savedGame = {
    schemaVersion: 1,
    seed: "multi-undo-ui",
    wordSet: "official",
    humanSeat: { side: "blue", role: "spymaster" },
    cards: teams.map((team, layoutId) => ({
      word: `WORD${layoutId}`,
      team,
      layoutId,
      done: layoutId === 0 || layoutId === 9,
      revealedBy: layoutId === 0 ? "blue" : layoutId === 9 ? "red" : null,
      revealedTurn: layoutId === 0 ? 1 : layoutId === 9 ? 2 : null,
    })),
    activeSide: "blue",
    phase: "awaiting-guess",
    turnNumber: 3,
    currentTurn: {
      side: "blue",
      clue: "THIRD",
      number: 1,
      actor: "human",
      intendedLayoutIds: [1],
      guesses: [],
    },
    winner: null,
    endReason: null,
    history: [
      {
        type: "game-started",
        humanSeat: { side: "blue", role: "spymaster" },
        activeSide: "blue",
      },
      {
        type: "clue-given",
        turn: 1,
        side: "blue",
        actor: "human",
        clue: "FIRST",
        number: 1,
        intendedLayoutIds: [0],
      },
      { type: "card-guessed", turn: 1, side: "blue", ...blueGuess },
      { type: "turn-passed", turn: 1, side: "blue", actor: "bot" },
      {
        type: "turn-ended",
        turn: 1,
        side: "blue",
        reason: "pass",
        clue: "FIRST",
        number: 1,
        guesses: [blueGuess],
      },
      {
        type: "clue-given",
        turn: 2,
        side: "red",
        actor: "bot",
        clue: "SECOND",
        number: 1,
        intendedLayoutIds: [9],
      },
      { type: "card-guessed", turn: 2, side: "red", ...redGuess },
      { type: "turn-passed", turn: 2, side: "red", actor: "bot" },
      {
        type: "turn-ended",
        turn: 2,
        side: "red",
        reason: "pass",
        clue: "SECOND",
        number: 1,
        guesses: [redGuess],
      },
      {
        type: "clue-given",
        turn: 3,
        side: "blue",
        actor: "human",
        clue: "THIRD",
        number: 1,
        intendedLayoutIds: [1],
      },
    ],
  };
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, savedGame);
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const forward = page.getByRole("button", { name: "Forward", exact: true });
  const turn = page.locator("#play-clue-display");
  const blueScore = page.locator('.play-score-team[data-side="blue"] strong');
  const redScore = page.locator('.play-score-team[data-side="red"] strong');

  await expect(turn.locator(".play-clue-pill")).toHaveText("THIRD");
  await expect(turn.locator(".play-history-clue-number")).toHaveText("1");
  await expect(turn.locator(".play-clue-pill")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("7");
  await expect(undo).toBeEnabled();
  await expect(forward).toBeDisabled();

  await undo.click();
  await expect(turn).toContainText("Blue turn");
  await expect(turn).toContainText("Give a clue");
  await expect(forward).toBeEnabled();

  await undo.click();
  await expect(turn).toContainText("Red turn");
  await expect(turn).toHaveAttribute("data-side", "red");
  await expect(page.locator('.play-card[data-layout-id="9"]')).not.toHaveClass(/is-done/);
  await expect(redScore).toHaveText("8");
  await page.waitForTimeout(1500);
  await expect(turn).toHaveAttribute("data-side", "red");

  await forward.click();
  await expect(turn).toContainText("Blue turn");
  await expect(turn).toContainText("Give a clue");
  await expect(page.locator('.play-card[data-layout-id="9"]')).toHaveClass(/is-done/);
  await expect(redScore).toHaveText("7");

  await forward.click();
  await expect(turn.locator(".play-clue-pill")).toHaveText("THIRD");
  await expect(turn.locator(".play-history-clue-number")).toHaveText("1");
  await expect(forward).toBeDisabled();

  await undo.click();
  await undo.click();
  await expect(turn).toContainText("Red turn");
  await expect(turn).toHaveAttribute("data-side", "red");

  await undo.click();
  await expect(turn.locator(".play-clue-pill")).toHaveText("FIRST");
  await expect(turn.locator(".play-history-clue-number")).toHaveText("1");
  await expect(page.locator('.play-card[data-layout-id="0"]')).toHaveClass(/is-done/);

  await undo.click();
  await expect(turn.locator(".play-clue-pill")).toHaveText("FIRST");
  await expect(turn.locator(".play-history-clue-number")).toHaveText("1");
  await expect(page.locator('.play-card[data-layout-id="0"]')).not.toHaveClass(/is-done/);
  await expect(blueScore).toHaveText("9");

  await undo.click();
  await expect(turn).toContainText("Blue turn");
  await expect(turn).toContainText("Give a clue");
  await expect(undo).toBeDisabled();
  await expect(forward).toBeEnabled();

  await page.getByRole("textbox", { name: "Clue", exact: true }).fill("BRANCH");
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(forward).toBeDisabled();
});

test("Play keeps public remaining scores after operative session restoration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__codenamesPlayModeOptions = {
      ...window.__codenamesPlayModeOptions,
      botActionDelay: 60_000,
    };
  });
  const blueGuess = {
    layoutId: 0,
    word: "WORD0",
    team: "friendly",
    actor: "human",
  };
  const redGuess = {
    layoutId: 9,
    word: "WORD9",
    team: "enemy",
    actor: "bot",
  };
  const session = playSessionWithHistory([
    {
      type: "clue-given",
      turn: 1,
      side: "blue",
      actor: "bot",
      clue: "FIRST",
      number: 1,
      intendedLayoutIds: [0],
    },
    { type: "card-guessed", turn: 1, side: "blue", ...blueGuess },
    { type: "turn-passed", turn: 1, side: "blue", actor: "human" },
    {
      type: "turn-ended",
      turn: 1,
      side: "blue",
      reason: "pass",
      clue: "FIRST",
      number: 1,
      guesses: [blueGuess],
    },
    {
      type: "clue-given",
      turn: 2,
      side: "red",
      actor: "bot",
      clue: "SECOND",
      number: 1,
      intendedLayoutIds: [9],
    },
    { type: "card-guessed", turn: 2, side: "red", ...redGuess },
    { type: "turn-passed", turn: 2, side: "red", actor: "bot" },
    {
      type: "turn-ended",
      turn: 2,
      side: "red",
      reason: "pass",
      clue: "SECOND",
      number: 1,
      guesses: [redGuess],
    },
    {
      type: "clue-given",
      turn: 3,
      side: "blue",
      actor: "bot",
      clue: "THIRD",
      number: 1,
      intendedLayoutIds: [1],
    },
  ]);
  session.humanSeat = { side: "blue", role: "operative" };
  session.history[0].humanSeat = { ...session.humanSeat };
  session.cards[0] = {
    ...session.cards[0],
    done: true,
    revealedBy: "blue",
    revealedTurn: 1,
  };
  session.cards[9] = {
    ...session.cards[9],
    done: true,
    revealedBy: "red",
    revealedTurn: 2,
  };
  session.activeSide = "blue";
  session.phase = "awaiting-guess";
  session.turnNumber = 3;
  session.currentTurn = {
    side: "blue",
    clue: "THIRD",
    number: 1,
    actor: "bot",
    intendedLayoutIds: [1],
    guesses: [],
  };

  await page.addInitScript((savedSession) => {
    localStorage.setItem(
      "codenames-play-session-v1",
      JSON.stringify(savedSession),
    );
  }, session);
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  const blueScore = page.locator('.play-score-team[data-side="blue"] strong');
  const redScore = page.locator('.play-score-team[data-side="red"] strong');
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const forward = page.getByRole("button", { name: "Forward", exact: true });

  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("7");

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const score = document.querySelector("#play-score");
      const scoreBounds = score.getBoundingClientRect();
      return {
        pageOverflows:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        scoreFits:
          scoreBounds.left >= 0 &&
          scoreBounds.right <= document.documentElement.clientWidth,
      };
    });
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(
      false,
    );
    expect(layout.scoreFits, `score clipping at ${viewport.width}px`).toBe(true);
    await expect(blueScore).toHaveText("8");
    await expect(redScore).toHaveText("7");
  }

  await undo.click();
  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("7");

  await undo.click();
  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("8");

  await forward.click();
  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("7");

  await forward.click();
  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("7");

  await page.reload();
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await expect(blueScore).toHaveText("8");
  await expect(redScore).toHaveText("7");
});

test("Play keeps player perspective separate from the current turn", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  const perspective = page.locator("#play-human-seat");
  const turn = page.locator("#play-clue-display");

  await expect(perspective.locator(".play-seat-context")).toHaveText("Your view");
  await expect(perspective.locator(".play-seat-identity")).toHaveText(
    "🔵 Blue 🕵️ Spymaster",
  );
  await expect(turn.locator(".play-turn-team")).toHaveText("Blue turn");
  await expect(turn.locator("strong")).toHaveText("Give a clue");
  await expect(turn).not.toContainText("Blue Spymaster");
  await expect(turn).not.toContainText("Spymaster");
  await expect(turn).not.toContainText("🕵️");
});

test("Play color-codes turns and lets spymasters switch board order", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  const turn = page.locator("#play-clue-display");
  await expect(turn).toHaveAttribute("data-side", "blue");
  await expect(turn.locator(".play-turn-team")).toHaveText("Blue turn");
  await expect(turn.locator("strong")).toHaveText("Give a clue");

  const cards = page.locator(".play-card");
  const tableLayout = await cards.evaluateAll((items) =>
    items.map((item) => item.dataset.layoutId),
  );
  await expect(page.locator("#play-board-toolbar")).toBeVisible();
  await page.getByRole("button", { name: "🗂️ Teams", exact: true }).click();
  await expect(page.getByRole("button", { name: "🗂️ Teams", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await cards.evaluateAll((items) => items.map((item) => item.dataset.team)),
  ).toEqual([
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ]);

  await page.getByRole("button", { name: "🎲 Table", exact: true }).click();
  expect(await cards.evaluateAll((items) => items.map((item) => item.dataset.layoutId))).toEqual(
    tableLayout,
  );
});

test("Play uses the Red turn treatment for an active Red spymaster", async ({ page }) => {
  const teams = [
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  const savedGame = {
    schemaVersion: 1,
    seed: "red-turn-ui",
    wordSet: "official",
    humanSeat: { side: "red", role: "spymaster" },
    cards: teams.map((team, layoutId) => ({
      word: `WORD${layoutId}`,
      team,
      layoutId,
      done: false,
      revealedBy: null,
      revealedTurn: null,
    })),
    activeSide: "red",
    phase: "awaiting-clue",
    turnNumber: 2,
    currentTurn: null,
    winner: null,
    endReason: null,
    history: [
      {
        type: "game-started",
        humanSeat: { side: "red", role: "spymaster" },
        activeSide: "blue",
      },
    ],
  };
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, savedGame);
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  await expect(page.locator("#play-human-seat")).toHaveAttribute("data-side", "red");
  await expect(page.locator("#play-human-seat .play-seat-identity")).toHaveText(
    "🔴 Red 🕵️ Spymaster",
  );
  await expect(page.locator("#play-clue-display")).toHaveAttribute("data-side", "red");
  await expect(page.locator("#play-clue-display .play-turn-team")).toHaveText(
    "Red turn",
  );
  await expect(page.locator("#play-clue-display strong")).toHaveText("Give a clue");
  await expect(page.locator("#play-suggestions")).toBeHidden();
});

test("Play game log shows clear empty states in both views", async ({ page }) => {
  await resumePlaySession(page, []);

  await expect(page.locator("#play-history-count")).toHaveText("0 events");
  await expect(page.locator("#play-history-list")).toHaveText("No game actions yet.");

  const teamsView = page.getByRole("button", { name: "↔️ By team", exact: true });
  await teamsView.click();

  await expect(teamsView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#play-history-list")).toBeHidden();
  await expect(page.locator("#play-history-blue-list")).toHaveText("No Blue actions yet.");
  await expect(page.locator("#play-history-red-list")).toHaveText("No Red actions yet.");
});

test("Play game log color-codes each guessed card as a word pill", async ({ page }) => {
  const teams = ["friendly", "enemy", "neutral", "assassin"];
  await resumePlaySession(
    page,
    teams.map((team, layoutId) => ({
      type: "card-guessed",
      turn: 1,
      side: "blue",
      layoutId,
      word: `WORD${layoutId}`,
      team,
      actor: "bot",
    })),
  );

  const pills = page.locator("#play-history-list .play-history-card");
  await expect(pills).toHaveCount(4);
  expect(await pills.evaluateAll((items) => items.map((item) => item.dataset.team))).toEqual(
    teams,
  );
  await expect(pills.nth(0)).toHaveAttribute("aria-label", "WORD0, Blue card");
  await expect(pills.nth(1)).toHaveAttribute("aria-label", "WORD1, Red card");
  await expect(pills.nth(2)).toHaveAttribute("aria-label", "WORD2, Neutral card");
  await expect(pills.nth(3)).toHaveAttribute("aria-label", "WORD3, Assassin card");
  expect(
    await page
      .locator("#play-history-list .play-history-action")
      .allTextContents(),
  ).toEqual([
    "Guessed WORD0",
    "Guessed WORD1",
    "Guessed WORD2",
    "Guessed WORD3",
  ]);
});

test("Play game log groups actions by turn and switches between views", async ({
  page,
}) => {
  await resumePlaySession(page, [
    {
      type: "clue-given",
      turn: 1,
      side: "blue",
      actor: "human",
      clue: "OCEAN",
      number: 2,
      intendedLayoutIds: [0, 1],
    },
    {
      type: "card-guessed",
      turn: 1,
      side: "blue",
      layoutId: 0,
      word: "WORD0",
      team: "friendly",
      actor: "bot",
    },
    {
      type: "clue-given",
      turn: 2,
      side: "red",
      actor: "bot",
      clue: "FIRE",
      number: 1,
      intendedLayoutIds: [],
    },
    {
      type: "turn-passed",
      turn: 2,
      side: "red",
      actor: "bot",
    },
  ]);

  const timelineView = page.getByRole("button", { name: "🕒 Timeline", exact: true });
  const teamsView = page.getByRole("button", { name: "↔️ By team", exact: true });
  const timeline = page.locator("#play-history-list");

  await expect(timelineView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#play-history-count")).toHaveText("4 events");
  await expect(timeline.locator(".play-history-turn")).toHaveCount(2);
  await expect(timeline.locator(".play-history-action")).toHaveCount(4);
  await expect(timeline.locator(".explain-recommendation-button")).toHaveCount(0);
  expect(
    await timeline.locator(".play-history-turn-header").allTextContents(),
  ).toEqual(["🔵 Blue · Turn 1", "🔴 Red · Turn 2"]);
  expect(
    await timeline.locator(".play-history-action").allTextContents(),
  ).toEqual([
    "Clue: OCEAN 2",
    "Guessed WORD0",
    "Clue: FIRE 1",
    "Passed",
  ]);
  const firstTurn = timeline.locator('.play-history-turn[data-turn="1"]');
  await expect(firstTurn.locator(".play-history-action")).toHaveCount(2);
  const firstTurnHierarchy = await firstTurn.evaluate((turn) => {
    const clue = turn.querySelector('[data-action="clue-given"]');
    const guess = turn.querySelector('[data-action="card-guessed"]');
    const clueBounds = clue.getBoundingClientRect();
    const guessBounds = guess.getBoundingClientRect();
    return {
      teamMentions: (turn.innerText.match(/blue/gi) ?? []).length,
      guessIndented: guessBounds.left > clueBounds.left,
      turnBorder: getComputedStyle(turn).borderTopWidth,
    };
  });
  expect(firstTurnHierarchy.teamMentions).toBe(1);
  expect(firstTurnHierarchy.guessIndented).toBe(true);
  expect(firstTurnHierarchy.turnBorder).toBe("1px");
  const timelineClues = timeline.locator(".play-clue-pill");
  await expect(timelineClues).toHaveCount(2);
  expect(await timelineClues.allTextContents()).toEqual(["OCEAN", "FIRE"]);
  await expect(timelineClues.nth(0)).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );

  await teamsView.click();

  await expect(teamsView).toHaveAttribute("aria-pressed", "true");
  await expect(timeline).toBeHidden();
  await expect(
    page.locator("#play-history-blue-list .play-history-turn-header"),
  ).toHaveText("Turn 1");
  expect(
    await page
      .locator("#play-history-blue-list .play-history-action")
      .allTextContents(),
  ).toEqual(["Clue: OCEAN 2", "Guessed WORD0"]);
  await expect(
    page.locator("#play-history-blue-list .play-clue-pill"),
  ).toHaveText("OCEAN");
  await expect(
    page.locator("#play-history-blue-list .play-history-card"),
  ).toHaveAttribute("data-team", "friendly");
  await expect(
    page.locator("#play-history-red-list .play-history-turn-header"),
  ).toHaveText("Turn 2");
  expect(
    await page
      .locator("#play-history-red-list .play-history-action")
      .allTextContents(),
  ).toEqual(["Clue: FIRE 1", "Passed"]);

  await timelineView.click();
  await expect(timelineView).toHaveAttribute("aria-pressed", "true");
  await expect(timeline).toBeVisible();
});

test("long Play logs remain complete and responsive in both views", async ({ page }) => {
  const history = Array.from({ length: 6 }, (_, index) => {
    const turn = index + 1;
    return [
      {
        type: "clue-given",
        turn,
        side: "blue",
        actor: "human",
        clue: `BLUE${turn}`,
        number: 1,
        intendedLayoutIds: [],
      },
      {
        type: "card-guessed",
        turn,
        side: "blue",
        layoutId: index,
        word: `BLUEWORD${turn}`,
        team: "friendly",
        actor: "bot",
      },
      {
        type: "clue-given",
        turn,
        side: "red",
        actor: "bot",
        clue: `RED${turn}`,
        number: 1,
        intendedLayoutIds: [],
      },
      {
        type: "turn-passed",
        turn,
        side: "red",
        actor: "bot",
      },
    ];
  }).flat();
  await resumePlaySession(page, history);

  await expect(page.locator("#play-history-count")).toHaveText("24 events");
  await expect(page.locator("#play-history-list .play-history-turn")).toHaveCount(12);
  await expect(page.locator("#play-history-list .play-history-action")).toHaveCount(24);
  expect(
    await page.locator("#play-history-list").evaluate(
      (list) => list.scrollHeight > list.clientHeight,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "↔️ By team", exact: true }).click();
  await expect(
    page.locator("#play-history-blue-list .play-history-turn"),
  ).toHaveCount(6);
  await expect(
    page.locator("#play-history-red-list .play-history-turn"),
  ).toHaveCount(6);
  await expect(
    page.locator("#play-history-blue-list .play-history-action"),
  ).toHaveCount(12);
  await expect(
    page.locator("#play-history-red-list .play-history-action"),
  ).toHaveCount(12);

  for (const viewport of [
    { width: 390, height: 844, columns: 1 },
    { width: 768, height: 1024, columns: 2 },
    { width: 1440, height: 900, columns: 2 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const historyPanel = document.querySelector(".play-history");
      const teamLists = document.querySelector("#play-history-team-lists");
      const teamSections = [...document.querySelectorAll(".play-history-team")];
      const panelBounds = historyPanel.getBoundingClientRect();
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        columns: getComputedStyle(teamLists).gridTemplateColumns.split(" ").length,
        teamsFit: teamSections.every((section) => {
          const bounds = section.getBoundingClientRect();
          return bounds.left >= panelBounds.left - 1 && bounds.right <= panelBounds.right + 1;
        }),
      };
    });

    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(layout.columns, `team columns at ${viewport.width}px`).toBe(viewport.columns);
    expect(layout.teamsFit, `team log clipping at ${viewport.width}px`).toBe(true);
  }
});

test("completed Play sessions replay turns and explain intended targets", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__codenamesPlayModeOptions = {
      ...window.__codenamesPlayModeOptions,
      guessCandidateExecutor({ cards }) {
        return cards.map((card, index) => ({
          layoutId: card.layoutId,
          similarity: 0.9 - index * 0.02,
        }));
      },
    };
  });
  const explanationRequests = [];
  await page.route("**/api/explain-recommendations", async (route) => {
    const request = route.request().postDataJSON();
    explanationRequests.push(request);
    const recommendation = request.recommendations[0];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        explanations: [
          {
            id: recommendation.id,
            explanation:
              recommendation.clue === "FIRST"
                ? "These words connect through sequence: word0 and word1 are the first items in the numbered series."
                : "These words connect through sequence: word9 is the second item in the numbered series.",
          },
        ],
      }),
    });
  });
  const teams = [
    ...Array(9).fill("friendly"),
    ...Array(8).fill("enemy"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  const savedGame = {
    schemaVersion: 1,
    seed: "completed-ui",
    wordSet: "official",
    humanSeat: { side: "blue", role: "operative" },
    cards: teams.map((team, layoutId) => ({
      word: `WORD${layoutId}`,
      team,
      layoutId,
      done: [0, 24].includes(layoutId),
      revealedBy: layoutId === 0 ? "blue" : layoutId === 24 ? "red" : null,
      revealedTurn: layoutId === 0 ? 1 : layoutId === 24 ? 2 : null,
    })),
    activeSide: "red",
    phase: "complete",
    turnNumber: 2,
    currentTurn: {
      side: "red",
      clue: "SECOND",
      number: 1,
      actor: "bot",
      intendedLayoutIds: [9],
      guesses: [
        {
          layoutId: 24,
          word: "WORD24",
          team: "assassin",
          actor: "human",
        },
      ],
    },
    winner: "blue",
    endReason: "assassin",
    history: [
      {
        type: "game-started",
        humanSeat: { side: "blue", role: "operative" },
        activeSide: "blue",
      },
      {
        type: "clue-given",
        turn: 1,
        side: "blue",
        actor: "bot",
        clue: "FIRST",
        number: 2,
        intendedLayoutIds: [0, 1],
      },
      {
        type: "card-guessed",
        turn: 1,
        side: "blue",
        layoutId: 0,
        word: "WORD0",
        team: "friendly",
        actor: "human",
      },
      { type: "turn-passed", turn: 1, side: "blue", actor: "human" },
      {
        type: "turn-ended",
        turn: 1,
        side: "blue",
        reason: "pass",
        clue: "FIRST",
        number: 2,
        guesses: [
          {
            layoutId: 0,
            word: "WORD0",
            team: "friendly",
            actor: "human",
          },
        ],
      },
      {
        type: "clue-given",
        turn: 2,
        side: "red",
        actor: "bot",
        clue: "SECOND",
        number: 1,
        intendedLayoutIds: [9],
      },
      {
        type: "card-guessed",
        turn: 2,
        side: "red",
        layoutId: 24,
        word: "WORD24",
        team: "assassin",
        actor: "human",
      },
      { type: "game-ended", turn: 2, winner: "blue", reason: "assassin" },
    ],
  };
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, savedGame);
  await page.goto("/?mode=play");
  await page
    .getByRole("button", { name: "Review finished game", exact: true })
    .click();

  await expect(page.locator("#play-post-game-outcome")).toContainText("Blue won");
  await expect(page.locator("#play-history-heading-label")).toHaveText(
    "Post-game analysis",
  );
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator("#play-post-game-analysis")).toBeVisible();
  await expect(page.locator("#play-analysis-summary")).toHaveCount(0);
  await expect(page.locator("#play-analysis-status")).toHaveCount(0);
  await expect(page.locator("#play-history-list .play-history-clue")).toHaveCount(2);
  await expect(
    page.locator("#play-history-list .explain-recommendation-button"),
  ).toHaveCount(2);
  const firstClue = page.getByRole("button", {
    name: "Review turn 1: Blue clue FIRST 2",
    exact: true,
  });
  const secondClue = page.getByRole("button", {
    name: "Review turn 2: Red clue SECOND 1",
    exact: true,
  });
  await expect(firstClue).toHaveAttribute("aria-pressed", "true");
  await expect(secondClue).toHaveAttribute("aria-pressed", "false");
  await expect(firstClue).toHaveText("Viewing");
  await expect(secondClue).toHaveText("Review");
  const initialTurnRows = await page
    .locator("#play-history-list")
    .evaluate((list) =>
      [...list.querySelectorAll(":scope > li")].map((item) => ({
        turn: item.getAttribute("data-analysis-turn"),
        selected: item.classList.contains("is-selected"),
        text: item.textContent.replace(/\s+/g, " ").trim(),
      })),
    );
  expect(initialTurnRows).toEqual([
    expect.objectContaining({
      turn: "0",
      selected: true,
      text: expect.stringContaining("Guessed WORD0"),
    }),
    expect.objectContaining({
      turn: "1",
      selected: false,
      text: expect.stringContaining("Guessed WORD24"),
    }),
  ]);
  expect(initialTurnRows[0].text).toContain("Passed");
  expect(initialTurnRows[1].text).toContain("Blue won by assassin");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await secondClue.hover();
    const hoveredSecondTurnRows = await page
      .locator("#play-history-list")
      .evaluate((list) =>
        [...list.querySelectorAll(":scope > li")].map((item) => ({
          turn: item.getAttribute("data-analysis-turn"),
          previewed: item.classList.contains("is-previewed"),
        })),
      );
    expect(
      hoveredSecondTurnRows,
      `whole-turn hover at ${viewport.width}px`,
    ).toEqual([
      { turn: "0", previewed: false },
      { turn: "1", previewed: true },
    ]);
    await page.locator("#play-post-game-outcome").hover();
    await expect(
      page.locator("#play-history-list > li.is-previewed"),
    ).toHaveCount(0);
  }
  await expect(
    page.locator("#play-clue-display .play-clue-pill"),
  ).toHaveText("FIRST");
  await expect(
    page.locator("#play-clue-display .play-history-clue-number"),
  ).toHaveText("2");
  await expect(
    page.locator("#play-clue-display .play-history-clue-number"),
  ).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("#play-clue-display .play-turn-note")).toBeHidden();
  await expect(page.locator('.play-card[data-layout-id="0"]')).toHaveAttribute(
    "data-intended",
    "true",
  );
  await expect(page.locator('.play-card[data-layout-id="0"]')).toHaveAttribute(
    "data-outcome",
    "correct",
  );
  await expect(page.locator('.play-card[data-layout-id="0"]')).not.toHaveClass(
    /is-done/,
  );
  await expect(page.locator('.play-card[data-layout-id="24"]')).not.toHaveClass(
    /is-done/,
  );
  await expect(page.locator("#play-history-list")).toContainText(
    "Clue: FIRST 2, intended WORD0 + WORD1",
  );
  await expect(page.locator("#play-history-list")).toContainText(
    "Guessed WORD0",
  );
  await expect(page.locator("#play-history-list")).toContainText(
    "Clue: SECOND 1, intended WORD9",
  );
  const blueSummary = page
    .locator(
      '#play-history-list .play-history-turn[data-side="blue"] .play-history-event-summary',
    )
    .first();
  const redSummary = page
    .locator(
      '#play-history-list .play-history-turn[data-side="red"] .play-history-event-summary',
    )
    .first();
  await expect(blueSummary.locator(".play-history-clue-number")).toHaveText("2");
  await expect(blueSummary.locator(".play-history-clue-number")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(
    blueSummary.locator('.play-history-card[data-team="friendly"]'),
  ).toHaveText(["WORD0", "WORD1"]);
  await expect(redSummary.locator(".play-history-clue-number")).toHaveText("1");
  await expect(redSummary.locator(".play-history-clue-number")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(
    redSummary.locator('.play-history-card[data-team="enemy"]'),
  ).toHaveText("WORD9");
  const blueExplainButton = page
    .locator("#play-history-list")
    .getByRole("button", {
      name: "Explain why FIRST connects WORD0, WORD1",
      exact: true,
    });
  const redExplainButton = page
    .locator("#play-history-list")
    .getByRole("button", {
      name: "Explain why SECOND connects WORD9",
      exact: true,
    });
  await expect(blueExplainButton).toBeVisible();
  await expect(redExplainButton).toBeVisible();
  expect(explanationRequests).toHaveLength(0);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const actionLayout = await redSummary.evaluate((summary) => {
      const item = summary.closest("li");
      const turn = item.closest(".play-history-turn");
      const heading = turn.querySelector(".play-history-turn-heading");
      const review = heading.querySelector(".play-history-clue-action");
      const explain = heading.querySelector(".explain-recommendation-button");
      const reviewBounds = review.getBoundingClientRect();
      const explainBounds = explain.getBoundingClientRect();
      const headingBounds = heading.getBoundingClientRect();
      const summaryBounds = summary.getBoundingClientRect();
      const turnBounds = turn.getBoundingClientRect();
      const reviewStyle = getComputedStyle(review);
      const explainStyle = getComputedStyle(explain);
      return {
        sameRow:
          Math.abs(
            reviewBounds.top +
              reviewBounds.height / 2 -
              (explainBounds.top + explainBounds.height / 2),
          ) <= 1,
        sameHeight: Math.abs(reviewBounds.height - explainBounds.height) <= 1,
        sameStyle:
          reviewStyle.borderRadius === explainStyle.borderRadius &&
          reviewStyle.backgroundColor === explainStyle.backgroundColor &&
          reviewStyle.fontSize === explainStyle.fontSize,
        actionsFit:
          reviewBounds.left >= turnBounds.left - 1 &&
          explainBounds.right <= turnBounds.right + 1,
        actionsInHeading:
          reviewBounds.top >= headingBounds.top - 1 &&
          explainBounds.bottom <= headingBounds.bottom + 1,
        actionsAboveClue:
          reviewBounds.bottom <= summaryBounds.top + 1 &&
          explainBounds.bottom <= summaryBounds.top + 1,
      };
    });
    expect(actionLayout.sameRow, `action row at ${viewport.width}px`).toBe(true);
    expect(actionLayout.sameHeight, `action height at ${viewport.width}px`).toBe(true);
    expect(actionLayout.sameStyle, `action style at ${viewport.width}px`).toBe(true);
    expect(actionLayout.actionsFit, `action clipping at ${viewport.width}px`).toBe(
      true,
    );
    expect(
      actionLayout.actionsInHeading,
      `turn action alignment at ${viewport.width}px`,
    ).toBe(true);
    expect(
      actionLayout.actionsAboveClue,
      `turn actions above clue at ${viewport.width}px`,
    ).toBe(true);
  }
  const teamsView = page.getByRole("button", { name: "↔️ By team", exact: true });
  const timelineView = page.getByRole("button", { name: "🕒 Timeline", exact: true });
  await teamsView.click();
  for (const viewport of [
    { width: 390, height: 844, columns: 1 },
    { width: 768, height: 1024, columns: 2 },
    { width: 1440, height: 900, columns: 2 },
  ]) {
    await page.setViewportSize(viewport);
    const teamLayout = await page.evaluate(() => {
      const teamLists = document.querySelector("#play-history-team-lists");
      const turn = document.querySelector(
        '#play-history-blue-list .play-history-turn[data-analysis-turn="0"]',
      );
      const heading = turn.querySelector(".play-history-turn-heading");
      const summary = turn.querySelector(".play-history-event-summary");
      const controls = turn.querySelector(".play-history-turn-actions");
      const headingBounds = heading.getBoundingClientRect();
      const summaryBounds = summary.getBoundingClientRect();
      const controlsBounds = controls.getBoundingClientRect();
      const turnBounds = turn.getBoundingClientRect();
      return {
        columns: getComputedStyle(teamLists).gridTemplateColumns.split(" ").length,
        controlsFit:
          controlsBounds.left >= turnBounds.left - 1 &&
          controlsBounds.right <= turnBounds.right + 1,
        controlsInHeading:
          controlsBounds.top >= headingBounds.top - 1 &&
          controlsBounds.bottom <= headingBounds.bottom + 1,
        controlsAboveClue: controlsBounds.bottom <= summaryBounds.top + 1,
      };
    });
    expect(teamLayout.columns, `analysis columns at ${viewport.width}px`).toBe(
      viewport.columns,
    );
    expect(teamLayout.controlsFit, `team actions fit at ${viewport.width}px`).toBe(
      true,
    );
    expect(
      teamLayout.controlsInHeading,
      `team action alignment at ${viewport.width}px`,
    ).toBe(true);
    expect(
      teamLayout.controlsAboveClue,
      `team actions above clue at ${viewport.width}px`,
    ).toBe(true);
  }
  await timelineView.click();
  await blueExplainButton.click();
  await redExplainButton.click();
  const explanations = page.locator(
    "#play-history-list .play-history-explanation .explanation-targets",
  );
  await expect(explanations).toHaveCount(2);
  await expect(explanations.nth(0)).toContainText(
    "These words connect through sequence",
  );
  await expect(explanations.nth(0).locator(".play-clue-pill")).toHaveText("first");
  await expect(
    explanations.nth(0).locator('.play-history-card[data-team="friendly"]'),
  ).toHaveText(["word0", "word1"]);
  await expect(explanations.nth(1).locator(".play-clue-pill")).toHaveText(
    "second",
  );
  await expect(
    explanations.nth(1).locator('.play-history-card[data-team="enemy"]'),
  ).toHaveText("word9");
  expect(explanationRequests).toHaveLength(2);
  expect(
    explanationRequests.every(({ recommendations }) => recommendations.length === 1),
  ).toBe(true);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const history = document.querySelector("#play-history-list");
      const explanation = history.querySelector(
        ".play-history-explanation .explanation-targets",
      );
      const summaries = [...history.querySelectorAll(".play-history-event-summary")];
      const historyBounds = history.getBoundingClientRect();
      const explanationBounds = explanation.getBoundingClientRect();
      const action = history.querySelector(".play-history-clue-action");
      const actionBounds = action.getBoundingClientRect();
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        explanationFits:
          explanationBounds.left >= historyBounds.left - 1 &&
          explanationBounds.right <= historyBounds.right + 1,
        summariesFit: summaries.every(
          (summary) => summary.scrollWidth <= summary.clientWidth + 1,
        ),
        explanationBelowActions:
          explanationBounds.top >= actionBounds.bottom - 1,
      };
    });
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(layout.explanationFits, `explanation clipping at ${viewport.width}px`).toBe(
      true,
    );
    expect(layout.summariesFit, `summary clipping at ${viewport.width}px`).toBe(true);
    expect(
      layout.explanationBelowActions,
      `explanation action overlap at ${viewport.width}px`,
    ).toBe(true);
  }
  const finishedNewGame = page.getByRole("button", {
    name: "Start new game",
    exact: true,
  });
  await expect(finishedNewGame).toBeVisible();
  await expect(finishedNewGame).toHaveClass(/primary/);
  await expect(page.locator(".play-game-header .play-game-actions #leave-play-game")).toHaveCount(
    1,
  );
  await expect(page.locator("#play-history-list")).not.toContainText("Spymaster");
  await expect(page.locator("#play-history-list")).not.toContainText("Operative");
  await expect(page.locator("#play-history-list")).not.toContainText("🕵️");
  await expect(page.locator("#play-history-list")).not.toContainText("🔎");

  await secondClue.click();
  await expect(firstClue).toHaveAttribute("aria-pressed", "false");
  await expect(secondClue).toHaveAttribute("aria-pressed", "true");
  const selectedSecondTurnRows = await page
    .locator("#play-history-list")
    .evaluate((list) =>
      [...list.querySelectorAll(":scope > li")].map((item) => ({
        turn: item.getAttribute("data-analysis-turn"),
        selected: item.classList.contains("is-selected"),
      })),
    );
  expect(selectedSecondTurnRows).toEqual([
    { turn: "0", selected: false },
    { turn: "1", selected: true },
  ]);
  await expect(firstClue).toHaveText("Review");
  await expect(secondClue).toHaveText("Viewing");
  await expect(
    page.locator("#play-clue-display .play-clue-pill"),
  ).toHaveText("SECOND");
  await expect(
    page.locator("#play-clue-display .play-history-clue-number"),
  ).toHaveText("1");
  await expect(page.locator('.play-card[data-layout-id="0"]')).toHaveClass(
    /is-done/,
  );
  await expect(page.locator('.play-card[data-layout-id="24"]')).not.toHaveClass(
    /is-done/,
  );
  await expect(page.locator('.play-card[data-layout-id="9"]')).toHaveAttribute(
    "data-intended",
    "true",
  );
  await expect(page.locator('.play-card[data-layout-id="24"]')).toHaveAttribute(
    "data-outcome",
    "mistake",
  );
  await expect(
    page.locator(".play-card[data-operative-score]"),
  ).toHaveCount(25, { timeout: 45_000 });
  await expect(page.locator("#play-post-game-analysis-status")).toBeHidden();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const board = document.querySelector("#play-board-grid");
      const cards = [...document.querySelectorAll(".play-card")];
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        historyOverflows:
          document.querySelector("#play-history-list").scrollWidth >
          document.querySelector("#play-history-list").clientWidth,
        cardsFit: cards.every((card) => {
          const cardBounds = card.getBoundingClientRect();
          const boardBounds = board.getBoundingClientRect();
          return (
            cardBounds.left >= boardBounds.left - 1 &&
            cardBounds.right <= boardBounds.right + 1
          );
        }),
        scoreCount: cards.filter(
          (card) => card.querySelector(".play-card-operative-score"),
        ).length,
      };
    });
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(layout.historyOverflows, `history overflow at ${viewport.width}px`).toBe(false);
    expect(layout.cardsFit, `card clipping at ${viewport.width}px`).toBe(true);
    expect(layout.scoreCount, `score count at ${viewport.width}px`).toBe(25);
  }
});

test("active Play sharing copies progress and turn history", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedPlayGame = value;
          return Promise.resolve();
        },
      },
    });
  });
  const code = encodePlayGame(activeShareGame());
  await page.goto(`/?mode=play&g=${code}`);
  await expect(page.locator("#play-history-list")).toContainText("FIRST");
  await expect(page.locator('.play-card[data-layout-id="0"]')).toHaveAttribute(
    "aria-label",
    /revealed before this clue/u,
  );
  await page.getByRole("button", { name: "Share game", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "Game link copied", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#share-play-game svg.lucide-check")).toHaveCount(1);
  const copied = new URL(await page.evaluate(() => window.__copiedPlayGame));
  expect(copied.searchParams.get("mode")).toBe("play");
  expect(copied.searchParams.has("b")).toBe(false);
  const shared = decodePlayGame(copied.searchParams.get("g"));
  expect(shared.phase).toBe("awaiting-clue");
  expect(shared.turnNumber).toBe(2);
  expect(shared.cards.find(({ layoutId }) => layoutId === 0).done).toBe(true);
  expect(
    shared.history.some(
      (event) => event.type === "clue-given" && event.clue === "FIRST",
    ),
  ).toBe(true);
});

test("completed Play links reopen full games and stay in the local archive", async ({
  page,
}) => {
  await useTestPlayAnalysis(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedCompletedGame = value;
          return Promise.resolve();
        },
      },
    });
  });
  const code = encodeCompletedGame(completedShareGame());
  expect(code.length).toBeLessThan(2_048);
  await page.goto(`/?mode=play&g=${code}`);

  await expect(page.locator("#play-post-game-outcome")).toContainText("Red won");
  await expect(page.locator("#play-history-list")).toContainText("FIRST");
  await expect(page.locator("#play-history-list")).toContainText("WORD24");
  await expect(
    page.getByRole("button", { name: "Share game", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Share game", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Game link copied", exact: true }),
  ).toBeVisible();
  const copied = new URL(
    await page.evaluate(() => window.__copiedCompletedGame),
  );
  expect(copied.searchParams.get("mode")).toBe("play");
  expect(copied.searchParams.get("g")).toBe(code);
  expect(copied.searchParams.has("b")).toBe(false);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#play-board-grid")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      `page overflow at ${viewport.width}px`,
    ).toBe(true);
  }

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(page.locator("#completed-play-games")).toBeVisible();
  await expect(page.locator("#completed-play-games-count")).toHaveText("1 saved");
  await expect(page.locator("#completed-play-games")).not.toHaveAttribute(
    "open",
    "",
  );
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".play-settings").compareDocumentPosition(
          document.querySelector("#completed-play-games"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBeTruthy();
  await page.locator("#completed-play-games > summary").click();
  await expect(page.locator("#completed-play-games-list")).toContainText(
    "Red won by assassin, 1 clue",
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("codenames-play-completed-v1")),
    ),
  ).toHaveLength(1);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.locator("#play-post-game-outcome")).toContainText("Red won");
  expect(new URL(page.url()).searchParams.get("g")).toBe(code);
});

test("unsupported historical rules still open and preserve their original actions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedHistoricalGame = value;
          return Promise.resolve();
        },
      },
    });
  });
  const currentCode = encodeCompletedGame(completedShareGame());
  const historicalPayload = JSON.parse(
    Buffer.from(currentCode, "base64url").toString("utf8"),
  );
  historicalPayload[1] = 99;
  const historicalCode = Buffer.from(
    JSON.stringify(historicalPayload),
  ).toString("base64url");
  await page.goto(`/?mode=play&g=${historicalCode}`);

  await expect(page.locator("#play-post-game-outcome")).toContainText(
    "Red won",
  );
  await expect(page.locator("#play-history-list")).toContainText("FIRST");
  await expect(page.locator("#play-history-list")).toContainText("WORD24");
  await expect(page.locator("#play-historical-review-note")).toBeVisible();
  await expect(page.locator("#play-historical-review-note")).toContainText(
    "Actions remain available",
  );
  await page
    .getByRole("button", { name: "Share game", exact: true })
    .click();
  expect(
    new URL(
      await page.evaluate(() => window.__copiedHistoricalGame),
    ).searchParams.get("g"),
  ).toBe(historicalCode);

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator("#completed-play-games > summary").click();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  expect(
    new URL(
      await page.evaluate(() => window.__copiedHistoricalGame),
    ).searchParams.get("g"),
  ).toBe(historicalCode);
});

test("archiving a completed save keeps its finished-game review entry point", async ({
  page,
}) => {
  await useTestPlayAnalysis(page);
  await page.addInitScript((savedGame) => {
    localStorage.setItem(
      "codenames-play-session-v1",
      JSON.stringify(savedGame),
    );
  }, completedShareGame());
  await page.goto("/?mode=play");

  await expect(page.locator("#completed-play-games")).toBeHidden();
  await expect(page.locator("#resume-play-session")).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("codenames-play-session-v1"),
    ),
  ).not.toBeNull();

  await page.locator("#resume-play-session").click();
  await expect(page.locator("#play-post-game-outcome")).toContainText(
    "Red won",
  );
});

test("developer archives keep diagnostics local when copying a replay link", async ({
  page,
}) => {
  const developerGame = completedShareGame();
  developerGame.developerMode = true;
  developerGame.history = developerGame.history.map((event) => {
    if (event.type === "game-started") {
      return { ...event, developerMode: true };
    }
    if (event.type === "clue-given") {
      return {
        ...event,
        developerDiagnostics: {
          diagnosticsVersion: 1,
          spymasterDecision: { clue: "FIRST", score: 0.82 },
        },
      };
    }
    return event;
  });
  const archivedCode = encodeCompletedGame(developerGame, {
    includeDeveloperDiagnostics: true,
    maxLength: 262_144,
  });
  const archivedGame = decodeCompletedGame(archivedCode, {
    maxLength: 262_144,
  });
  await page.addInitScript(({ code, id }) => {
    localStorage.setItem(
      "codenames-play-completed-v1",
      JSON.stringify([
        {
          id,
          savedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          code,
        },
      ]),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedDeveloperGame = value;
          return Promise.resolve();
        },
      },
    });
  }, { code: archivedCode, id: archivedGame.gameId });
  await page.goto("/?mode=play");

  await page.locator("#completed-play-games > summary").click();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  const copied = new URL(
    await page.evaluate(() => window.__copiedDeveloperGame),
  );
  const shared = decodeCompletedGame(copied.searchParams.get("g"));
  expect(shared.developerMode).toBe(true);
  expect(shared.history[1].developerDiagnostics).toBeUndefined();

  const [archived] = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-completed-v1")),
  );
  const fullRecord = decodeCompletedGame(archived.code, {
    maxLength: 262_144,
  });
  expect(fullRecord.history[1].developerDiagnostics).toEqual({
    diagnosticsVersion: 1,
    spymasterDecision: { clue: "FIRST", score: 0.82 },
  });
});

test("Italian Play uses E5, persists its session, and shares the active game", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedItalianGame = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto("/?mode=play");

  const english = page.locator('[data-language-value="en"]');
  const italian = page.locator('[data-language-value="it"]');
  await expect(english).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#play-bot-model")).toHaveValue("bge-small");

  await italian.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(italian).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#play-title")).toHaveText("Scegli il tuo ruolo");
  const italianPlayNote = page.locator(
    ".play-settings-sections > #italian-play-note",
  );
  await expect(italianPlayNote).toContainText(
    "Il comportamento dei bot è sperimentale",
  );
  await expect(italianPlayNote).toBeHidden();
  await page.locator(".play-settings > summary").click();
  await expect(italianPlayNote).toBeVisible();
  await expect(page.locator('[data-play-word-set="official"]')).toBeHidden();
  await expect(page.locator('[data-play-word-set="extended"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#play-bot-model")).toHaveValue(
    "multilingual-e5-small",
  );
  await expect(page.locator("#play-bot-model")).toBeDisabled();
  await expect(page.locator("#play-bot-candidates")).toHaveValue("10000");
  await expect(page.locator("#play-bot-candidates option")).toHaveCount(2);

  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.locator("#start-play-game").click();

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codenames-play-session-v1")),
  );
  expect(saved.language).toBe("it");
  expect(saved.wordSet).toBe("extended");
  expect(saved.botSettings.modelId).toBe("multilingual-e5-small");
  expect(saved.cards).toHaveLength(25);
  expect(new Set(saved.cards.map(({ word }) => word)).size).toBe(25);
  await expect(page.locator("#play-human-seat .play-seat-context")).toHaveText(
    "La tua vista",
  );
  await expect(page.locator("#play-human-seat .play-seat-identity")).toContainText(
    "Blu 🕵️ Capo agenzia",
  );

  await page.locator("#share-play-game").click();
  const copied = new URL(
    await page.evaluate(() => window.__copiedItalianGame),
  );
  const shared = decodePlayGame(copied.searchParams.get("g"));
  expect(copied.searchParams.get("mode")).toBe("play");
  expect(copied.searchParams.has("b")).toBe(false);
  expect(shared.language).toBe("it");
  expect(shared.wordSet).toBe("extended");
  expect(shared.phase).toBe("awaiting-clue");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.locator("#resume-play-session")).toHaveText(
    "Riprendi partita",
  );
  await page.locator("#resume-play-session").click();
  await expect(page.locator("#play-board-grid .play-card")).toHaveCount(25);
  await expect(page.locator("#play-human-seat .play-seat-context")).toHaveText(
    "La tua vista",
  );
  await expect(page.locator("#play-human-seat .play-seat-identity")).toContainText(
    "Blu 🕵️ Capo agenzia",
  );
});

test("Italian Play remains usable at phone, tablet, and desktop widths", async ({
  page,
}) => {
  await page.goto("/?mode=play");
  await page.locator('[data-language-value="it"]').click();
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.locator("#start-play-game").click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const board = document.querySelector("#play-board-grid");
      const topbar = document.querySelector(".topbar");
      const cards = [...document.querySelectorAll(".play-card")];
      const boardBounds = board.getBoundingClientRect();
      return {
        pageOverflows:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        topbarOverflows: topbar.scrollWidth > topbar.clientWidth,
        languageVisible:
          document.querySelector(".app-language-switch").getBoundingClientRect()
            .width > 0,
        columns: getComputedStyle(board).gridTemplateColumns.split(" ").length,
        cardsFit: cards.every((card) => {
          const bounds = card.getBoundingClientRect();
          return (
            bounds.left >= boardBounds.left - 1 &&
            bounds.right <= boardBounds.right + 1
          );
        }),
      };
    });
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(
      false,
    );
    expect(layout.topbarOverflows, `topbar overflow at ${viewport.width}px`).toBe(
      false,
    );
    expect(layout.languageVisible).toBe(true);
    expect(layout.columns).toBe(5);
    expect(layout.cardsFit).toBe(true);
  }
});

test("Play board remains usable at phone, tablet, and desktop widths", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  for (const viewport of [
    { width: 390, height: 844, layout: "stacked", minCardFont: 11 },
    { width: 768, height: 1024, layout: "stacked", minCardFont: 11 },
    { width: 1440, height: 900, layout: "wide", minCardFont: 14 },
    { width: 1920, height: 1080, layout: "wide", minCardFont: 16.5 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const layout = await page.evaluate(() => {
      const board = document.querySelector("#play-board-grid");
      const boardPanel = document.querySelector(".play-board-panel");
      const header = document.querySelector(".play-game-header");
      const history = document.querySelector(".play-history");
      const score = document.querySelector("#play-score");
      const turnPanel = document.querySelector(".play-turn-panel");
      const workspace = document.querySelector(".play-workspace");
      const cards = [...document.querySelectorAll(".play-card")];
      const clueActions = document.querySelector(".play-clue-actions");
      const giveClue = clueActions.querySelector('[type="submit"]');
      const hints = document.querySelector("#toggle-play-suggestions");
      const clueField = document.querySelector(".play-clue-field");
      const clueNumberField = document.querySelector(".play-clue-form > label");
      const clueActionBounds = clueActions.getBoundingClientRect();
      const giveClueBounds = giveClue.getBoundingClientRect();
      const hintsBounds = hints.getBoundingClientRect();
      const clueFieldBounds = clueField.getBoundingClientRect();
      const clueNumberBounds = clueNumberField.getBoundingClientRect();
      const boardPanelBounds = boardPanel.getBoundingClientRect();
      const historyBounds = history.getBoundingClientRect();
      const turnPanelBounds = turnPanel.getBoundingClientRect();
      const workspaceBounds = workspace.getBoundingClientRect();
      return {
        viewportScale: window.visualViewport?.scale ?? 1,
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        headerOverflows: header.scrollWidth > header.clientWidth,
        scoreWidth: Math.round(score.getBoundingClientRect().width),
        columns: getComputedStyle(board).gridTemplateColumns.split(" ").length,
        cardsFit: cards.every((card) => {
          const cardBounds = card.getBoundingClientRect();
          const boardBounds = board.getBoundingClientRect();
          return (
            cardBounds.left >= boardBounds.left - 1 &&
            cardBounds.right <= boardBounds.right + 1
          );
        }),
        clueActionsFit: clueActions.scrollWidth <= clueActions.clientWidth,
        hintsBesideClue:
          Math.abs(giveClueBounds.top - hintsBounds.top) <= 1 &&
          hintsBounds.left >= giveClueBounds.right &&
          hintsBounds.left - giveClueBounds.right <= 9 &&
          hintsBounds.right <= clueActionBounds.right + 1,
        clueFieldsFit:
          clueFieldBounds.width >= 120 &&
          clueFieldBounds.right <= clueNumberBounds.left,
        cardFont: Number.parseFloat(getComputedStyle(cards[0]).fontSize),
        clueLabelFont: Number.parseFloat(getComputedStyle(clueField).fontSize),
        giveClueHeight: Math.round(giveClueBounds.height),
        historyBelowContent:
          historyBounds.top >=
          Math.max(boardPanelBounds.bottom, turnPanelBounds.bottom),
        turnBesideBoard:
          Math.abs(turnPanelBounds.top - boardPanelBounds.top) <= 1 &&
          turnPanelBounds.left >= boardPanelBounds.right,
        workspaceUsage: workspaceBounds.width / window.innerWidth,
      };
    });

    expect(layout.viewportScale, `browser scale at ${viewport.width}px`).toBe(1);
    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(layout.headerOverflows, `header overflow at ${viewport.width}px`).toBe(false);
    expect(layout.scoreWidth, `score width at ${viewport.width}px`).toBeLessThan(190);
    expect(layout.columns, `board columns at ${viewport.width}px`).toBe(5);
    expect(layout.cardsFit, `card clipping at ${viewport.width}px`).toBe(true);
    expect(layout.clueActionsFit, `clue action overflow at ${viewport.width}px`).toBe(true);
    expect(layout.hintsBesideClue, `Hints placement at ${viewport.width}px`).toBe(true);
    expect(layout.clueFieldsFit, `clue field overlap at ${viewport.width}px`).toBe(true);
    expect(layout.cardFont, `card font at ${viewport.width}px`).toBeGreaterThanOrEqual(
      viewport.minCardFont,
    );
    expect(layout.clueLabelFont, `clue label at ${viewport.width}px`).toBeGreaterThanOrEqual(
      12,
    );
    expect(layout.giveClueHeight, `clue action height at ${viewport.width}px`).toBeGreaterThanOrEqual(
      44,
    );
    expect(layout.historyBelowContent, `game log order at ${viewport.width}px`).toBe(true);
    expect(layout.turnBesideBoard, `workspace layout at ${viewport.width}px`).toBe(
      viewport.layout === "wide",
    );
    if (viewport.width === 1920) {
      expect(layout.workspaceUsage, "large-screen workspace width").toBeGreaterThan(0.85);
    }
  }
});

test("recommendations collapse without losing controls or results state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SHARED_BOARD);

  const toggle = page.locator("#toggle-recommendations");
  const toolbar = page.locator("#recommendation-toolbar");
  const content = page.locator("#recommendation-content");
  const sort = page.locator("#mobile-suggestion-sort");
  const advanced = page.locator("#advanced-metrics");
  const red = page.getByRole("button", { name: "Red", exact: true });

  await sort.selectOption("number:desc");
  await advanced.check();
  await red.click();
  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-label", "Expand recommendations");
  await expect(toolbar).toBeHidden();
  await expect(content).toBeHidden();
  await expect(page.getByRole("heading", { name: "Recommendations" })).toBeVisible();

  await page.getByRole("button", { name: "Expand recommendations" }).click();

  await expect(toolbar).toBeVisible();
  await expect(content).toBeVisible();
  await expect(sort).toHaveValue("number:desc");
  await expect(advanced).toBeChecked();
  await expect(red).toHaveAttribute("aria-pressed", "true");
});

test("model lab lazy-loads only selected model and incremental clue shards", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
      return url.origin === window.location.origin
        ? originalFetch(input, init)
        : new Promise(() => {});
    };
  });
  const requests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/data/model-lab/")) requests.push(path);
  });
  await page.goto(SHARED_BOARD);

  await expect(page.getByRole("heading", { name: "Model picker" })).toBeVisible();
  await expect.poll(() => requests.some((path) => path.includes("minilm-l6/manifest"))).toBe(true);
  await expect.poll(() => requests.some((path) => path.includes("minilm-l6/clues-3000-10000"))).toBe(true);
  expect(requests.some((path) => path.includes("minilm-l3"))).toBe(false);
  expect(requests.some((path) => path.includes("bge-small"))).toBe(false);
  expect(requests.some((path) => path.includes("minilm-l12"))).toBe(false);
  expect(requests.some((path) => path.includes("mpnet-base"))).toBe(false);

  const bge3k = page.locator('.model-combination[data-model-id="bge-small"][data-candidate-count="3000"]');
  await expect(bge3k).toHaveCount(1);
  await bge3k.click();
  await expect.poll(() => requests.some((path) => path.includes("bge-small/clues-0-3000"))).toBe(true);
  const baseRequests = requests.filter((path) => path.includes("bge-small/clues-0-3000")).length;

  const bge10k = page.locator('.model-combination[data-model-id="bge-small"][data-candidate-count="10000"]');
  await expect(bge10k).toHaveCount(1);
  await bge10k.click();
  await expect.poll(() => requests.some((path) => path.includes("bge-small/clues-3000-10000"))).toBe(true);
  expect(requests.filter((path) => path.includes("bge-small/clues-0-3000"))).toHaveLength(baseRequests);
  expect(requests.some((path) => path.includes("minilm-l3"))).toBe(false);
  expect(requests.some((path) => path.includes("minilm-l12"))).toBe(false);
  expect(requests.some((path) => path.includes("mpnet-base"))).toBe(false);

  let releaseTailRequest;
  await page.route("**/bge-small/clues-30000-100000.json", async (route) => {
    await new Promise((resolve) => { releaseTailRequest = resolve; });
    await route.continue();
  });
  const bge100k = page.locator('.model-combination[data-model-id="bge-small"][data-candidate-count="100000"]');
  await expect(bge100k).toHaveCount(1);
  await bge100k.click();
  await expect(page.locator("#analysis-status")).toHaveText("Loading 100,000 clues (52.8 MB index)");
  await expect.poll(() => typeof releaseTailRequest).toBe("function");
  releaseTailRequest();
  await expect.poll(() => requests.some((path) => path.includes("bge-small/clues-30000-100000"))).toBe(true);
});

test("model picker uses the fixed benchmark and shows one time per combination", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
      return url.origin === window.location.origin
        ? originalFetch(input, init)
        : new Promise(() => {});
    };
  });
  await page.goto(SHARED_BOARD);

  await expect(page.locator(".model-combination")).toHaveCount(12);
  await expect(page.getByRole("columnheader", { name: "3,000 clues 62.1% human clue coverage 1.6 MB index" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "10,000 clues 85.5% human clue coverage 5.3 MB index" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "30,000 clues 93.9% human clue coverage 15.8 MB index" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "100,000 clues 96.3% human clue coverage 52.8 MB index" })).toBeVisible();
  await expect(page.getByText("Use combination")).toHaveCount(0);
  await expect(page.getByText("Selected", { exact: true })).toHaveCount(0);
  await expect(page.locator(".model-recommendation-badge")).toHaveCount(1);
  await expect(page.locator(".model-recommendation-badge")).toContainText("Recommended");
  await expect(page.locator('#model-picker-info .info-button')).toBeVisible();
  await expect(page.locator('#candidate-filter-info .info-button')).toBeVisible();
  await expect(page.locator(".model-lab-info")).toHaveCount(0);
  const l6 = page.locator('.model-combination[data-model-id="minilm-l6"][data-candidate-count="10000"]');
  const bge = page.locator('.model-combination[data-model-id="bge-small"][data-candidate-count="3000"]');
  const l3 = page.locator('.model-combination[data-model-id="minilm-l3"][data-candidate-count="3000"]');
  const fastest = Math.min(...pickerBenchmark.results.map(({ medianMs }) => medianMs));
  const result = (modelId, candidateCount) => pickerBenchmark.results.find(
    (entry) => entry.modelId === modelId && entry.candidateCount === candidateCount,
  );
  await expect(l6).toContainText(`${result("minilm-l6", 10000).medianMs.toFixed(1)} ms`);
  await expect(l6).toContainText("49.1%");
  await expect(l6.locator("small")).toHaveCount(0);
  await expect(l6.locator(".lab-bar.speed i")).toHaveAttribute(
    "style",
    `width:${Math.round((fastest / result("minilm-l6", 10000).medianMs) * 100)}%`,
  );
  await expect(bge.locator(".lab-bar.speed i")).toHaveAttribute(
    "style",
    `width:${Math.round((fastest / result("bge-small", 3000).medianMs) * 100)}%`,
  );
  await expect(l3.locator(".lab-bar.quality i")).toHaveAttribute("style", "width:62%");
  await expect(l6.getByText("Download", { exact: true })).toBeVisible();
  await expect(l6).toContainText("28.2 MB");
  await expect(l6.locator(".lab-bar.download i")).toHaveAttribute("style", "width:67%");
  await expect(page.getByText("Light", { exact: true })).toHaveCount(0);
  await expect(page.locator(".model-pareto svg")).toBeVisible();
  await expect(page.locator(".pareto-point")).toHaveCount(12);
  await expect(page.locator(".pareto-point.is-recommended")).toHaveCount(1);
  await expect(page.locator(".pareto-ticks").getByText("0 ms", { exact: true })).toHaveCount(0);
  await expect(page.locator(".pareto-ticks")).toContainText(`${Math.round(fastest)} ms`);
});
