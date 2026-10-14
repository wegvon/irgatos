import { useRef, useState } from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { Popover } from "../../../shared/ui/Popover";
import {
  DateTimePicker,
  parseLocalDateTime,
  toLocalDateTime,
} from "../../../shared/ui/DateTimePicker";
import { Clock } from "../../../shared/ui/icons";
import { inboxItemKey, inboxItemRef, type InboxItem } from "../model/githubTasks";
import {
  formatSnoozeUntil,
  INBOX_SNOOZE_PRESET_IDS,
  snoozedUntil,
  snoozeItem,
  snoozePresets,
  snoozePresetTime,
  unsnoozeItem,
  updateInboxSnoozes,
  type InboxSnoozePresetId,
} from "../model/inboxSnooze";
import { useInboxSnoozes } from "../hooks/useInboxTriageState";

const MENU_WIDTH = 252;
const CUSTOM = "snooze:custom";
const CLEAR = "snooze:clear";

/** A reference that still reads on its own, as in a toast. */
export function inboxSnoozeRef(item: InboxItem): string {
  const ref = inboxItemRef(item);
  return ref.startsWith("#") && item.repo ? `${item.repo}${ref}` : ref;
}

function presetId(id: string): InboxSnoozePresetId | null {
  const preset = id.replace(/^snooze:/, "");
  return (INBOX_SNOOZE_PRESET_IDS as readonly string[]).includes(preset)
    ? (preset as InboxSnoozePresetId)
    : null;
}

export function inboxSnoozeMenuItems(
  now: Date,
  snoozed: boolean,
): ExplorerMenuItem[] {
  return [
    ...snoozePresets(now).map(
      (preset): ExplorerMenuItem => ({
        kind: "item",
        id: `snooze:${preset.id}`,
        label: preset.label,
      }),
    ),
    { kind: "sep" },
    { kind: "item", id: CUSTOM, label: "Pick a date and time…" },
    ...(snoozed
      ? ([
          { kind: "sep" },
          { kind: "item", id: CLEAR, label: "Unsnooze" },
        ] satisfies ExplorerMenuItem[])
      : []),
  ];
}

/** "Remind me later" for one Inbox item. */
export function InboxSnoozeControl({
  item,
  onSnoozed,
}: {
  item: InboxItem;
  /** The item leaves the list, so the caller can move selection on. */
  onSnoozed?: () => void;
}) {
  const key = inboxItemKey(item);
  const state = useInboxSnoozes();
  const until = snoozedUntil(state, key, Date.now());
  const [open, setOpen] = useState<"menu" | "custom" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = (restoreFocus = true) => {
    setOpen(null);
    if (restoreFocus) trigger.current?.focus();
  };
  const snooze = (at: number): boolean => {
    try {
      const saved = updateInboxSnoozes((current) =>
        snoozeItem(current, key, at, Date.now(), {
          title: item.title,
          ref: inboxSnoozeRef(item),
        }),
      );
      if (!saved) {
        setError("Could not save the snooze. Please try again.");
        return false;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
    setError(null);
    close();
    onSnoozed?.();
    return true;
  };

  const label = until
    ? `Snoozed until ${formatSnoozeUntil(until)}`
    : "Remind me later";
  return (
    <>
      <button
        ref={trigger}
        type="button"
        title={until ? `${label}. Click to change.` : "Snooze this item"}
        aria-label={until ? label : "Snooze"}
        aria-haspopup={open === "custom" ? "dialog" : "menu"}
        aria-expanded={open !== null}
        onClick={() => setOpen(open ? null : "menu")}
        className={`ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] hover:bg-content/10 hover:text-content ${
          until ? "text-amber-400" : "text-content/50"
        }`}
      >
        <Clock className="size-3.5" strokeWidth={1.75} />
        <span className="max-w-[180px] truncate">
          {until ? `Until ${formatSnoozeUntil(until)}` : "Snooze"}
        </span>
      </button>
      {error ? (
        <span role="alert" className="shrink-0 text-[11px] text-red-400">
          {error}
        </span>
      ) : null}
      {open === "menu" && trigger.current ? (
        <ExplorerMenu
          x={trigger.current.getBoundingClientRect().right - MENU_WIDTH}
          y={trigger.current.getBoundingClientRect().bottom + 4}
          width={MENU_WIDTH}
          ariaLabel="Snooze inbox item"
          header={
            <p className="px-2 py-1.5 text-[11px] text-content/45">
              Hide it, then bring it back
            </p>
          }
          items={inboxSnoozeMenuItems(new Date(), until != null)}
          onClose={() =>
            close(Boolean(document.activeElement?.closest('[role="menu"]')))
          }
          onPick={(id) => {
            if (id === CUSTOM) {
              setOpen("custom");
              return;
            }
            if (id === CLEAR) {
              updateInboxSnoozes((current) => unsnoozeItem(current, key));
              close();
              return;
            }
            const preset = presetId(id);
            const at = preset ? snoozePresetTime(preset, new Date()) : null;
            if (at != null) snooze(at);
          }}
        />
      ) : null}
      {open === "custom" ? (
        <Popover
          anchor={trigger}
          align="end"
          width={280}
          role="dialog"
          aria-label="Snooze until"
          onDismiss={(reason) => close(reason === "escape")}
          className="overflow-y-auto p-3"
        >
          <SnoozeDatePicker
            initial={until}
            onCancel={() => close()}
            onPick={snooze}
          />
        </Popover>
      ) : null}
    </>
  );
}

function SnoozeDatePicker({
  initial,
  onCancel,
  onPick,
}: {
  initial?: number;
  onCancel: () => void;
  onPick: (at: number) => boolean;
}) {
  const [value, setValue] = useState(() => {
    const start = initial ?? Date.now() + 3_600_000;
    return toLocalDateTime(new Date(Math.ceil(start / 60_000) * 60_000));
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        const date = parseLocalDateTime(value);
        if (!date) {
          setError("Choose a valid date and time.");
          return;
        }
        if (date.getTime() <= Date.now()) {
          setError("Choose a date and time in the future.");
          return;
        }
        if (!onPick(date.getTime()))
          setError("Could not save the snooze. Please try again.");
      }}
    >
      <p className="mb-3 px-1 text-[11px] text-content/45">
        Bring this item back on
      </p>
      <DateTimePicker
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        minDate={toLocalDateTime(new Date(Date.now())).slice(0, 10)}
        autoFocus
      />
      {error ? (
        <p role="alert" className="mt-3 px-1 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-stroke pt-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1.5 text-xs text-content/50 hover:bg-content/5 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="primary-action flex shrink-0 items-center rounded-md border border-transparent px-2.5 py-1 text-[12px] focus-visible:outline-2 focus-visible:outline-accent"
        >
          Snooze until then
        </button>
      </div>
    </form>
  );
}
