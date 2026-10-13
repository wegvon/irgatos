import type {
  GitCommitPushCommit,
  GitCommitPushError,
  GitCommitPushPlan,
  GitCommitPushPushed,
  GitCommitPushStaged,
} from "../../../platform/tauri/fs";

export type CommitPushPhase = "check" | "stage" | "commit" | "push" | "pull";

export type CommitPushApi = {
  check: (
    cwd: string,
    setUpstream: boolean,
    allowSubmodules: boolean,
  ) => Promise<GitCommitPushPlan>;
  stage: (cwd: string) => Promise<GitCommitPushStaged>;
  commit: (cwd: string, message: string) => Promise<GitCommitPushCommit>;
  push: (cwd: string, setUpstream: boolean) => Promise<GitCommitPushPushed>;
  rebase: (cwd: string) => Promise<void>;
};

export type CommitPushRequest = {
  message: string;
  setUpstream?: boolean;
  allowSubmodules?: boolean;
  /** The commit already exists; only push it. */
  pushOnly?: boolean;
  /** Rebase onto the upstream first, after a rejected push. */
  rebase?: boolean;
};

export type CommitPushOutcome =
  | {
      ok: true;
      commit: GitCommitPushCommit | null;
      pushed: GitCommitPushPushed;
    }
  | {
      ok: false;
      phase: CommitPushPhase;
      error: GitCommitPushError;
      commit: GitCommitPushCommit | null;
      request: CommitPushRequest;
    };

const KINDS = new Set<GitCommitPushError["kind"]>([
  "notRepository",
  "operationInProgress",
  "detachedHead",
  "submodules",
  "nothingToCommit",
  "noRemote",
  "noUpstream",
  "authFailed",
  "nonFastForward",
  "hookFailed",
  "rebaseConflict",
  "failed",
]);

/** The backend's tagged error, or a plain failure for anything else thrown. */
export function toCommitPushError(
  error: unknown,
  phase: CommitPushPhase,
): GitCommitPushError {
  if (
    error &&
    typeof error === "object" &&
    KINDS.has((error as { kind?: unknown }).kind as GitCommitPushError["kind"])
  ) {
    return error as GitCommitPushError;
  }
  return {
    kind: "failed",
    phase,
    detail: error instanceof Error ? error.message : String(error),
  };
}

const running = new Set<string>();

export function isCommitPushRunning(cwd: string): boolean {
  return running.has(cwd);
}

/**
 * Stage, commit and push one checkout, reporting each phase as it starts.
 * Returns null without touching Git while a run for the same checkout is in
 * flight, so a second click can never make a second commit.
 */
export async function runCommitPush(
  api: CommitPushApi,
  cwd: string,
  request: CommitPushRequest,
  onPhase: (phase: CommitPushPhase) => void,
): Promise<CommitPushOutcome | null> {
  if (running.has(cwd)) return null;
  running.add(cwd);
  let phase: CommitPushPhase = "check";
  let commit: GitCommitPushCommit | null = null;
  const enter = (next: CommitPushPhase) => {
    phase = next;
    onPhase(next);
  };
  try {
    if (request.rebase) {
      enter("pull");
      await api.rebase(cwd);
    } else if (!request.pushOnly) {
      enter("check");
      await api.check(
        cwd,
        request.setUpstream ?? false,
        request.allowSubmodules ?? false,
      );
      enter("stage");
      await api.stage(cwd);
      enter("commit");
      commit = await api.commit(cwd, request.message);
    }
    enter("push");
    const pushed = await api.push(cwd, request.setUpstream ?? false);
    return { ok: true, commit, pushed };
  } catch (error) {
    return {
      ok: false,
      phase,
      error: toCommitPushError(error, phase),
      commit,
      request,
    };
  } finally {
    running.delete(cwd);
  }
}

export type CommitPushAction = {
  label: string;
  request: CommitPushRequest;
};

export type CommitPushFailure = {
  title: string;
  body: string;
  /** Git's own output, e.g. a hook's stderr. */
  detail?: string;
  actions: CommitPushAction[];
};

/** Whether the commit exists already, so any follow-up only pushes. */
function committed(outcome: Extract<CommitPushOutcome, { ok: false }>) {
  return (
    outcome.commit !== null ||
    outcome.request.pushOnly === true ||
    outcome.request.rebase === true
  );
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** What went wrong and what the user can do about it, for one failed run. */
export function describeCommitPushFailure(
  outcome: Extract<CommitPushOutcome, { ok: false }>,
  message: string,
): CommitPushFailure {
  const { error } = outcome;
  const saved = committed(outcome);
  const local = saved ? " Your commit is saved locally." : "";
  const retry: CommitPushAction = {
    label: "Try Again",
    request: saved
      ? { message, pushOnly: true, setUpstream: outcome.request.setUpstream }
      : { ...outcome.request, message },
  };
  switch (error.kind) {
    case "notRepository":
      return {
        title: "Not a Git repository",
        body: "This folder isn’t inside a Git repository.",
        actions: [],
      };
    case "operationInProgress":
      return {
        title: `${error.operation === "am" ? "Patch apply" : error.operation} in progress`,
        body: `Finish or abort the ${error.operation === "am" ? "git am session" : error.operation} before committing. Nothing was committed.`,
        actions: [],
      };
    case "detachedHead":
      return {
        title: "Detached HEAD",
        body: `You aren’t on a branch, so there is nothing to push to. Create or switch to a branch first.${local}`,
        actions: [],
      };
    case "submodules": {
      if (error.submodules.length === 0) {
        return {
          title: "Submodule commits aren’t pushed",
          body: `Push the submodule’s commits to its own remote first, then push again.${local}`,
          detail: error.detail || undefined,
          actions: [retry],
        };
      }
      const lines = error.submodules.map((issue) => {
        const notes = [
          issue.moved ? "at a different commit than recorded" : null,
          issue.modified ? "has uncommitted changes" : null,
          issue.untracked ? "has untracked files" : null,
        ].filter(Boolean);
        return `${issue.path}: ${notes.join(", ")}`;
      });
      return {
        title:
          error.submodules.length === 1
            ? "Submodule needs attention"
            : `${error.submodules.length} submodules need attention`,
        body: "Changes inside a submodule aren’t part of this commit; only its recorded commit is. Nothing was committed.",
        detail: lines.join("\n"),
        actions: [
          {
            label: "Commit & Push Anyway",
            request: { ...outcome.request, message, allowSubmodules: true },
          },
        ],
      };
    }
    case "nothingToCommit":
      return {
        title: "Nothing to commit",
        body:
          error.ahead > 0
            ? `The working tree is clean, but ${plural(error.ahead, "commit")} haven’t been pushed.`
            : "The working tree is clean.",
        actions:
          error.ahead > 0
            ? [
                {
                  label: `Push ${plural(error.ahead, "Commit")}`,
                  request: { message, pushOnly: true },
                },
              ]
            : [],
      };
    case "noRemote":
      return {
        title: "No remote configured",
        body: `Add one with “git remote add origin <url>”, or use Commit to commit locally.${local}`,
        actions: [],
      };
    case "noUpstream":
      return {
        title: `“${error.branch}” has no upstream`,
        body: `Push it to ${error.remote}/${error.branch} and track it from now on (git push -u).${saved ? local : " Nothing was committed yet."}`,
        actions: [
          {
            label: `Push & Track ${error.remote}/${error.branch}`,
            request: saved
              ? { message, pushOnly: true, setUpstream: true }
              : { ...outcome.request, message, setUpstream: true },
          },
        ],
      };
    case "authFailed":
      return {
        title: "Authentication failed",
        body: `${error.remote} rejected the credentials. Check your SSH key, token or credential helper, then try again.${local}`,
        detail: error.detail,
        actions: [retry],
      };
    case "nonFastForward":
      return {
        title: "Push rejected: remote has new commits",
        body: `${error.remote}/${error.branch} has commits you don’t have yet. Nothing was force-pushed.${local} Pull them in, then push.`,
        detail: error.detail,
        actions: [
          {
            label: "Pull with Rebase & Push",
            request: { message, rebase: true },
          },
        ],
      };
    case "hookFailed":
      return {
        title: `${error.hook} hook failed`,
        body:
          outcome.phase === "push"
            ? `The hook stopped the push.${local} Fix what it reports, then try again.`
            : "The hook stopped the commit. Fix what it reports, then try again.",
        detail: error.detail,
        actions: [retry],
      };
    case "rebaseConflict":
      return {
        title: "Rebase hit conflicts",
        body: "It was undone, so the branch is as it was and your commit is still local. Merge or rebase by hand, then push.",
        detail: error.detail,
        actions: [],
      };
    case "failed":
      return {
        title: `${phaseLabel(outcome.phase)} failed`,
        body: saved ? "Your commit is saved locally." : "",
        detail: error.detail,
        actions: [retry],
      };
  }
}

export function phaseLabel(phase: CommitPushPhase): string {
  switch (phase) {
    case "check":
      return "Checking";
    case "stage":
      return "Staging";
    case "commit":
      return "Committing";
    case "push":
      return "Pushing";
    case "pull":
      return "Pulling";
  }
}

export function successText(
  outcome: Extract<CommitPushOutcome, { ok: true }>,
): string {
  const target = `${outcome.pushed.remote}/${outcome.pushed.branch}`;
  const tracked = outcome.pushed.setUpstream ? ", now tracked" : "";
  return outcome.commit
    ? `Committed ${outcome.commit.sha} and pushed to ${target}${tracked}`
    : `Pushed to ${target}${tracked}`;
}
