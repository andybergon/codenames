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
  ]);
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
  const autoTurn = page.getByRole("checkbox", { name: "Auto turn" });

  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expect(autoTurn).toBeChecked();
  await red.click();

  await expect(red).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".results-panel")).toHaveAttribute("data-active-side", "red");
  await expect(page.locator("#turn-status")).toHaveText("Red to play");
  await autoTurn.uncheck();
  await expect(autoTurn).not.toBeChecked();
});
