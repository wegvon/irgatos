import { useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "../../../shared/ui/icons";
import { findModel } from "../../sessions/model/models";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { orchestrator } from "../../orchestration/model/orchestration";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import {
  CancelTaskControl,
  WorkerGuidanceButton,
  WorkerGuidanceForm,
  WorkerGuidanceLog,
  WorkerWaitLine,
  canGuide,
} from "../../orchestration/ui/WorkerControls";
import {
  teamCountsLabel,
  type FleetTeam,
  type FleetTeamMember,
} from "../model/fleet";

const solid =
  "rounded bg-content/15 px-1.5 py-0.5 text-[11px] text-content/75 hover:bg-content/25 hover:text-content disabled:opacity-35";

function tone(member: FleetTeamMember) {
  if (
    member.needsInput ||
    member.wait?.stuck ||
    ["failed", "blocked", "interrupted"].includes(member.status)
  )
    return "text-amber-400";
  if (member.status === "running") return "text-accent";
  if (member.status === "completed") return "text-emerald-400";
  return "text-content/45";
}

/**
 * A lead's workers under its Fleet card. Collapsed it is one line of counts;
 * expanded, each worker shows why it waits and can be guided or cancelled
 * without opening the lead's conversation.
 */
export function FleetTeamPanel({
  leadId,
  team,
  run,
  defaultOpen = false,
  onOpenSession,
}: {
  leadId: string;
  team: FleetTeam;
  /** The live run, for guidance and cancel; absent once it is gone. */
  run?: OrchestrationRun;
  defaultOpen?: boolean;
  onOpenSession: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [guiding, setGuiding] = useState<string>();
  const [error, setError] = useState<string>();
  const counts = teamCountsLabel(team.counts);
  const attention = team.counts.needsInput > 0 ||
    team.members.some((member) => member.wait?.stuck);
  const toggleMember = (sessionId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  const reveal = (sessionId: string) => {
    setExpanded((current) => new Set(current).add(sessionId));
    requestAnimationFrame(() =>
      document
        .querySelector(
          `[data-fleet-team="${CSS.escape(leadId)}"] [data-fleet-worker="${CSS.escape(sessionId)}"]`,
        )
        ?.scrollIntoView({ block: "nearest" }),
    );
  };
  return (
    <div
      data-fleet-team={leadId}
      className="border-t border-stroke"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Team: ${counts}`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-content/55 hover:bg-content/[0.03]"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        ) : (
          <ChevronRight className="size-3 shrink-0 opacity-60" />
        )}
        <span className="shrink-0 text-content/70">
          {team.members.length} {team.members.length === 1 ? "agent" : "agents"}
        </span>
        <span aria-hidden className="text-content/25">
          ·
        </span>
        <span
          data-fleet-team-counts=""
          className={`min-w-0 truncate tabular-nums ${attention ? "text-amber-400" : ""}`}
        >
          {counts}
        </span>
        {team.runStatus === "paused" ? (
          <span className="ml-auto shrink-0 rounded bg-amber-400/10 px-1 text-[10px] text-amber-400">
            paused
          </span>
        ) : null}
      </button>
      {open ? (
        <ul aria-label="Team" className="flex flex-col gap-px px-1.5 pb-1.5">
          {team.members.map((member) => {
            const task = run?.tasks.find((entry) => entry.id === member.taskId);
            const memberOpen =
              expanded.has(member.sessionId) || member.needsInput;
            const model = findModel(member.model)?.name ?? member.model;
            return (
              <li
                key={member.sessionId}
                data-fleet-worker={member.sessionId}
                className={`rounded-md ${memberOpen ? "bg-content/[0.04]" : ""}`}
              >
                <button
                  type="button"
                  aria-expanded={memberOpen}
                  aria-label={`Agent details: ${member.title}`}
                  onClick={() => toggleMember(member.sessionId)}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-content/[0.05]"
                >
                  <HarnessIcon
                    harness={member.harness}
                    className="size-3.5 shrink-0 opacity-75"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-content/80">
                    {member.title}
                  </span>
                  {member.activity ? (
                    <span className="hidden min-w-0 max-w-[40%] truncate text-[11px] text-content/45 sm:inline">
                      {member.activity}
                    </span>
                  ) : null}
                  <span
                    className={`flex shrink-0 items-center gap-1 text-[11px] ${tone(member)}`}
                  >
                    {tone(member) === "text-amber-400" ? (
                      <CircleAlert className="size-3" strokeWidth={1.75} />
                    ) : null}
                    {member.label}
                  </span>
                </button>
                {memberOpen ? (
                  <div className="space-y-1.5 px-1.5 pb-2 pl-7">
                    <p className="truncate text-[11px] text-content/40">
                      {model}
                    </p>
                    {member.wait ? (
                      <WorkerWaitLine reason={member.wait} onReveal={reveal} />
                    ) : null}
                    {task ? <WorkerGuidanceLog task={task} /> : null}
                    {task && guiding === task.id ? (
                      <WorkerGuidanceForm
                        leadId={leadId}
                        task={task}
                        onClose={() => setGuiding(undefined)}
                      />
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className={solid}
                        onClick={() => onOpenSession(member.sessionId)}
                      >
                        Open
                      </button>
                      {run && task && canGuide(run, task) && guiding !== task.id ? (
                        <WorkerGuidanceButton
                          open={false}
                          onToggle={() => setGuiding(task.id)}
                        />
                      ) : null}
                      {run && task && ["queued", "running"].includes(task.status) ? (
                        <CancelTaskControl
                          run={run}
                          task={task}
                          onCancel={() => {
                            setError(undefined);
                            orchestrator
                              .cancelTask(leadId, task.id)
                              .catch((reason: unknown) =>
                                setError(
                                  reason instanceof Error
                                    ? reason.message
                                    : String(reason),
                                ),
                              );
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          {error ? (
            <li role="alert" className="px-1.5 text-[11px] text-red-400">
              {error}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
