import type { ComposerVoice } from "../hooks/useComposerVoice";
import {
  DictationButton,
  DictationErrorNotice,
  DictationStrip,
} from "./DictationControls";
import { VoiceModeButton, VoiceModeStrip } from "./VoiceModeControls";

/**
 * What a composer shows above its button row while voice runs: any failure,
 * then the voice-mode strip or the dictation meter. Renders nothing when the
 * microphone is idle.
 */
export function ComposerVoiceStatus({ voice }: { voice: ComposerVoice }) {
  const { dictation, conversation, settings } = voice;
  return (
    <>
      {dictation.error ? (
        <DictationErrorNotice
          error={dictation.error}
          onDismiss={dictation.clearError}
        />
      ) : null}
      {conversation.error ? (
        <DictationErrorNotice
          error={{ message: conversation.error }}
          onDismiss={conversation.clearError}
        />
      ) : null}
      {conversation.phase !== "off" ? (
        <VoiceModeStrip
          phase={conversation.phase}
          heard={conversation.heard}
          pauseMs={settings.conversationPauseMs}
          readReplies={settings.readReplies}
          levels={dictation.levels}
          onStopSpeaking={conversation.stopSpeaking}
          onEnd={conversation.turnOff}
        />
      ) : dictation.phase !== "idle" ? (
        <DictationStrip
          phase={dictation.phase}
          startedAt={dictation.startedAt}
          venue={dictation.venue}
          levels={dictation.levels}
          onCancel={dictation.cancel}
          onDone={dictation.stop}
        />
      ) : null}
    </>
  );
}

/** The voice-mode and microphone buttons, in that order, or nothing. */
export function ComposerVoiceButtons({
  voice,
  disabled = false,
}: {
  voice: ComposerVoice;
  disabled?: boolean;
}) {
  if (!voice.available) return null;
  const { dictation, conversation } = voice;
  return (
    <>
      <VoiceModeButton
        on={conversation.on}
        shortcut={voice.voiceModeShortcut}
        disabled={disabled}
        onToggle={conversation.toggle}
      />
      <DictationButton
        phase={dictation.phase}
        levels={dictation.levels}
        shortcut={voice.dictationShortcut}
        disabled={disabled}
        onToggle={dictation.toggle}
      />
    </>
  );
}
