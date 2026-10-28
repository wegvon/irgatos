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
  await expect(needs).toContainText("Publish or deploy");
  await expect(needs).toContainText("Hard to undo: it is already out");
  await expect(needs).toContainText("Next I'll publish 2.4 to npm under the next tag");
  await expect(needs).not.toContainText("npm publish --access public --tag next");
  await needs.getByRole("button", { name: "Technical details" }).click();
  await expect(needs).toContainText("npm publish --access public --tag next");
  await expect(needs).toContainText("Your decision");
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
  await expect(attention).toContainText("Publish or deploy");
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

test("reviews a delivered goal without reading code", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html?mode=goals");
  const review = page.locator('[data-goal-section="review"]');
  await review.getByRole("button", { name: "Review", exact: true }).click();
  const detail = review.locator("[data-goal-detail]");
  await expect(detail).toContainText("Delivered");
  await expect(detail.locator("[data-goal-checks]")).toContainText("pnpm vitest run limiter");
  await expect(detail.locator("[data-goal-previews]")).toContainText("localhost:4000/limits");
  await expect(detail.locator("[data-goal-limitations]")).toContainText("stay blocked");
  await expect(detail).toContainText("2 files changed");
});

test("keeps one progress summary across a coordinated goal's agents", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html?mode=goals");
  const card = page.locator("[data-goal]", { hasText: "Publish the 2.4 SDK" });
  await expect(card).toContainText("1 done · 2 left");
  await page.getByRole("button", { name: "Expand Publish the 2.4 SDK" }).click();
  const progress = card.locator("[data-goal-progress]");
  await expect(progress).toContainText("Draft the 2.4 release notes");
  await expect(progress).toContainText("Bump package versions");
  await expect(progress).toContainText("Waiting on earlier tasks");
  await expect(card).toContainText("1 decision waiting on you");
});

test("explains an interrupted goal and resumes it in one click", async ({ page }) => {
  await page.goto("/tests/browser/fleet.html?mode=goals");
  const card = page.locator("[data-goal]", { hasText: "Migrate the billing schema" });
  const recovery = card.locator('[data-goal-recovery="interrupted"]');
  await expect(recovery).toContainText("Stopped before it finished");
  await expect(recovery).toContainText("1 of 3 steps: Write the migration");
  await expect(recovery).toContainText("The file changes, on billing-v2");
  await expect(recovery).toContainText("Backfill old invoices");
  await recovery.getByRole("button", { name: "Resume" }).click();
  expect(await events(page)).toEqual(["resume:migrate:interrupted"]);
});
