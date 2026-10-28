import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatPortRange,
  inheritedConfig,
  localConfigFromForm,
  openInAppBrowser,
  OPEN_BROWSER_URL_EVENT,
  parsePortRangeInput,
  portUrl,
  rememberSetupEvent,
  setupEventFor,
  setupSummary,
  type WorktreeSettings,
  type WorktreeSetupEvent,
} from "./worktreeEnv";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const settings = (shared: WorktreeSettings["shared"]): WorktreeSettings => ({
  shared,
  sharedPath: "/repo/.irgatos/worktree.json",
  sharedError: null,
  local: {},
  effective: {},
  defaultPortRange: [4100, 4199],
});

const event = (overrides: Partial<WorktreeSetupEvent>): WorktreeSetupEvent => ({
  path: "/repo-worktrees/a",
  command: "pnpm install --offline",
  status: "running",
  exitCode: null,
  output: "",
  logPath: null,
  port: 4123,
  startedAt: 1,
  finishedAt: null,
  ...overrides,
});

describe("port range input", () => {
  it("accepts the common separators and formats with an en dash", () => {
    expect(parsePortRangeInput("4100-4199")).toEqual({ range: [4100, 4199] });
    expect(parsePortRangeInput(" 4100 – 4199 ")).toEqual({ range: [4100, 4199] });
    expect(parsePortRangeInput("5000 5001")).toEqual({ range: [5000, 5001] });
    expect(parsePortRangeInput("4300:4300")).toEqual({ range: [4300, 4300] });
    expect(parsePortRangeInput("")).toEqual({});
    expect(formatPortRange([4100, 4199])).toBe("4100–4199");
    expect(parsePortRangeInput(formatPortRange([4100, 4199]))).toEqual({
      range: [4100, 4199],
    });
  });

  it("rejects ranges the backend would refuse", () => {
    expect(parsePortRangeInput("4199-4100").error).toMatch(/not be above/);
    expect(parsePortRangeInput("0-10").error).toMatch(/between 1 and 65535/);
    expect(parsePortRangeInput("1-70000").error).toMatch(/between 1 and 65535/);
    expect(parsePortRangeInput("1000-20000").error).toMatch(/at most 10000/);
    expect(parsePortRangeInput("http").error).toMatch(/like 4100-4199/);
  });
});

describe("local worktree overrides", () => {
  it("inherits the shared file, then the default range", () => {
    expect(inheritedConfig(settings({}))).toEqual({
      portRange: [4100, 4199],
      setup: undefined,
    });
    expect(
      inheritedConfig(settings({ portRange: [5000, 5099], setup: "npm ci" })),
    ).toEqual({ portRange: [5000, 5099], setup: "npm ci" });
  });

  it("stores only values that differ from what the clone inherits", () => {
    const inherited = { portRange: [4100, 4199] as [number, number], setup: "npm ci" };
    expect(localConfigFromForm("4100–4199", " npm ci ", inherited)).toEqual({
      config: {},
    });
    expect(localConfigFromForm("", "npm ci", inherited)).toEqual({ config: {} });
    expect(
      localConfigFromForm("4500-4599", "pnpm install --offline", inherited),
    ).toEqual({
      config: { portRange: [4500, 4599], setup: "pnpm install --offline" },
    });
  });

  it("stores the development command only when it changes", () => {
    const inherited = {
      portRange: [4100, 4199] as [number, number],
      dev: "npm run dev",
    };
    expect(localConfigFromForm("", "", inherited, " npm run dev ")).toEqual({
      config: {},
    });
    expect(localConfigFromForm("", "", inherited, "pnpm dev")).toEqual({
      config: { dev: "pnpm dev" },
    });
    expect(localConfigFromForm("", "", inherited, "")).toEqual({
      config: { dev: "" },
    });
    // Callers that do not show the field leave it alone.
    expect(localConfigFromForm("", "", inherited)).toEqual({ config: {} });
  });

  it("saves an empty setup to turn a committed command off", () => {
    expect(
      localConfigFromForm("", "  ", { portRange: [4100, 4199], setup: "npm ci" }),
    ).toEqual({ config: { setup: "" } });
    expect(localConfigFromForm("", "", { portRange: [4100, 4199] })).toEqual({
      config: {},
    });
  });

  it("reports an invalid range instead of saving", () => {
    expect(localConfigFromForm("9-1", "", {})).toEqual({
      error: "The first port must not be above the last.",
    });
  });
});

describe("setup progress", () => {
  it("keeps the newest run per worktree path", () => {
    rememberSetupEvent(event({ startedAt: 10 }));
    rememberSetupEvent(
      event({ startedAt: 10, status: "failed", exitCode: 1, output: "boom" }),
    );
    expect(setupEventFor("/repo-worktrees/a/")?.status).toBe("failed");
    // A late event from an earlier run does not replace the retry.
    rememberSetupEvent(event({ startedAt: 20 }));
    rememberSetupEvent(event({ startedAt: 10, status: "succeeded" }));
    expect(setupEventFor("/repo-worktrees/a")?.status).toBe("running");
    expect(setupEventFor("/repo-worktrees/b")).toBeUndefined();
  });

  it("summarises each status", () => {
    expect(setupSummary(event({}))).toBe("Running pnpm install --offline");
    expect(setupSummary(event({ status: "succeeded" }))).toBe(
      "Setup finished: pnpm install --offline",
    );
    expect(setupSummary(event({ status: "failed", exitCode: 2 }))).toBe(
      "Setup failed (exit 2): pnpm install --offline",
    );
    expect(setupSummary(event({ status: "failed" }))).toBe(
      "Setup failed: pnpm install --offline",
    );
  });
});

describe("opening a worktree's port", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the in-app browser for the localhost URL", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const seen: string[] = [];
    target.addEventListener(OPEN_BROWSER_URL_EVENT, (e) =>
      seen.push((e as CustomEvent<string>).detail),
    );
    openInAppBrowser(portUrl(4123));
    expect(seen).toEqual(["http://localhost:4123"]);
  });
});
