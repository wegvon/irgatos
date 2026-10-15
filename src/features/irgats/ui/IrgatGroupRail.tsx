import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { Shimmer } from "../../../shared/ui/Shimmer";
import { MoreHorizontal, Trash2 } from "../../../shared/ui/icons";
import { irgatLook, listIrgats, irgatsSnapshot, subscribeIrgats } from "../model/irgat";
import {
  groupMembers,
  irgatGroupName,
  irgatGroupsSnapshot,
  listIrgatGroups,
  renameIrgatGroup,
  subscribeIrgatGroups,
} from "../model/irgatGroups";
import { IrgatRailMascot } from "./IrgatRailMascot";

export type IrgatGroupRailProps = {
  /** The room open in the main area, if any. */
  activeId?: string;
  /** Rooms with a member replying now. */
  busy?: ReadonlySet<string>;
  onOpen: (groupId: string) => void;
  onDelete: (groupId: string) => void;
};

/** Up to three member mascots, overlapping, for a room's row and header. */
export function GroupMascots({
  members,
  size = "size-4",
}: {
  members: readonly { id: string; mascot: string; color: string }[];
  size?: string;
}) {
  const shown = members.slice(0, 3);
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {shown.map((member, index) => (
        <span
          key={member.id}
          className={`grid place-items-center rounded-full bg-background-base ring-1 ring-background-base ${index ? "-ml-1.5" : ""}`}
        >
          <IrgatRailMascot
            name={member.mascot}
            color={member.color}
            className={`${size} shrink-0`}
          />
        </span>
      ))}
    </span>
  );
}

/** The user's group rooms, under their Irgats on the rail. */
export function IrgatGroupRail({ activeId, busy, onOpen, onDelete }: IrgatGroupRailProps) {
  const groupsSnap = useSyncExternalStore(subscribeIrgatGroups, irgatGroupsSnapshot);
  const rosterSnap = useSyncExternalStore(subscribeIrgats, irgatsSnapshot);
  const rows = useMemo(() => {
    const roster = listIrgats();
    return listIrgatGroups().map((group) => ({
      group,
      name: irgatGroupName(group, roster),
      members: groupMembers(group, roster).map((irgat) => ({
        id: irgat.id,
        ...irgatLook(irgat),
      })),
    }));
  }, [groupsSnap, rosterSnap]);
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor }>();
  if (!rows.length) return null;
  return (
    <div data-irgat-group-rail className="mt-1.5">
      <div className="px-4 pb-1 text-[11px] leading-5 text-content/40">Groups</div>
      <div className="flex flex-col gap-px px-2">
        {rows.map(({ group, name, members }) => {
          const selected = group.id === activeId;
          const working = !!busy?.has(group.id);
          const memberNames = members.map((member) => member.name).join(", ");
          return (
            <div
              key={group.id}
              data-irgat-group={group.id}
              data-selected={selected || undefined}
              className={`group relative flex h-8 cursor-default items-stretch rounded-md px-2 ${
                selected ? "bg-selection-strong text-content" : "opacity-65"
              }`}
              onClick={(event) => {
                if ((event.target as HTMLElement | null)?.closest("[data-no-drag]"))
                  return;
                onOpen(group.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id: group.id, anchor: { x: event.clientX, y: event.clientY } });
              }}
            >
              <button
                type="button"
                title={[name, memberNames, working ? "Replying" : ""]
                  .filter(Boolean)
                  .join("\n")}
                aria-label={`${name} group chat, ${members.length} members${working ? ", replying" : ""}`}
                aria-current={selected ? "true" : undefined}
                className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none group-hover:pr-6 group-has-[:focus-visible]:pr-6"
              >
                <GroupMascots members={members} />
                {working ? (
                  <Shimmer
                    as="span"
                    duration={1.4}
                    className="min-w-0 flex-1 truncate text-sm font-medium leading-tight"
                  >
                    {name}
                  </Shimmer>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
                    {name}
                  </span>
                )}
              </button>
              <button
                type="button"
                data-no-drag
                title="Group options"
                aria-label={`${name} options`}
                aria-haspopup="menu"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu({ id: group.id, anchor: event.currentTarget });
                }}
                className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid group-has-[:focus-visible]:grid"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
      {menu ? (
        <GroupMenu
          key={menu.id}
          groupId={menu.id}
          anchor={menu.anchor}
          onDelete={() => {
            setMenu(undefined);
            onDelete(menu.id);
          }}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

function GroupMenu({
  groupId,
  anchor,
  onDelete,
  onClose,
}: {
  groupId: string;
  anchor: PopoverAnchor;
  onDelete: () => void;
  onClose: () => void;
}) {
  const group = listIrgatGroups().find((entry) => entry.id === groupId);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(group?.name ?? "");
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  if (!group) return null;
  const commit = () => {
    if (name.trim() !== (group.name ?? "")) renameIrgatGroup(groupId, name);
  };
  return (
    <Popover
      anchor={anchor}
      side="right"
      align="start"
      gap={0}
      width={260}
      constrainHeight={false}
      onDismiss={() => {
        commit();
        onClose();
      }}
      role="menu"
      aria-label="Group options"
      className="p-2"
    >
      <input
        ref={input}
        value={name}
        placeholder={irgatGroupName({ memberIds: group.memberIds })}
        maxLength={60}
        aria-label="Group name"
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
          onClose();
        }}
        className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 placeholder:text-content/45 focus:ring-1"
      />
      <div role="separator" className="my-1 h-px bg-content/10" />
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-red-400 hover:bg-content/8"
      >
        <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
        Delete group chat…
      </button>
    </Popover>
  );
}
