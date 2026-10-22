import {
  automationScheduleLabel,
  automationTriggers,
  type Automation,
  type AutomationTriggerKind,
} from "./automations";

/** How the editor and the browser companion name triggers. */
export const TRIGGER_CATEGORIES: readonly {
  value: AutomationTriggerKind;
  label: string;
}[] = [
  { value: "time", label: "Scheduled" },
  { value: "github", label: "GitHub" },
  { value: "linear", label: "Linear" },
  { value: "jira", label: "Jira" },
  { value: "gitlab", label: "GitLab" },
  { value: "azuredevops", label: "Azure DevOps" },
];

export type TriggerEvent = {
  value: string;
  label: string;
};

export const TRIGGER_EVENTS: Record<
  AutomationTriggerKind,
  readonly TriggerEvent[]
> = {
  time: [
    { value: "hourly", label: "Hourly" },
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
  ],
  github: [
    { value: "draft_opened", label: "Draft opened" },
    { value: "pull_request_opened", label: "Pull request opened" },
    { value: "issue_opened", label: "Issue opened" },
  ],
  linear: [{ value: "issue_created", label: "Issue created" }],
  jira: [{ value: "issue_created", label: "Issue appeared" }],
  gitlab: [
    { value: "merge_request_opened", label: "Merge request opened" },
    { value: "issue_opened", label: "Issue opened" },
  ],
  azuredevops: [
    { value: "pull_request_appeared", label: "Pull request appeared" },
    { value: "work_item_appeared", label: "Work item appeared" },
  ],
};

export function triggerName(kind: AutomationTriggerKind): string {
  return (
    TRIGGER_CATEGORIES.find((option) => option.value === kind)?.label ?? kind
  );
}

export function findTriggerEvent(
  kind: AutomationTriggerKind,
  value: string,
): TriggerEvent | undefined {
  return TRIGGER_EVENTS[kind].find((event) => event.value === value);
}

/** "Daily at 9:00 AM +1": the first trigger, and how many more there are. */
export function triggerLabel(automation: Automation): string {
  const triggers = automationTriggers(automation);
  if (triggers.length === 0) return "No trigger";
  const first = triggers[0]!;
  const label =
    first.kind === "time"
      ? automationScheduleLabel(first)
      : (findTriggerEvent(first.kind, first.event)?.label ??
        triggerName(first.kind));
  return triggers.length > 1 ? `${label} +${triggers.length - 1}` : label;
}
