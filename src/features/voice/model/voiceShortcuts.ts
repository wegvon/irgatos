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
