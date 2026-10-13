import { keybindingPressed } from "../../settings/model/settings";

export const DICTATE_COMMAND = "Composer: Dictate";

type KeyEvent = {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** ⌘⇧E (Ctrl+Shift+E elsewhere) starts and finishes dictation. */
export function isDictateShortcut(event: KeyEvent): boolean {
  return keybindingPressed(
    DICTATE_COMMAND,
    event,
    (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.code === "KeyE",
  );
}

export const VOICE_MODE_COMMAND = "Composer: Voice Mode";

/** ⌘⇧L (Ctrl+Shift+L elsewhere) turns hands-free voice mode on and off. */
export function isVoiceModeShortcut(event: KeyEvent): boolean {
  return keybindingPressed(
    VOICE_MODE_COMMAND,
    event,
    (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.code === "KeyL",
  );
}
