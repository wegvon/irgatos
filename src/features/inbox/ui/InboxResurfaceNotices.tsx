import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { Clock, X } from "../../../shared/ui/icons";
import {
  startInboxSnoozeWatcher,
  type InboxResurfaced,
} from "../model/inboxSnooze";
import { saveInboxTriageFilter } from "../model/inboxTriage";

export type InboxResurfaceNotice = InboxResurfaced & { key: string };

const SHOWN = 4;

/** Newest last; a repeat of the same item replaces its older notice. */
export function mergeResurfaceNotices(
  current: readonly InboxResurfaceNotice[],
  incoming: readonly InboxResurfaceNotice[],
): InboxResurfaceNotice[] {
  const keys = new Set(incoming.map((notice) => notice.key));
  return [...current.filter((notice) => !keys.has(notice.key)), ...incoming];
}

/**
 * Runs the Inbox snooze clock for the whole app and says when snoozed items
 * come back, even while the Inbox is closed.
 */
export function InboxResurfaceNotices({
  topOffset = 12,
  onOpenInbox,
  onHeightChange,
}: {
  topOffset?: number;
  onOpenInbox: () => void;
  onHeightChange?: (height: number) => void;
}) {
  const [notices, setNotices] = useState<InboxResurfaceNotice[]>([]);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(
    () =>
      startInboxSnoozeWatcher((back) =>
        setNotices((current) => mergeResurfaceNotices(current, back)),
      ),
    [],
  );

  const visible = notices.length > 0;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onHeightChange) return;
    const measure = () => onHeightChange(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [visible, onHeightChange]);
  if (!visible) return null;

  const shown = notices.slice(-SHOWN).reverse();
  const hidden = notices.length - shown.length;
  return createPortal(
    <section
      ref={panelRef}
      aria-label="Back in your Inbox"
      aria-live="polite"
      style={{ zIndex: LAYER.popover - 1, top: topOffset }}
      className="fixed right-3 w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl border border-content/15 bg-background-base/95 text-content shadow-xl backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 border-b border-stroke px-3 py-2.5">
        <Clock className="size-3.5 text-amber-400" strokeWidth={1.75} />
        <span className="flex-1 text-[12px] font-semibold">
          Back in your Inbox
        </span>
        <button
          type="button"
          aria-label="Dismiss all"
          title="Dismiss all"
          onClick={() => setNotices([])}
          className="grid size-5 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      <ul className="divide-y divide-stroke">
        {shown.map((notice) => (
          <li key={notice.key} className="px-3 py-2">
            <span className="block truncate text-[13px] font-medium">
              {notice.title ?? "Snoozed item"}
            </span>
            {notice.ref ? (
              <span className="mt-0.5 block truncate text-[11px] text-content/50">
                {notice.ref}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="px-3 pb-2 text-[11px] text-content/45">
          and {hidden} more
        </p>
      ) : null}
      <div className="flex items-center gap-1.5 border-t border-stroke px-3 py-2 text-[11px]">
        <button
          type="button"
          className="rounded-md bg-content/10 px-2 py-1 hover:bg-content/15"
          onClick={() => {
            saveInboxTriageFilter("needs_action");
            setNotices([]);
            onOpenInbox();
          }}
        >
          Open Inbox
        </button>
        <button
          type="button"
          className="ml-auto rounded-md px-2 py-1 text-content/50 hover:bg-content/10"
          onClick={() => setNotices([])}
        >
          Dismiss
        </button>
      </div>
    </section>,
    document.body,
  );
}
