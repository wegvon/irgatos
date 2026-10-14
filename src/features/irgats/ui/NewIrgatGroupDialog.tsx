import { useMemo, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Check } from "../../../shared/ui/icons";
import { irgatLook, type Irgat } from "../model/irgat";
import { autoGroupName, MIN_GROUP_MEMBERS } from "../model/irgatGroups";
import { IrgatRailMascot } from "./IrgatRailMascot";

/**
 * Picks two or more Irgats for a group room, and optionally its name; left
 * blank, the room goes by its members' names.
 */
export function NewIrgatGroupDialog({
  irgats,
  initial = [],
  onCreate,
  onClose,
}: {
  irgats: readonly Irgat[];
  /** Members ticked when it opens. */
  initial?: readonly string[];
  onCreate: (memberIds: string[], name: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() =>
    initial.filter((id) => irgats.some((irgat) => irgat.id === id)),
  );
  const [name, setName] = useState("");
  const looks = useMemo(
    () => new Map(irgats.map((irgat) => [irgat.id, irgatLook(irgat)])),
    [irgats],
  );
  const ordered = irgats.filter((irgat) => picked.includes(irgat.id));
  const suggested = autoGroupName(
    ordered.map((irgat) => looks.get(irgat.id)!.name),
  );
  const ready = picked.length >= MIN_GROUP_MEMBERS;
  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );

  return (
    <Modal
      title="New group chat"
      description="Bring Irgats with different expertise into one room."
      size="sm"
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3 px-4 pb-4 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready)
            onCreate(
              ordered.map((irgat) => irgat.id),
              name.trim(),
            );
        }}
      >
        {irgats.length < MIN_GROUP_MEMBERS ? (
          <p className="rounded-lg bg-content/5 px-3 py-2.5 text-[13px] text-content/70">
            A group needs at least two Irgats. Create another Irgat with the +
            button first, then come back here.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-px">
            <legend className="mb-1.5 text-[12px] text-content/55">
              Members ({picked.length} picked, at least {MIN_GROUP_MEMBERS})
            </legend>
            {irgats.map((irgat) => {
              const look = looks.get(irgat.id)!;
              const on = picked.includes(irgat.id);
              const order = on ? ordered.indexOf(irgat) + 1 : undefined;
              return (
                <label
                  key={irgat.id}
                  data-group-candidate={irgat.id}
                  className={`flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] ${on ? "bg-selection text-content" : "text-content/80 hover:bg-content/5"}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => toggle(irgat.id)}
                    aria-label={look.name}
                  />
                  <span
                    aria-hidden
                    className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-white" : "border-content/25"}`}
                  >
                    {on ? <Check className="size-3" strokeWidth={2.5} /> : null}
                  </span>
                  <IrgatRailMascot name={look.mascot} color={look.color} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {look.name}
                  </span>
                  {order ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-content/45">
                      replies {order === 1 ? "first" : `#${order}`}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
        )}
        <label className="flex flex-col gap-1 text-[12px] text-content/55">
          Name (optional)
          <input
            value={name}
            maxLength={60}
            placeholder={ready ? suggested : "Architect + Security + Frontend"}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 placeholder:text-content/40 focus:ring-1"
          />
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="primary-action rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
          >
            Create group
          </button>
        </div>
      </form>
    </Modal>
  );
}
