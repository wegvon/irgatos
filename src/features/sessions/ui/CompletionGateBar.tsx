import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { Popover } from "../../../shared/ui/Popover";
import {
  CheckCircle,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Shield,
} from "../../../shared/ui/icons";
import {
  clearCompletionGate,
  COMPLETION_GATE_PRESETS,
  completionGateStatus,
  gateCommandLabel,
  loadProjectGate,
  loadSessionGate,
  resolveCompletionGate,
  saveSessionGate,
  stopCompletionGateRetries,
  subscribeCompletionGateStatus,
  subscribeGateConfig,
  type CompletionGateStatus,
  type ProjectGateConfig,
  type ResolvedGate,
  type SessionGateConfig,
} from "../model/completionGate";

export function useCompletionGateStatus(
  sessionId: string,
): CompletionGateStatus | undefined {
  return useSyncExternalStore(
    subscribeCompletionGateStatus,
    () => completionGateStatus(sessionId),
    () => undefined,
  );
}

type GateConfig = {
  project: ProjectGateConfig | undefined;
  session: SessionGateConfig | undefined;
  effective: ResolvedGate | null;
};

function readGateConfig(sessionId: string, cwd: string): GateConfig {
  const project = loadProjectGate(cwd);
  const session = loadSessionGate(sessionId);
  return { project, session, effective: resolveCompletionGate(project, session) };
}

export function useGateConfig(sessionId: string, cwd: string): GateConfig {
  const [config, setConfig] = useState(() => readGateConfig(sessionId, cwd));
  useEffect(() => {
    setConfig(readGateConfig(sessionId, cwd));
    return subscribeGateConfig(() => setConfig(readGateConfig(sessionId, cwd)));
  }, [cwd, sessionId]);
  return config;
}

const MENU_WIDTH = 260;

export function completionGateMenuItems(config: GateConfig): ExplorerMenuItem[] {
  const mode = config.session?.mode ?? "inherit";
  const project = config.project?.enabled
    ? `On: ${gateCommandLabel(config.project.command)}`
    : "Off";
  const command = config.effective?.command;
  return [
    {
      kind: "item",
      id: "mode:inherit",
      label: `Follow project (${project})`,
      checked: mode === "inherit",
    },
    { kind: "item", id: "mode:on", label: "On for this chat", checked: mode === "on" },
    { kind: "item", id: "mode:off", label: "Off for this chat", checked: mode === "off" },
    { kind: "sep" },
    ...COMPLETION_GATE_PRESETS.map(
      (preset): ExplorerMenuItem => ({
        kind: "item",
        id: `preset:${preset.id}`,
        label: preset.label,
        description: preset.command,
        checked: command === preset.command,
      }),
    ),
    {
      kind: "item",
      id: "custom",
      label: "Custom command…",
      checked:
        !!command &&
        !COMPLETION_GATE_PRESETS.some((preset) => preset.command === command),
    },
  ];
}

export function completionGateBadge(status: CompletionGateStatus): {
  label: string;
  tone: "busy" | "ok" | "warn" | "bad";
  title: string;
} {
  switch (status.state) {
    case "running":
      return {
        label: status.attempt > 0 ? `Checking retry ${status.attempt}…` : "Checking…",
        tone: "busy",
        title: `Running ${status.command}`,
      };
    case "verified":
      return {
        label: status.timedOut ? "Verified ✓ · timed out" : "Verified ✓",
        tone: "ok",
        title: status.timedOut
          ? `${status.command} ran past its time limit; the turn was not held back.`
          : `${status.command} passed in ${(status.durationMs / 1000).toFixed(1)}s${
              status.attempts
                ? ` after ${status.attempts} ${status.attempts === 1 ? "retry" : "retries"}`
                : ""
            }.`,
      };
    case "fixing":
      return {
        label: `Fixing ${status.attempt}/${status.max}`,
        tone: "warn",
        title: `${status.command} failed${
          status.exitCode == null ? "" : ` with exit code ${status.exitCode}`
        }; the agent is fixing it.`,
      };
    case "failed":
      return status.reason === "exhausted"
        ? {
            label: `Still failing after ${status.attempts} ${status.attempts === 1 ? "retry" : "retries"}`,
            tone: "bad",
            title: `${status.command} still fails. Retries stopped; your turn.`,
          }
        : status.reason === "stopped"
          ? {
              label: "Retries stopped",
              tone: "warn",
              title: "Automatic retries were stopped for this turn.",
            }
          : {
              label: "Check could not run",
              tone: "bad",
              title: `${status.command} could not run.`,
            };
  }
}

const TONE: Record<ReturnType<typeof completionGateBadge>["tone"], string> = {
  busy: "bg-content/8 text-content/60",
  ok: "bg-emerald-500/15 text-emerald-400",
  warn: "bg-amber-400/15 text-amber-400",
  bad: "bg-red-500/15 text-red-400",
};

/** The Completion Gate's switch and the verdict on the last turn. */
export function CompletionGateBar({
  sessionId,
  cwd,
}: {
  sessionId: string;
  /** The project folder whose gate settings apply. */
  cwd: string;
}) {
  const config = useGateConfig(sessionId, cwd);
  const status = useCompletionGateStatus(sessionId);
  const [open, setOpen] = useState<"menu" | "custom" | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = config.effective != null;
  const badge = status ? completionGateBadge(status) : null;
  const output =
    status && (status.state === "fixing" || status.state === "failed")
      ? status.output
      : "";
  const canStop =
    status?.state === "fixing" ||
    (status?.state === "running" && status.attempt > 0);

  useEffect(() => setShowOutput(false), [status?.state]);

  const save = (next: SessionGateConfig) => {
    saveSessionGate(sessionId, next);
    if (!resolveCompletionGate(config.project, next)) clearCompletionGate(sessionId);
  };
  const close = (restoreFocus = true) => {
    setOpen(null);
    if (restoreFocus) trigger.current?.focus();
  };

  return (
    <div
      data-completion-gate
      className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5 text-[11px]"
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup={open === "custom" ? "dialog" : "menu"}
        aria-expanded={open !== null}
        title={
          active
            ? `Completion Gate runs ${config.effective!.command} after each turn`
            : "Completion Gate: check the agent's work after each turn"
        }
        onClick={() => setOpen(open ? null : "menu")}
        className={`inline-flex h-5 max-w-[240px] items-center gap-1 rounded-full border px-2 leading-4 ${
          active
            ? "border-content/15 text-content/70 hover:bg-content/5 hover:text-content"
            : "border-transparent text-content/35 hover:bg-content/5 hover:text-content/70"
        }`}
      >
        <Shield className="size-3 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate">
          {active ? `Gate · ${gateCommandLabel(config.effective!.command)}` : "Gate off"}
        </span>
        <ChevronDown className="size-2.5 shrink-0 opacity-60" strokeWidth={2} />
      </button>
      {badge ? (
        <span
          role="status"
          title={badge.title}
          className={`inline-flex h-5 items-center gap-1 rounded-full px-2 font-medium ${TONE[badge.tone]}`}
        >
          {badge.tone === "busy" ? (
            <LoaderCircle className="size-3 animate-spin" strokeWidth={1.75} />
          ) : badge.tone === "ok" ? (
            <CheckCircle className="size-3" strokeWidth={1.75} />
          ) : (
            <CircleAlert className="size-3" strokeWidth={1.75} />
          )}
          {badge.label}
        </span>
      ) : null}
      {output ? (
        <button
          type="button"
          aria-expanded={showOutput}
          onClick={() => setShowOutput((value) => !value)}
          className="rounded-md px-1.5 py-0.5 text-content/50 hover:bg-content/10 hover:text-content"
        >
          {showOutput ? "Hide output" : "Show output"}
        </button>
      ) : null}
      {canStop ? (
        <button
          type="button"
          onClick={() => stopCompletionGateRetries(sessionId)}
          className="rounded-md px-1.5 py-0.5 text-content/60 hover:bg-content/10 hover:text-content"
        >
          Stop retries
        </button>
      ) : null}
      {showOutput && output ? (
        <pre className="mt-1 max-h-40 w-full overflow-auto rounded-md border border-content/10 bg-content/4 px-2 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap text-content/70">
          {output}
        </pre>
      ) : null}
      {open === "menu" && trigger.current ? (
        <ExplorerMenu
          anchor={trigger.current}
          width={MENU_WIDTH}
          ariaLabel="Completion Gate"
          header={
            <p className="px-2 py-1.5 text-[11px] text-content/45">
              After each agent turn, run a check. Failures go back to the
              agent, up to 3 times.
            </p>
          }
          items={completionGateMenuItems(config)}
          onClose={() =>
            close(Boolean(document.activeElement?.closest('[role="menu"]')))
          }
          onPick={(id) => {
            if (id === "custom") {
              setOpen("custom");
              return;
            }
            if (id.startsWith("mode:")) {
              const mode = id.slice(5) as SessionGateConfig["mode"];
              save({ mode, command: config.session?.command });
            } else if (id.startsWith("preset:")) {
              const preset = COMPLETION_GATE_PRESETS.find(
                (entry) => `preset:${entry.id}` === id,
              );
              if (preset) save({ mode: "on", command: preset.command });
            }
            close();
          }}
        />
      ) : null}
      {open === "custom" ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          width={320}
          role="dialog"
          aria-label="Custom Completion Gate command"
          onDismiss={(reason) => close(reason === "escape")}
          className="p-3"
        >
          <CustomGateCommand
            initial={config.effective?.command ?? ""}
            onCancel={() => close()}
            onSave={(command) => {
              save({ mode: "on", command });
              close();
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}

export function CustomGateCommand({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (command: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const command = value.trim();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (command) onSave(command);
      }}
    >
      <label className="block px-1 pb-2 text-[11px] text-content/45">
        Command to run in the chat's working folder
        <input
          autoFocus
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="npm run lint && npm test"
          onChange={(event) => setValue(event.target.value)}
          className="mt-1.5 block w-full rounded-md border border-content/10 bg-content/5 px-2 py-1.5 font-mono text-[12px] text-content outline-none focus:border-content/30"
        />
      </label>
      <p className="px-1 text-[11px] text-content/40">
        Exit code 0 passes. Anything else goes back to the agent.
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-stroke pt-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1.5 text-xs text-content/50 hover:bg-content/5 hover:text-content"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!command}
          className="primary-action flex shrink-0 items-center rounded-md border border-transparent px-2.5 py-1 text-[12px] disabled:cursor-default disabled:opacity-40"
        >
          Use this command
        </button>
      </div>
    </form>
  );
}
