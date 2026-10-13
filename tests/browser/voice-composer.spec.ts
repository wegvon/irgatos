import { expect, test, type Page } from "@playwright/test";

const SENTENCE = "Refactor the session store so drafts survive a reload";

async function speakLevels(page: Page, levels: number[]) {
  for (const level of levels) {
    await page.evaluate((value) => window.voice.level(value), level);
    await page.waitForTimeout(50);
  }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
});

test("dictation streams words into the composer and leaves them editable", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/voice-composer.html");
  const mic = page.getByRole("button", { name: "Dictate" });
  await expect(mic).toBeVisible();
  await page.locator("textarea").focus();
  await page.screenshot({ path: testInfo.outputPath("composer-idle.png") });

  await mic.click();
  const strip = page.locator("[data-dictation-strip]");
  await expect(strip).toContainText("Listening");
  await expect(strip).toContainText("On this Mac");

  const words = SENTENCE.split(" ");
  for (let count = 1; count <= words.length; count += 1) {
    await page.evaluate(
      (text) => window.voice.partial(text),
      words.slice(0, count).join(" "),
    );
    await speakLevels(page, [0.35, 0.62, 0.8, 0.55]);
  }
  await expect(page.locator("textarea")).toHaveValue(SENTENCE);
  await page.waitForTimeout(1100);
  await speakLevels(page, [0.4, 0.7, 0.9, 0.65, 0.5, 0.75, 0.6, 0.45]);
  await page.screenshot({ path: testInfo.outputPath("dictation-live.png") });

  await page.keyboard.press("Meta+Shift+E");
  await expect(strip).toContainText("Transcribing");
  await expect(strip).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveValue(SENTENCE);
  await expect(page.locator("textarea")).toBeFocused();
  await page.keyboard.type(" and add a test.");
  await expect(page.locator("textarea")).toHaveValue(
    `${SENTENCE} and add a test.`,
  );
  await page.screenshot({ path: testInfo.outputPath("dictation-final.png") });
});

test("a refused permission explains itself and links to System Settings", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/voice-composer.html");
  await page.evaluate(() => {
    window.voice.status = { ...window.voice.status, speech: "denied" };
  });
  await page.getByRole("button", { name: "Dictate" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Speech recognition is off for Irgatos.");
  await expect(
    alert.getByRole("button", { name: "Open System Settings" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("dictation-permission.png"),
  });
});

test("voice mode sends after a pause and reads the reply aloud", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/voice-composer.html");
  await page.getByRole("button", { name: "Voice mode" }).click();
  const strip = page.locator("[data-voice-mode-strip]");
  await expect(strip).toHaveAttribute("data-phase", "listening");

  await page.evaluate(() => window.voice.partial("What changed in the last"));
  await speakLevels(page, [0.5, 0.8, 0.7, 0.6, 0.85, 0.5]);
  await expect(strip).toContainText("Sends after a 1.2 s pause");
  await page.screenshot({
    path: testInfo.outputPath("voice-mode-listening.png"),
  });

  await page.evaluate(() => window.voice.partial("What changed in the last commit"));
  await expect(page.locator("[data-sent]")).toHaveText(
    "What changed in the last commit",
    { timeout: 4000 },
  );
  await expect(strip).toHaveAttribute("data-phase", "waiting");
  await page.screenshot({ path: testInfo.outputPath("voice-mode-waiting.png") });

  await page.evaluate(() =>
    window.voice.reply(
      "The last commit adds **voice dictation** to the composer. It touches `Composer.tsx` and the new `voice` module.",
    ),
  );
  await expect(strip).toHaveAttribute("data-phase", "speaking");
  expect(await page.evaluate(() => window.voice.calls)).toContain(
    "voice_speak",
  );
  await page.screenshot({
    path: testInfo.outputPath("voice-mode-speaking.png"),
  });

  await page.keyboard.press("Escape");
  await expect(strip).toHaveAttribute("data-phase", "listening");
  await page.getByRole("button", { name: "End voice mode" }).first().click();
  await expect(strip).toHaveCount(0);
});

test("the Voice settings page lays out every option", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 1500 });
  await page.goto("/tests/browser/voice-composer.html?view=settings");
  await expect(page.getByText("Pause before sending")).toBeVisible();
  await expect(page.getByText("Transcription engine")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("voice-settings.png"),
    fullPage: true,
  });
});
