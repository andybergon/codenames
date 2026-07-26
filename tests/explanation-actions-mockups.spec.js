import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

const VARIANTS = [
  { id: "icons", actionCount: 9, visibleActionCount: 9 },
  { id: "adjacent", actionCount: 9, visibleActionCount: 9 },
  { id: "selected", actionCount: 2, visibleActionCount: 2 },
  { id: "inline", actionCount: 9, visibleActionCount: 0 },
];

test("explanation action mockups fit representative analysis states", async ({
  page,
}) => {
  for (const variant of VARIANTS) {
    await page.goto(
      `/tests/fixtures/explanation-actions.html?variant=${variant.id}`,
    );
    await expect(page.locator(".scenario")).toHaveCount(2);
    await expect(page.locator(".explain-action")).toHaveCount(
      variant.actionCount,
    );
    await expect(page.locator(".explain-action:visible")).toHaveCount(
      variant.visibleActionCount,
    );
    await expect(page.locator("#request-preview")).toHaveText(
      "No paid request made.",
    );

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const scenarios = [...document.querySelectorAll(".scenario")];
        return {
          pageFits: root.scrollWidth <= root.clientWidth + 1,
          scenariosFit: scenarios.every(
            (scenario) => scenario.scrollWidth <= scenario.clientWidth + 1,
          ),
        };
      });
      expect(
        layout.pageFits,
        `${variant.id} page overflow at ${viewport.width}px`,
      ).toBe(true);
      expect(
        layout.scenariosFit,
        `${variant.id} scenario overflow at ${viewport.width}px`,
      ).toBe(true);
    }
  }
});

test("icon actions expose paid tooltips and send only after a click", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/explanation-actions.html?variant=icons");
  const clueAction = page.getByRole("button", {
    name: "Explain why ORBIT connects SATELLITE, MOON, SPACE",
    exact: true,
  });
  await expect(clueAction).toHaveAttribute(
    "data-tooltip",
    "Generate an AI explanation, one paid request",
  );
  await expect(page.locator("#request-preview")).toHaveText(
    "No paid request made.",
  );

  await clueAction.hover();
  await expect
    .poll(() =>
      clueAction.evaluate(
        (button) => getComputedStyle(button, "::after").opacity,
      ),
    )
    .toBe("1");

  await clueAction.click();
  await expect(page.locator("#request-preview")).toHaveText(
    "Paid request preview: clue ORBIT, selected words SATELLITE, MOON, SPACE",
  );
});

test("selected-row treatment separates selection from the paid action", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/explanation-actions.html?variant=selected");
  const liveScenario = page.locator('[data-scenario="live"]');
  const knightRow = liveScenario.getByRole("button", {
    name: "Select Guess KNIGHT for CHARGE",
    exact: true,
  });
  await knightRow.click();
  await expect(knightRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#request-preview")).toHaveText(
    "No paid request made.",
  );

  const paidAction = liveScenario.getByRole("button", {
    name: "Explain selected clue CHARGE",
    exact: true,
  });
  await paidAction.click();
  await expect(page.locator("#request-preview")).toHaveText(
    "Paid request preview: clue CHARGE, selected words KNIGHT",
  );
});

test("inline selection reveals one paid action on the selected line", async ({
  page,
}) => {
  await page.goto(
    "/tests/fixtures/explanation-actions.html?variant=inline&clue=grouped",
  );
  const liveScenario = page.locator('[data-scenario="live"]');
  await expect(liveScenario.locator(".explain-action:visible")).toHaveCount(0);

  const knightSelector = liveScenario.getByRole("button", {
    name: "Select guess KNIGHT for CHARGE",
    exact: true,
  });
  await knightSelector.click();
  await expect(knightSelector).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#request-preview")).toHaveText(
    "No paid request made.",
  );

  const knightAction = liveScenario.getByRole("button", {
    name: "Explain why KNIGHT was a plausible guess for CHARGE",
    exact: true,
  });
  await expect(knightAction).toBeVisible();
  await expect(liveScenario.locator(".explain-action:visible")).toHaveCount(1);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const selectedLayout = await liveScenario
      .locator(".inline-selectable-row.is-selected")
      .evaluate((row) => {
        const action = row.querySelector(".inline-selected-explain");
        const rowBounds = row.getBoundingClientRect();
        const actionBounds = action.getBoundingClientRect();
        return {
          rowFits: row.scrollWidth <= row.clientWidth + 1,
          actionInsideRow:
            actionBounds.left >= rowBounds.left - 1 &&
            actionBounds.right <= rowBounds.right + 1 &&
            actionBounds.top >= rowBounds.top - 1 &&
            actionBounds.bottom <= rowBounds.bottom + 1,
        };
      });
    expect(
      selectedLayout.rowFits,
      `inline selected row overflow at ${viewport.width}px`,
    ).toBe(true);
    expect(
      selectedLayout.actionInsideRow,
      `inline action placement at ${viewport.width}px`,
    ).toBe(true);
  }

  await knightAction.click();
  await expect(page.locator("#request-preview")).toHaveText(
    "Paid request preview: clue CHARGE, selected words KNIGHT",
  );
});

test("inline clue treatments preserve the full paid clue payload", async ({
  page,
}) => {
  const treatments = [
    {
      id: "whole",
      selector: "Select clue ORBIT 3 with target words SATELLITE, MOON, SPACE",
      label: "Targets",
    },
    {
      id: "clue",
      selector: "Select clue ORBIT 3",
      label: "Targets",
    },
    {
      id: "grouped",
      selector: "Select clue ORBIT 3 with target words SATELLITE, MOON, SPACE",
      label: "For",
    },
  ];

  for (const treatment of treatments) {
    await page.goto(
      `/tests/fixtures/explanation-actions.html?variant=inline&clue=${treatment.id}`,
    );
    const completedScenario = page.locator('[data-scenario="completed"]');
    const clueRow = completedScenario.locator(
      `.inline-selectable-row[data-clue-treatment="${treatment.id}"]`,
    );
    await expect(clueRow.locator(".inline-targets-label")).toHaveText(
      treatment.label,
    );
    const clueSelector = completedScenario.getByRole("button", {
      name: treatment.selector,
      exact: true,
    });
    await clueSelector.click();
    await expect(clueSelector).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#request-preview")).toHaveText(
      "No paid request made.",
    );

    const clueAction = completedScenario.getByRole("button", {
      name: "Explain why ORBIT connects SATELLITE, MOON, SPACE",
      exact: true,
    });
    await expect(clueAction).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const layout = await clueRow.evaluate((row) => {
        const action = row.querySelector(".inline-selected-explain");
        const rowBounds = row.getBoundingClientRect();
        const actionBounds = action.getBoundingClientRect();
        return {
          rowFits: row.scrollWidth <= row.clientWidth + 1,
          actionInsideRow:
            actionBounds.left >= rowBounds.left - 1 &&
            actionBounds.right <= rowBounds.right + 1 &&
            actionBounds.top >= rowBounds.top - 1 &&
            actionBounds.bottom <= rowBounds.bottom + 1,
        };
      });
      expect(
        layout.rowFits,
        `${treatment.id} clue row overflow at ${viewport.width}px`,
      ).toBe(true);
      expect(
        layout.actionInsideRow,
        `${treatment.id} clue action placement at ${viewport.width}px`,
      ).toBe(true);
    }

    await clueAction.click();
    await expect(page.locator("#request-preview")).toHaveText(
      "Paid request preview: clue ORBIT, selected words SATELLITE, MOON, SPACE",
    );
  }
});
