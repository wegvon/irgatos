import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { revealPath } from "../../../platform/tauri/fs";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import {
  Copy,
  ExternalLink,
  RefreshCw,
  Shield,
} from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  COMPUTER_USE_PROVIDERS,
  COMPUTER_USE_SCOPE,
  COMPUTER_USE_SERVER,
  CUA_DRIVER_DOCS_URL,
  CUA_DRIVER_INSTALL_COMMAND,
  activeComputerUse,
  computerUseServerConfig,
  permissionState,
  permissionsReady,
  type ComputerUseProvider,
  type ComputerUseStatus,
} from "../model/computerUse";
import { MCP_PROVIDER_LABELS, type McpConnection } from "../model/mcp";

type Busy = "status" | "enable" | "telemetry" | "grant" | ComputerUseProvider;

const PERMISSION_LABELS = {
  granted: "Granted",
  missing: "Not granted",
  unknown: "Unknown",
};

let cachedStatus: ComputerUseStatus | null = null;

export function clearComputerUseStatusCache() {
  cachedStatus = null;
}

function providerList(providers: ComputerUseProvider[]) {
  return providers.map((provider) => MCP_PROVIDER_LABELS[provider]).join(", ");
}

function EnableModal({
  providers,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  providers: ComputerUseProvider[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (disableTelemetry: boolean) => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const [disableTelemetry, setDisableTelemetry] = useState(true);
  return (
    <Modal
      title="Allow agents to control this computer?"
      description={`Adds the Cua Driver MCP server to ${providerList(providers)} for all projects.`}
      onClose={onClose}
      fitViewport
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(disableTelemetry);
        }}
      >
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-content/80">
          <li>
            Agents can <strong>see your screen</strong>: screenshots, window
            contents and the accessibility tree of any app.
          </li>
          <li>
            Agents can <strong>click, type, scroll and press keys</strong> in
            any app, including browsers where you are signed in.
          </li>
          <li>
            It applies to every session of {providerList(providers)}, not just
            this project. Each CLI's own tool approvals still apply; sessions
            that skip approvals can act without asking.
          </li>
          <li>
            macOS asks you to grant Accessibility and Screen Recording to
            CuaDriver, not to MonoCode.
          </li>
        </ul>
        <label className="flex items-start gap-2 text-[13px] text-content">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={disableTelemetry}
            onChange={(event) => setDisableTelemetry(event.target.checked)}
          />
          Turn off Cua Driver telemetry
        </label>
        <label className="flex items-start gap-2 text-[13px] text-content">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          I understand that agents can control my desktop
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-stroke px-3 py-1.5 text-xs hover:bg-content/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!understood || busy}
            className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
          >
            {busy ? "Enabling…" : "Enable computer use"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ComputerUseSettings({
  cwd,
  servers,
  loading,
  onChanged,
}: {
  cwd: string;
  servers: McpConnection[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [status, setStatusState] = useState(cachedStatus);
  const [busy, setBusy] = useState<Busy | null>(cachedStatus ? null : "status");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ComputerUseProvider[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [copied, setCopied] = useState(false);
  const active = activeComputerUse(servers);
  const activeProviders = new Set(active.map((server) => server.provider));
  const inactive = COMPUTER_USE_PROVIDERS.filter(
    (provider) => !activeProviders.has(provider),
  );
  const pending = selected.filter((provider) => inactive.includes(provider));

  const setStatus = useCallback((next: ComputerUseStatus) => {
    cachedStatus = next;
    setStatusState(next);
  }, []);

  const check = useCallback(async () => {
    setBusy("status");
    setError("");
    try {
      setStatus(await invoke<ComputerUseStatus>("computer_use_status"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }, [setStatus]);

  useEffect(() => {
    if (!cachedStatus) void check();
  }, [check]);

  async function enable(disableTelemetry: boolean) {
    const binaryPath = status?.binaryPath;
    if (!binaryPath || pending.length === 0) return;
    setBusy("enable");
    setConfirmError("");
    const failures: string[] = [];
    for (const provider of pending) {
      try {
        await invoke("mcp_add", {
          cwd,
          provider,
          scope: COMPUTER_USE_SCOPE,
          name: COMPUTER_USE_SERVER,
          config: JSON.stringify(computerUseServerConfig(binaryPath)),
        });
      } catch (cause) {
        failures.push(`${MCP_PROVIDER_LABELS[provider]}: ${String(cause)}`);
      }
    }
    if (disableTelemetry) {
      try {
        await invoke("computer_use_disable_telemetry");
      } catch (cause) {
        failures.push(`Telemetry: ${String(cause)}`);
      }
    }
    await onChanged();
    setBusy(null);
    if (failures.length > 0) {
      setConfirmError(failures.join("\n"));
      return;
    }
    setSelected([]);
    setConfirmOpen(false);
    void check();
  }

  async function turnOff(server: McpConnection) {
    if (server.provider !== "claude") {
      void revealPath(server.configPath).catch((cause) =>
        setError(String(cause)),
      );
      return;
    }
    if (
      !(await ask(`Remove ${COMPUTER_USE_SERVER} from Claude Code?`, {
        title: "Turn off computer use",
      }))
    )
      return;
    setBusy("claude");
    setError("");
    try {
      await invoke("claude_mcp_remove", {
        cwd,
        name: server.name,
        scope: server.scope,
      });
      await onChanged();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function run(action: "telemetry" | "grant") {
    setBusy(action);
    setError("");
    try {
      if (action === "telemetry") {
        await invoke("computer_use_disable_telemetry");
        await check();
      } else {
        setStatus(
          await invoke<ComputerUseStatus>("computer_use_grant_permissions"),
        );
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  const installed = Boolean(status?.binaryPath);
  const permissions = status?.permissions ?? null;
  const ready = permissionsReady(status);

  return (
    <section
      aria-labelledby="computer-use-title"
      className="space-y-3 rounded-xl border border-content/10 bg-content/3 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
            <Shield className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3
              id="computer-use-title"
              className="text-[13px] font-medium text-content"
            >
              Computer use
            </h3>
            <p className="mt-0.5 text-[12px] text-content/55">
              Let coding agents see your screen and operate apps on this
              computer through Cua Driver. Off until you enable it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active.length > 0 ? (
            <span
              data-testid="computer-use-active"
              className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300"
            >
              <span className="size-1.5 rounded-full bg-amber-400" />
              On · {providerList(active.map((server) => server.provider))}
            </span>
          ) : (
            <span className="rounded-full border border-content/10 px-2 py-0.5 text-[11px] text-content/50">
              Off
            </span>
          )}
          <SecondaryButton
            aria-label="Check Cua Driver again"
            disabled={busy !== null}
            onClick={() => void check()}
          >
            <RefreshCw className="size-3.5" />
          </SecondaryButton>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400"
        >
          {error}
        </p>
      ) : null}

      {busy === "status" && !status ? (
        <p className="text-[12px] text-content/55">Checking Cua Driver…</p>
      ) : !installed ? (
        <div className="space-y-2">
          <p className="text-[12px] text-content/65">
            Cua Driver is not installed. Install the standalone CuaDriver app:
            macOS ties Accessibility and Screen Recording to its own identity,
            so the grants survive driver updates and MonoCode rebuilds.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-content/10 bg-background-base px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/80">
              {CUA_DRIVER_INSTALL_COMMAND}
            </code>
            <SecondaryButton
              aria-label="Copy install command"
              onClick={() =>
                void copyText(CUA_DRIVER_INSTALL_COMMAND).then(() =>
                  setCopied(true),
                )
              }
            >
              <Copy className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </SecondaryButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              onClick={() => void openUrl(CUA_DRIVER_DOCS_URL).catch(() => {})}
            >
              <ExternalLink className="size-3.5" />
              Cua Driver docs
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-[12px] text-content/55">
            Cua Driver {status?.version ?? ""}
            <div
              className="truncate text-[11px] text-content/35"
              title={status?.binaryPath ?? ""}
            >
              {status?.binaryPath}
            </div>
          </div>
          {!status?.appBundle && permissions ? (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-[12px] text-amber-300">
              This driver is not running from CuaDriver.app, so macOS
              permissions may reset when it changes. Reinstall with{" "}
              <code className="font-mono text-[11px]">
                {CUA_DRIVER_INSTALL_COMMAND}
              </code>
              .
            </p>
          ) : null}

          {permissions ? (
            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-content/75">
                macOS permissions (granted to CuaDriver)
              </div>
              {(
                [
                  ["Accessibility", permissions.accessibility],
                  ["Screen Recording", permissions.screenRecording],
                ] as const
              ).map(([label, value]) => {
                const state = permissionState(value);
                return (
                  <div
                    key={label}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="text-content/65">{label}</span>
                    <span
                      className={
                        state === "granted"
                          ? "text-emerald-400"
                          : state === "missing"
                            ? "text-amber-300"
                            : "text-content/45"
                      }
                    >
                      {PERMISSION_LABELS[state]}
                    </span>
                  </div>
                );
              })}
              {!ready ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <SecondaryButton
                    disabled={busy !== null}
                    onClick={() => void run("grant")}
                  >
                    {busy === "grant"
                      ? "Waiting for macOS…"
                      : "Grant in CuaDriver…"}
                  </SecondaryButton>
                  <span className="text-[11px] text-content/45">
                    Opens CuaDriver so the prompts name it, not MonoCode.
                  </span>
                </div>
              ) : null}
              {permissions.detail && !ready ? (
                <p className="text-[11px] text-content/40">
                  {permissions.detail}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="text-content/65">
              Cua Driver telemetry:{" "}
              {status?.telemetryEnabled === false
                ? "Off"
                : status?.telemetryEnabled
                  ? "On"
                  : "Unknown"}
            </span>
            {status?.telemetryEnabled !== false ? (
              <SecondaryButton
                disabled={busy !== null}
                onClick={() => void run("telemetry")}
              >
                Turn off
              </SecondaryButton>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border border-content/10">
            {COMPUTER_USE_PROVIDERS.map((provider) => {
              const server = active.find(
                (entry) => entry.provider === provider,
              );
              return (
                <div
                  key={provider}
                  className="flex items-center gap-2 border-b border-content/5 px-3 py-2 text-[12px] last:border-b-0"
                >
                  {server ? (
                    <span className="size-3.5 shrink-0" />
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`Enable computer use for ${MCP_PROVIDER_LABELS[provider]}`}
                      checked={selected.includes(provider)}
                      disabled={busy !== null || loading}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(provider)
                            ? current.filter((entry) => entry !== provider)
                            : [...current, provider],
                        )
                      }
                    />
                  )}
                  <HarnessIcon harness={provider} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate text-content">
                    {MCP_PROVIDER_LABELS[provider]}
                  </span>
                  {server ? (
                    <>
                      <span className="text-[11px] text-amber-300">
                        On · {server.scope}
                      </span>
                      <SecondaryButton
                        disabled={busy !== null}
                        onClick={() => void turnOff(server)}
                      >
                        {provider === "claude" ? "Turn off" : "Show config"}
                      </SecondaryButton>
                    </>
                  ) : (
                    <span className="text-[11px] text-content/40">Off</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-content/45">
              {active.some((server) => server.provider !== "claude")
                ? `To turn it off elsewhere, remove the ${COMPUTER_USE_SERVER} entry from that config.`
                : "Applies to all projects for each CLI you choose."}
            </p>
            <SecondaryButton
              disabled={pending.length === 0 || busy !== null || loading}
              onClick={() => {
                setConfirmError("");
                setConfirmOpen(true);
              }}
            >
              Enable for selected…
            </SecondaryButton>
          </div>
        </div>
      )}
      {confirmOpen ? (
        <EnableModal
          providers={pending}
          busy={busy === "enable"}
          error={confirmError}
          onClose={() => setConfirmOpen(false)}
          onConfirm={(disableTelemetry) => void enable(disableTelemetry)}
        />
      ) : null}
    </section>
  );
}
