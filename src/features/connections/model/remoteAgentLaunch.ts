import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import { resolveModel } from "../../sessions/model/models";
import { DEFAULT_RUNTIME_MODE } from "../../sessions/model/session";
import { withStandingPrompt } from "../../sessions/model/standingPrompt";
import { remoteMachineFor, remoteRequest } from "./connections";
import { isRemoteProvider, type CommandReceipt } from "./protocol";
import { parseRemotePath, remoteProjectFor } from "./remoteProjects";

/**
 * Starts an agent-requested session (`app sessions.start`) in a project on
 * another machine: the host creates and runs it, as for a message typed in a
 * remote tab. Command IDs derive from the request ID, so a retry with the same
 * `--request-id` returns the host's earlier receipts instead of starting again.
 */
export async function launchRemoteSession(
  launch: QuickLaunch,
  requestId: string,
): Promise<{ machineId: string; sessionId: string }> {
  const remote = remoteProjectFor(launch.cwd);
  if (!remote)
    throw new Error(
      "This remote project is not open on this computer; open it from the project rail first",
    );
  const machine = await remoteMachineFor(remote.environmentId);
  if (!machine)
    throw new Error(
      "The machine for this project is not connected; reconnect it in Settings > Connections",
    );
  if (!isRemoteProvider(launch.harness))
    throw new Error(`${launch.harness} cannot run on another machine`);
  if (launch.draft)
    throw new Error("Drafts are not available in projects on another machine");
  if (launch.attachments?.length)
    throw new Error(
      "Attachments are not available for sessions started on another machine",
    );
  const worktree = launch.worktreeCwd
    ? (parseRemotePath(launch.worktreeCwd)?.hostPath ?? launch.worktreeCwd)
    : undefined;
  const created = await remoteRequest<CommandReceipt>(
    machine.id,
    "commands.dispatch",
    {
      type: "create",
      commandId: `${requestId}:create`,
      projectId: remote.projectId,
      ...(worktree && worktree !== remote.cwd ? { worktreeCwd: worktree } : {}),
      harness: launch.harness,
      model: resolveModel(launch.harness, launch.model).id,
      ...(launch.modelSettings ? { modelSettings: launch.modelSettings } : {}),
      runtimeMode: launch.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    },
  );
  await remoteRequest<CommandReceipt>(machine.id, "commands.dispatch", {
    type: "send",
    commandId: `${requestId}:send`,
    sessionId: created.sessionId,
    text: launch.prompt,
    ...(launch.intent === "plan" ? { intent: "plan" } : {}),
    ...withStandingPrompt(),
  });
  return { machineId: machine.id, sessionId: created.sessionId };
}
