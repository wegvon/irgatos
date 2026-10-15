import { pathKey } from "../../../shared/lib/paths";

/** Keep in sync with `SCRATCH_DIR` in `src-tauri/src/free_chat.rs`. */
export const FREE_CHAT_DIR_SUFFIX = "/.irgatos/scratch";

/**
 * A free chat is an ordinary session whose cwd is the private scratch folder,
 * so it persists, streams and asks for approval like any other.
 */
export function isFreeChatCwd(cwd: string | undefined | null): boolean {
  if (!cwd) return false;
  return pathKey(cwd).endsWith(FREE_CHAT_DIR_SUFFIX);
}
