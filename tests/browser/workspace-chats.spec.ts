import { expect, test } from "@playwright/test";

test("Chats branch and Irgat conversations remain separate, with clickable answers", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/tests/browser/workspace-chats.html");
  await expect(page.getByRole("region", { name: "Chats" })).toBeVisible();
  await page
    .getByRole("button", { name: "Serbest sohbet", exact: true })
    .click();
  await expect(page.locator("[data-chat-title]")).toHaveText("Serbest sohbet");
  await page.getByRole("button", { name: /^Onna, idle/ }).click();
  await page.getByRole("button", { name: "New chat under Onna" }).click();
  await expect(page.locator("[data-chat-title]")).toHaveText("Chat 1");
  await expect(page.locator("[data-transcript]")).toBeEmpty();
  await expect(page.locator("[data-owner]")).toContainText("Onna");
  await page.getByRole("button", { name: "Karar sorusu göster" }).click();
  const form = page.locator("[data-question-form]");
  await expect(form).toContainText("Nasıl devam edelim?");
  await form.getByRole("button", { name: /Uygula ve test et/ }).click();
  await form.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator("[data-transcript]")).toContainText(
    "Uygula ve test et",
  );
  await page.getByRole("button", { name: "New chat under Onna" }).click();
  await expect(page.locator("[data-chat-title]")).toHaveText("Chat 2");
  await expect(page.locator("[data-transcript]")).toBeEmpty();
  await page.getByRole("button", { name: "Chat 1", exact: true }).click();
  await expect(page.locator("[data-transcript]")).toContainText(
    "Uygula ve test et",
  );
  await page.getByRole("button", { name: /^Onna, idle/ }).click();
  await expect(page.locator("[data-transcript]")).toHaveText(
    "Ana sohbetin geçmişi",
  );
  await page.screenshot({ path: testInfo.outputPath("workspace-chats.png") });
});

test("Irgat chats collapse, reopen and delete individually", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/workspace-chats.html");
  const irgat = page.getByRole("button", { name: /^Onna, idle/ });
  const add = page.getByRole("button", { name: "New chat under Onna" });
  await expect(irgat).toHaveAttribute("aria-expanded", "false");
  await expect(add).toHaveCount(0);
  await irgat.click();
  await add.click();
  await add.click();
  await irgat.click();
  await expect(add).toHaveCount(0);
  await irgat.click();
  await expect(
    page.getByRole("button", { name: "Chat 1", exact: true }),
  ).toBeVisible();
  const removeFirst = async () => {
    await page.getByRole("button", { name: "Chat 1", exact: true }).hover();
    await page
      .getByRole("button", { name: "Chat 1 options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Delete chat…", exact: true })
      .click();
  };
  page.once("dialog", (dialog) => dialog.dismiss());
  await removeFirst();
  await expect(
    page.getByRole("button", { name: "Chat 1", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await removeFirst();
  await expect(
    page.getByRole("button", { name: "Chat 1", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Chat 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chat 2", exact: true }).click();
  await page.getByRole("button", { name: "Chat 2", exact: true }).hover();
  await page
    .getByRole("button", { name: "Chat 2 options", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("menuitem", { name: "Delete chat…", exact: true })
    .click();
  await expect(page.locator("[data-chat-title]")).toHaveText("Onna");
  await expect(page.locator("[data-transcript]")).toHaveText(
    "Ana sohbetin geçmişi",
  );
  const projectBox = await page
    .locator("[data-projects-section]")
    .boundingBox();
  const chatsBox = await page
    .getByRole("region", { name: "Chats" })
    .boundingBox();
  expect(chatsBox!.y).toBeGreaterThan(projectBox!.y + projectBox!.height);
  await page.screenshot({
    path: testInfo.outputPath("irgat-collapse-delete.png"),
  });
});
