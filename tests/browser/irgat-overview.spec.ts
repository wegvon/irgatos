import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

const shown = (page: Page, section: string, attribute: string) =>
  page.locator(`[data-overview-section="${section}"] [${attribute}]`);
const columns = (page: Page) =>
  page
    .locator("[data-overview-all] > div")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" "));

test("lands on All with ten of each kind and pages one section", async ({
  page,
}) => {
  await page.goto("/tests/browser/irgat-overview.html");
  await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(shown(page, "sessions", "data-irgat-session")).toHaveCount(10);
  await expect(shown(page, "documents", "data-irgat-document")).toHaveCount(10);
  await expect(shown(page, "habits", "data-habit")).toHaveCount(10);
  await page.locator('[data-overview-more="sessions"]').click();
  await expect(shown(page, "sessions", "data-irgat-session")).toHaveCount(20);
  await expect(shown(page, "documents", "data-irgat-document")).toHaveCount(10);
  await page.getByRole("button", { name: "View all habits" }).click();
  await expect(page.getByRole("tab", { name: "Habits" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "All" }).click();
  await expect(shown(page, "sessions", "data-irgat-session")).toHaveCount(20);
});

test("stacks sections in a narrow panel and pairs them in a wide one", async ({
  page,
}) => {
  await page.goto("/tests/browser/irgat-overview.html");
  await expect(page.locator("[data-overview-all]")).toBeVisible();
  expect(await columns(page)).toHaveLength(1);
  const separator = await page.getByRole("separator").boundingBox();
  if (!separator) throw new Error("no resize handle");
  const y = separator.y + 300;
  await page.mouse.move(separator.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(separator.x - 400, y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await columns(page)).length).toBe(2);
});

test("keeps a narrow window free of sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/irgat-overview.html");
  await expect(shown(page, "sessions", "data-irgat-session")).toHaveCount(10);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("explains a failed habits read and offers another try", async ({
  page,
}) => {
  await page.goto("/tests/browser/irgat-overview.html?seed=error");
  const alert = page.locator('[data-overview-section="habits"] [role="alert"]');
  await expect(alert).toContainText("Could not read the habits.");
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
});
