// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  KEYBINDINGS,
  saveKeybindingOverride,
} from "../../settings/model/settings";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import {
  DICTATE_COMMAND,
  isDictateShortcut,
  isVoiceModeShortcut,
  VOICE_MODE_COMMAND,
} from "./voiceShortcuts";

function key(code: string, modifiers: Partial<KeyboardEventInit> = {}) {
  return {
    code,
    key: code.replace(/^Key/, "").toLowerCase(),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("isDictateShortcut", () => {
  it("matches Command or Control with Shift and E, on any layout", () => {
    expect(
      isDictateShortcut(key("KeyE", { metaKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      isDictateShortcut(key("KeyE", { ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      isDictateShortcut({
        ...key("KeyE", { metaKey: true, shiftKey: true }),
        key: "у",
      }),
    ).toBe(true);
  });

  it("leaves nearby chords alone", () => {
    expect(isDictateShortcut(key("KeyE", { metaKey: true }))).toBe(false);
    expect(
      isDictateShortcut(
        key("KeyE", { metaKey: true, shiftKey: true, altKey: true }),
      ),
    ).toBe(false);
    expect(
      isDictateShortcut(key("KeyR", { metaKey: true, shiftKey: true })),
    ).toBe(false);
  });

  it("follows a rebinding and can be turned off", () => {
    saveKeybindingOverride(DICTATE_COMMAND, {
      shortcut: "Control+Option+KeyD",
    });
    expect(
      isDictateShortcut(key("KeyE", { metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      isDictateShortcut(key("KeyD", { ctrlKey: true, altKey: true })),
    ).toBe(true);

    saveKeybindingOverride(DICTATE_COMMAND, { disabled: true });
    expect(
      isDictateShortcut(key("KeyE", { metaKey: true, shiftKey: true })),
    ).toBe(false);
  });

  it("is listed with the other keybindings", () => {
    expect(KEYBINDINGS.find((row) => row.command === DICTATE_COMMAND)).toEqual({
      command: DICTATE_COMMAND,
      keys: `${MOD}${SHIFT}E`,
      when: "Composer",
    });
  });
});

describe("isVoiceModeShortcut", () => {
  it("matches Command or Control with Shift and L, and is listed", () => {
    expect(
      isVoiceModeShortcut(key("KeyL", { metaKey: true, shiftKey: true })),
    ).toBe(true);
    expect(isVoiceModeShortcut(key("KeyL", { metaKey: true }))).toBe(false);
    expect(
      isVoiceModeShortcut(key("KeyE", { metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      KEYBINDINGS.find((row) => row.command === VOICE_MODE_COMMAND)?.keys,
    ).toBe(`${MOD}${SHIFT}L`);
  });
});
