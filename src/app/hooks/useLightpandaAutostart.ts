import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import {
  loadSidecarAutostart,
  loadSidecarPort,
} from "../../features/settings/model/lightpanda";

/** Starting is idempotent, so every window may ask. */
export async function startLightpandaIfEnabled() {
  if (!loadSidecarAutostart()) return false;
  try {
    await invoke("lightpanda_sidecar_start", { port: loadSidecarPort() });
    return true;
  } catch {
    // Not installed or the port is taken; Settings shows why on demand.
    return false;
  }
}

export function useLightpandaAutostart() {
  useEffect(() => {
    void startLightpandaIfEnabled();
  }, []);
}
