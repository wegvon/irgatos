import { useState } from "react";
import { ChevronDown } from "../../../shared/ui/icons";
import type { MailMessage } from "../model/mail";
import { senderName } from "../model/mail";
import { HiddenTextNotice } from "./HiddenTextNotice";

/** One message of a thread in its own box: the user's own messages tinted
 *  with the accent and set to the right, everyone else's neutral and to the
 *  left. The earlier conversation a message quotes is folded away. */
export function MailMessageCard({
  message: m,
  mine,
  time,
}: {
  message: MailMessage;
  mine: boolean;
  time: string;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  return (
    <article
      className={`mb-3 rounded-lg border px-3 py-2 ${
        mine
          ? "ml-10 border-accent/30 bg-accent/[0.09]"
          : "mr-10 border-stroke bg-content/[0.04]"
      }`}
    >
      <header className="flex items-baseline gap-2 text-[12px]">
        <span
          className={`min-w-0 flex-1 truncate font-medium ${
            mine ? "text-accent" : ""
          }`}
          title={m.from}
        >
          {mine ? "You" : senderName(m.from)}
        </span>
        <span className="shrink-0 tabular-nums text-content/45">{time}</span>
      </header>
      <p className="truncate text-[11px] text-content/45" title={m.to}>
        to {m.to}
        {m.cc ? `, cc ${m.cc}` : ""}
      </p>
      <div className="mt-2 select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed">
        {m.body || <span className="text-content/40">(no text)</span>}
      </div>
      {m.quoted ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowQuoted((value) => !value)}
            aria-expanded={showQuoted}
            className="flex items-center gap-1 rounded px-1 text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
          >
            <ChevronDown
              className={`size-3 transition-transform ${
                showQuoted ? "rotate-180" : ""
              }`}
              strokeWidth={1.75}
            />
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showQuoted ? (
            <div className="mt-1.5 select-text whitespace-pre-wrap break-words border-l-2 border-content/15 pl-3 text-[12px] leading-relaxed text-content/55">
              {m.quoted}
            </div>
          ) : null}
        </div>
      ) : null}
      <HiddenTextNotice parts={m.hidden ?? []} />
      {m.attachments.length ? (
        <p className="mt-2 text-[11px] text-content/50">
          Attachments: {m.attachments.join(", ")}
        </p>
      ) : null}
    </article>
  );
}
