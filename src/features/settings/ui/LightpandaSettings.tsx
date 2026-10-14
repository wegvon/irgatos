import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import {
  ArrowDownCircle,
  Copy,
  ExternalLink,
  Globe,
  Play,
  RefreshCw,
  Square,
} from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  LIGHTPANDA_BREW_COMMAND,
  LIGHTPANDA_CDP_ENV,
  LIGHTPANDA_INSTALL_PROGRESS,
  LIGHTPANDA_PROVIDERS,
  LIGHTPANDA_REPO_URL,
  LIGHTPANDA_SCOPE,
  LIGHTPANDA_SERVER,
  STOPPED_SIDECAR,
  activeLightpanda,
  installProgressLabel,
  lightpandaServerConfig,
  loadSidecarAutostart,
  loadSidecarPort,
  parseSidecarPort,
  saveSidecarAutostart,
  saveSidecarPort,
  type LightpandaInstallProgress,
  type LightpandaProvider,
  type LightpandaSidecar,
  type LightpandaStatus,
} from "../model/lightpanda";
import { MCP_PROVIDER_LABELS, type McpConnection } from "../model/mcp";

type Busy =
  "status" | "install" | "register" | "start" | "stop" | LightpandaProvider;

let cachedStatus: LightpandaStatus | null = null;

export function clearLightpandaStatusCache() {
  cachedStatus = null;
}

function providerList(providers: LightpandaProvider[]) {
  return providers.map((provider) => MCP_PROVIDER_LABELS[provider]).join(", ");
}

type Props =
  | {
      variant?: "full";
      cwd: string;
      servers: McpConnection[];
      loading: boolean;
      onChanged: () => Promise<void>;
    }
  | { variant: "sidecar" };

export function LightpandaSettings(props: Props) {
  const full = props.variant !== "sidecar";
  const servers = full ? props.servers : [];
  const [status, setStatusState] = useState(cachedStatus);
  const [busy, setBusy] = useState<Busy | null>(cachedStatus ? null : "status");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<LightpandaInstallProgress | null>(
    null,
  );
  const [selected, setSelected] = useState<LightpandaProvider[]>([]);
  const [portInput, setPortInput] = useState(
    () => loadSidecarPort()?.toString() ?? "",
  );
  const [autostart, setAutostart] = useState(loadSidecarAutostart);
  const [copied, setCopied] = useState<"brew" | "cdp" | null>(null);
  const active = activeLightpanda(servers);
  const activeProviders = new Set(active.map((server) => server.provider));
  const pending = selected.filter((provider) => !activeProviders.has(provider));
  const port = parseSidecarPort(portInput);
  const sidecar = status?.sidecar ?? STOPPED_SIDECAR;

  const setStatus = useCallback((next: LightpandaStatus) => {
    cachedStatus = next;
    setStatusState(next);
  }, []);

  const setSidecar = useCallback(
    (next: LightpandaSidecar) => {
      if (cachedStatus) setStatus({ ...cachedStatus, sidecar: next });
    },
    [setStatus],
  );

  const check = useCallback(async () => {
    setBusy("status");
    setError("");
    try {
      setStatus(await invoke<LightpandaStatus>("lightpanda_status"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }, [setStatus]);

  useEffect(() => {
    if (!cachedStatus) void check();
  }, [check]);

  async function install() {
    setBusy("install");
    setError("");
    setProgress({ received: 0, total: null });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<LightpandaInstallProgress>(
        LIGHTPANDA_INSTALL_PROGRESS,
        (event) => setProgress(event.payload),
      ).catch(() => undefined);
      setStatus(await invoke<LightpandaStatus>("lightpanda_install"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      unlisten?.();
      setProgress(null);
      setBusy(null);
    }
  }

  async function register() {
    if (!full) return;
    const binaryPath = status?.binaryPath;
    if (!binaryPath || pending.length === 0) return;
    setBusy("register");
    setError("");
    const failures: string[] = [];
    for (const provider of pending) {
      try {
        await invoke("mcp_add", {
          cwd: props.cwd,
          provider,
          scope: LIGHTPANDA_SCOPE,
          name: LIGHTPANDA_SERVER,
          config: JSON.stringify(lightpandaServerConfig(binaryPath)),
        });
      } catch (cause) {
        failures.push(`${MCP_PROVIDER_LABELS[provider]}: ${String(cause)}`);
      }
    }
    await props.onChanged();
    setBusy(null);
    if (failures.length > 0) {
      setError(failures.join("\n"));
      return;
    }
    setSelected([]);
  }

  async function turnOff(
    server: McpConnection & { provider: LightpandaProvider },
  ) {
    if (!full) return;
    if (
      !(await ask(
        `Remove ${LIGHTPANDA_SERVER} from ${MCP_PROVIDER_LABELS[server.provider]}?`,
        { title: "Remove Lightpanda" },
      ))
    )
      return;
    setBusy(server.provider);
    setError("");
    try {
      if (server.provider === "claude") {
        await invoke("claude_mcp_remove", {
          cwd: props.cwd,
          name: server.name,
          scope: server.scope,
        });
      } else {
        await invoke("mcp_remove", {
          cwd: props.cwd,
          provider: server.provider,
          name: server.name,
          configPath: server.configPath,
        });
      }
      await props.onChanged();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (port === undefined) return;
    setBusy("start");
    setError("");
    saveSidecarPort(port);
    try {
      setSidecar(
        await invoke<LightpandaSidecar>("lightpanda_sidecar_start", { port }),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    setError("");
    try {
      setSidecar(await invoke<LightpandaSidecar>("lightpanda_sidecar_stop"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  function copy(kind: "brew" | "cdp", text: string) {
    void copyText(text).then(() => setCopied(kind));
  }

  const installed = Boolean(status?.binaryPath);
  const titleId = full ? "lightpanda-title" : "lightpanda-sidecar-title";

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-xl border border-content/10 bg-content/3 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
            <Globe className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="text-[13px] font-medium text-content">
              Lightpanda Headless Browser
            </h3>
            <p className="mt-0.5 text-[12px] text-content/55">
              A fast, low-memory headless browser agents can drive over MCP or
              the Chrome DevTools Protocol, for research and scraping in the
              background. The browser panel stays for pages you look at and sign
              in to.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {installed ? (
            <span
              data-testid="lightpanda-detected"
              className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300"
            >
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Detected{status?.version ? ` · ${status.version}` : ""}
            </span>
          ) : status ? (
            <span className="rounded-full border border-content/10 px-2 py-0.5 text-[11px] text-content/50">
              Not installed
            </span>
          ) : null}
          <SecondaryButton
            aria-label="Check Lightpanda again"
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
          className="whitespace-pre-line rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400"
        >
          {error}
        </p>
      ) : null}

      {busy === "status" && !status ? (
        <p className="text-[12px] text-content/55">Checking Lightpanda…</p>
      ) : !installed ? (
        <div className="space-y-2">
          <p className="text-[12px] text-content/65">
            Lightpanda is not installed. Irgatos can download the official
            release
            {status?.releaseAsset ? (
              <>
                {" "}
                (
                <code className="font-mono text-[11px]">
                  {status.releaseAsset}
                </code>
                )
              </>
            ) : null}{" "}
            into{" "}
            <code className="font-mono text-[11px]">
              {status?.installPath ?? "~/.irgatos/bin/lightpanda"}
            </code>
            . It is AGPL-3.0 software kept outside Irgatos: never bundled, run
            only as a separate process, always with telemetry off.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton
              disabled={busy !== null || !status?.releaseAsset}
              onClick={() => void install()}
            >
              <ArrowDownCircle className="size-3.5" />
              {busy === "install"
                ? progress && progress.received > 0
                  ? `Downloading… ${installProgressLabel(progress)}`
                  : "Downloading…"
                : "Install Lightpanda"}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => void openUrl(LIGHTPANDA_REPO_URL).catch(() => {})}
            >
              <ExternalLink className="size-3.5" />
              Lightpanda on GitHub
            </SecondaryButton>
          </div>
          {!status?.releaseAsset && status ? (
            <p className="text-[11px] text-content/45">
              There is no Lightpanda release for this platform.
            </p>
          ) : null}
          <div className="flex items-center gap-2 rounded-md border border-content/10 bg-background-base px-2 py-1.5">
            <span className="text-[11px] text-content/45">
              Or with Homebrew
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/80">
              {LIGHTPANDA_BREW_COMMAND}
            </code>
            <SecondaryButton
              aria-label="Copy Homebrew command"
              onClick={() => copy("brew", LIGHTPANDA_BREW_COMMAND)}
            >
              <Copy className="size-3.5" />
              {copied === "brew" ? "Copied" : "Copy"}
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-content/55">
            <div className="min-w-0">
              Lightpanda {status?.version ?? ""}
              <div
                className="truncate text-[11px] text-content/35"
                title={status?.binaryPath ?? ""}
              >
                {status?.binaryPath}
              </div>
            </div>
            {status?.managed ? (
              <SecondaryButton
                disabled={busy !== null}
                onClick={() => void install()}
              >
                <ArrowDownCircle className="size-3.5" />
                {busy === "install"
                  ? progress && progress.received > 0
                    ? `Updating… ${installProgressLabel(progress)}`
                    : "Updating…"
                  : "Update"}
              </SecondaryButton>
            ) : null}
          </div>

          {full ? (
            <div className="space-y-2">
              <div className="text-[12px] font-medium text-content/75">
                MCP server for agents
              </div>
              <div className="overflow-hidden rounded-lg border border-content/10">
                {LIGHTPANDA_PROVIDERS.map((provider) => {
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
                          aria-label={`Add Lightpanda to ${MCP_PROVIDER_LABELS[provider]}`}
                          checked={selected.includes(provider)}
                          disabled={busy !== null || props.loading}
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
                          <span className="text-[11px] text-emerald-300">
                            Added · {server.scope}
                          </span>
                          <SecondaryButton
                            disabled={busy !== null}
                            onClick={() => void turnOff(server)}
                          >
                            Remove
                          </SecondaryButton>
                        </>
                      ) : (
                        <span className="text-[11px] text-content/40">
                          Not added
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-content/45">
                  Adds <code className="font-mono">lightpanda mcp</code> for all
                  projects, with telemetry off.
                </p>
                <SecondaryButton
                  disabled={
                    pending.length === 0 || busy !== null || props.loading
                  }
                  onClick={() => void register()}
                >
                  {busy === "register"
                    ? "Adding…"
                    : pending.length > 0
                      ? `Add to ${providerList(pending)}`
                      : "Add to selected"}
                </SecondaryButton>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-medium text-content/75">
                Background CDP browser
              </div>
              <span
                data-testid="lightpanda-sidecar-state"
                className={`text-[11px] ${sidecar.running ? "text-emerald-300" : "text-content/45"}`}
              >
                {sidecar.running ? `Running · port ${sidecar.port}` : "Stopped"}
              </span>
            </div>
            <p className="text-[11px] text-content/45">
              Runs <code className="font-mono">lightpanda serve</code> on this
              computer only. Agent sessions started while it runs, including
              Irgats and Habits, get its address in{" "}
              <code className="font-mono">{LIGHTPANDA_CDP_ENV}</code> for
              Playwright, Puppeteer or any CDP client.
            </p>
            {sidecar.running && sidecar.cdpUrl ? (
              <div className="flex items-center gap-2 rounded-md border border-content/10 bg-background-base px-2 py-1.5">
                <code
                  data-testid="lightpanda-cdp-url"
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/80"
                >
                  {sidecar.cdpUrl}
                </code>
                <SecondaryButton
                  aria-label="Copy CDP address"
                  onClick={() => copy("cdp", sidecar.cdpUrl ?? "")}
                >
                  <Copy className="size-3.5" />
                  {copied === "cdp" ? "Copied" : "Copy"}
                </SecondaryButton>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] text-content/65">
                Port
                <input
                  aria-label="Lightpanda CDP port"
                  inputMode="numeric"
                  placeholder="Automatic"
                  value={portInput}
                  disabled={sidecar.running || busy !== null}
                  onChange={(event) => setPortInput(event.target.value)}
                  className="w-24 rounded-md border border-content/10 bg-background-base px-2 py-1 font-mono text-[12px] text-content disabled:opacity-60"
                />
              </label>
              {sidecar.running ? (
                <SecondaryButton
                  disabled={busy !== null}
                  onClick={() => void stop()}
                >
                  <Square className="size-3.5" />
                  {busy === "stop" ? "Stopping…" : "Stop"}
                </SecondaryButton>
              ) : (
                <SecondaryButton
                  disabled={busy !== null || port === undefined}
                  onClick={() => void start()}
                >
                  <Play className="size-3.5" />
                  {busy === "start" ? "Starting…" : "Start"}
                </SecondaryButton>
              )}
            </div>
            {port === undefined ? (
              <p className="text-[11px] text-amber-300">
                Use a port from 1024 to 65535, or leave it blank.
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-[12px] text-content/65">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autostart}
                onChange={(event) => {
                  setAutostart(event.target.checked);
                  saveSidecarAutostart(event.target.checked);
                }}
              />
              Start it when Irgatos opens
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
