import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { irgatLook, listIrgats, irgatsSnapshot, subscribeIrgats } from "../model/irgat";
import { loadIrgatFiles, subscribeIrgatFiles } from "../model/irgatFiles";
import { soulRole } from "../model/irgatGroupContext";
import type { GroupRunState, IrgatGroupRunner } from "../model/irgatGroupRunner";
import {
  findIrgatGroup,
  groupMembers,
  irgatGroupName,
  irgatGroupsSnapshot,
  irgatGroupTranscriptSnapshot,
  loadIrgatGroupMessages,
  subscribeIrgatGroups,
  type IrgatGroup,
  type IrgatGroupMessage,
} from "../model/irgatGroups";

/** A room member as the room shows it. */
export type GroupMemberView = {
  id: string;
  name: string;
  mascot: string;
  color: string;
  role?: string;
};

/** The room, its name and its current members, kept up to date. */
export function useIrgatGroup(groupId: string): {
  group?: IrgatGroup;
  name: string;
  members: GroupMemberView[];
} {
  const groupsSnap = useSyncExternalStore(subscribeIrgatGroups, irgatGroupsSnapshot);
  const rosterSnap = useSyncExternalStore(subscribeIrgats, irgatsSnapshot);
  const roles = useMemberRoles(groupId, groupsSnap);
  return useMemo(() => {
    const group = findIrgatGroup(groupId);
    if (!group) return { name: "Group chat", members: [] };
    const roster = listIrgats();
    return {
      group,
      name: irgatGroupName(group, roster),
      members: groupMembers(group, roster).map((irgat) => {
        const look = irgatLook(irgat);
        return {
          id: irgat.id,
          name: look.name,
          mascot: look.mascot,
          color: look.color,
          ...(roles.get(irgat.id) ? { role: roles.get(irgat.id) } : {}),
        };
      }),
    };
  }, [groupId, groupsSnap, rosterSnap, roles]);
}

/** Each member's role line from its SOUL.md, reloaded when a file changes. */
function useMemberRoles(groupId: string, groupsSnap: string) {
  const [roles, setRoles] = useState<ReadonlyMap<string, string>>(new Map());
  const [filesVersion, setFilesVersion] = useState(0);
  useEffect(() => subscribeIrgatFiles(() => setFilesVersion((v) => v + 1)), []);
  useEffect(() => {
    const ids = findIrgatGroup(groupId)?.memberIds ?? [];
    let current = true;
    void Promise.all(
      ids.map((id) =>
        loadIrgatFiles(id)
          .then((files) => [id, soulRole(files.soul)] as const)
          .catch(() => [id, undefined] as const),
      ),
    ).then((entries) => {
      if (!current) return;
      setRoles(
        new Map(
          entries.flatMap(([id, role]) => (role ? [[id, role] as const] : [])),
        ),
      );
    });
    return () => {
      current = false;
    };
  }, [groupId, groupsSnap, filesVersion]);
  return roles;
}

/** What was said in the room. */
export function useIrgatGroupMessages(groupId: string): IrgatGroupMessage[] {
  const snapshot = useSyncExternalStore(subscribeIrgatGroups, () =>
    irgatGroupTranscriptSnapshot(groupId),
  );
  return useMemo(() => loadIrgatGroupMessages(groupId), [groupId, snapshot]);
}

/** Who is replying in the room now, and who is next. */
export function useIrgatGroupRun(
  runner: IrgatGroupRunner,
  groupId: string,
): GroupRunState {
  useSyncExternalStore(runner.subscribe, runner.snapshot);
  return runner.state(groupId);
}

/** Every room with a member replying or waiting to. */
export function useActiveIrgatGroups(runner: IrgatGroupRunner): ReadonlySet<string> {
  useSyncExternalStore(runner.subscribe, runner.snapshot);
  const key = runner.activeGroups().sort().join("|");
  return useMemo(() => new Set(key ? key.split("|") : []), [key]);
}
