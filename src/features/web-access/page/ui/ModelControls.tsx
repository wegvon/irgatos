import { useEffect, useState, type ReactNode } from "react";
import type { HarnessId, RuntimeMode } from "../../../sessions/model/session";
import type { WebEffort, WebModels } from "../../model/protocol";
import { read } from "../client";
import { Harness } from "./parts";
import {
  Brain,
  ChevronDown,
  Lock,
  Pencil,
  Shield,
  Sparkles,
} from "../../../../shared/ui/icons";

/** The desktop composer's access modes, in its order and words. */
export const ACCESS_MODES: {
  mode: RuntimeMode;
  label: string;
  /** What the pill says, so the picker row fits a phone. */
  short: string;
}[] = [
  { mode: "supervised", label: "Supervised", short: "Supervised" },
  {
    mode: "auto-accept-edits",
    label: "Auto-accept edits",
    short: "Auto edits",
  },
  { mode: "auto", label: "Auto", short: "Auto" },
  { mode: "full-access", label: "Full access", short: "Full access" },
];

const ACCESS_ICON: Record<RuntimeMode, ReactNode> = {
  supervised: <Lock className="size-4 text-(--ink-2)" />,
  "auto-accept-edits": <Pencil className="size-4 text-(--ink-2)" />,
  auto: <Sparkles className="size-4 text-(--ink-2)" />,
  "full-access": <Shield className="size-4 text-amber-500" />,
};

let models: Promise<WebModels> | null = null;

/** Every provider's models, read once per page load. */
export function useModels(): WebModels | null {
  const [value, setValue] = useState<WebModels | null>(null);
  useEffect(() => {
    let alive = true;
    const loading = (models ??= read<WebModels>("models"));
    loading.then(
      (result) => alive && setValue(result),
      () => {
        if (models === loading) models = null;
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

export function modelName(
  catalog: WebModels | null,
  harness: HarnessId,
  id: string,
): string | undefined {
  return catalog?.harnesses
    .find((entry) => entry.harness === harness)
    ?.models.find((model) => model.id === id)?.name;
}

/** A pill that opens the system picker: iOS shows its own wheel for it. */
export function PickerPill({
  icon,
  value,
  label,
  disabled = false,
  children,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  disabled?: boolean;
  /** A native `<select>`, laid over the pill. */
  children: ReactNode;
}) {
  return (
    <span
      title={label}
      className={`glass relative inline-flex h-9 min-w-0 shrink-0 items-center gap-1 rounded-full pl-2.5 pr-1.5 text-[13px] ${disabled ? "opacity-50" : ""}`}
    >
      <span className="shrink-0 [&>svg]:size-[15px]">{icon}</span>
      <span className="min-w-0 max-w-[11rem] truncate font-semibold text-(--ink)">
        {value}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-(--ink-3)" />
      {children}
    </span>
  );
}

const overlay = "absolute inset-0 size-full cursor-pointer opacity-0";

/** One list of every provider's models, grouped by provider. */
export function ModelSelect({
  catalog,
  harness,
  model,
  name,
  disabled,
  onChange,
}: {
  catalog: WebModels | null;
  harness: HarnessId;
  model: string;
  /** What the pill says before the catalog arrives. */
  name: string;
  disabled?: boolean;
  onChange: (harness: HarnessId, model: string) => void;
}) {
  return (
    <PickerPill
      label="Model"
      icon={<Harness harness={harness} className="size-4" />}
      value={modelName(catalog, harness, model) ?? name}
      disabled={disabled}
    >
      <select
        aria-label="Model"
        value={`${harness}\n${model}`}
        disabled={disabled || !catalog}
        onChange={(event) => {
          const [nextHarness, nextModel] = event.target.value.split("\n");
          if (nextHarness && nextModel)
            onChange(nextHarness as HarnessId, nextModel);
        }}
        className={overlay}
      >
        {catalog?.harnesses.some((entry) => entry.harness === harness) &&
        catalog.harnesses
          .find((entry) => entry.harness === harness)!
          .models.some((entry) => entry.id === model) ? null : (
          <option value={`${harness}\n${model}`}>{name}</option>
        )}
        {catalog?.harnesses.map((entry) =>
          entry.models.length ? (
            <optgroup key={entry.harness} label={entry.title}>
              {entry.models.map((option) => (
                <option
                  key={option.id}
                  value={`${entry.harness}\n${option.id}`}
                >
                  {option.name}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </PickerPill>
  );
}

export function EffortSelect({
  effort,
  disabled,
  onChange,
}: {
  effort: WebEffort;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const current = effort.options.find(
    (option) => option.value === effort.value,
  );
  return (
    <PickerPill
      label="Effort"
      icon={<Brain className="size-4 text-(--ink-2)" />}
      value={current?.label ?? effort.value}
      disabled={disabled}
    >
      <select
        aria-label="Effort"
        value={effort.value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={overlay}
      >
        {effort.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </PickerPill>
  );
}

export function AccessSelect({
  mode,
  disabled,
  onChange,
}: {
  mode: RuntimeMode;
  disabled?: boolean;
  onChange: (mode: RuntimeMode) => void;
}) {
  return (
    <PickerPill
      label="Access"
      icon={ACCESS_ICON[mode]}
      value={ACCESS_MODES.find((entry) => entry.mode === mode)?.short ?? mode}
      disabled={disabled}
    >
      <select
        aria-label="Access"
        value={mode}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as RuntimeMode)}
        className={overlay}
      >
        {ACCESS_MODES.map((entry) => (
          <option key={entry.mode} value={entry.mode}>
            {entry.label}
          </option>
        ))}
      </select>
    </PickerPill>
  );
}

/** The composer's Plan switch: the next message asks for a plan first. */
export function PlanToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`web-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${
        on ? "primary-action" : "glass text-(--ink-2)"
      }`}
    >
      Plan
    </button>
  );
}
