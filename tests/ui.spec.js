import { expect, test } from "@playwright/test";

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

test("model lab lazy-loads only selected model and incremental clue shards", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/data/model-lab/")) requests.push(path);
  });
  await page.goto(SHARED_BOARD);

  await expect(page.getByRole("heading", { name: "Model picker" })).toBeVisible();
  await expect.poll(() => requests.some((path) => path.includes("minilm-l6/manifest"))).toBe(true);
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
});

test("model lab speed bars compare persisted valid runtimes without exceeding 100%", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "codenames-model-lab-runtime-v1",
      JSON.stringify([
        ["minilm-l6:3000", { scoreMs: 100, totalMs: 160 }],
        ["bge-small:3000", { scoreMs: 200, totalMs: 280 }],
        ["minilm-l12:3000", { scoreMs: 0, totalMs: 300 }],
        ["unknown:3000", { scoreMs: 1, totalMs: 1 }],
      ]),
    );
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
      return url.origin === window.location.origin
        ? originalFetch(input, init)
        : new Promise(() => {});
    };
  });
  await page.goto(SHARED_BOARD);

  await expect(page.locator(".model-combination")).toHaveCount(15);
  await expect(page.getByText("Use combination")).toHaveCount(0);
  await expect(page.getByText("Selected", { exact: true })).toHaveCount(0);
  await expect(page.locator(".model-recommendation-badge")).toHaveCount(1);
  await expect(page.locator(".model-recommendation-badge")).toContainText("Recommended");
  await expect(page.locator('#model-picker-info .info-button')).toBeVisible();
  await expect(page.locator(".model-lab-info")).toHaveCount(0);
  const l6 = page.locator('.model-combination[data-model-id="minilm-l6"][data-candidate-count="3000"]');
  const bge = page.locator('.model-combination[data-model-id="bge-small"][data-candidate-count="3000"]');
  const l12 = page.locator('.model-combination[data-model-id="minilm-l12"][data-candidate-count="3000"]');
  await expect(l6.locator(".lab-bar.speed i")).toHaveAttribute("style", "width:100%");
  await expect(bge.locator(".lab-bar.speed i")).toHaveAttribute("style", "width:50%");
  await expect(l12.locator(".lab-bar.speed i")).toHaveAttribute("style", "width:0%");
  await expect(l12).toContainText("Run to measure");
  await expect(page.locator('th[scope="row"] .lab-bar.quality i').first()).toHaveAttribute("style", "width:27%");
});
