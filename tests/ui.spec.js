import { expect, test } from "@playwright/test";
import pickerBenchmark from "../scripts/generated/model-picker-benchmark.json" with { type: "json" };

const SHARED_BOARD = "/?b=2sw7fIwN9dL7Yos";

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
  await page.goto("/?mode=play");

  await expect(page.locator("#app-title")).toHaveText("Codenames");
  await expect(page).toHaveTitle("Codenames");
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

  await page.getByRole("button", { name: "Randomize", exact: true }).click();
  await expect(page.locator("[data-play-seat][aria-pressed='true']")).toHaveCount(1);
});

test("Play enforces operative and spymaster information views", async ({ page }) => {
  await page.goto("/?mode=play");

  await page.locator('[data-play-seat="blue:operative"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await expect(page.locator(".play-card")).toHaveCount(25);
  await expect(page.locator('.play-card[data-team="hidden"]')).toHaveCount(25);
  await expect(page.locator("#play-clue-form")).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Clue", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "New game", exact: true }).click();
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await expect(page.locator("#play-clue-form")).toBeVisible();
  await expect(page.locator("#play-suggestions")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "💡 Show clue suggestions", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "💡 Show clue suggestions", exact: true }).click();
  await expect(page.locator("#play-suggestions")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "💡 Hide clue suggestions", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator('.play-card[data-team="neutral"]')).toHaveCount(7);
  await expect(page.locator('.play-card[data-team="assassin"]')).toHaveCount(1);
});

test("Play validates human clues and resumes the saved seat", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  await page.getByRole("textbox", { name: "Clue", exact: true }).fill("two words");
  await page.getByRole("button", { name: "Give clue", exact: true }).click();
  await expect(page.locator("#play-clue-error")).toHaveText("A clue must be one word.");

  await page.getByRole("button", { name: "New game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume game", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await expect(page.locator("#play-human-seat")).toHaveText(
    "🔵 🕵️ You are Blue Spymaster",
  );
  await expect(page.getByRole("textbox", { name: "Clue", exact: true })).toBeVisible();
});

test("Play color-codes turns and lets spymasters switch board order", async ({ page }) => {
  await page.goto("/?mode=play");
  await page.locator('[data-play-seat="blue:spymaster"]').click();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();

  const turn = page.locator("#play-clue-display");
  await expect(turn).toHaveAttribute("data-side", "blue");
  await expect(turn).toContainText("🔵 Blue turn");
  await expect(turn).toContainText("💬 Give a clue");

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
  await expect(page.locator("#play-clue-display")).toHaveAttribute("data-side", "red");
  await expect(page.locator("#play-clue-display")).toContainText("🔴 Red turn");
  await expect(page.locator("#play-clue-display")).toContainText("💬 Give a clue");
  await expect(page.locator("#play-suggestions")).toBeHidden();
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

  await expect(page.locator("#play-clue-display")).toContainText("🔵 Blue wins");
  await expect(page.locator('.play-card[data-team="friendly"]')).toHaveCount(9);
  await expect(page.locator('.play-card[data-team="enemy"]')).toHaveCount(8);
  await expect(page.locator("#play-history-list")).toContainText(
    "Blue clue: FIRST 1, intended WORD0",
  );
  await expect(page.locator("#play-history-list")).toContainText(
    "Blue guessed WORD0, Blue",
  );
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
  const copied = new URL(await page.evaluate(() => window.__copiedBoardLink));
  expect(copied.searchParams.has("b")).toBe(true);
  expect(copied.searchParams.has("mode")).toBe(false);
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
      const cards = [...document.querySelectorAll(".play-card")];
      return {
        pageOverflows:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
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
