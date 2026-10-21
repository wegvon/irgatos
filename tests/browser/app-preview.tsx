import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { PREVIEW_DATA } from "./app-preview-data";
import { dismissIrgatIntro } from "../../src/features/irgats/model/irgat";

// The whole app over an IPC mock: sample data for Mail, Ideas and Feed, an
// empty value for everything else. For theme checks; add ?scheme=light
// and ?palette=sage.
const scheme = new URLSearchParams(location.search).get("scheme");
if (scheme) localStorage.setItem("irgat.colorScheme", scheme);
const palette = new URLSearchParams(location.search).get("palette");
if (palette) localStorage.setItem("irgat.palette", palette);
if (scheme === "light") document.documentElement.classList.add("theme-light");

const LISTS: Record<string, true> = { service_status_check: true };

dismissIrgatIntro();
mockWindows("main");
const seen = new Set<string>();
(window as unknown as { ipcSeen: Set<string> }).ipcSeen = seen;
mockIPC((cmd) => {
  seen.add(cmd);
  if (cmd in PREVIEW_DATA) return PREVIEW_DATA[cmd];
  if (cmd.startsWith("plugin:event|")) return 0;
  if (cmd === "plugin:path|resolve_directory") return "/Users/demo";
  if (cmd in LISTS || /^(list|get_all|load_all)|_list$|s$/.test(cmd)) return [];
  return null;
});

void import("../../src/main");
