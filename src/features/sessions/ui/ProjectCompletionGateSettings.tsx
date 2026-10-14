import { useEffect, useState } from "react";
import { Check } from "../../../shared/ui/icons";
import {
  COMPLETION_GATE_PRESETS,
  DEFAULT_GATE_COMMAND,
  DEFAULT_GATE_TIMEOUT_MS,
  MAX_GATE_BOUNCES,
  MAX_GATE_TIMEOUT_MS,
  MIN_GATE_TIMEOUT_MS,
  loadProjectGate,
  saveProjectGate,
} from "../model/completionGate";

/** Parses the timeout field, in minutes, into milliseconds. */
export function gateTimeoutFromMinutes(value: string): number | null {
  const minutes = Number(value.trim());
  if (!value.trim() || !Number.isFinite(minutes)) return null;
  const ms = Math.round(minutes * 60_000);
  return ms >= MIN_GATE_TIMEOUT_MS && ms <= MAX_GATE_TIMEOUT_MS ? ms : null;
}

/** Project-wide default for the Completion Gate; chats can override it. */
export function ProjectCompletionGateSettings({ project }: { project: string }) {
  const [enabled, setEnabled] = useState(false);
  const [command, setCommand] = useState(DEFAULT_GATE_COMMAND);
  const [timeout, setTimeoutText] = useState(
    String(DEFAULT_GATE_TIMEOUT_MS / 60_000),
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const config = loadProjectGate(project);
    setEnabled(config?.enabled ?? false);
    setCommand(config?.command ?? DEFAULT_GATE_COMMAND);
    setTimeoutText(
      String((config?.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS) / 60_000),
    );
    setSaved(false);
    setError(undefined);
  }, [project]);

  const edited = () => {
    setSaved(false);
    setError(undefined);
  };
  const save = () => {
    const trimmed = command.trim();
    if (!trimmed) {
      setError("Enter a command to run.");
      return;
    }
    const timeoutMs = gateTimeoutFromMinutes(timeout);
    if (timeoutMs == null) {
      setError(
        `Use a time limit between ${MIN_GATE_TIMEOUT_MS / 60_000} and ${MAX_GATE_TIMEOUT_MS / 60_000} minutes.`,
      );
      return;
    }
    if (!saveProjectGate(project, { enabled, command: trimmed, timeoutMs })) {
      setError("Could not save. Please try again.");
      return;
    }
    setError(undefined);
    setSaved(true);
  };

  return (
    <section
      data-setting-id="completion-gate"
      className="flex flex-col gap-3 rounded-xl border border-stroke p-4"
    >
      <div>
        <h3 className="text-[13px] font-medium">Completion Gate</h3>
        <p className="mt-1 text-[12px] text-content/50">
          After an agent finishes a turn, run a check in its working folder.
          Exit code 0 marks the turn verified. Anything else goes back to the
          agent to fix, up to {MAX_GATE_BOUNCES} times per message. A check
          that runs past the time limit does not hold the turn back. Each
          chat can override this from the Gate pill above its composer.
        </p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="flex items-center gap-2 text-[12px] text-content/80">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Check every chat in this project"
            onClick={() => {
              setEnabled(!enabled);
              edited();
            }}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-accent" : "bg-content/20"
            }`}
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${
                enabled ? "left-4.5" : "left-0.5"
              }`}
            />
          </button>
          Check every chat in this project
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-content/70">Command</span>
          <div className="flex flex-wrap gap-1">
            {COMPLETION_GATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={command.trim() === preset.command}
                onClick={() => {
                  setCommand(preset.command);
                  edited();
                }}
                className={`h-6 rounded-full border px-2 text-[11px] ${
                  command.trim() === preset.command
                    ? "border-transparent bg-selection text-content"
                    : "border-content/10 text-content/60 hover:bg-content/5 hover:text-content"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
              edited();
            }}
            spellCheck={false}
            aria-label="Completion Gate command"
            placeholder="npm run lint && npm test"
            className="h-8 rounded-md border border-content/10 bg-content/5 px-2 font-mono text-[12px] outline-none focus:border-content/25"
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-content/70">
            Time limit (minutes)
          </span>
          <input
            value={timeout}
            onChange={(event) => {
              setTimeoutText(event.target.value);
              edited();
            }}
            inputMode="decimal"
            aria-label="Completion Gate time limit in minutes"
            className="h-8 w-24 rounded-md border border-content/10 bg-content/5 px-2 font-mono text-[12px] outline-none focus:border-content/25"
          />
        </label>
        {error ? (
          <p role="alert" className="text-[12px] text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="flex h-7.5 items-center gap-1.5 rounded-md bg-content/10 px-3 text-[12px] hover:bg-content/15 active:scale-[0.97]"
          >
            Save
          </button>
          {saved ? (
            <span className="flex items-center gap-1 text-[11px] text-content/50">
              <Check className="size-3" />
              Saved. The next finished turn uses it.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
