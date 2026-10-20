import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { Popover } from "../../../shared/ui/Popover";
import { ChevronRight, Sparkles, StickyNote } from "../../../shared/ui/icons";
import type { HarnessId, RuntimeMode } from "../../sessions/model/session";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { ModelPicker, ModelSettingRows } from "../../sessions/ui/ModelPicker";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import {
  defaultIrgatName,
  findIrgat,
  saveIrgatMascot,
  saveIrgatName,
  subscribeIrgats,
  updateIrgat,
  type IrgatLook,
} from "../model/irgat";
import type { IrgatFiles } from "../model/irgatFiles";
import { memoryLines } from "../model/irgatMemory";
import { ConfirmReset } from "./ConfirmReset";
import { IrgatProjects } from "./IrgatProjects";
import { ColorPicker, MascotPicker, SwitchRow } from "./irgatPanelParts";

/** The pages its settings open over themselves in the overview. */
export type IrgatSettingsPage = "soul" | "memory";

/** How the Irgat's conversation runs, which its settings read and change. */
export type IrgatSettingsControls = {
  /** Its conversation's folder, which the model picker reads settings from. */
  cwd: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  busy?: boolean;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onReset?: () => Promise<void>;
};

type Props = IrgatSettingsControls & {
  irgatId: string;
  agent: IrgatLook;
  /** Its soul and memory, to show what each page holds. */
  files: IrgatFiles | undefined;
  onOpenPage: (page: IrgatSettingsPage) => void;
};

/**
 * Who the Irgat is and how it works, on the overview's Settings tab: its
 * name, face, model and projects, with its soul and memory a click away.
 */
export function IrgatSettings({
  irgatId,
  agent,
  files,
  onOpenPage,
  cwd,
  harness,
  model,
  modelSettings,
  runtimeMode,
  busy = false,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onReset,
}: Props) {
  const lock = useLockOverscroll<HTMLDivElement>();
  const shown = useSyncExternalStore(
    subscribeIrgats,
    () => findIrgat(irgatId)?.showStartedSessionsInSidebar !== false,
  );
  const folders = useSyncExternalStore(
    subscribeIrgats,
    () => findIrgat(irgatId)?.useSidebarFolders === true,
  );
  return (
    <div
      ref={lock}
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pb-6 pt-2"
      data-irgat-settings
    >
      <div className="flex flex-col items-center pb-2 pt-4">
        <LookButton irgatId={irgatId} agent={agent} />
        <NameField key={irgatId} irgatId={irgatId} fallback={agent.mascot} />
      </div>

      <GroupHeading title="Model" />
      <SettingGroup>
        <SettingRow
          label="Model"
          description="What it thinks and replies with."
        >
          <ModelPicker
            harness={harness}
            model={model}
            values={modelSettings}
            project={cwd}
            hideSettings
            side="bottom"
            variant="plain"
            onChange={onModelChange}
            onSettingsChange={onModelSettingsChange}
          />
        </SettingRow>
        <ModelSettingRows
          harness={harness}
          model={model}
          values={modelSettings}
          side="bottom"
          onSettingsChange={onModelSettingsChange}
          row={({ label, control }) => (
            <SettingRow label={label}>{control}</SettingRow>
          )}
        />
        <SettingRow
          label="Permissions"
          description="What it may do without asking."
        >
          <AccessPicker
            value={runtimeMode}
            onChange={onRuntimeModeChange}
            busy={busy}
            side="bottom"
            variant="plain"
          />
        </SettingRow>
      </SettingGroup>

      <GroupHeading
        title="Soul and memory"
        description="What it always keeps in mind, and what it has learned."
      />
      <SettingGroup>
        <PageLink
          icon={Sparkles}
          label="Soul"
          description="Who it is and how it works."
          onClick={() => onOpenPage("soul")}
        />
        <PageLink
          icon={StickyNote}
          label="Memory"
          description={memorySummary(files)}
          onClick={() => onOpenPage("memory")}
        />
      </SettingGroup>

      <GroupHeading
        title="Projects"
        description="It can see every session, note and folder in these."
      />
      <SettingGroup>
        <IrgatProjects irgatId={irgatId} projects={agent.projects} />
      </SettingGroup>

      <GroupHeading title="Sessions it starts" />
      <SettingGroup>
        <SwitchRow
          label="Show sessions in sidebar"
          description="Sessions it starts appear in your project sidebar. Hidden ones stay saved and open from its overview."
          on={shown}
          onChange={(on) =>
            updateIrgat(irgatId, (irgat) => ({
              ...irgat,
              showStartedSessionsInSidebar: on,
            }))
          }
        />
        {/* Hidden sessions have no sidebar folder to go in. */}
        <SwitchRow
          label="Group in a folder"
          description={`Sessions it starts go in a “${agent.name}” folder in your project sidebar.`}
          on={shown && folders}
          disabled={!shown}
          onChange={(on) =>
            updateIrgat(irgatId, ({ useSidebarFolders: _, ...irgat }) =>
              on ? { ...irgat, useSidebarFolders: true } : irgat,
            )
          }
        />
      </SettingGroup>

      {onReset ? (
        <>
          <GroupHeading title="Conversation" />
          <ConfirmReset
            label="Reset conversation"
            title={`Reset ${agent.name}'s conversation?`}
            body="All messages in this Irgat's conversation will be deleted and any active reply will be stopped. This can't be undone."
            kept="Its soul, memory and habits will be kept."
            failure="Could not reset the conversation."
            onConfirm={onReset}
          >
            {(open, ref) => (
              <SettingGroup>
                <SettingRow
                  label="Reset conversation"
                  description="Clear all messages and start fresh. Its soul, memory and habits stay."
                >
                  <button
                    ref={ref}
                    type="button"
                    onClick={open}
                    className="rounded-md border border-stroke px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10"
                  >
                    Reset
                  </button>
                </SettingRow>
              </SettingGroup>
            )}
          </ConfirmReset>
        </>
      ) : null}
    </div>
  );
}

/** How many facts it remembers, under the Memory row. */
function memorySummary(files: IrgatFiles | undefined): string {
  if (!files) return "Loading…";
  const count = memoryLines(files.memory).length;
  return count === 0
    ? "Nothing remembered yet."
    : count === 1
      ? "1 thing remembered."
      : `${count} things remembered.`;
}

/** A row that opens one of its pages over the settings. */
function PageLink({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 items-center gap-3 px-3 py-2 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-content/5"
    >
      <Icon className="size-3.5 shrink-0 text-content/60" strokeWidth={1.75} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] leading-5 text-content/90">{label}</span>
        <span className="truncate text-[12px] leading-5 text-content/40">
          {description}
        </span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
    </button>
  );
}

/** A titled group of settings, with what it covers under the title. */
function GroupHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="px-1 pb-2 pt-7">
      <h4 className="text-[12px] font-medium text-content/70">{title}</h4>
      {description ? (
        <p className="text-[12px] leading-5 text-content/40">{description}</p>
      ) : null}
    </div>
  );
}

/** Settings that belong together, in one card with a line between rows. */
function SettingGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-stroke rounded-xl border border-stroke bg-content/[0.02]">
      {children}
    </div>
  );
}

/**
 * A setting's name and what it does on the left, its control on the right.
 * In a narrow panel the control drops under its name rather than cutting it.
 */
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
      <div className="flex min-w-0 flex-1 basis-36 flex-col">
        <span className="text-[13px] leading-5 text-content/90">{label}</span>
        {description ? (
          <span className="text-[12px] leading-5 text-content/40">
            {description}
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex max-w-full shrink-0 items-center justify-end pr-1.5 text-[12px] text-content/85">
        {children}
      </div>
    </div>
  );
}

/** The Irgat's face, which opens its mascots and colors in a popover. */
function LookButton({ irgatId, agent }: { irgatId: string; agent: IrgatLook }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label="Change mascot and color"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change mascot and color"
        onClick={() => setOpen((value) => !value)}
        className={`grid size-20 shrink-0 place-items-center rounded-2xl border border-stroke hover:bg-content/8 ${
          open ? "bg-content/8" : "bg-content/4"
        }`}
      >
        <PixelMascot
          name={agent.mascot}
          color={agent.color}
          className="size-12 shrink-0"
        />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="center"
          width={272}
          constrainHeight={false}
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label="Mascot and color"
          className="flex flex-col gap-3 p-3"
        >
          <MascotPicker
            columns={5}
            current={agent.mascot}
            color={agent.color}
            onPick={(mascot) => saveIrgatMascot(irgatId, mascot)}
          />
          <div className="h-px bg-content/10" />
          <ColorPicker
            inline
            columns={5}
            current={agent.color}
            onPick={(color) =>
              updateIrgat(irgatId, (irgat) => ({ ...irgat, color }))
            }
          />
        </Popover>
      ) : null}
    </>
  );
}

/** The Irgat's name, edited in place; empty goes back to its mascot's name. */
function NameField({ irgatId, fallback }: { irgatId: string; fallback: string }) {
  const saved = () => findIrgat(irgatId)?.name ?? "";
  const [draft, setDraft] = useState(saved);
  const editing = useRef(false);
  // A reset clears the name while its settings are open.
  useEffect(
    () =>
      subscribeIrgats(() => {
        if (!editing.current) setDraft(saved());
      }),
    [irgatId],
  );
  const placeholder = defaultIrgatName(fallback);
  const save = () => {
    const name = draft.trim().slice(0, 40);
    if (name !== saved()) saveIrgatName(irgatId, name);
    setDraft(name);
  };
  return (
    <input
      aria-label="Name"
      value={draft}
      placeholder={placeholder}
      maxLength={40}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(saved());
          event.currentTarget.blur();
        }
      }}
      className="mt-3 h-8 w-full max-w-64 rounded-md bg-transparent px-2 text-center text-[15px] font-medium text-content outline-none placeholder:text-content/60 hover:bg-content/5 focus:bg-content/5"
    />
  );
}
