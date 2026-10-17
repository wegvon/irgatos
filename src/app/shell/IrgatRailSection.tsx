import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserGroup,
} from "../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../shared/ui/Popover";
import { Shimmer } from "../../shared/ui/Shimmer";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import { IrgatRailMascot } from "../../features/irgats/ui/IrgatRailMascot";
import { IrgatIntroPopover } from "../../features/irgats/ui/IrgatIntro";
import { ProjectBackgroundDialog } from "../../features/projects/ui/ProjectBackgroundDialog";
import { irgatBackgroundKey } from "../../features/irgats/model/irgatBackground";
import { createIrgatGroup } from "../../features/irgats/model/irgatGroups";
import {
  IrgatGroupRail,
  type IrgatGroupRailProps,
} from "../../features/irgats/ui/IrgatGroupRail";
import { NewIrgatGroupDialog } from "../../features/irgats/ui/NewIrgatGroupDialog";
import {
  ColorPicker,
  MascotPicker,
} from "../../features/irgats/ui/irgatPanelParts";
import type { FreeChatState } from "../../features/freechat/model/freeChat";
import {
  defaultIrgatName,
  dismissIrgatIntro,
  findIrgat,
  listIrgats,
  IRGAT_STATUS_LABEL,
  irgatIntroDismissed,
  nextIrgatLook,
  irgatLook,
  irgatProjectsPhrase,
  irgatsSnapshot,
  reorderIrgats,
  saveIrgatMascot,
  saveIrgatName,
  subscribeIrgats,
  updateIrgat,
  type IrgatState,
} from "../../features/irgats/model/irgat";

export type IrgatRailProps = {
  /** The Irgat open in the main area, if any. */
  activeId?: string;
  /** What each Irgat is doing, by Irgat id; missing reads as idle. */
  states: ReadonlyMap<string, IrgatState>;
  /** Replies each Irgat has that the user has not looked at yet, by Irgat id. */
  unseenCounts?: ReadonlyMap<string, number>;
  onOpen: (irgatId: string) => void;
  onCreate: () => void;
  activeSessionId?: string;
  chatTitles?: ReadonlyMap<string, string>;
  /** What each child chat is doing, by session id; missing reads as idle. */
  chatStates?: ReadonlyMap<string, FreeChatState>;
  onRenameChat?: (sessionId: string, title: string) => void;
  onOpenChat?: (irgatId: string, sessionId: string) => void;
  /** Shows the chat next to the one open, in its own pane. */
  onOpenChatBeside?: (sessionId: string) => void;
  onCreateChat?: (irgatId: string) => void;
  onDeleteChat?: (irgatId: string, sessionId: string) => void;
  onDelete: (irgatId: string) => void;
  /** Whether the intro may show now, when there is no Irgat yet. */
  introAvailable?: boolean;
  /** Group rooms of several Irgats, listed under them. */
  groups?: IrgatGroupRailProps;
};

const IDLE: IrgatState = { status: "idle" };

const CHAT_STATE_LABEL: Record<FreeChatState, string> = {
  "needs-input": "Needs you",
  running: "Running",
  unread: "New reply",
  idle: "",
};

/** The inline title field a chat row turns into while it is renamed. */
function ChatTitleInput({
  title,
  onDone,
}: {
  title: string;
  /** The new title, or undefined when the rename was cancelled. */
  onDone: (title?: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value?: string) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      ref={ref}
      defaultValue={title}
      aria-label="Chat title"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-7 min-w-0 flex-1 rounded-md border border-content/20 bg-transparent px-2 text-xs text-content outline-none"
    />
  );
}

/** A Irgat's unread count as its badge shows it. */
export function unreadBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function unreadLabel(count: number): string {
  return count === 1 ? "1 new reply" : `${count} new replies`;
}

/**
 * The user's Irgats, above the projects. Each opens like a project does, but
 * into its conversation; none belongs to a project, so they get a section of
 * their own and the shaded mascot rather than a project's flat one.
 */
export function IrgatRailSection({
  activeId,
  states,
  unseenCounts,
  onOpen,
  onCreate,
  activeSessionId,
  chatTitles,
  chatStates,
  onRenameChat,
  onOpenChat,
  onOpenChatBeside,
  onCreateChat,
  onDeleteChat,
  onDelete,
  introAvailable = false,
  groups,
}: IrgatRailProps) {
  const snapshot = useSyncExternalStore(subscribeIrgats, irgatsSnapshot);
  const irgats = useMemo(() => listIrgats(), [snapshot]);
  const [addButton, setAddButton] = useState<HTMLButtonElement | null>(null);
  // Shown once ever, and only the user's choice puts it away.
  const showIntro =
    introAvailable && irgats.length === 0 && !irgatIntroDismissed();
  const ids = irgats.map((irgat) => irgat.id);
  const sortable = useAnimatedReorder(ids, reorderIrgats, "y");
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor }>();
  const [chatMenu, setChatMenu] = useState<{
    irgatId: string;
    sessionId: string;
    anchor: PopoverAnchor;
  }>();
  const [renamingChat, setRenamingChat] = useState<string>();
  const [background, setBackground] = useState<string>();
  const backgroundIrgat = background ? findIrgat(background) : undefined;
  const [newGroup, setNewGroup] = useState(false);

  return (
    <div className="mb-2 shrink-0" data-irgat-rail>
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
        <span className="min-w-0 flex-1 truncate px-1 text-xs leading-5 text-content/50">
          Irgats
        </span>
        {groups && irgats.length ? (
          <button
            type="button"
            title="New group chat…"
            aria-label="New group chat"
            onClick={() => setNewGroup(true)}
            className="grid size-5 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content"
          >
            <UserGroup className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        {/* With none yet, the row below is the way to add one. */}
        {irgats.length ? (
          <button
            type="button"
            title="New irgat"
            aria-label="New irgat"
            onClick={onCreate}
            className="grid size-5 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {showIntro && addButton ? (
        <IrgatIntroPopover
          anchor={addButton}
          look={nextIrgatLook(irgats)}
          onCreate={() => {
            dismissIrgatIntro();
            onCreate();
          }}
          onLater={dismissIrgatIntro}
        />
      ) : null}
      <div className="flex flex-col gap-px px-2">
        {irgats.length === 0 ? (
          <button
            ref={setAddButton}
            type="button"
            data-irgat-add
            title="New irgat"
            aria-label="New irgat"
            onClick={onCreate}
            className="grid h-8 w-full cursor-default place-items-center rounded-md border border-dashed border-content/15 text-content/50 hover:border-content/30 hover:bg-content/5 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        {irgats.map((irgat) => {
          const look = irgatLook(irgat);
          const state = states.get(irgat.id) ?? IDLE;
          const selected = irgat.id === activeId;
          const expanded = irgat.chatsCollapsed === false;
          const Chevron = expanded ? ChevronDown : ChevronRight;
          // The open chat is already left out of the count.
          const unseen = unseenCounts?.get(irgat.id) ?? 0;
          const projects = look.projects.length
            ? irgatProjectsPhrase(look.projects)
            : "No projects yet";
          const status =
            state.status === "idle"
              ? undefined
              : (state.activity ?? IRGAT_STATUS_LABEL[state.status]);
          return (
            <div key={irgat.id}>
              <div
                ref={(el) => sortable.setItemRef(irgat.id, el)}
                data-selected={selected || undefined}
                data-irgat-status={state.status}
                className={`reorder-item project-reorder-item group relative flex h-8 cursor-default touch-none items-stretch rounded-md px-2 ${
                  selected ? "bg-selection-strong text-content" : "opacity-65"
                }`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (
                    (event.target as HTMLElement | null)?.closest(
                      "[data-no-drag]",
                    )
                  )
                    return;
                  sortable.onItemPointerDown(irgat.id, event);
                }}
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement | null)?.closest(
                      "[data-no-drag]",
                    )
                  )
                    return;
                  if (sortable.consumeClick()) return;
                  if (onCreateChat)
                    updateIrgat(irgat.id, (current) => ({
                      ...current,
                      chatsCollapsed: expanded,
                    }));
                  onOpen(irgat.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    id: irgat.id,
                    anchor: { x: event.clientX, y: event.clientY },
                  });
                }}
              >
                <button
                  type="button"
                  title={[look.name, projects, status]
                    .filter(Boolean)
                    .join("\n")}
                  aria-label={[
                    look.name,
                    status ?? "idle",
                    unseen ? unreadLabel(unseen) : undefined,
                    projects,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  aria-current={selected ? "true" : undefined}
                  aria-expanded={onCreateChat ? expanded : undefined}
                  aria-controls={
                    onCreateChat ? `irgat-chats-${irgat.id}` : undefined
                  }
                  className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none group-hover:pr-6 group-has-[:focus-visible]:pr-6"
                >
                  {onCreateChat ? (
                    <Chevron className="size-3 shrink-0" />
                  ) : null}
                  <IrgatRailMascot
                    name={look.mascot}
                    color={look.color}
                    status={state.status}
                  />
                  {state.status === "working" ? (
                    <Shimmer
                      as="span"
                      duration={1.4}
                      className="min-w-0 flex-1 truncate text-sm font-medium leading-tight"
                    >
                      {look.name}
                    </Shimmer>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
                      {look.name}
                    </span>
                  )}
                  {unseen ? (
                    <span
                      aria-hidden
                      data-irgat-unread={unseen}
                      className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-content/15 px-1 text-[10px] font-medium tabular-nums leading-none text-content/80 group-hover:hidden group-has-[:focus-visible]:hidden"
                    >
                      {unreadBadge(unseen)}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  data-no-drag
                  title="Irgat options"
                  aria-label={`${look.name} options`}
                  aria-haspopup="menu"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu({ id: irgat.id, anchor: event.currentTarget });
                  }}
                  className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid group-has-[:focus-visible]:grid"
                >
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </button>
              </div>
              {onCreateChat && expanded ? (
                <div
                  id={`irgat-chats-${irgat.id}`}
                  className="ml-5 border-l border-content/10 pl-2"
                  data-irgat-chats={irgat.id}
                >
                  {(irgat.childSessionIds ?? []).map((id, index) => {
                    const title = chatTitles?.get(id) || `Chat ${index + 1}`;
                    const state = chatStates?.get(id) ?? "idle";
                    const stateLabel = CHAT_STATE_LABEL[state];
                    const hasMenu = !!(
                      onDeleteChat ||
                      onRenameChat ||
                      onOpenChatBeside
                    );
                    const canOpenBeside =
                      !!onOpenChatBeside && activeSessionId !== id;
                    return (
                      <div
                        key={id}
                        data-irgat-chat={id}
                        data-state={state}
                        className="group/chat relative flex items-center"
                        onContextMenu={
                          hasMenu
                            ? (event) => {
                                event.preventDefault();
                                setChatMenu({
                                  irgatId: irgat.id,
                                  sessionId: id,
                                  anchor: {
                                    x: event.clientX,
                                    y: event.clientY,
                                  },
                                });
                              }
                            : undefined
                        }
                      >
                        {renamingChat === id ? (
                          <ChatTitleInput
                            title={title}
                            onDone={(next) => {
                              setRenamingChat(undefined);
                              const trimmed = next?.trim();
                              if (trimmed && trimmed !== title)
                                onRenameChat?.(id, trimmed);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            aria-current={
                              activeSessionId === id ? "page" : undefined
                            }
                            aria-label={
                              stateLabel ? `${title}, ${stateLabel}` : title
                            }
                            className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 ${canOpenBeside ? "pr-12" : "pr-7"} text-left text-xs hover:bg-content/8 ${activeSessionId === id ? "bg-selection-strong text-content" : "text-content/55"}`}
                            onClick={(event) => {
                              if (event.altKey && canOpenBeside)
                                onOpenChatBeside?.(id);
                              else onOpenChat?.(irgat.id, id);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {title}
                            </span>
                            {state === "needs-input" ? (
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full bg-amber-500 group-hover/chat:hidden"
                              />
                            ) : state === "running" ? (
                              <LoaderCircle
                                aria-hidden
                                className="size-3 shrink-0 animate-spin opacity-60 group-hover/chat:hidden"
                              />
                            ) : state === "unread" ? (
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full bg-accent group-hover/chat:hidden"
                              />
                            ) : null}
                          </button>
                        )}
                        {canOpenBeside && renamingChat !== id ? (
                          <button
                            type="button"
                            aria-label={`Open ${title} beside`}
                            title="Open beside (⌥-click)"
                            onClick={() => onOpenChatBeside?.(id)}
                            className="absolute right-6 hidden size-5 place-items-center rounded text-content/55 hover:bg-content/8 hover:text-content group-hover/chat:grid group-focus-within/chat:grid"
                          >
                            <Columns className="size-3.5" />
                          </button>
                        ) : null}
                        {hasMenu && renamingChat !== id ? (
                          <button
                            type="button"
                            aria-label={`${title} options`}
                            aria-haspopup="menu"
                            onClick={(event) =>
                              setChatMenu({
                                irgatId: irgat.id,
                                sessionId: id,
                                anchor: event.currentTarget,
                              })
                            }
                            className="absolute right-1 hidden size-5 place-items-center rounded text-content/55 hover:bg-content/8 hover:text-content group-hover/chat:grid group-focus-within/chat:grid"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    aria-label={`New chat under ${look.name}`}
                    onClick={() => onCreateChat(irgat.id)}
                    className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs text-content/45 hover:bg-content/8 hover:text-content"
                  >
                    <Plus className="size-3" /> New chat
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {groups ? <IrgatGroupRail {...groups} /> : null}
      {newGroup && groups ? (
        <NewIrgatGroupDialog
          irgats={irgats}
          onClose={() => setNewGroup(false)}
          onCreate={(memberIds, name) => {
            setNewGroup(false);
            groups.onOpen(createIrgatGroup(memberIds, name).id);
          }}
        />
      ) : null}
      {menu ? (
        <IrgatMenu
          key={menu.id}
          irgatId={menu.id}
          anchor={menu.anchor}
          onBackground={() => {
            setMenu(undefined);
            setBackground(menu.id);
          }}
          onDelete={() => {
            setMenu(undefined);
            onDelete(menu.id);
          }}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
      {backgroundIrgat ? (
        <ProjectBackgroundDialog
          project={irgatBackgroundKey(backgroundIrgat.id)}
          name={irgatLook(backgroundIrgat).name}
          locked
          onClose={() => setBackground(undefined)}
        />
      ) : null}
      {chatMenu && (onDeleteChat || onRenameChat || onOpenChatBeside) ? (
        <Popover
          anchor={chatMenu.anchor}
          side="right"
          align="start"
          width={200}
          role="menu"
          aria-label="Chat options"
          onDismiss={() => setChatMenu(undefined)}
          className="p-1"
        >
          {onOpenChatBeside && activeSessionId !== chatMenu.sessionId ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setChatMenu(undefined);
                onOpenChatBeside(chatMenu.sessionId);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-content/8"
            >
              <Columns className="size-3.5" /> Open beside
            </button>
          ) : null}
          {onRenameChat ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setChatMenu(undefined);
                setRenamingChat(chatMenu.sessionId);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-content/8"
            >
              <Pencil className="size-3.5" /> Rename
            </button>
          ) : null}
          {onDeleteChat ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setChatMenu(undefined);
                onDeleteChat?.(chatMenu.irgatId, chatMenu.sessionId);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-red-400 hover:bg-content/8"
            >
              <Trash2 className="size-3.5" /> Delete chat…
            </button>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

/**
 * The Irgat menu on its own, with the background picker it opens, for places
 * outside this section such as the compact rail.
 */
export function IrgatContextMenu({
  irgatId,
  anchor,
  onDelete,
  onClose,
}: {
  irgatId: string;
  anchor: PopoverAnchor;
  onDelete: (irgatId: string) => void;
  onClose: () => void;
}) {
  const [background, setBackground] = useState(false);
  const irgat = findIrgat(irgatId);
  if (background && irgat)
    return (
      <ProjectBackgroundDialog
        project={irgatBackgroundKey(irgat.id)}
        name={irgatLook(irgat).name}
        locked
        onClose={onClose}
      />
    );
  return (
    <IrgatMenu
      irgatId={irgatId}
      anchor={anchor}
      onBackground={() => setBackground(true)}
      onDelete={() => {
        onClose();
        onDelete(irgatId);
      }}
      onClose={onClose}
    />
  );
}

/**
 * Right-click menu for a Irgat, like a project's: its name, mascot and color
 * up top, edited in place, then the actions.
 */
function IrgatMenu({
  irgatId,
  anchor,
  onBackground,
  onDelete,
  onClose,
}: {
  irgatId: string;
  anchor: PopoverAnchor;
  onBackground: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useSyncExternalStore(subscribeIrgats, irgatsSnapshot);
  const irgat = findIrgat(irgatId);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(irgat?.name ?? "");

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  if (!irgat) return null;
  const look = irgatLook(irgat);
  const commitName = () => {
    const next = name.trim().slice(0, 40);
    if (next !== (findIrgat(irgatId)?.name ?? "")) saveIrgatName(irgatId, next);
  };

  return (
    <Popover
      anchor={anchor}
      side="right"
      align="start"
      gap={0}
      width={280}
      constrainHeight={false}
      onDismiss={() => {
        commitName();
        onClose();
      }}
      role="menu"
      aria-label="Irgat options"
      onContextMenu={(event) => event.preventDefault()}
      className="p-2"
    >
      <input
        ref={input}
        value={name}
        placeholder={defaultIrgatName(irgat.mascot)}
        maxLength={40}
        aria-label="Irgat name"
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitName();
          onClose();
        }}
        className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 placeholder:text-content/45 focus:ring-1"
      />
      <div className="mb-2 flex flex-col gap-2">
        <MascotPicker
          current={look.mascot}
          color={look.color}
          onPick={(mascot) => saveIrgatMascot(irgatId, mascot)}
        />
        <ColorPicker
          inline
          current={look.color}
          onPick={(color) =>
            updateIrgat(irgatId, (irgat) => ({ ...irgat, color }))
          }
        />
      </div>
      <div role="separator" className="my-1 h-px bg-content/10" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          commitName();
          onBackground();
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-content/85 hover:bg-content/8"
      >
        <ImagePlus className="size-3.5 shrink-0" strokeWidth={1.75} />
        Background image
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-red-400 hover:bg-content/8"
      >
        <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
        Delete irgat…
      </button>
    </Popover>
  );
}
