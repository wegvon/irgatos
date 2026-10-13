import { useEffect, useState } from "react";
import { voiceStatus } from "../../../platform/tauri/voice";

let probe: Promise<boolean> | null = null;
let known: boolean | null = null;

/** Whether this build can capture audio at all; asked once per window. */
export function useVoiceSupport(): boolean {
  const [supported, setSupported] = useState(known ?? false);
  useEffect(() => {
    if (known != null) return;
    let live = true;
    probe ??= voiceStatus().then((status) => (known = status.supported));
    void probe.then((value) => {
      if (live) setSupported(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return supported;
}

export function resetVoiceSupportForTests() {
  probe = null;
  known = null;
}
