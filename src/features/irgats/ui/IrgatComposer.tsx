import {
  lazy,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  mentionTokenAt,
  replaceMentionToken,
  type MentionToken,
} from "../../files/model/fileMentions";
import { mentionHandle, mentionSuggestions } from "../model/irgatGroupMentions";
import { IrgatMentionPicker, type ComposerMention } from "./IrgatMentionPicker";
import { useAppWindows } from "../../sessions/hooks/useAppWindows";
import {
  AppWindowPicker,
  SharedAppWindow,
} from "../../sessions/ui/AppWindowPicker";
import {
  appWindowToken,
  appWindowTokens,
  withAppWindow,
  type AppWindow,
} from "../../sessions/model/appWindows";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { ArrowUp, FolderPlus, Plus, SmilePlus } from "../../../shared/ui/icons";
import { AttachmentChip } from "../../sessions/ui/AttachmentChip";
import type { Attachment } from "../../sessions/model/session";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
  pickFolderAttachments,
  revokeAttachment,
} from "../../sessions/model/attachments";
import {
  getComposerDraft,
  setComposerDraft,
} from "../../sessions/model/draftCache";
import { useFileDrop } from "../../sessions/hooks/useFileDrop";
import { resizeComposer } from "../../sessions/model/composerResize";
import { useComposerAutocorrect } from "../../settings/model/displayPrefs";
import {
  consumeQuoteRequest,
  type QuoteRequest,
} from "../../sessions/model/quoteDraft";
import { useComposerVoice } from "../../voice/hooks/useComposerVoice";
import type { Reply } from "../../voice/model/spokenReply";
import {
  ComposerVoiceButtons,
  ComposerVoiceStatus,
} from "../../voice/ui/ComposerVoiceControls";
import {
  LiveVoiceButton,
  LiveVoicePill,
} from "../../voice/live/ui/LiveVoiceControls";

// Loaded on first open, with its emoji data, so neither weighs on startup.
const EmojiPickerPopover = lazy(() =>
  import("../../../shared/ui/EmojiPicker").then((module) => ({
    default: module.EmojiPickerPopover,
  })),
);

const DROP_STATE = { current: { attachmentsSupported: true, remote: false } };

/** Tallest the field grows before it scrolls, in px. */
const MAX_HEIGHT = 160;
/** The quiet buttons under the input: a glyph that gains a backdrop on hover. */
const TOOL_BUTTON =
  "grid size-6.5 shrink-0 place-items-center rounded-md text-content/55 transition-colors hover:bg-content/8 hover:text-content disabled:opacity-50";
const INLINE_ATTACH_BUTTON =
  "grid size-6.5 shrink-0 place-items-center rounded-md bg-content/8 text-content/55 hover:bg-content/12 hover:text-content disabled:opacity-50";
/** Attach and attach-folder share the first column, 0.125rem apart. */
const INPUT_COLUMNS = "grid-cols-[3.375rem_minmax(0,1fr)_1.625rem]";
/** The same line with room for the voice buttons between the field and send. */
const VOICE_INPUT_COLUMNS = "grid-cols-[3.375rem_minmax(0,1fr)_auto_1.625rem]";
const FIELD_CLASSES =
  "scrollbar-none block min-w-0 w-full resize-none bg-transparent py-1 text-[13px] leading-4.5 text-content outline-none placeholder:text-content/35";

type Props = {
  sessionId: string;
  name: string;
  enabled?: boolean;
  /** This composer owns the voice shortcuts while its pane has the focus. */
  hotkeys?: boolean;
  /** The Irgat is working, so voice mode waits for the reply. */
  busy?: boolean;
  /** The Irgat's last finished reply, which voice mode reads aloud. */
  voiceReply?: Reply | null;
  focusToken?: number;
  quoteRequest?: QuoteRequest;
  onQuoteRequestConsumed?: (id: number) => void;
  onDraftChange?: (text: string) => void;
  /** Returns false when the message wasn't taken, so the draft stays. */
  onSubmit: (
    text: string,
    attachments: Attachment[],
  ) => boolean | void | Promise<boolean | void>;
  onFocus?: () => void;
  /**
   * Sits under the input on the right, like the model and its effort, with
   * attach across from it. Without any, attach and send share the field's
   * line, as in the floating chat.
   */
  controls?: ReactNode;
  /** Sits beside attach and emoji, on the left under the input. */
  tools?: ReactNode;
  /** Who typing @ suggests, as in a group room. */
  mentions?: readonly ComposerMention[];
  /** Replaces "Message <name>". */
  placeholder?: string;
  /** Offers a Live voice call with the agent; real chats only. */
  live?: boolean;
  computerUse?: boolean;
  onStop?: () => void;
};

/**
 * A messaging app's input for the Irgat: attach, type, send, whether or not
 * it is mid-reply; Escape stops a reply. Files dropped anywhere on the chat
 * attach here. Attach sits under the input, with any `controls` (the model
 * and its effort) across from it, or beside the field when there are none;
 * permissions and checkout live in the details panel.
 */
export function IrgatComposer({
  sessionId,
  name,
  enabled = true,
  hotkeys = false,
  busy = false,
  voiceReply = null,
  focusToken,
  quoteRequest,
  onQuoteRequestConsumed,
  onDraftChange,
  onSubmit,
  onFocus,
  controls,
  tools,
  mentions,
  placeholder,
  live = false,
  computerUse = true,
  onStop,
}: Props) {
  const [text, setText] = useState(() => getComposerDraft(sessionId) ?? "");
  const [mentionToken, setMentionToken] = useState<MentionToken | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const mentionOptions = useMemo(
    () =>
      mentions?.length && mentionToken
        ? mentionSuggestions(mentionToken.query, mentions)
        : [],
    [mentions, mentionToken],
  );
  const appWindows = useAppWindows(
    sessionId.replace(/^floating:/, ""),
    mentionToken !== null,
    mentionToken?.query ?? "",
    computerUse,
  );
  const appOptions = computerUse ? appWindows.windows : [];
  const mentionCount = mentionOptions.length + appOptions.length;
  const mentionOpen =
    mentionToken !== null &&
    (mentionCount > 0 ||
      (computerUse && (appWindows.loading || !!appWindows.error)));
  const trackMention = (value: string, caret: number) => {
    if (!mentions?.length && !computerUse) return;
    const token = mentionTokenAt(value, caret);
    if (
      token?.start === mentionToken?.start &&
      token?.end === mentionToken?.end &&
      token?.query === mentionToken?.query
    )
      return;
    if (token?.query !== mentionToken?.query) setMentionActive(0);
    setMentionToken(token);
  };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const autocorrect = useComposerAutocorrect();
  const textRef = useRef(text);
  const attachmentsRef = useRef(attachments);
  const consumedQuote = useRef<number | null>(null);
  const readGeneration = useRef(0);
  const pendingReadsRef = useRef(0);
  const [pendingReads, setPendingReads] = useState(0);
  const [multiline, setMultiline] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const inlineMeasure = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const ready =
    enabled &&
    !submitting &&
    !appWindows.selecting &&
    pendingReads === 0 &&
    (text.trim().length > 0 || attachments.length > 0);
  const inline = !controls;
  // Attachments sit above the field like a second line of text, so an inline
  // field moves above the buttons for them too.
  const stacked = inline && (multiline || attachments.length > 0);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const measure = inlineMeasure.current;
    const fit = () => {
      if (!el.clientWidth) return;
      if (measure?.clientWidth) {
        // Always measure at the inline width. Expanding the field above the
        // buttons must not make it collapse again just because it is wider.
        const style = getComputedStyle(measure);
        const singleLineHeight =
          Number.parseFloat(style.lineHeight) +
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom);
        setMultiline(measure.scrollHeight > singleLineHeight + 1);
      }
      // Holds the input's height while measuring, as sessions do, so the
      // transcript above never grows for a moment and loses its bottom pin.
      resizeComposer(el, MAX_HEIGHT);
      el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
    };
    fit();
    // An empty field stays one line at any width, so once measured, resizing
    // the panes beside it need not measure it every frame.
    const sized = measure ?? el;
    if (!text && sized.clientWidth) return;
    let width = sized.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a new width can rewrap the text; growing taller is our own doing.
      if (sized.clientWidth === width) return;
      width = sized.clientWidth;
      fit();
    });
    observer.observe(sized);
    return () => observer.disconnect();
  }, [text, multiline, stacked]);

  useLayoutEffect(() => {
    if (focusToken != null) field.current?.focus();
  }, [focusToken]);

  const update = (next: string) => {
    textRef.current = next;
    setText(next);
    setComposerDraft(sessionId, next);
    onDraftChange?.(next);
  };
  const emojiButton = useRef<HTMLButtonElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Where the pick goes: the field's selection when the picker opened.
  const emojiSelection = useRef<[number, number] | null>(null);
  const toggleEmoji = () => {
    if (emojiOpen) return setEmojiOpen(false);
    const el = field.current;
    emojiSelection.current = el ? [el.selectionStart, el.selectionEnd] : null;
    setEmojiOpen(true);
  };
  const insertEmoji = (emoji: string) => {
    const current = textRef.current;
    const [start, end] = emojiSelection.current ?? [
      current.length,
      current.length,
    ];
    update(current.slice(0, start) + emoji + current.slice(end));
    setEmojiOpen(false);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(caret, caret);
    });
  };
  useLayoutEffect(() => {
    const next = consumeQuoteRequest(
      textRef.current,
      consumedQuote.current,
      quoteRequest,
    );
    consumedQuote.current = next.consumedId;
    if (next.changed) {
      update(next.draft);
      if (enabled) field.current?.focus();
    }
    if (next.consumedId != null) onQuoteRequestConsumed?.(next.consumedId);
  }, [quoteRequest, onQuoteRequestConsumed, enabled]);
  useLayoutEffect(
    () => () => {
      readGeneration.current++;
      for (const file of attachmentsRef.current) revokeAttachment(file);
    },
    [],
  );
  const add = (incoming: Attachment[]) => {
    if (incoming.length === 0) return;
    const next = mergeAttachments(attachmentsRef.current, incoming);
    attachmentsRef.current = next;
    setAttachments(next);
  };
  const readAttachments = useCallback(
    (read: () => Promise<Attachment[]>, dropped = false) => {
      if (submittingRef.current) return;
      const generation = readGeneration.current;
      pendingReadsRef.current++;
      setPendingReads(pendingReadsRef.current);
      setDropError(null);
      Promise.resolve()
        .then(read)
        .then((incoming) => {
          if (generation !== readGeneration.current) {
            incoming.forEach(revokeAttachment);
            return;
          }
          if (incoming.length === 0) {
            if (dropped)
              setDropError(
                "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.",
              );
            return;
          }
          add(incoming);
        })
        .catch((reason: unknown) => {
          if (generation === readGeneration.current)
            setDropError(
              reason instanceof Error ? reason.message : String(reason),
            );
        })
        .finally(() => {
          pendingReadsRef.current--;
          if (generation === readGeneration.current)
            setPendingReads(pendingReadsRef.current);
        });
    },
    [],
  );
  const readDropped = useCallback(
    (read: () => Promise<Attachment[]>) => {
      readAttachments(read, true);
    },
    [readAttachments],
  );
  const fileDrag = useFileDrop({
    anchor: box,
    enabled: enabled && !submitting,
    state: DROP_STATE,
    read: readDropped,
    onError: setDropError,
  });
  const send = () => {
    if (
      !enabled ||
      submittingRef.current ||
      pendingReadsRef.current > 0 ||
      appWindows.selecting
    )
      return;
    const message = textRef.current.trim();
    const draft = textRef.current;
    const files = attachmentsRef.current;
    if (!message && !files.length) return;
    const generation = readGeneration.current;
    const clear = (accepted: boolean | void) => {
      if (accepted === false) return;
      if (generation !== readGeneration.current) {
        if (getComposerDraft(sessionId) === draft)
          setComposerDraft(sessionId, "");
        return;
      }
      update("");
      attachmentsRef.current = [];
      setAttachments([]);
      setDropError(null);
    };
    const result = onSubmit(
      withAppWindow(message, appWindows.selection),
      files,
    );
    if (result instanceof Promise) {
      submittingRef.current = true;
      setSubmitting(true);
      void result
        .then(clear)
        .catch((reason: unknown) => {
          if (generation === readGeneration.current)
            setDropError(
              reason instanceof Error ? reason.message : String(reason),
            );
        })
        .finally(() => {
          submittingRef.current = false;
          if (generation === readGeneration.current) setSubmitting(false);
        });
    } else clear(result);
  };

  /** Writes dictated text the way typing would, then places the caret. */
  const writeDraft = (
    text: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ) => {
    update(text);
    const el = field.current;
    if (!el) return;
    // The field is controlled, so the value has to land before the caret;
    // React leaves both alone once they already match the next render.
    el.value = text;
    resizeComposer(el, MAX_HEIGHT);
    el.setSelectionRange(selectionStart, selectionEnd);
  };
  const pickMention = (member: ComposerMention) => {
    if (!mentionToken) return;
    const handle = mentionHandle(member.name);
    const next = replaceMentionToken(textRef.current, mentionToken, handle);
    setMentionToken(null);
    writeDraft(next, mentionToken.start + handle.length + 2);
    field.current?.focus();
  };
  const pickApp = async (window: AppWindow) => {
    const token = mentionToken;
    const draft = textRef.current;
    if (!token) return;
    const selection = await appWindows.select(window);
    if (!selection || textRef.current !== draft) return;
    const label = appWindowToken(window).slice(1);
    const next = replaceMentionToken(draft, token, label);
    setMentionToken(null);
    writeDraft(next, token.start + label.length + 2);
    field.current?.focus();
  };
  /** Arrows, Enter, Tab and Escape steer the @ picker while it is open. */
  const handleMentionKey = (event: ReactKeyboardEvent): boolean => {
    if (!mentionOpen) return false;
    const count = mentionCount;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!count) {
        event.preventDefault();
        return true;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setMentionActive((index) => (index + step + count) % count);
    } else if (
      (event.key === "Enter" || event.key === "Tab") &&
      !event.shiftKey
    ) {
      const index = Math.min(mentionActive, count - 1);
      if (index < 0) {
        event.preventDefault();
        return true;
      }
      if (index < mentionOptions.length) pickMention(mentionOptions[index]);
      else void pickApp(appOptions[index - mentionOptions.length]);
    } else if (event.key === "Escape") {
      setMentionToken(null);
    } else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const voice = useComposerVoice({
    field,
    // A message on its way counts as busy: voice mode stays on and reads the reply.
    enabled,
    hotkeys,
    busy: busy || submitting,
    draftEmpty: !text.trim() && attachments.length === 0,
    reply: voiceReply,
    write: writeDraft,
    submit: () => send(),
    onBegin: () => setEmojiOpen(false),
  });
  const inlineColumns = voice.available ? VOICE_INPUT_COLUMNS : INPUT_COLUMNS;

  // `tool` sizes the plus to match the emoji face beside it: its cross fills
  // 14 of the glyph's 24 units against the face's 21, so it is drawn larger,
  // with a thinner stroke so both lines render about 1px wide.
  const attachButton = (className: string, tool = false) => (
    <button
      type="button"
      title="Attach files"
      aria-label="Attach files"
      disabled={!enabled || submitting}
      onClick={() => readAttachments(pickAttachments)}
      className={className}
    >
      <Plus
        className={tool ? "size-4.25" : "size-3.5"}
        strokeWidth={tool ? 1.5 : 1.75}
      />
    </button>
  );
  const attachFolderButton = (className: string) => (
    <button
      type="button"
      title="Attach folder…"
      aria-label="Attach folder"
      disabled={!enabled || submitting}
      onClick={() => readAttachments(pickFolderAttachments)}
      className={className}
    >
      <FolderPlus className="size-3.5" strokeWidth={1.75} />
    </button>
  );
  const input = (className: string) => (
    <textarea
      ref={field}
      rows={1}
      aria-label={`Message ${name}`}
      placeholder={placeholder ?? `Message ${name}`}
      spellCheck={autocorrect}
      autoCorrect={autocorrect ? "on" : "off"}
      disabled={!enabled || submitting}
      value={text}
      onFocus={onFocus}
      onBlur={() => setMentionToken(null)}
      onSelect={(event) =>
        trackMention(
          event.currentTarget.value,
          event.currentTarget.selectionStart,
        )
      }
      onChange={(event) => {
        // Typing takes over from dictation and keeps what was heard.
        voice.noteInput();
        update(event.target.value);
        trackMention(event.target.value, event.target.selectionStart);
      }}
      onKeyDown={(event) => {
        if (isImeComposition(event.nativeEvent)) return;
        if (handleMentionKey(event)) return;
        // While the microphone is open, Escape and Enter belong to dictation,
        // not to the reply this chat would otherwise stop or send.
        if (voice.handleKeyDown(event)) {
          event.stopPropagation();
          return;
        }
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        send();
      }}
      onPaste={(event) => {
        const files = filesFromClipboard(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        readAttachments(() => attachmentsFromFiles(files));
      }}
      className={`${FIELD_CLASSES} ${className}`}
    />
  );
  const sendButton = (className: string) => (
    <button
      type="submit"
      aria-label="Send"
      title={pendingReads ? "Reading attachments…" : "Send"}
      disabled={!ready}
      className={`primary-action grid size-6.5 place-items-center rounded-md transition-[background-color,color,transform] duration-150 active:scale-90 disabled:cursor-default ${className}`}
    >
      <ArrowUp className="size-3.5" strokeWidth={2} />
    </button>
  );

  return (
    <form
      className="mx-auto w-full max-w-4xl shrink-0 p-1.5 pt-0 font-sans"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div
        ref={box}
        className={`agent-chat-composer relative rounded-lg border bg-content/3 backdrop-blur-sm ${fileDrag ? "border-accent/60" : "border-content/10 has-focus:border-content/20"}`}
      >
        {live ? <LiveVoicePill sessionId={sessionId} /> : null}
        {mentionOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1.5">
            {mentionOptions.length ? (
              <IrgatMentionPicker
                options={mentionOptions}
                active={mentionActive}
                onActive={setMentionActive}
                onPick={pickMention}
              />
            ) : null}
            {computerUse ? (
              <AppWindowPicker
                windows={appOptions}
                active={mentionActive - mentionOptions.length}
                onActive={(index) =>
                  setMentionActive(index + mentionOptions.length)
                }
                onPick={(window) => void pickApp(window)}
                loading={appWindows.loading}
                error={appWindows.error}
              />
            ) : null}
          </div>
        ) : null}
        {appWindows.selection ? (
          <SharedAppWindow
            selection={appWindows.selection}
            disabled={appWindows.selecting}
            onControl={(allowed) =>
              void appWindows.select(appWindows.selection!.window, allowed)
            }
            onRemove={() => {
              void appWindows.revoke();
              let next = textRef.current;
              for (const token of appWindowTokens(next))
                next = next.replace(token, "");
              update(next);
            }}
            onStop={
              busy
                ? () => {
                    void appWindows.revoke();
                    onStop?.();
                  }
                : undefined
            }
          />
        ) : null}
        {appWindows.error && !mentionOpen ? (
          <p role="alert" className="px-3 py-2 text-xs text-red-400">
            {appWindows.error}
          </p>
        ) : null}
        {fileDrag ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent/8 text-[12px] text-content/70">
            Drop files or folders to attach
          </div>
        ) : null}
        {dropError ? (
          <p role="alert" className="px-3 pt-2 text-xs text-red-400">
            {dropError}
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
            {attachments.map((file) => (
              <AttachmentChip
                key={file.id}
                attachment={file}
                onRemove={() => {
                  if (submittingRef.current) return;
                  revokeAttachment(file);
                  const next = attachmentsRef.current.filter(
                    (item) => item.id !== file.id,
                  );
                  attachmentsRef.current = next;
                  setAttachments(next);
                }}
              />
            ))}
          </div>
        ) : null}
        <ComposerVoiceStatus voice={voice} />
        {inline ? (
          <div
            data-layout={stacked ? "multiline" : "inline"}
            className={`relative grid min-h-9 ${inlineColumns} items-center gap-x-1.5 p-1 ${stacked ? "gap-y-1" : ""}`}
          >
            <div
              aria-hidden="true"
              className={`pointer-events-none invisible absolute inset-x-1 top-1 grid ${inlineColumns} gap-x-1.5`}
            >
              <textarea
                ref={inlineMeasure}
                tabIndex={-1}
                readOnly
                rows={1}
                value={text}
                className={`${FIELD_CLASSES} col-start-2 h-0 overflow-hidden`}
              />
            </div>
            <div
              className={`col-start-1 flex items-center gap-0.5 ${stacked ? "row-start-2" : "row-start-1"}`}
            >
              {attachButton(INLINE_ATTACH_BUTTON)}
              {attachFolderButton(INLINE_ATTACH_BUTTON)}
            </div>
            {input(
              `row-start-1 ${stacked ? `${voice.available ? "col-span-4" : "col-span-3"} col-start-1 px-1.5` : "col-start-2"}`,
            )}
            {voice.available ? (
              <div
                className={`col-start-3 flex items-center ${stacked ? "row-start-2" : "row-start-1"}`}
              >
                <ComposerVoiceButtons
                  voice={voice}
                  disabled={!enabled || submitting}
                />
              </div>
            ) : null}
            {sendButton(
              `${voice.available ? "col-start-4" : "col-start-3"} ${stacked ? "row-start-2" : "row-start-1"}`,
            )}
          </div>
        ) : (
          // Even padding centers send beside one line, and keeps it at the
          // bottom as the text grows.
          <div className="flex items-end gap-1.5 p-1.25">
            {input("flex-1 self-center px-1.5")}
            {sendButton("shrink-0")}
          </div>
        )}
      </div>
      {inline ? null : (
        // The right inset matches the box's border and padding, so the last
        // control lines up under send.
        <div className="flex min-w-0 items-center gap-0.5 pt-1 pl-1 pr-1.5">
          {attachButton(TOOL_BUTTON, true)}
          {attachFolderButton(TOOL_BUTTON)}
          <button
            ref={emojiButton}
            type="button"
            title="Emoji"
            aria-label="Add emoji"
            aria-expanded={emojiOpen}
            disabled={!enabled || submitting}
            onClick={toggleEmoji}
            className={`${TOOL_BUTTON} ${emojiOpen ? "bg-content/8 text-content" : ""}`}
          >
            <SmilePlus className="size-3.25" strokeWidth={2} />
          </button>
          {emojiOpen ? (
            <Suspense fallback={null}>
              <EmojiPickerPopover
                anchor={emojiButton}
                onPick={insertEmoji}
                onDismiss={() => {
                  setEmojiOpen(false);
                  field.current?.focus();
                }}
              />
            </Suspense>
          ) : null}
          <ComposerVoiceButtons
            voice={voice}
            disabled={!enabled || submitting}
          />
          {live ? (
            <LiveVoiceButton sessionId={sessionId} disabled={!enabled} />
          ) : null}
          {tools}
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {controls}
          </div>
        </div>
      )}
    </form>
  );
}
