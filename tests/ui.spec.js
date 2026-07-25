import { expect, test } from "@playwright/test";
import pickerBenchmark from "../scripts/generated/model-picker-benchmark.json" with { type: "json" };

const SHARED_BOARD = "/?mode=train&b=2sw7fIwN9dL7Yos";

async function useTestBotAction(page, delay) {
  await page.addInitScript((botActionDelay) => {
    window.__codenamesPlayModeOptions = {
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

async function resumePlaySession(page, history) {
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, playSessionWithHistory(history));
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
}

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

test("mobile recommendation cards show every primary metric", async ({ page }) => {
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
    "Worth",
    "Est. hit",
    "Risk",
    "Closest danger",
    "Apply",
  ]);
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
          ".target-score, .danger-score, .item-cell strong, .score-cell strong",
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

test("sortable metric headers keep sort and info controls separate", async ({ page }) => {
  await page.goto("/tests/fixtures/recommendations.html");
  await expect(page.locator('th[data-column="worth"]')).toBeVisible();

  for (const width of [900, 1011, 1115]) {
    await page.setViewportSize({ width, height: 900 });
    const headers = await page.evaluate(() =>
      ["worth", "hit", "risk", "danger"].map((column) => {
        const header = document.querySelector(`th[data-column="${column}"]`);
        const sort = header.querySelector(".sort-button").getBoundingClientRect();
        const info = header.querySelector(".info-control").getBoundingClientRect();
        const bounds = header.getBoundingClientRect();
        return {
          column,
          controlsOverlap: sort.right > info.left,
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

  await page.getByRole("button", { name: "Randomize seat", exact: true }).click();
  await expect(page.locator("[data-play-seat][aria-pressed='true']")).toHaveCount(1);
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

  const settings = page.locator(".play-bot-settings");
  await expect(settings).toContainText(
    "BGE-small, 10k, human-like, dynamic operative, stop at number",
  );
  await expect(settings).not.toHaveAttribute("open", "");
  await expect(settings.locator(".play-bot-settings-toggle")).toContainText(
    "Customize",
  );
  expect(
    await settings.evaluate((details) =>
      details.previousElementSibling?.classList.contains("play-setup-footer"),
    ),
  ).toBe(true);
  await settings.locator("summary").click();
  await expect(settings).toHaveAttribute("open", "");
  await expect(page.locator("#play-bot-model")).toHaveValue("bge-small");
  await expect(page.locator("#play-bot-candidates")).toHaveValue("10000");
  await expect(page.locator("#play-clue-policy")).toHaveValue("hybrid");
  await expect(page.locator("#play-multi-tolerance")).toHaveValue("5");
  await expect(page.locator("#play-operative-aggression")).toHaveValue(
    "dynamic",
  );
  await expect(page.locator("#play-bonus-guesses")).toHaveValue("pass");
  await expect(settings.locator(".play-setting-label .info-button")).toHaveCount(6);

  await page.locator("#play-bot-model").selectOption("minilm-l6");
  await page.locator("#play-bot-candidates").selectOption("30000");
  await page.locator("#play-clue-policy").selectOption("current");
  await page.locator("#play-multi-tolerance").selectOption("10");
  await page.locator("#play-operative-aggression").selectOption("conservative");
  await page.locator("#play-bonus-guesses").selectOption("allow");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  expect(
    await page.evaluate(() => {
      const game = JSON.parse(
        localStorage.getItem("codenames-play-session-v1"),
      );
      return game.botSettings;
    }),
  ).toEqual({
    modelId: "minilm-l6",
    candidateCount: 30000,
    cluePolicy: "current",
    multiTolerance: 10,
    operativeAggression: "conservative",
    bonusGuesses: "allow",
  });
});

test("Play bot setting help explains measured tradeoffs and stays on-screen", async ({
  page,
}) => {
  const settingHelp = [
    ["Embedding model", 3, "58.57%"],
    ["Clue vocabulary", 4, "85.47%"],
    ["Clue scoring", 2, "50.4%"],
    ["Prefer multi-card clues", 3, "best clue for 2+ cards"],
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
    await page.locator(".play-bot-settings summary").click();

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
  await expect(page.locator("#play-clue-form")).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Clue", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await expect(page.locator("#play-clue-form")).toBeVisible();
  await expect(page.locator("#undo-play-action svg.lucide-undo-2")).toHaveCount(1);
  await expect(page.locator("#forward-play-action svg.lucide-redo-2")).toHaveCount(1);
  await expect(page.locator("#share-play-board svg.lucide-share-2")).toHaveCount(1);
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
  await expect(
    page.getByRole("button", { name: "💡 Show clue suggestions", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "💡 Show clue suggestions", exact: true }).click();
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
    page.getByRole("button", { name: "💡 Hide clue suggestions", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator('.play-card[data-team="neutral"]')).toHaveCount(7);
  await expect(page.locator('.play-card[data-team="assassin"]')).toHaveCount(1);
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
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?mode=play");
    await page.evaluate(() => localStorage.removeItem("codenames-play-session-v1"));
    await page.reload();

    const setupActions = page.locator(".play-setup-heading .play-primary-actions");
    const randomize = page.getByRole("button", {
      name: "Randomize seat",
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

test("starting a second Play game clears the previous clue and analysis", async ({
  page,
}) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.locator(".play-bot-settings summary").click();
  await page.locator("#play-bot-model").selectOption("minilm-l3");
  await page.locator("#play-bot-candidates").selectOption("3000");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await page.getByRole("button", {
    name: "💡 Show clue suggestions",
    exact: true,
  }).click();
  await expect(page.locator(".play-suggestion").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("textbox", { name: "Clue", exact: true }).fill("hibernation");
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(page.locator("#play-history-list")).toContainText(
    "Blue clue: HIBERNATION 2",
  );
  await expect(page.locator("#play-history-list")).toContainText("Blue guessed", {
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

  await expect(turn).toContainText("THIRD 1");
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
  await expect(turn).toContainText("THIRD 1");
  await expect(forward).toBeDisabled();

  await undo.click();
  await undo.click();
  await expect(turn).toContainText("Red turn");
  await expect(turn).toHaveAttribute("data-side", "red");

  await undo.click();
  await expect(turn).toContainText("FIRST 1");
  await expect(page.locator('.play-card[data-layout-id="0"]')).toHaveClass(/is-done/);

  await undo.click();
  await expect(turn).toContainText("FIRST 1");
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

test("Play game log switches between chronological and separated team views", async ({
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
      intendedLayoutIds: [],
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
  await expect(timeline.locator("li")).toHaveCount(4);
  expect(await timeline.locator("li").allTextContents()).toEqual([
    "Blue clue: OCEAN 2",
    "Blue guessed WORD0, Blue",
    "Red clue: FIRE 1",
    "Red passed",
  ]);

  await teamsView.click();

  await expect(teamsView).toHaveAttribute("aria-pressed", "true");
  await expect(timeline).toBeHidden();
  expect(await page.locator("#play-history-blue-list li").allTextContents()).toEqual([
    "Blue clue: OCEAN 2",
    "Blue guessed WORD0, Blue",
  ]);
  expect(await page.locator("#play-history-red-list li").allTextContents()).toEqual([
    "Red clue: FIRE 1",
    "Red passed",
  ]);

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
  await expect(page.locator("#play-history-list li")).toHaveCount(24);
  expect(
    await page.locator("#play-history-list").evaluate(
      (list) => list.scrollHeight > list.clientHeight,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "↔️ By team", exact: true }).click();
  await expect(page.locator("#play-history-blue-list li")).toHaveCount(12);
  await expect(page.locator("#play-history-red-list li")).toHaveCount(12);

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

test("completed Play sessions reveal the key and intended targets", async ({ page }) => {
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
      done: layoutId === 0,
      revealedBy: layoutId === 0 ? "blue" : null,
      revealedTurn: layoutId === 0 ? 1 : null,
    })),
    activeSide: "blue",
    phase: "complete",
    turnNumber: 1,
    currentTurn: null,
    winner: "blue",
    endReason: "agents",
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
        number: 1,
        intendedLayoutIds: [0],
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
      { type: "game-ended", turn: 1, winner: "blue", reason: "agents" },
    ],
  };
  await page.addInitScript((session) => {
    localStorage.setItem("codenames-play-session-v1", JSON.stringify(session));
  }, savedGame);
  await page.goto("/?mode=play");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();

  await expect(page.locator("#play-clue-display")).toContainText("Blue wins");
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator("#play-history-list")).toContainText(
    "Blue clue: FIRST 1, intended WORD0",
  );
  await expect(page.locator("#play-history-list")).toContainText(
    "Blue guessed WORD0, Blue",
  );
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
});

test("Play sharing copies a board-only link", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedBoardLink = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await page.getByRole("button", { name: "Share board", exact: true }).click();

  await expect(page.getByRole("button", { name: "Board copied", exact: true })).toBeVisible();
  await expect(page.locator("#share-play-board svg.lucide-check")).toHaveCount(1);
  const copied = new URL(await page.evaluate(() => window.__copiedBoardLink));
  expect(copied.searchParams.has("b")).toBe(true);
  expect(copied.searchParams.get("mode")).toBe("train");
});

test("Play board remains usable at phone, tablet, and desktop widths", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const board = document.querySelector("#play-board-grid");
      const header = document.querySelector(".play-game-header");
      const score = document.querySelector("#play-score");
      const cards = [...document.querySelectorAll(".play-card")];
      return {
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
      };
    });

    expect(layout.pageOverflows, `page overflow at ${viewport.width}px`).toBe(false);
    expect(layout.headerOverflows, `header overflow at ${viewport.width}px`).toBe(false);
    expect(layout.scoreWidth, `score width at ${viewport.width}px`).toBeLessThan(190);
    expect(layout.columns, `board columns at ${viewport.width}px`).toBe(5);
    expect(layout.cardsFit, `card clipping at ${viewport.width}px`).toBe(true);
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
