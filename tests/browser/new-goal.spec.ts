import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1100, height: 700 } });

type Fixture = Window & { goalSent: () => { text: string; intent?: string; workspace: string }[] };

test("suggests how to run a new goal and sets it up in one click", async ({ page }) => {
  await page.goto("/tests/browser/new-goal.html");
  await expect(page.getByText("Describe the result you want.")).toBeVisible();
  const field = page.locator("textarea");
  await field.fill("Fix the typo in the settings header");
  const hint = page.locator("[data-arrangement-hint]");
  // A small fix already runs as one agent in this folder: nothing to suggest.
  await expect(hint).toHaveCount(0);

  await field.fill("Refactor the mail sync so accounts load in parallel");
  await expect(hint).toHaveAttribute("data-arrangement-hint", "plan");
  await expect(hint).toContainText("Plan first · own worktree");
  await hint.getByRole("button", { name: "Use" }).click();
  await expect(hint).toHaveCount(0);
  await field.press("Enter");
  const sent = await page.evaluate(() => (window as unknown as Fixture).goalSent());
  expect(sent).toEqual([
    { text: "Refactor the mail sync so accounts load in parallel", intent: "plan", workspace: "worktree" },
  ]);
});
