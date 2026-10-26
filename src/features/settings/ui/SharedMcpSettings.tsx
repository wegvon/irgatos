import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Plus, Share } from "../../../shared/ui/icons";
import { listSecrets, type SecretMeta } from "../../secrets/model/secrets";
import {
  SHARED_MCP_NAME_PATTERN,
  executorMcpUrl,
  listSharedMcp,
  removeSharedMcp,
  saveSharedMcp,
  sharedMcpAuthLabel,
  sharedMcpHost,
  testSharedMcp,
  usableVaultKeys,
  type SharedMcpAuth,
  type SharedMcpServer,
} from "../model/sharedMcp";

type AuthChoice = SharedMcpAuth["kind"];

const inputClass =
  "mt-1 block w-full rounded-md border border-stroke bg-background-base px-2 py-1.5 text-[12px] text-content";

/** Settings > MCP: servers every agent gets, signed in once in Irgatos. */
export function SharedMcpSettings() {
  const titleId = useId();
  const [servers, setServers] = useState<SharedMcpServer[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [executorUrl, setExecutorUrl] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tests, setTests] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [list, executor] = await Promise.all([
        listSharedMcp(),
        executorMcpUrl().catch(() => null),
      ]);
      setServers(Array.isArray(list) ? list : []);
      setExecutorUrl(executor);
      // The Vault opens with the Keychain; only ask it when a key is in use.
      if (
        Array.isArray(list) &&
        list.some((server) => server.auth.kind === "vault")
      ) {
        const vault = await listSecrets().catch(() => []);
        setSecrets(Array.isArray(vault) ? vault : []);
      }
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  const shareExecutor = (url: string) =>
    run("executor", async () => {
      const saved = await saveSharedMcp({
        id: "",
        name: servers.some((server) => server.name === "executor")
          ? "executor-mail"
          : "executor",
        url,
        auth: { kind: "executor" },
        enabled: true,
      });
      await refresh();
      await test(saved);
    });

  async function test(server: SharedMcpServer) {
    setTests((current) => ({ ...current, [server.id]: "Checking…" }));
    try {
      const result = await testSharedMcp(server.id);
      setTests((current) => ({
        ...current,
        [server.id]: `Connected${result.serverName ? ` to ${result.serverName}` : ""} · ${result.tools} tool${result.tools === 1 ? "" : "s"}`,
      }));
    } catch (cause) {
      setTests((current) => ({ ...current, [server.id]: String(cause) }));
    }
  }

  const toggle = (server: SharedMcpServer) =>
    run(server.id, async () => {
      await saveSharedMcp({ ...server, enabled: !server.enabled });
      await refresh();
    });

  const remove = (server: SharedMcpServer) =>
    run(server.id, async () => {
      if (
        !(await ask(`Stop sharing ${server.name} with agents?`, {
          title: "Remove shared MCP server",
        }))
      )
        return;
      await removeSharedMcp(server.id);
      await refresh();
    });

  const executorShared =
    executorUrl !== null &&
    servers.some(
      (server) => server.auth.kind === "executor" && server.url === executorUrl,
    );

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-xl border border-content/10 bg-content/3 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
            <Share className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="text-[13px] font-medium text-content">
              Shared with every agent
            </h3>
            <p className="mt-0.5 text-[12px] text-content/55">
              Add a server once and sign in once. Claude Code, Codex, Cursor,
              OpenCode, Devin, Grok, Hermes and Antigravity chats you start in
              Irgatos all get it. The key stays in Irgatos; agents never see it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {executorUrl && !executorShared ? (
            <SecondaryButton
              disabled={busy !== null}
              onClick={() => void shareExecutor(executorUrl)}
            >
              <Share className="size-3.5" />
              Share Executor
            </SecondaryButton>
          ) : null}
          <SecondaryButton
            aria-label="Add a shared MCP server"
            disabled={busy !== null}
            onClick={() => {
              setAdding(true);
              void listSecrets()
                .then((vault) => setSecrets(Array.isArray(vault) ? vault : []))
                .catch(() => undefined);
            }}
          >
            <Plus className="size-3.5" />
            Add
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
      {servers.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-content/10">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex flex-wrap items-center gap-3 border-b border-content/5 px-3 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium text-content">
                  {server.name}
                  {!server.enabled ? (
                    <span className="rounded-full border border-content/10 px-1.5 py-px text-[10px] font-normal text-content/50">
                      Off
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-content/45">
                  {sharedMcpHost(server.url)} ·{" "}
                  {sharedMcpAuthLabel(server.auth, secrets)}
                </div>
                {tests[server.id] ? (
                  <div className="mt-0.5 text-[11px] text-content/55">
                    {tests[server.id]}
                  </div>
                ) : null}
              </div>
              <SecondaryButton
                disabled={busy !== null}
                onClick={() => void test(server)}
              >
                Test
              </SecondaryButton>
              <SecondaryButton
                aria-pressed={server.enabled}
                disabled={busy !== null}
                onClick={() => void toggle(server)}
              >
                {server.enabled ? "Turn off" : "Turn on"}
              </SecondaryButton>
              <SecondaryButton
                danger
                disabled={busy !== null}
                onClick={() => void remove(server)}
              >
                Remove
              </SecondaryButton>
            </div>
          ))}
        </div>
      ) : !adding ? (
        <p className="text-[12px] text-content/45">
          {executorUrl
            ? "Nothing shared yet. Share Executor to use it in every agent without signing in again."
            : "Nothing shared yet."}
        </p>
      ) : null}
      {adding ? (
        <AddSharedServer
          secrets={secrets}
          executorUrl={executorUrl}
          onCancel={() => setAdding(false)}
          onSave={(server) =>
            run("add", async () => {
              const saved = await saveSharedMcp(server);
              setAdding(false);
              await refresh();
              await test(saved);
            })
          }
          busy={busy !== null}
        />
      ) : null}
      <p className="text-[11px] text-content/40">
        New chats pick up changes; a running chat keeps the servers it started
        with. Pi has no MCP support.
      </p>
    </section>
  );
}

function AddSharedServer({
  secrets,
  executorUrl,
  busy,
  onCancel,
  onSave,
}: {
  secrets: SecretMeta[];
  executorUrl: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (server: SharedMcpServer) => void;
}) {
  const keys = usableVaultKeys(secrets);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [choice, setChoice] = useState<AuthChoice>("none");
  const [secretId, setSecretId] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth: SharedMcpAuth =
      choice === "vault"
        ? { kind: "vault", secretId: secretId || keys[0]?.id || "" }
        : { kind: choice };
    onSave({ id: "", name: name.trim(), url: url.trim(), auth, enabled: true });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-content/10 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-content/65">
          Name
          <input
            required
            value={name}
            pattern={SHARED_MCP_NAME_PATTERN}
            title="Letters, numbers, - and _"
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
            placeholder="linear"
          />
        </label>
        <label className="block text-xs text-content/65">
          Server URL (Streamable HTTP)
          <input
            required
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className={inputClass}
            placeholder="https://example.com/mcp"
          />
        </label>
      </div>
      <label className="block text-xs text-content/65">
        Sign-in
        <select
          value={choice}
          onChange={(event) => setChoice(event.target.value as AuthChoice)}
          className={inputClass}
        >
          <option value="none">None</option>
          {executorUrl ? (
            <option value="executor">Mail's Executor key</option>
          ) : null}
          <option value="vault" disabled={keys.length === 0}>
            Key from the Vault{keys.length === 0 ? " (none usable)" : ""}
          </option>
        </select>
      </label>
      {choice === "vault" ? (
        <label className="block text-xs text-content/65">
          Vault key (sent as a Bearer token)
          <select
            value={secretId || keys[0]?.id || ""}
            onChange={(event) => setSecretId(event.target.value)}
            className={inputClass}
          >
            {keys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.label || key.name} · {key.hosts.join(", ")}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-content/40">
            The key's hosts must include this server, and it must be free to use
            without a limit.
          </span>
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <SecondaryButton type="submit" disabled={busy}>
          {busy ? "Saving…" : "Share with agents"}
        </SecondaryButton>
      </div>
    </form>
  );
}
