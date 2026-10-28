import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

type Fixture = Window & { fleetEvents: () => string[] };

const events = (page: Page) =>
  page.evaluate(() => (window as unknown as Fixture).fleetEvents());

const bucket = (page: Page, name: string) => page.locator(`[data-fleet-bucket="${name}"]`);

test("approves and answers waiting agents without leaving the fleet", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html");
  const needs = bucket(page, "needsYou");
  await expect(needs.locator("[data-fleet-session]")).toHaveCount(2);
  await expect(page.locator("[data-fleet-needs-you]")).toHaveText("2");
  await expect(needs).toContainText("npm publish --access public --tag next");
  await expect(bucket(page, "review")).toContainText("2 files changed");
  await expect(bucket(page, "running")).toContainText("Restyle the marketing header");

  await needs.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("[data-fleet-needs-you]")).toHaveText("1");

  await needs.getByRole("button", { name: /In-memory LRU/ }).click();
  await needs.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("[data-fleet-needs-you]")).toHaveCount(0);
  await expect(needs).toContainText("No agent is waiting on you.");

  await bucket(page, "review").getByRole("button", { name: "Open Fix the rate limiter reset" }).click();
  expect(await events(page)).toEqual([
    "allow:publish:1",
    expect.stringMatching(/^answer:cache:2:.*"store":\["lru"\]/),
    "open:limiter",
  ]);
});

test("keeps idle sessions folded until asked", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html");
  const idle = bucket(page, "idle");
  await expect(idle.locator("[data-fleet-session]")).toHaveCount(0);
  await idle.getByRole("button", { name: /Idle/ }).click();
  await expect(idle).toContainText("Explain the deploy script");
});

test("explains an empty fleet", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html?state=empty");
  await expect(page.getByText("No agents yet")).toBeVisible();
});

test("groups work under goals and answers a goal's decision in place", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html?mode=goals");
  const attention = page.locator('[data-goal-section="attention"]');
  await expect(attention).toContainText("npm publish --access public --tag next");
  await expect(
    attention.locator("[data-goal]", { hasText: "Publish the 2.4 SDK" }),
  ).toContainText("1 chat · 1 agent");
  await attention.getByRole("button", { name: "Allow" }).first().click();
  await expect(page.locator('[data-goal-section="working"]')).toContainText("Publish the 2.4 SDK");
  await page.getByRole("button", { name: "Expand Publish the 2.4 SDK" }).click();
  const detail = page.locator("[data-goal-detail]");
  await expect(detail).toContainText("Draft the 2.4 release notes");
  await expect(detail).toContainText("worker");
});
