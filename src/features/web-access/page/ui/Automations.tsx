import { useState, type ReactNode } from "react";
import type { AutomationRunStatus } from "../../../automations/model/automations";
import type {
  WebAutomation,
  WebAutomationRun,
  WebAutomations,
} from "../../model/protocol";
import { read, usePoll, write } from "../client";
import { ago, duration } from "../format";
import { navigate, openSheet } from "../route";
import {
  Empty,
  Group,
  Harness,
  Pill,
  SectionTitle,
  Spinner,
  primaryButton,
  useAction,
  type Tone,
} from "./parts";
import {
  ChevronRight,
  Clock,
  Play,
  Zap,
} from "../../../../shared/ui/icons";

const RUN_LABEL: Record<AutomationRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const RUN_TONE: Record<AutomationRunStatus, Tone> = {
  pending: "accent",
  running: "accent",
  succeeded: "emerald",
  failed: "rose",
  skipped: "amber",
  cancelled: "muted",
};

/** "in 2h", "in 5m": when the next scheduled run is due. */
function until(at: number, now: number): string {
  const left = at - now;
  if (left <= 60_000) return "soon";
  const label = ago(now - left, now);
  return `in ${label}`;
}

/** An iOS-style switch. */
export function Switch({
  on,
  label,
  disabled = false,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!on);
      }}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${
        on ? "bg-(--tone-emerald)" : "bg-content/15"
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-[2px] top-[2px] size-[27px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25)] transition-transform duration-200 ${
          on ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

function RunPill({ status }: { status: AutomationRunStatus }) {
  return (
    <Pill tone={RUN_TONE[status]} live={status === "running"}>
      {RUN_LABEL[status]}
    </Pill>
  );
}

function useAutomations(fast: boolean) {
  return usePoll(
    "automations",
    () => read<WebAutomations>("automations"),
    () => (fast ? 5000 : 20_000),
  );
}

/** Turning one on or off shows at once; the Mac's answer replaces it. */
function useToggle(mutate: ReturnType<typeof useAutomations>["mutate"]) {
  const { busy, run } = useAction();
  const toggle = (automation: WebAutomation, enabled: boolean) => {
    mutate((data) => ({
      automations: data.automations.map((entry) =>
        entry.id === automation.id ? { ...entry, enabled } : entry,
      ),
    }));
    void run(
      `toggle:${automation.id}`,
      () => write("automationEnabled", { id: automation.id, enabled }),
      enabled ? "Turned on" : "Turned off",
    );
  };
  return { busy, toggle };
}

/** The Mac's automations: when each runs, how it last went, on or off. */
export function Automations({
  header,
  wide,
  now,
}: {
  header: ReactNode;
  wide: boolean;
  now: number;
}) {
  const { data, mutate } = useAutomations(true);
  const { busy, toggle } = useToggle(mutate);
  const automations = data?.automations;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[760px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
          Automations
        </h1>
      </header>
      {!automations ? (
        <div className="flex justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : !automations.length ? (
        <div className="glass rounded-[28px]">
          <Empty
            icon={
              <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                <Zap className="size-8" />
              </span>
            }
            title="No automations yet"
          >
            Create one in Automations on your Mac, then run or pause it from
            here.
          </Empty>
        </div>
      ) : (
        <Group>
          {automations.map((automation) => (
            <div
              key={automation.id}
              role="button"
              tabIndex={0}
              onClick={() => openSheet({ name: "automation", id: automation.id })}
              className="web-press flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-content/6 ${automation.enabled ? "text-(--ink-2)" : "text-(--ink-3)"}`}
              >
                <Zap className="size-5" />
              </span>
              <span
                className={`min-w-0 flex-1 ${automation.enabled ? "" : "opacity-60"}`}
              >
                <span className="block truncate text-[16px] font-semibold text-(--ink)">
                  {automation.name}
                </span>
                <span className="block truncate text-[13px] text-(--ink-2)">
                  {[automation.trigger, automation.place]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[12.5px] text-(--ink-3)">
                  {automation.lastRunStatus ? (
                    <RunPill status={automation.lastRunStatus} />
                  ) : null}
                  {automation.nextRunAt ? (
                    <span className="truncate">
                      Next {until(automation.nextRunAt, now)}
                    </span>
                  ) : automation.lastRunAt ? (
                    <span className="truncate">
                      Ran {ago(automation.lastRunAt, now)} ago
                    </span>
                  ) : null}
                </span>
              </span>
              <Switch
                on={automation.enabled}
                label={`${automation.name} on`}
                disabled={busy === `toggle:${automation.id}`}
                onChange={(on) => toggle(automation, on)}
              />
            </div>
          ))}
        </Group>
      )}
    </div>
  );
}

/** One automation: what it does, Run now, and its recent runs. */
export function AutomationDetail({
  id,
  now,
  onClose,
}: {
  id: string;
  now: number;
  onClose: () => void;
}) {
  const automations = useAutomations(false);
  const { busy: toggling, toggle } = useToggle(automations.mutate);
  const runs = usePoll(
    `automationRuns:${id}`,
    () => read<WebAutomationRun[]>("automationRuns", { id }),
    (list) =>
      list?.some((run) => run.status === "running" || run.status === "pending")
        ? 3000
        : 15_000,
  );
  const { busy, run } = useAction();
  const [full, setFull] = useState(false);
  const automation = automations.data?.automations.find(
    (entry) => entry.id === id,
  );

  if (!automations.data)
    return (
      <div className="flex justify-center py-16 text-(--ink-3)">
        <Spinner className="size-6" />
      </div>
    );
  if (!automation)
    return (
      <Empty title="This automation is gone">
        It was deleted on your Mac.
      </Empty>
    );

  const openChat = (sessionId: string) => {
    onClose();
    window.setTimeout(() => navigate({ name: "chat", id: sessionId }), 60);
  };
  const runNow = () =>
    void run(
      "run",
      async () => {
        await write("automationRun", { id });
        runs.reload();
      },
      "Started on your Mac",
    );

  return (
    <div className="flex flex-col gap-5 px-5 pb-6">
      <h3 className="-mt-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-(--ink)">
        {automation.name}
      </h3>
      <div className="-mt-2 flex items-center gap-3">
        <Harness harness={automation.harness} className="size-4" />
        <span className="min-w-0 flex-1 truncate text-[14px] text-(--ink-2)">
          {[automation.modelName, automation.place].join(" · ")}
        </span>
        <Switch
          on={automation.enabled}
          label="Automation on"
          disabled={toggling !== null}
          onChange={(on) => toggle(automation, on)}
        />
      </div>
      <div className="glass flex flex-col gap-2 rounded-[22px] px-4 py-3.5">
        <span className="flex items-center gap-2 text-[14px] font-medium text-(--ink)">
          <Clock className="size-4 text-(--ink-3)" />
          {automation.trigger}
          {automation.nextRunAt ? (
            <span className="ml-auto text-[13px] font-normal text-(--ink-2)">
              Next {until(automation.nextRunAt, now)}
            </span>
          ) : null}
        </span>
        <button
          onClick={() => setFull((value) => !value)}
          className={`whitespace-pre-wrap break-words text-left text-[15px] leading-snug text-(--ink-2) ${full ? "" : "line-clamp-4"}`}
        >
          {automation.prompt}
        </button>
      </div>
      <button
        className={`${primaryButton} w-full`}
        disabled={busy !== null}
        onClick={runNow}
      >
        {busy === "run" ? (
          <Spinner className="size-5" />
        ) : (
          <Play className="size-[18px]" />
        )}
        Run now
      </button>
      {automation.lastRunError && automation.lastRunStatus === "failed" ? (
        <div className="rounded-[18px] bg-[color-mix(in_srgb,var(--bad)_10%,transparent)] px-4 py-3 text-[14px] text-(--bad)">
          {automation.lastRunError}
        </div>
      ) : null}
      <section>
        <SectionTitle count={runs.data?.length}>Recent runs</SectionTitle>
        {!runs.data ? (
          <div className="flex justify-center py-6 text-(--ink-3)">
            <Spinner className="size-5" />
          </div>
        ) : !runs.data.length ? (
          <div className="px-1 text-[14px] text-(--ink-3)">No runs yet.</div>
        ) : (
          <Group>
            {runs.data.map((entry) => {
              const took =
                entry.startedAt && entry.completedAt
                  ? duration(entry.completedAt - entry.startedAt)
                  : "";
              return (
                <button
                  key={entry.id}
                  disabled={!entry.sessionId}
                  onClick={() => entry.sessionId && openChat(entry.sessionId)}
                  className="web-press flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default"
                >
                  <RunPill status={entry.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-(--ink)">
                      {entry.trigger === "manual"
                        ? "Run by hand"
                        : entry.trigger === "event"
                          ? "Started by an event"
                          : "Scheduled"}
                    </span>
                    {entry.error ? (
                      <span className="block truncate text-[12.5px] text-(--bad)">
                        {entry.error}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right text-[12px] tabular-nums text-(--ink-3)">
                    {ago(entry.createdAt, now) === "now"
                      ? "now"
                      : `${ago(entry.createdAt, now)} ago`}
                    {took ? <span className="block">{took}</span> : null}
                  </span>
                  {entry.sessionId ? (
                    <ChevronRight className="size-4 shrink-0 text-(--ink-3)" />
                  ) : null}
                </button>
              );
            })}
          </Group>
        )}
      </section>
    </div>
  );
}
