import { describe, expect, it, vi } from "vitest";
import type { GitCommitPushError } from "../../../platform/tauri/fs";
import {
  describeCommitPushFailure,
  runCommitPush,
  successText,
  toCommitPushError,
  type CommitPushApi,
  type CommitPushOutcome,
  type CommitPushPhase,
} from "./commitPush";

const commit = { sha: "abc1234", message: "Update a.ts", paths: ["a.ts"] };
const pushed = { remote: "origin", branch: "main", setUpstream: false };

function fakeApi(overrides: Partial<CommitPushApi> = {}): CommitPushApi {
  return {
    check: vi.fn(async () => ({
      branch: "main",
      remote: "origin",
      upstream: "origin/main",
      stageAll: true,
    })),
    stage: vi.fn(async () => ({ paths: ["a.ts"], stagedAll: true })),
    commit: vi.fn(async () => commit),
    push: vi.fn(async () => pushed),
    rebase: vi.fn(async () => {}),
    ...overrides,
  };
}

async function run(
  api: CommitPushApi,
  request: Parameters<typeof runCommitPush>[2] = { message: "" },
) {
  const phases: CommitPushPhase[] = [];
  const outcome = await runCommitPush(api, "/repo", request, (phase) =>
    phases.push(phase),
  );
  return { outcome, phases };
}

function failure(outcome: CommitPushOutcome | null) {
  if (!outcome || outcome.ok) throw new Error("expected a failed run");
  return outcome;
}

const rejecting = (error: GitCommitPushError) => async () => {
  throw error;
};

describe("runCommitPush", () => {
  it("reports every phase in order and pushes the new commit", async () => {
    const api = fakeApi();
    const { outcome, phases } = await run(api, { message: "Ship it" });
    expect(phases).toEqual(["check", "stage", "commit", "push"]);
    expect(api.commit).toHaveBeenCalledWith("/repo", "Ship it");
    expect(api.push).toHaveBeenCalledWith("/repo", false);
    expect(outcome).toEqual({ ok: true, commit, pushed });
    expect(successText(outcome as never)).toBe(
      "Committed abc1234 and pushed to origin/main",
    );
  });

  it("ignores a second click while the first run is in flight", async () => {
    let release!: () => void;
    const api = fakeApi({
      commit: vi
        .fn<CommitPushApi["commit"]>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(commit);
            }),
        )
        .mockResolvedValue(commit),
    });
    const first = run(api);
    await vi.waitFor(() => expect(api.commit).toHaveBeenCalled());
    expect((await run(api)).outcome).toBeNull();
    release();
    expect((await first).outcome?.ok).toBe(true);
    expect(api.commit).toHaveBeenCalledTimes(1);
    expect((await run(api)).outcome?.ok).toBe(true);
  });

  it("stops before committing when the branch has no upstream, then sets it with -u", async () => {
    const noUpstream = { kind: "noUpstream", remote: "origin", branch: "feature" } as const;
    const api = fakeApi({ check: vi.fn(rejecting(noUpstream)) });
    const failed = failure((await run(api, { message: "Feature" })).outcome);
    expect(failed.phase).toBe("check");
    expect(api.stage).not.toHaveBeenCalled();
    expect(api.commit).not.toHaveBeenCalled();

    const described = describeCommitPushFailure(failed, "Feature");
    expect(described.title).toBe("“feature” has no upstream");
    expect(described.actions).toEqual([
      {
        label: "Push & Track origin/feature",
        request: { message: "Feature", setUpstream: true },
      },
    ]);

    const retry = fakeApi();
    await run(retry, described.actions[0].request);
    expect(retry.check).toHaveBeenCalledWith("/repo", true, false);
    expect(retry.push).toHaveBeenCalledWith("/repo", true);
  });

  it("keeps the commit after a rejected push and offers a rebase, never a force push", async () => {
    const rejected = {
      kind: "nonFastForward",
      remote: "origin",
      branch: "main",
      detail: " ! [rejected] main -> main (fetch first)",
    } as const;
    const api = fakeApi({ push: vi.fn(rejecting(rejected)) });
    const failed = failure((await run(api)).outcome);
    expect(failed.phase).toBe("push");
    expect(failed.commit).toEqual(commit);

    const described = describeCommitPushFailure(failed, "");
    expect(described.body).toContain("Nothing was force-pushed");
    expect(described.body).toContain("saved locally");
    expect(described.detail).toBe(rejected.detail);
    expect(described.actions.map((action) => action.request)).toEqual([
      { message: "", rebase: true },
    ]);

    const recover = fakeApi();
    const { outcome, phases } = await run(recover, described.actions[0].request);
    expect(phases).toEqual(["pull", "push"]);
    expect(recover.commit).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, commit: null, pushed });
  });

  it("surfaces a failing pre-commit hook's stderr and retries the whole run", async () => {
    const hook = {
      kind: "hookFailed",
      hook: "pre-commit",
      detail: "eslint: 2 problems in src/a.ts",
    } as const;
    const api = fakeApi({ commit: vi.fn(rejecting(hook)) });
    const failed = failure((await run(api, { message: "WIP" })).outcome);
    const described = describeCommitPushFailure(failed, "WIP");
    expect(described.title).toBe("pre-commit hook failed");
    expect(described.detail).toBe("eslint: 2 problems in src/a.ts");
    expect(described.actions[0].request).toEqual({ message: "WIP" });
  });

  it("retries only the push after a failing pre-push hook", async () => {
    const hook = { kind: "hookFailed", hook: "pre-push", detail: "tests failed" } as const;
    const api = fakeApi({ push: vi.fn(rejecting(hook)) });
    const failed = failure((await run(api)).outcome);
    const described = describeCommitPushFailure(failed, "");
    expect(described.body).toContain("stopped the push");
    expect(described.actions[0].request).toMatchObject({ pushOnly: true });
  });

  it("offers to push existing commits when there is nothing to commit", async () => {
    const api = fakeApi({
      check: vi.fn(rejecting({ kind: "nothingToCommit", ahead: 2 })),
    });
    const described = describeCommitPushFailure(
      failure((await run(api)).outcome),
      "",
    );
    expect(described.title).toBe("Nothing to commit");
    expect(described.actions).toEqual([
      { label: "Push 2 Commits", request: { message: "", pushOnly: true } },
    ]);
  });

  it("wraps anything else thrown as a failure of the current phase", async () => {
    const api = fakeApi({
      stage: vi.fn(async () => {
        throw new Error("This isn’t available for projects on another machine yet.");
      }),
    });
    const failed = failure((await run(api)).outcome);
    expect(failed.error).toEqual({
      kind: "failed",
      phase: "stage",
      detail: "This isn’t available for projects on another machine yet.",
    });
    expect(toCommitPushError("boom", "push")).toEqual({
      kind: "failed",
      phase: "push",
      detail: "boom",
    });
  });
});

describe("describeCommitPushFailure", () => {
  const errors: GitCommitPushError[] = [
    { kind: "notRepository" },
    { kind: "operationInProgress", operation: "merge" },
    { kind: "operationInProgress", operation: "rebase" },
    { kind: "operationInProgress", operation: "cherry-pick" },
    { kind: "detachedHead" },
    {
      kind: "submodules",
      submodules: [{ path: "lib", moved: true, modified: true, untracked: false }],
      detail: "",
    },
    { kind: "nothingToCommit", ahead: 0 },
    { kind: "noRemote" },
    { kind: "noUpstream", remote: "origin", branch: "feature" },
    { kind: "authFailed", remote: "origin", detail: "Authentication failed" },
    { kind: "nonFastForward", remote: "origin", branch: "main", detail: "rejected" },
    { kind: "hookFailed", hook: "pre-commit", detail: "lint" },
    { kind: "rebaseConflict", detail: "CONFLICT (content)" },
    { kind: "failed", phase: "push", detail: "unable to connect" },
  ];

  it("gives every case its own title", () => {
    const titles = errors.map(
      (error) =>
        describeCommitPushFailure(
          { ok: false, phase: "check", error, commit: null, request: { message: "" } },
          "",
        ).title,
    );
    expect(new Set(titles).size).toBe(errors.length);
  });

  it("lists dirty submodules and lets the user continue deliberately", () => {
    const described = describeCommitPushFailure(
      {
        ok: false,
        phase: "check",
        error: errors[5],
        commit: null,
        request: { message: "Bump" },
      },
      "Bump",
    );
    expect(described.detail).toBe(
      "lib: at a different commit than recorded, has uncommitted changes",
    );
    expect(described.actions[0].request).toEqual({
      message: "Bump",
      allowSubmodules: true,
    });
  });
});
