import { useState } from "react";
import { Shield } from "../../../shared/ui/icons";
import type { MailHiddenPart } from "../model/mail";
import { hiddenKindLabel, hiddenTextNotice } from "../model/hiddenText";

/** A line under a message whose sender hid text from the reader, with the
 *  hidden parts one click away. */
export function HiddenTextNotice({ parts }: { parts: MailHiddenPart[] }) {
  const [open, setOpen] = useState(false);
  const notice = hiddenTextNotice(parts);
  if (!notice) return null;
  return (
    <div
      role={notice.warning ? "alert" : undefined}
      className={`mt-2 rounded-md px-2 py-1.5 text-[12px] ${
        notice.warning ? "bg-amber-500/10" : "bg-content/[0.04]"
      }`}
    >
      <div className="flex items-start gap-1.5">
        <Shield
          className={`mt-px size-3.5 shrink-0 ${
            notice.warning ? "text-amber-500" : "text-content/45"
          }`}
          strokeWidth={1.75}
        />
        <p
          className={`min-w-0 flex-1 ${
            notice.warning ? "text-content" : "text-content/55"
          }`}
        >
          {notice.text}
        </p>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="shrink-0 text-content/55 hover:text-content"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <ul className="mt-1.5 space-y-1.5 pl-5">
          {parts.map((part, index) => (
            <li key={index}>
              <span
                className={`text-[11px] ${
                  part.suspicious ? "text-amber-600" : "text-content/45"
                }`}
              >
                {hiddenKindLabel(part.kind)}
              </span>
              <p className="whitespace-pre-wrap break-words font-mono text-[11px] text-content/70">
                {part.text}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
