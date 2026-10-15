import { useState } from "react";
import { createRoot } from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { VoiceStatus } from "../../src/platform/tauri/voice";
import type { Reply } from "../../src/features/voice/model/spokenReply";
import "../../src/styles/index.css";

// The real composer and Voice settings over a mocked Rust side: capture and
// speech events are emitted by the test through `window.voice`.
const GRANTED: VoiceStatus = {
  supported: true,
  microphone: "granted",
  speech: "granted",
  onDevice: true,
  languageAvailable: true,
  locale: "tr-TR",
  cloudKey: false,
};

type VoiceDriver = {
  status: VoiceStatus;
  capture: string | null;
  speech: string | null;
  speechProvider: string | null;
  heard: string;
  calls: string[];
  level: (level: number) => Promise<void>;
  partial: (text: string) => Promise<void>;
  final: (text?: string) => Promise<void>;
  reply: (text: string) => void;
  finishSpeech: () => Promise<void>;
};

declare global {
  interface Window {
    voice: VoiceDriver;
    isTauri?: boolean;
  }
}

window.isTauri = true;

const driver: VoiceDriver = {
  status: GRANTED,
  capture: null,
  speech: null,
  speechProvider: null,
  heard: "",
  calls: [],
  level: (level) =>
    emit("irgat:voice", { kind: "level", capture: driver.capture, level }),
  partial: (text) => {
    driver.heard = text;
    return emit("irgat:voice", {
      kind: "partial",
      capture: driver.capture,
      text,
    });
  },
  final: (text = driver.heard) =>
    emit("irgat:voice", { kind: "final", capture: driver.capture, text }),
  reply: () => {},
  finishSpeech: () =>
    emit("irgat:voice-speech", { id: driver.speech, interrupted: false }),
};
window.voice = driver;

mockIPC(
  (command, args) => {
    driver.calls.push(command);
    const payload = args as Record<string, unknown>;
    switch (command) {
      case "voice_status":
      case "voice_request_access":
        return driver.status;
      case "voice_start":
        driver.capture = (payload.options as { capture: string }).capture;
        driver.heard = "";
        return null;
      case "voice_stop":
        window.setTimeout(() => void driver.final(), 400);
        return null;
      case "voice_speak":
        driver.speech = payload.id as string;
        driver.speechProvider = payload.provider as string;
        return null;
      case "voice_stop_speaking":
        void emit("irgat:voice-speech", {
          id: payload.id,
          interrupted: true,
        });
        return null;
      case "voice_list_voices":
        return [
          { name: "Yelda", locale: "tr-TR" },
          { name: "Samantha", locale: "en-US" },
        ];
      default:
        throw new Error(`${command} is not available in this fixture`);
    }
  },
  { shouldMockEvents: true },
);

mockWindows("main");

const view = new URLSearchParams(location.search).get("view");

const { Composer } = await import("../../src/features/sessions/ui/Composer");
const { SettingsView } =
  await import("../../src/features/settings/ui/SettingsView");

const { UsageChips } = await import("../../src/app/shell/UsageFooter");
const { setCachedRateLimits } =
  await import("../../src/features/providers/model/rateLimitsCache");
setCachedRateLimits("codex", "default", {
  provider: "codex",
  status: "ok",
  updatedAt: Date.now(),
  error: null,
  session: {
    usedPercent: 25,
    windowMinutes: 300,
    resetsAt: Date.now() + 3600000,
  },
  weekly: null,
  monthly: null,
  resetCredits: null,
});

function ComposerFixture() {
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  driver.reply = (text) => {
    setReply({ id: `reply-${Date.now()}`, text });
    setBusy(false);
  };
  return (
    <div className="text-content mx-auto flex h-screen max-w-[760px] flex-col justify-end gap-3 px-6 pb-8">
      <div className="flex flex-col gap-2 text-[13px]">
        {sent.map((text, index) => (
          <div
            key={index}
            data-sent
            className="self-end rounded-xl bg-content/8 px-3 py-2"
          >
            {text}
          </div>
        ))}
        {reply ? <div className="text-content/80">{reply.text}</div> : null}
        {busy ? <div className="text-content/45">Working…</div> : null}
      </div>
      <Composer
        focused
        hotkeys
        harness="codex"
        model=""
        modelLeading={
          <UsageChips providers={["codex"]} session={{ harness: "codex" }} />
        }
        runtimeMode="supervised"
        executionCwd="~/code/irgat"
        hideTopBar
        busy={busy}
        voiceReply={busy ? null : reply}
        onFocus={() => {}}
        onCwdChange={() => {}}
        onModelChange={() => {}}
        onRuntimeModeChange={() => {}}
        onSubmit={(text) => {
          setSent((current) => [...current, text]);
          setBusy(true);
          return true;
        }}
      />
    </div>
  );
}

function SettingsFixture() {
  return (
    <div className="h-screen">
      <SettingsView
        section="voice"
        cwd="~/code/irgat"
        sessions={[]}
        onClose={() => {}}
        onSelectSection={() => {}}
        onOpenSession={() => {}}
        onArchiveSession={() => {}}
        onDeleteSession={() => {}}
        onOpenWhatsNew={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  view === "settings" ? <SettingsFixture /> : <ComposerFixture />,
);
