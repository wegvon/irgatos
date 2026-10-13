import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

type Fixture = Window & {
  kanbanState: () => { title: string; cards: string[] }[];
};

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as Fixture).kanbanState());

const shownCards = (page: Page, columnId: string) =>
  page
    .locator(`[data-kanban-column="${columnId}"] [data-kanban-card]`)
    .evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.kanbanCard));

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing at ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "Linux x86_64" });
  });
});

test("drags a card into another column between two cards", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html");
  await expect(page.locator("[data-kanban-card]")).toHaveCount(9);
  const from = await center(page, '[data-kanban-card="card-0"]');
  const second = await center(page, '[data-kanban-card="card-5"]');
  await drag(page, from, { x: second.x, y: second.box.y + 4 });
  await expect.poll(() => shownCards(page, "col-1")).toEqual(["card-4", "card-0", "card-5"]);
  await expect.poll(async () => (await state(page))[1]!.cards).toEqual([
    "card-4",
    "card-0",
    "card-5",
  ]);
  await expect(page.locator("[data-kanban-placeholder]")).toHaveCount(0);
});

test("drops into an empty spot at the end of a column", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html");
  const from = await center(page, '[data-kanban-card="card-1"]');
  const column = await center(page, '[data-kanban-column="col-3"]');
  await drag(page, from, { x: column.x, y: column.box.y + column.box.height - 10 });
  await expect.poll(async () => (await state(page))[3]!.cards).toEqual([
    "card-7",
    "card-8",
    "card-1",
  ]);
});

test("a click opens the card instead of dragging it", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html");
  await page.locator('[data-kanban-card="card-2"]').click();
  await expect(page.locator("[data-kanban-card-dialog]")).toBeVisible();
  await expect(page.getByLabel("Card title")).toHaveValue(/Show token usage/);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-kanban-card-dialog]")).toHaveCount(0);
});

test("reorders columns by dragging the header", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html");
  const from = await center(page, '[data-kanban-column="col-0"] header h3');
  const to = await center(page, '[data-kanban-column="col-2"] header');
  await drag(page, from, { x: to.x + 40, y: to.y });
  await expect
    .poll(async () => (await state(page)).map((column) => column.title))
    .toEqual(["In progress", "Review", "Backlog", "Done"]);
});

test("moves a column to the far end", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html");
  const from = await center(page, '[data-kanban-column="col-1"] header h3');
  const last = await center(page, '[data-kanban-column="col-3"]');
  await drag(page, from, { x: last.box.x + last.box.width - 8, y: from.y });
  await expect
    .poll(async () => (await state(page)).map((column) => column.title))
    .toEqual(["Backlog", "Review", "Done", "In progress"]);
});

test("a board with many cards scrolls inside each column", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html?seed=many");
  await expect(page.locator("[data-kanban-column]")).toHaveCount(6);
  const list = page.locator('[data-kanban-column="col-0"] [data-kanban-list]');
  const overflow = await list.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(overflow).toBe(true);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(documentHeight).toBeLessThanOrEqual(800);
});

test("shows linked session state and links a session from the card", async ({ page }) => {
  await page.goto("/tests/browser/kanban.html");
  const chipState = (cardId: string) =>
    page.locator(`[data-kanban-card="${cardId}"] [data-card-session-state]`);
  await expect(chipState("card-0")).toHaveAttribute("data-card-session-state", "finished");
  await expect(chipState("card-2")).toHaveAttribute("data-card-session-state", "failed");
  await expect(chipState("card-5")).toHaveAttribute("data-card-session-state", "running");
  await expect(chipState("card-6")).toHaveAttribute("data-card-session-state", "needs-input");

  await chipState("card-2").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { kanbanSessionEvents: () => string[] }).kanbanSessionEvents()))
    .toEqual(["open:s-usage"]);
  await expect(page.locator("[data-card-session]")).toHaveCount(0);

  await page.locator('[data-kanban-card="card-1"]').click();
  const section = page.locator("[data-card-session]");
  await expect(section).toContainText("Start an agent on this card");
  await section.getByRole("button", { name: /^Link existing session/ }).click();
  await page.getByRole("option", { name: /Copy button for note code blocks/ }).click();
  await expect(section).toContainText("Copy button for note code blocks");
  await expect(chipState("card-1")).toHaveAttribute("data-card-session-state", "finished");
});
