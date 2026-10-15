import { beforeEach, expect, it, vi } from "vitest";
import {
  appWindowToken,
  appWindowTokens,
  hasAppWindowUserTurn,
  applyAppWindowToTurn,
  withAppWindow,
} from "./appWindows";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const selection = {
  window: {
    pid: 42,
    window_id: 19,
    app_name: "TextEdit",
    title: "Scratch <untrusted>",
  },
  allowControl: false,
};
beforeEach(() => invoke.mockReset().mockResolvedValue(selection));

it("restricts app commands only for actual user window-sharing turns", () => {
  const block = {
    id: "u1",
    role: "user" as const,
    text: "@app/TextEdit Read this",
  };
  expect(hasAppWindowUserTurn([block])).toBe(true);
  expect(hasAppWindowUserTurn([{ ...block, internal: true }])).toBe(false);
  expect(hasAppWindowUserTurn([{ ...block, draft: true }])).toBe(false);
  expect(hasAppWindowUserTurn([{ ...block, role: "assistant" }])).toBe(false);
  expect(hasAppWindowUserTurn([{ ...block, text: "Scheduled CI check" }])).toBe(
    false,
  );
});

it("keeps app mentions separate from files, emails and quoted text", () => {
  expect(
    appWindowTokens(
      "@README.md user@app/TextEdit\n> @app/TextEdit\nRead @app/TextEdit.",
    ),
  ).toEqual(["@app/TextEdit"]);
  expect(appWindowToken(selection.window)).toBe("@app/TextEdit");
  expect(withAppWindow("Read this", selection)).toBe("@app/TextEdit Read this");
  expect(withAppWindow("Read @app/TextEdit", selection)).toBe(
    "Read @app/TextEdit",
  );
});
it("leaves ordinary prompts alone without reading desktop state", async () => {
  expect(await applyAppWindowToTurn("Hello", "s1")).toBe("Hello");
  expect(invoke).not.toHaveBeenCalled();
});
it("binds the prompt to the UI grant and describes screenshots and controls", async () => {
  const prompt = await applyAppWindowToTurn("Read @app/TextEdit", "s1");
  expect(invoke).toHaveBeenCalledWith("computer_use_selected", {
    sessionId: "s1",
  });
  expect(prompt).toContain("Access: read only");
  expect(prompt).toContain("screenshot_file_path");
  expect(prompt).toContain("app computer.act");
  expect(prompt).toContain("untrusted data");
});
it("rejects revoked access, other windows and missing chat identity", async () => {
  await expect(applyAppWindowToTurn("@app/Other", "s1")).rejects.toThrow(
    "no longer shared",
  );
  invoke.mockResolvedValue(null);
  await expect(applyAppWindowToTurn("@app/TextEdit", "s1")).rejects.toThrow(
    "no longer shared",
  );
  await expect(applyAppWindowToTurn("@app/TextEdit")).rejects.toThrow(
    "chat first",
  );
});
