import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAPTURE_WORKLET_NAME, CAPTURE_WORKLET_URL } from "./liveAudioEngine";
import { LIVE_ENDPOINT } from "./liveSettings";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const config = JSON.parse(readFileSync(`${ROOT}src-tauri/tauri.conf.json`, "utf8")) as {
  app: { security: { csp: string; devCsp: string } };
};

function directive(csp: string, name: string): string[] {
  const entry = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return entry ? entry.split(/\s+/).slice(1) : [];
}

describe("what a Live call needs from the app's sandbox", () => {
  it("lets both CSPs open the Gemini Live socket", () => {
    const origin = new URL(LIVE_ENDPOINT).origin;
    expect(origin).toBe("wss://generativelanguage.googleapis.com");
    for (const csp of [config.app.security.csp, config.app.security.devCsp])
      expect(directive(csp, "connect-src")).toContain(origin);
  });

  it("ships the capture worklet as a same-origin script", () => {
    const path = `${ROOT}public${CAPTURE_WORKLET_URL}`;
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(`registerProcessor("${CAPTURE_WORKLET_NAME}"`);
    for (const csp of [config.app.security.csp, config.app.security.devCsp])
      expect(directive(csp, "script-src")).toContain("'self'");
  });

  it("lets the phone page open the socket and load the worklet", () => {
    const rust = readFileSync(`${ROOT}src-tauri/src/web_access.rs`, "utf8");
    const csp = /const PAGE_CSP: &str = "([^"]+)"/.exec(rust)?.[1] ?? "";
    expect(directive(csp, "connect-src")).toContain(new URL(LIVE_ENDPOINT).origin);
    expect(rust).toContain(`"${CAPTURE_WORKLET_URL}",`);
  });
});
