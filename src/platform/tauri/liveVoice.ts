import { invoke, isTauri } from "@tauri-apps/api/core";

export type LiveKeyEnv = "GEMINI_API_KEY" | "GOOGLE_API_KEY";

export type LiveKeyStatus = {
  /** A key saved in Settings, which wins over the environment. */
  stored: boolean;
  /** The environment variable a key was found in, from the login shell too. */
  env: LiveKeyEnv | null;
};

const NONE: LiveKeyStatus = { stored: false, env: null };

export async function liveKeyStatus(): Promise<LiveKeyStatus> {
  try {
    if (!isTauri()) return NONE;
    const status = await invoke<LiveKeyStatus>("voice_live_key_status");
    return status ?? NONE;
  } catch {
    return NONE;
  }
}

/** Stores the Gemini key in Rust; an empty key removes it. */
export function saveLiveKey(key: string): Promise<boolean> {
  return invoke<boolean>("voice_set_live_key", { key });
}

/** The key the call opens with: the saved one, else the environment's. */
export async function liveKey(): Promise<string | null> {
  if (!isTauri()) return null;
  const key = await invoke<string | null>("voice_live_key");
  return key?.trim() || null;
}
