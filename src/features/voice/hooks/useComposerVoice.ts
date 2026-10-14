import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { keybindingShortcutLabel } from "../../settings/model/settings";
import {
  dictationAnchor,
  restoreAnchor,
  spliceTranscript,
  type DictationAnchor,
} from "../model/dictationText";
import type { Reply } from "../model/spokenReply";
import {
  loadVoiceSettings,
  subscribeVoiceSettings,
  VOICE_SETTINGS_DEFAULTS,
} from "../model/voiceSettings";
import {
  DICTATE_COMMAND,
  isDictateShortcut,
  isVoiceModeShortcut,
  VOICE_MODE_COMMAND,
} from "../model/voiceShortcuts";
import { useDictation } from "./useDictation";
import { useVoiceConversation } from "./useVoiceConversation";
import { useVoiceSupport } from "./useVoiceSupport";

type Options = {
  /** The field dictation writes into. */
  field: { current: HTMLTextAreaElement | null };
  /** Voice can run in this composer right now: mounted, visible, usable. */
  enabled: boolean;
  /** This composer owns the window-level voice shortcuts. */
  hotkeys: boolean;
  /** The agent is working, so voice mode waits instead of listening. */
  busy?: boolean;
  /** There is nothing to send, so voice mode may open the microphone. */
  draftEmpty: boolean;
  /** The agent's last finished reply, which voice mode reads aloud. */
  reply?: Reply | null;
  /**
   * Writes dictated text the way typing would, without an input event, and
   * leaves the caret where the hook asks.
   */
  write: (
    text: string,
    selectionStart: number,
    selectionEnd?: number,
  ) => void;
  /** Sends what dictation settled on, for Enter mid-sentence and voice mode. */
  submit: (text: string) => void;
  /** Runs just before the microphone opens, while the draft is untouched. */
  onBegin?: () => void;
  /** Dictation drops whenever this changes, as a cleared draft should. */
  resetToken?: unknown;
};

/**
 * Dictation and hands-free voice mode for one composer: the capture, the
 * conversation, the shortcuts, and the keys the field itself handles. Every
 * composer that takes voice shares this one state machine, so the behaviour
 * cannot drift between them.
 */
export function useComposerVoice({
  field,
  enabled,
  hotkeys,
  busy = false,
  draftEmpty,
  reply = null,
  write,
  submit,
  onBegin,
  resetToken,
}: Options) {
  const settings = useSyncExternalStore(
    subscribeVoiceSettings,
    loadVoiceSettings,
    () => VOICE_SETTINGS_DEFAULTS,
  );
  const supported = useVoiceSupport();
  const available = supported && settings.dictation;

  // The composer re-renders on every keystroke, so the callbacks it hands in
  // are read through refs rather than pinned as dependencies.
  const callbacks = useRef({ write, submit, onBegin });
  callbacks.current = { write, submit, onBegin };
  const anchorRef = useRef<DictationAnchor | null>(null);
  /** Enter while dictating sends once the transcript settles. */
  const sendAfterRef = useRef(false);
  const noteWordsRef = useRef<() => void>(() => {});

  const dictation = useDictation({
    onBegin: () => {
      const el = field.current;
      if (!el) return;
      anchorRef.current = dictationAnchor(
        el.value,
        el.selectionStart ?? el.value.length,
        el.selectionEnd ?? el.value.length,
      );
      callbacks.current.onBegin?.();
    },
    onTranscript: (text, final) => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      if (final && !text.trim()) {
        const restored = restoreAnchor(anchor);
        callbacks.current.write(
          restored.text,
          restored.selectionStart,
          restored.selectionEnd,
        );
        return;
      }
      const next = spliceTranscript(anchor, text);
      callbacks.current.write(next.text, next.caret);
      if (!final) noteWordsRef.current();
    },
    onEnd: (reason) => {
      const anchor = anchorRef.current;
      anchorRef.current = null;
      if (reason === "cancel" && anchor) {
        const restored = restoreAnchor(anchor);
        callbacks.current.write(
          restored.text,
          restored.selectionStart,
          restored.selectionEnd,
        );
      }
      const send = sendAfterRef.current && reason === "final";
      sendAfterRef.current = false;
      field.current?.focus();
      const value = field.current?.value ?? "";
      if (send && value.trim()) callbacks.current.submit(value);
    },
  });

  const { detach, toggle: toggleDictation } = dictation;
  const conversation = useVoiceConversation({
    dictation,
    available: enabled && available,
    busy,
    draftEmpty,
    reply,
    send: () => {
      sendAfterRef.current = true;
      dictation.stop();
    },
  });
  noteWordsRef.current = conversation.noteWords;
  const {
    toggle: toggleVoiceMode,
    stopSpeaking,
    phase: conversationPhase,
  } = conversation;

  const dictationShortcut = keybindingShortcutLabel(
    DICTATE_COMMAND,
    `${MOD}${SHIFT}E`,
  );
  const voiceModeShortcut = keybindingShortcutLabel(
    VOICE_MODE_COMMAND,
    `${MOD}${SHIFT}L`,
  );

  useEffect(() => {
    if (!hotkeys || !enabled || !available) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Whichever composer handles the key first marks it, so a second one on
      // screen never also toggles its own microphone.
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape" && conversationPhase === "speaking") {
        event.preventDefault();
        stopSpeaking();
        return;
      }
      if (isVoiceModeShortcut(event)) {
        event.preventDefault();
        field.current?.focus();
        toggleVoiceMode();
        return;
      }
      if (!isDictateShortcut(event)) return;
      event.preventDefault();
      field.current?.focus();
      toggleDictation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    available,
    conversationPhase,
    enabled,
    field,
    hotkeys,
    stopSpeaking,
    toggleDictation,
    toggleVoiceMode,
  ]);

  useEffect(() => {
    if (!enabled || !available) detach();
  }, [available, detach, enabled]);
  useEffect(() => detach(), [detach, resetToken]);

  /**
   * The keys the field itself owns while voice is running: Escape puts the
   * draft back, Enter finishes and sends, anything else pauses voice mode.
   * Returns true once the key is spent.
   */
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (
        conversation.on &&
        !event.metaKey &&
        !event.ctrlKey &&
        ![
          "Shift",
          "Alt",
          "Meta",
          "Control",
          "CapsLock",
          "Escape",
          "Enter",
        ].includes(event.key)
      )
        conversation.noteTyping();
      if (!dictation.active) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        dictation.cancel();
        return true;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (dictation.phase === "starting") return true;
        sendAfterRef.current = true;
        dictation.stop();
        return true;
      }
      return false;
    },
    [conversation, dictation],
  );

  /** Typing took over from dictation; the words already heard stay. */
  const noteInput = useCallback(() => {
    if (dictation.active) dictation.detach();
  }, [dictation]);

  return {
    /** Voice input is supported here and turned on in Settings › Voice. */
    available,
    settings,
    dictation,
    conversation,
    dictationShortcut,
    voiceModeShortcut,
    handleKeyDown,
    noteInput,
  };
}

export type ComposerVoice = ReturnType<typeof useComposerVoice>;
