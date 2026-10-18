import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  listSecrets,
  parseHosts,
  revokeSecret,
  saveSecret,
  secretAudit,
  secretScopeLabel,
  SECRETS_CHANGED_EVENT,
  type SecretAudit,
  type SecretMeta,
} from "../model/secrets";

const button =
  "rounded-lg bg-selection px-3 py-2 text-[13px] font-medium hover:bg-selection-hover disabled:opacity-40";
const field =
  "min-w-0 rounded-md border border-stroke bg-transparent px-2 py-1.5 text-[12px] text-content outline-none focus:border-content/40";

const OUTCOME: Record<SecretAudit["outcome"], string> = {
  saved: "Saved",
  used: "Used",
  blocked: "Blocked",
  revoked: "Revoked",
  expired: "Expired",
  ended: "Chat ended",
};

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Settings → Secrets: what agents may use right now, and where it went. */
export function SecretsSettings() {
  const [secrets, setSecrets] = useState<SecretMeta[] | null>(null);
  const [audit, setAudit] = useState<SecretAudit[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const valueRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    Promise.all([listSecrets(), secretAudit(40)])
      .then(([list, log]) => {
        setSecrets(list ?? []);
        setAudit(log ?? []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const stop = listen(SECRETS_CHANGED_EVENT, refresh);
    return () => void stop.then((off) => off());
  }, [refresh]);

  const add = async () => {
    setError("");
    try {
      await saveSecret({
        name: name.trim(),
        label: name.trim(),
        description: "",
        hosts: parseHosts(hosts),
        allowIn: ["header"],
        once: false,
        persistent: true,
        value: valueRef.current?.value ?? "",
      });
      if (valueRef.current) valueRef.current.value = "";
      setName("");
      setHosts("");
      setAdding(false);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div data-setting-id="secrets" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <p className="min-w-0 text-[12px] leading-relaxed text-content/45">
          An agent only knows a secret's name: Irgatos fills the value in for
          the hosts listed here,
          and it never appears in a chat, a log or the agent's output. Values
          are encrypted, with the key in your Keychain.
        </p>
        <button className={`${button} shrink-0`} onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add secret"}
        </button>
      </div>

      {adding ? (
        <form
          className="flex flex-col gap-2 rounded-xl border border-stroke px-4 py-4"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              className={`${field} w-44 font-mono`}
              placeholder="STRIPE_KEY"
              value={name}
              spellCheck={false}
              onChange={(event) => setName(event.target.value.toUpperCase())}
            />
            <input
              className={`${field} flex-1`}
              placeholder="api.stripe.com"
              value={hosts}
              spellCheck={false}
              onChange={(event) => setHosts(event.target.value)}
            />
          </div>
          <input
            ref={valueRef}
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            className={`${field} font-mono`}
            placeholder="Value"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-content/45">
              Kept for every chat until you revoke it; used in request headers.
            </span>
            <button type="submit" className={button}>
              Save
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-col divide-y divide-stroke rounded-xl border border-stroke">
        {secrets === null ? (
          <div className="px-4 py-3 text-[12px] text-content/45">Loading…</div>
        ) : secrets.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-content/45">
            No secrets. When an agent needs one it asks with a masked card in
            its chat.
          </div>
        ) : (
          secrets.map((secret) => (
            <div key={secret.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px]">
                  <code className="font-mono">{secret.name}</code>
                  {secret.label !== secret.name ? (
                    <span className="truncate text-content/55">{secret.label}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11px] text-content/45">
                  {[
                    secret.hosts.join(", "),
                    `in ${secret.allowIn.join(", ")}`,
                    secretScopeLabel(secret),
                    secret.purpose ? `only for ${secret.purpose}` : "",
                    secret.maxUses
                      ? `${Math.max(0, secret.maxUses - secret.uses)} use left`
                      : `${secret.uses} uses`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button
                className={button}
                onClick={() =>
                  revokeSecret(secret.id)
                    .then(refresh)
                    .catch((e) => setError(String(e)))
                }
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>

      {error ? <div className="text-[12px] text-red-400">{error}</div> : null}

      {audit.length ? (
        <div className="mt-4">
          <h2 className="text-[13px] font-semibold text-content">Recent use</h2>
          <p className="mt-1 text-[12px] text-content/45">
            Which secret was used, by which action, for which host. Values are
            never recorded.
          </p>
          <div className="mt-2 flex flex-col divide-y divide-stroke rounded-xl border border-stroke">
            {audit.map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                className="flex items-baseline gap-3 px-4 py-2 text-[12px]"
              >
                <span className="w-28 shrink-0 text-content/45">{when(entry.at)}</span>
                <code className="shrink-0 font-mono">{entry.name}</code>
                <span
                  className={`shrink-0 ${entry.outcome === "blocked" ? "text-red-400" : "text-content/70"}`}
                >
                  {OUTCOME[entry.outcome] ?? entry.outcome}
                </span>
                <span className="min-w-0 flex-1 truncate text-content/45">
                  {[entry.method, entry.host, entry.detail].filter(Boolean).join(" ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
