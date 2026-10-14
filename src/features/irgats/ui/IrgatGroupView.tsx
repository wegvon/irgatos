import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Popover } from "../../../shared/ui/Popover";
import { Shimmer } from "../../../shared/ui/Shimmer";
import {
  CornerDownRight,
  Square,
  UserAdd,
  X,
} from "../../../shared/ui/icons";
import type { ApprovalDecision } from "../../../integrations/harness/core/types";
import type { OpenFileFn } from "../../search/model/search";
import { resolveModel } from "../../sessions/model/models";
import { HARNESS_LABEL, type Session } from "../../sessions/model/session";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { AttachmentChip } from "../../sessions/ui/AttachmentChip";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  useIrgatGroup,
  useIrgatGroupMessages,
  useIrgatGroupRun,
  type GroupMemberView,
} from "../hooks/useIrgatGroup";
import { irgatLook, irgatState, listIrgats } from "../model/irgat";
import {
  defaultPicked,
  mentionHandle,
  mentionedMembers,
} from "../model/irgatGroupMentions";
import { seatReply, type IrgatGroupRunner } from "../model/irgatGroupRunner";
import {
  addIrgatGroupMember,
  irgatGroupViewKey,
  MIN_GROUP_MEMBERS,
  removeIrgatGroupMember,
  updateIrgatGroup,
  type IrgatGroupMessage,
} from "../model/irgatGroups";
import { IrgatComposer } from "./IrgatComposer";
import { GroupMascots } from "./IrgatGroupRail";
import { IrgatRailMascot } from "./IrgatRailMascot";

type Props = {
  groupId: string;
  runner: IrgatGroupRunner;
  /** The hidden session of the member replying now, whose reply streams in. */
  liveSeat?: Session;
  /** The view covers the workspace and owns the voice shortcuts. */
  visible?: boolean;
  focusToken?: number;
  onApproval?: (
    seatId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  onOpenFile?: OpenFileFn;
};

const CHIP =
  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] leading-none transition-colors";

function modelName(message: Pick<IrgatGroupMessage, "harness" | "model">) {
  if (!message.harness) return undefined;
  try {
    return message.model
      ? resolveModel(message.harness, message.model).name
      : HARNESS_LABEL[message.harness];
  } catch {
    return message.model;
  }
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A group room: the user and several Irgats in one conversation. Members
 * reply in turn, each reading the ones before it; @mentions pick who replies,
 * and a reply that mentions another member can hand it the floor.
 */
export function IrgatGroupView({
  groupId,
  runner,
  liveSeat,
  visible = true,
  focusToken,
  onApproval,
  onOpenFile,
}: Props) {
  const { group, name, members } = useIrgatGroup(groupId);
  const messages = useIrgatGroupMessages(groupId);
  const run = useIrgatGroupRun(runner, groupId);
  const [draft, setDraft] = useState("");
  const mode = group?.mode ?? "round";
  const [picked, setPicked] = useState<string[] | null>(null);
  const memberIds = members.map((member) => member.id).join("|");
  const effectivePicked = useMemo(
    () =>
      (picked ?? defaultPicked(mode, members)).filter((id) =>
        members.some((member) => member.id === id),
      ),
    // Members are compared by id, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, mode, memberIds],
  );
  const mentioned = useMemo(
    () => mentionedMembers(draft, members),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, memberIds],
  );
  const busy = !!run.speaking || run.queue.length > 0;
  const byId = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const liveText = seatReply(liveSeat);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveText, run.speaking?.irgatId, visible]);

  if (!group) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-[13px] text-content/55">
        This group chat was deleted.
      </div>
    );
  }

  const send = (text: string, attachments: Parameters<IrgatGroupRunner["send"]>[2]) => {
    if (!mentioned.length && !effectivePicked.length) return false;
    pinned.current = true;
    const posted = runner.send(groupId, text, attachments, effectivePicked);
    if (!posted) return false;
    setPicked(null);
    return true;
  };
  const togglePicked = (id: string) =>
    setPicked(
      effectivePicked.includes(id)
        ? effectivePicked.filter((entry) => entry !== id)
        : members
            .map((member) => member.id)
            .filter((entry) => entry === id || effectivePicked.includes(entry)),
    );
  const pending = new Set([
    ...(run.speaking ? [run.speaking.irgatId] : []),
    ...run.queue,
  ]);
  const lastReply = [...messages]
    .reverse()
    .find((message) => message.role === "irgat" && message.text.trim());
  const nobodyReplies = !mentioned.length && !effectivePicked.length;

  return (
    <div
      data-irgat-group-view={groupId}
      className="flex h-full min-h-0 flex-col font-sans"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !busy || event.defaultPrevented) return;
        event.preventDefault();
        void runner.stop(groupId);
      }}
    >
      <GroupHeader
        groupId={groupId}
        name={name}
        members={members}
        mode={mode}
        autoHandoff={group.autoHandoff}
        busy={busy}
      />
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5">
          {members.length < MIN_GROUP_MEMBERS ? (
            <p
              role="status"
              className="rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-[12.5px] text-content/80"
            >
              Only {members.length === 1 ? "one Irgat is" : "no Irgats are"} left
              in this room. Add another from the header to keep it a group.
            </p>
          ) : null}
          {messages.length === 0 && !busy ? (
            <GroupIntro members={members} mode={mode} />
          ) : null}
          {messages.map((message, index) => (
            <GroupMessageRow
              key={message.id}
              message={message}
              member={message.irgatId ? byId.get(message.irgatId) : undefined}
              members={members}
              answered={(irgatId) =>
                pending.has(irgatId) ||
                messages
                  .slice(index + 1)
                  .some((later) => later.irgatId === irgatId && later.role !== "user")
              }
              repliedTo={
                message.trigger
                  ? messages.find((entry) => entry.id === message.trigger!.messageId)
                  : undefined
              }
              onAsk={(irgatId, kind) => {
                pinned.current = true;
                runner.ask(groupId, irgatId, message.id, kind);
              }}
              onRetry={
                message.role === "notice" && message.irgatId
                  ? () => {
                      const anchor = [...messages.slice(0, index)]
                        .reverse()
                        .find((entry) => entry.role !== "notice");
                      if (anchor)
                        runner.ask(groupId, message.irgatId!, anchor.id, "handoff");
                    }
                  : undefined
              }
              onOpenFile={onOpenFile}
            />
          ))}
          {run.speaking ? (
            <LiveReply
              member={byId.get(run.speaking.irgatId)}
              seat={liveSeat?.id === run.speaking.seatId ? liveSeat : undefined}
              text={liveSeat?.id === run.speaking.seatId ? liveText : ""}
              queue={run.queue.flatMap((id) => byId.get(id) ?? [])}
              onStop={() => void runner.stop(groupId)}
              onApproval={onApproval}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </div>
      </div>
      <div className="shrink-0">
        <ReplyChips
          members={members}
          mode={mode}
          picked={effectivePicked}
          mentioned={mentioned}
          onToggle={togglePicked}
        />
        {nobodyReplies && draft.trim() ? (
          <p className="mx-auto w-full max-w-4xl px-3 pb-1 text-[11.5px] text-content/50">
            Pick who replies above, or address someone with @.
          </p>
        ) : null}
        <IrgatComposer
          sessionId={irgatGroupViewKey(groupId)}
          name={name}
          placeholder={`Message ${name} — type @ to address one member`}
          hotkeys={visible}
          busy={busy}
          voiceReply={
            lastReply && !busy ? { id: lastReply.id, text: lastReply.text } : null
          }
          focusToken={focusToken}
          mentions={members}
          onDraftChange={setDraft}
          onSubmit={send}
          controls={
            busy ? (
              <button
                type="button"
                onClick={() => void runner.stop(groupId)}
                className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[12px] text-content/65 hover:bg-content/8 hover:text-content"
              >
                <Square className="size-3" strokeWidth={2} />
                Stop round
              </button>
            ) : (
              <span className="px-1 text-[11.5px] text-content/40">
                {mode === "round" ? "Everyone replies in order" : "Only picked or @mentioned reply"}
              </span>
            )
          }
        />
      </div>
    </div>
  );
}

function GroupHeader({
  groupId,
  name,
  members,
  mode,
  autoHandoff,
  busy,
}: {
  groupId: string;
  name: string;
  members: readonly GroupMemberView[];
  mode: "round" | "pick";
  autoHandoff: boolean;
  busy: boolean;
}) {
  const [adding, setAdding] = useState<HTMLButtonElement | null>(null);
  const candidates = adding
    ? listIrgats().filter((irgat) => !members.some((m) => m.id === irgat.id))
    : [];
  return (
    <header
      className="flex shrink-0 flex-col gap-1.5 border-b border-stroke px-4 py-2"
      data-tauri-drag-region="deep"
    >
      <div className="flex min-w-0 items-center gap-2">
        <GroupMascots members={members} size="size-5" />
        <h2 className="min-w-0 truncate text-[13px] font-medium text-content">
          {name}
        </h2>
        <span className="shrink-0 text-[11.5px] text-content/45">
          {members.length} Irgats
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div
            role="radiogroup"
            aria-label="Who replies"
            className="flex rounded-md bg-content/6 p-0.5"
          >
            {(
              [
                ["round", "All in order"],
                ["pick", "Pick or @mention"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() =>
                  updateIrgatGroup(groupId, (group) => ({ ...group, mode: value }))
                }
                className={`h-5.5 rounded px-2 text-[11.5px] ${mode === value ? "bg-background-base text-content shadow-sm" : "text-content/55 hover:text-content"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoHandoff}
            title="When a reply @mentions another member, let that member answer once"
            onClick={() =>
              updateIrgatGroup(groupId, (group) => ({
                ...group,
                autoHandoff: !group.autoHandoff,
              }))
            }
            className={`h-6 rounded-md px-2 text-[11.5px] ${autoHandoff ? "bg-accent/12 text-content" : "text-content/55 hover:bg-content/8 hover:text-content"}`}
          >
            Follow-ups {autoHandoff ? "on" : "off"}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {members.map((member) => (
          <span
            key={member.id}
            data-group-member={member.id}
            title={member.role ?? member.name}
            className={`${CHIP} group/member border-content/10 bg-content/4 text-content/85`}
          >
            <IrgatRailMascot name={member.mascot} color={member.color} className="size-3.5 shrink-0" />
            {member.name}
            <button
              type="button"
              aria-label={`Remove ${member.name} from the group`}
              disabled={busy || members.length <= MIN_GROUP_MEMBERS}
              onClick={() => removeIrgatGroupMember(groupId, member.id)}
              className="-mr-1 grid size-4 place-items-center rounded-full text-content/45 hover:bg-content/10 hover:text-content disabled:hidden"
            >
              <X className="size-2.5" strokeWidth={2} />
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-label="Add an Irgat to the group"
          title="Add an Irgat"
          onClick={(event) => setAdding(event.currentTarget)}
          className={`${CHIP} border-dashed border-content/20 text-content/55 hover:border-content/35 hover:text-content`}
        >
          <UserAdd className="size-3" strokeWidth={1.75} />
          Add
        </button>
        {adding ? (
          <Popover
            anchor={adding}
            side="bottom"
            align="start"
            width={240}
            onDismiss={() => setAdding(null)}
            role="menu"
            aria-label="Add an Irgat"
            className="p-1"
          >
            {candidates.length ? (
              candidates.map((irgat) => {
                const look = irgatLook(irgat);
                return (
                  <button
                    key={irgat.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      addIrgatGroupMember(groupId, irgat.id);
                      setAdding(null);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-content hover:bg-content/8"
                  >
                    <IrgatRailMascot name={look.mascot} color={look.color} />
                    {look.name}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-2 text-[12px] text-content/55">
                Every Irgat is already in this room.
              </p>
            )}
          </Popover>
        ) : null}
      </div>
    </header>
  );
}

function GroupIntro({
  members,
  mode,
}: {
  members: readonly GroupMemberView[];
  mode: "round" | "pick";
}) {
  return (
    <div data-group-intro className="flex flex-col items-center gap-3 py-8 text-center">
      <GroupMascots members={members} size="size-8" />
      <div>
        <h3 className="text-[14px] font-medium text-content">Start the conversation</h3>
        <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-content/55">
          {mode === "round"
            ? "Everyone replies in order, and each reads the replies before it, so the second builds on or challenges the first."
            : "Only the members you pick above the composer, or @mention, reply."}{" "}
          Type @ to address one member directly.
        </p>
      </div>
      <ul className="flex w-full max-w-md flex-col gap-1 text-left">
        {members.map((member, index) => (
          <li
            key={member.id}
            className="flex items-center gap-2 rounded-md bg-content/4 px-2.5 py-1.5"
          >
            <span className="w-4 shrink-0 text-[11px] tabular-nums text-content/40">
              {index + 1}
            </span>
            <IrgatRailMascot name={member.mascot} color={member.color} />
            <span className="shrink-0 text-[12.5px] font-medium text-content">
              {member.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-content/45">
              {member.role ?? "No role in its SOUL.md yet"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpeakerBadge({
  name,
  color,
  mascot,
  harness,
  model,
  at,
  extra,
}: {
  name: string;
  color: string;
  mascot?: string;
  harness?: IrgatGroupMessage["harness"];
  model?: string;
  at?: number;
  extra?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {mascot ? (
        <IrgatRailMascot name={mascot} color={color} className="size-5 shrink-0" />
      ) : null}
      <span
        data-speaker={name}
        className="rounded px-1.5 py-0.5 text-[12px] font-semibold leading-none"
        style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
      >
        {name}
      </span>
      {harness ? (
        <span
          data-model-pill
          className="inline-flex items-center gap-1 rounded-full bg-content/6 px-1.5 py-0.5 text-[10.5px] leading-none text-content/55"
        >
          <HarnessIcon harness={harness} className="size-3" />
          {modelName({ harness, model })}
        </span>
      ) : null}
      {at ? <span className="text-[10.5px] text-content/35">{clock(at)}</span> : null}
      {extra}
    </div>
  );
}

function GroupMessageRow({
  message,
  member,
  members,
  answered,
  repliedTo,
  onAsk,
  onRetry,
  onOpenFile,
}: {
  message: IrgatGroupMessage;
  member?: GroupMemberView;
  members: readonly GroupMemberView[];
  /** Whether a member has spoken, or is lined up to, since this message. */
  answered: (irgatId: string) => boolean;
  repliedTo?: IrgatGroupMessage;
  onAsk: (irgatId: string, kind: "handoff" | "review") => void;
  onRetry?: () => void;
  onOpenFile?: OpenFileFn;
}) {
  if (message.role === "user") {
    return (
      <div data-group-message="user" className="flex flex-col items-end gap-1">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-content/8 px-3 py-2 text-[13px] leading-relaxed text-content">
          {message.text}
        </div>
        {message.attachments?.length ? (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
            {message.attachments.map((file) => (
              <AttachmentChip key={file.id} attachment={file} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  const name = member?.name ?? message.name ?? "A former member";
  const color = member?.color ?? message.color ?? "hsl(0 0% 60%)";
  const mascot = member?.mascot ?? message.mascot;
  if (message.role === "notice") {
    return (
      <div
        data-group-message="notice"
        role="alert"
        className="flex flex-wrap items-center gap-2 self-start rounded-lg border border-red-400/25 bg-red-400/6 px-3 py-1.5 text-[12px] text-content/75"
      >
        <span>
          <strong className="font-medium">{name}</strong> could not reply:{" "}
          {message.error ?? "the turn did not finish."}
        </span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded px-1.5 py-0.5 text-[11.5px] font-medium text-content hover:bg-content/8"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  const others = members.filter((entry) => entry.id !== message.irgatId);
  const handoffs = (message.handoffs ?? []).flatMap((id) => {
    const target = members.find((entry) => entry.id === id);
    return target && !answered(id) ? [target] : [];
  });
  return (
    <div data-group-message="irgat" data-irgat-id={message.irgatId} className="group/message flex flex-col gap-1.5">
      <SpeakerBadge
        name={name}
        color={color}
        mascot={mascot}
        harness={message.harness}
        model={message.model}
        at={message.at}
        extra={
          message.trigger && repliedTo ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-content/45">
              <CornerDownRight className="size-3" strokeWidth={1.75} />
              {message.trigger.kind === "review" ? "reviewing" : "answering"}{" "}
              {repliedTo.role === "user" ? "you" : `@${mentionHandle(repliedTo.name ?? "member")}`}
            </span>
          ) : null
        }
      />
      <div className="pl-6.5">
        {message.reaction ? (
          <p className="text-[13px] text-content/65">Reacted {message.reaction}</p>
        ) : (
          <AgentMarkdown text={message.text} onOpenFile={onOpenFile} localMedia />
        )}
        {message.error ? (
          <p className="mt-1 text-[11px] text-content/45">{message.error}</p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {handoffs.map((target) => (
            <button
              key={target.id}
              type="button"
              data-let-reply={target.id}
              onClick={() => onAsk(target.id, "handoff")}
              className={`${CHIP} border-accent/35 bg-accent/8 text-content hover:bg-accent/15`}
            >
              Let @{mentionHandle(target.name)} reply
            </button>
          ))}
          {others.length ? (
            <span className="flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
              {others.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  data-ask-review={target.id}
                  title={`Ask ${target.name} to review and respond to this`}
                  onClick={() => onAsk(target.id, "review")}
                  className={`${CHIP} border-content/12 text-content/60 hover:border-content/25 hover:text-content`}
                >
                  Ask @{mentionHandle(target.name)} to review
                </button>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LiveReply({
  member,
  seat,
  text,
  queue,
  onStop,
  onApproval,
  onOpenFile,
}: {
  member?: GroupMemberView;
  seat?: Session;
  text: string;
  queue: readonly GroupMemberView[];
  onStop: () => void;
  onApproval?: Props["onApproval"];
  onOpenFile?: OpenFileFn;
}) {
  const state = seat ? irgatState(seat) : undefined;
  const activity = state?.activity ?? "Getting ready";
  const approvals = seat
    ? seat.blocks.filter((block) => block.approval && !block.approval.decided)
    : [];
  const name = member?.name ?? "A member";
  const color = member?.color ?? "hsl(0 0% 60%)";
  return (
    <div data-group-live className="flex flex-col gap-1.5">
      <SpeakerBadge
        name={name}
        color={color}
        mascot={member?.mascot}
        harness={seat?.harness}
        model={seat?.model}
        extra={
          <button
            type="button"
            onClick={onStop}
            className="ml-1 inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] text-content/60 hover:bg-content/8 hover:text-content"
          >
            <Square className="size-2.5" strokeWidth={2} />
            Stop
          </button>
        }
      />
      <div className="pl-6.5">
        {text ? (
          <AgentMarkdown text={text} streaming onOpenFile={onOpenFile} />
        ) : (
          <Shimmer as="p" duration={1.4} className="text-[12.5px] text-content/55">
            {`${activity}…`}
          </Shimmer>
        )}
        {approvals.map((block) => (
          <div
            key={block.id}
            data-group-approval
            className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/6 px-3 py-2 text-[12.5px]"
          >
            <span className="min-w-0 flex-1">
              {name} asks to {block.tool?.title ?? block.text ?? "continue"}
            </span>
            <button
              type="button"
              onClick={() => onApproval?.(seat!.id, block.approval!.requestId, "allow")}
              className="primary-action rounded-md px-2 py-1 text-[12px]"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => onApproval?.(seat!.id, block.approval!.requestId, "deny")}
              className="rounded-md px-2 py-1 text-[12px] text-content/70 hover:bg-content/8"
            >
              Deny
            </button>
          </div>
        ))}
        {queue.length ? (
          <p className="mt-1.5 text-[11.5px] text-content/45">
            Up next: {queue.map((entry) => `@${mentionHandle(entry.name)}`).join(", ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReplyChips({
  members,
  mode,
  picked,
  mentioned,
  onToggle,
}: {
  members: readonly GroupMemberView[];
  mode: "round" | "pick";
  picked: readonly string[];
  mentioned: readonly string[];
  onToggle: (id: string) => void;
}) {
  const label = mentioned.length
    ? "Only mentioned reply:"
    : mode === "round"
      ? "Replying, in order:"
      : "Pick who replies:";
  return (
    <div
      data-reply-chips
      className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1 px-3 pb-1.5"
    >
      <span className="mr-0.5 text-[11.5px] text-content/45">{label}</span>
      {members.map((member) => {
        const on = mentioned.length
          ? mentioned.includes(member.id)
          : picked.includes(member.id);
        const order = mentioned.length
          ? mentioned.indexOf(member.id)
          : members.filter((entry) => picked.includes(entry.id)).indexOf(member);
        return (
          <button
            key={member.id}
            type="button"
            aria-pressed={on}
            disabled={mentioned.length > 0}
            data-reply-chip={member.id}
            onClick={() => onToggle(member.id)}
            className={`${CHIP} ${on ? "border-content/25 bg-content/8 text-content" : "border-content/10 text-content/40 hover:text-content/70"} disabled:cursor-default`}
          >
            <IrgatRailMascot name={member.mascot} color={member.color} className="size-3.5 shrink-0" />
            {member.name}
            {on && order >= 0 ? (
              <span className="text-[10px] tabular-nums text-content/45">{order + 1}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
