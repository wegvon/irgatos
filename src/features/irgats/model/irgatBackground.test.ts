// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { CHAT_BACKGROUND_OPACITY_DEFAULT } from "../../settings/model/appearance";
import { saveProjectChatBackgroundSettings } from "../../projects/model/projectChatBackground";
import { irgatBackgroundKey, irgatChatBackground } from "./irgatBackground";

afterEach(() => localStorage.clear());

it("always shows a Irgat's background as a dimmed Haze", () => {
  expect(irgatChatBackground("a")).toBeNull();
  saveProjectChatBackgroundSettings(irgatBackgroundKey("a"), {
    path: "/bg/irgat.png",
    emptyOpacity: 0.6,
    sessionOpacity: 0.5,
    scope: "empty",
    effect: "dither",
  });
  expect(irgatChatBackground("a")).toEqual({
    path: "/bg/irgat.png",
    emptyOpacity: CHAT_BACKGROUND_OPACITY_DEFAULT,
    sessionOpacity: CHAT_BACKGROUND_OPACITY_DEFAULT,
    scope: "all",
    effect: "gradient-blur",
  });
});
