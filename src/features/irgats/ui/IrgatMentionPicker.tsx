import { useEffect, useRef } from "react";
import { mentionHandle } from "../model/irgatGroupMentions";
import { IrgatRailMascot } from "./IrgatRailMascot";

/** A room member the composer's @ suggests. */
export type ComposerMention = {
  id: string;
  name: string;
  mascot: string;
  color: string;
  role?: string;
};

/** The members matching what follows @, above the composer. */
export function IrgatMentionPicker({
  options,
  active,
  onActive,
  onPick,
}: {
  options: readonly ComposerMention[];
  active: number;
  onActive: (index: number) => void;
  onPick: (member: ComposerMention) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div
      data-irgat-mention-picker
      className="overflow-hidden rounded-lg border border-content/10 bg-background-base/95 shadow-lg backdrop-blur-xl"
    >
      <div
        role="listbox"
        aria-label="Irgats in this room"
        className="max-h-[min(240px,40vh)] overflow-y-auto px-1 py-1"
      >
        {options.map((member, index) => {
          const highlighted = index === active;
          return (
            <button
              key={member.id}
              ref={highlighted ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={highlighted}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActive(index)}
              onClick={() => onPick(member)}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-none ${
                highlighted ? "bg-selection text-content" : "text-content"
              }`}
            >
              <IrgatRailMascot name={member.mascot} color={member.color} />
              <span className="shrink-0 font-medium">
                @{mentionHandle(member.name)}
              </span>
              {member.role ? (
                <span className="min-w-0 flex-1 truncate text-[11px] text-content/45">
                  {member.role}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
