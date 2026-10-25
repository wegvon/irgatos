import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Key, Lock, Search } from "../../../shared/ui/icons";
import {
  listSecrets,
  matchesSecret,
  parseHosts,
  revokeSecret,
  saveSecret,
  SECRET_KIND_LABEL,
  SECRET_PLACES,
  secretAudit,
  secretScopeLabel,
  SECRETS_CHANGED_EVENT,
  updateSecret,
  type SecretAudit,
  type SecretKind,
  type SecretMeta,
  type SecretPolicy,
} from "../model/secrets";

const button =
  "rounded-lg bg-selection px-3 py-2 text-[13px] font-medium hover:bg-selection-hover disabled:opacity-40";
const quiet =
  "rounded-lg px-3 py-2 text-[13px] text-content/70 hover:bg-selection disabled:opacity-40";
const field =
  "min-w-0 rounded-md border border-stroke bg-transparent px-2 py-1.5 text-[12px] text-content outline-none focus:border-content/40";
const caption = "text-[11px] text-content/50";

const OUTCOME: Record<SecretAudit["outcome"], string> = {
  saved: "Saved",
  used: "Used",
  blocked: "Blocked",
  revoked: "Deleted",
  expired: "Expired",
  ended: "Chat ended",
  edited: "Edited",
  approved: "Allowed",
  denied: "Denied",
};

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "GitHub token" → "GITHUB_TOKEN", the name agents write. */
export function secretNameFrom(label: string) {
  const name = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

type Draft = {
  kind: SecretKind;
  label: string;
  name: string;
  nameTouched: boolean;
  username: string;
  hosts: string;
  allowIn: string[];
  policy: SecretPolicy;
  description: string;
  purpose: string;
};

const EMPTY: Draft = {
  kind: "key",
  label: "",
  name: "",
  nameTouched: false,
  username: "",
  hosts: "",
  allowIn: ["header"],
  policy: "free",
  description: "",
  purpose: "",
};

function draftOf(meta: SecretMeta): Draft {
  return {
    kind: meta.kind,
    label: meta.label,
    name: meta.name,
    nameTouched: true,
    username: meta.username,
    hosts: meta.hosts.join(", "),
    allowIn: meta.allowIn,
    policy: meta.policy,
    description: meta.description,
    purpose: meta.purpose ?? "",
  };
}

/**
 * Adds or edits one vault entry. The value lives only in the masked input
 * and is read once, on Save; editing leaves it as it is unless retyped.
 */
function SecretForm({
  editing,
  onDone,
  onDelete,
}: {
  editing: SecretMeta | null;
  onDone: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(editing ? draftOf(editing) : EMPTY);
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const valueRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const login = draft.kind === "login";

  const save = async () => {
    setError("");
    const value = valueRef.current?.value ?? "";
    const name = draft.name.trim();
    if (!name) return setError("Give it a name.");
    if (!editing && !value.trim()) return setError(login ? "Enter the password." : "Enter the value.");
    const hosts = parseHosts(draft.hosts);
    if (!hosts.length) return setError(login ? "Name the site it is for." : "Name at least one host it may be sent to.");
    const common = {
      name,
      label: draft.label.trim() || name,
      description: draft.description.trim(),
      hosts,
      allowIn: draft.allowIn.length ? draft.allowIn : ["header"],
      purpose: draft.purpose.trim() || undefined,
      kind: draft.kind,
      username: login ? draft.username.trim() : "",
      policy: draft.policy,
    };
    setSaving(true);
    try {
      if (editing) {
        await updateSecret({ id: editing.id, ...common, ...(value.trim() ? { value } : {}) });
      } else {
        await saveSecret({ ...common, once: false, persistent: true, value });
      }
      if (valueRef.current) valueRef.current.value = "";
      onDone();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-stroke px-4 py-4"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex gap-1 self-start rounded-lg bg-content/[0.05] p-0.5" role="radiogroup">
        {(["key", "login"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind}
            className={`rounded-md px-3 py-1 text-[12px] ${draft.kind === kind ? "bg-background-base font-medium shadow-sm" : "text-content/60"}`}
            onClick={() => set({ kind, allowIn: kind === "login" && !editing ? ["header", "body"] : draft.allowIn })}
          >
            {SECRET_KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className={caption}>
          Label
          <input
            className={`${field} mt-0.5 block w-full`}
            placeholder={login ? "GitHub login" : "Stripe secret key"}
            value={draft.label}
            onChange={(event) =>
              set({
                label: event.target.value,
                ...(draft.nameTouched ? {} : { name: secretNameFrom(event.target.value) }),
              })
            }
          />
        </label>
        <label className={caption}>
          Name agents use
          <input
            className={`${field} mt-0.5 block w-full font-mono`}
            placeholder={login ? "GITHUB_LOGIN" : "STRIPE_KEY"}
            value={draft.name}
            spellCheck={false}
            onChange={(event) =>
              set({ name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), nameTouched: true })
            }
          />
        </label>
        {login ? (
          <label className={caption}>
            Username or email
            <input
              className={`${field} mt-0.5 block w-full`}
              value={draft.username}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(event) => set({ username: event.target.value })}
            />
          </label>
        ) : null}
        <label className={`${caption} ${login ? "" : "sm:col-span-2"}`}>
          {login ? "Password" : "Value"}
          <span className="mt-0.5 flex gap-2">
            <input
              ref={valueRef}
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className={`${field} flex-1 font-mono`}
              placeholder={editing ? "Leave empty to keep the current one" : "Paste or type it"}
            />
            <button type="button" className={quiet} onClick={() => setShown((value) => !value)}>
              {shown ? "Hide" : "Show"}
            </button>
          </span>
        </label>
      </div>

      <label className={caption}>
        {login ? "Sites it is for" : "May only be sent to"}
        <input
          className={`${field} mt-0.5 block w-full`}
          placeholder={login ? "github.com" : "api.stripe.com, *.example.com"}
          value={draft.hosts}
          spellCheck={false}
          onChange={(event) => set({ hosts: event.target.value })}
        />
      </label>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-content/70">
        <span className={caption}>Placed in a request's</span>
        {SECRET_PLACES.map((place) => (
          <label key={place} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.allowIn.includes(place)}
              onChange={(event) =>
                set({
                  allowIn: event.target.checked
                    ? [...draft.allowIn, place]
                    : draft.allowIn.filter((item) => item !== place),
                })
              }
            />
            {place}
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className={caption}>When an agent wants it</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-content/80">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="policy"
              checked={draft.policy === "free"}
              onChange={() => set({ policy: "free" })}
            />
            Allowed
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="policy"
              checked={draft.policy === "ask"}
              onChange={() => set({ policy: "ask" })}
            />
            Ask me each time
          </label>
        </div>
        <span className="text-[11px] text-content/40">
          {draft.policy === "ask"
            ? "The chat shows a card; you allow it once, for that chat, or deny it."
            : "Agents use it for the sites above without asking."}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <label className={caption}>
          Note for agents (optional)
          <input
            className={`${field} mt-0.5 block w-full`}
            placeholder="Production account; read-only use"
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
          />
        </label>
        <label className={caption}>
          Only for (optional)
          <input
            className={`${field} mt-0.5 block w-full`}
            placeholder="any action"
            value={draft.purpose}
            onChange={(event) => set({ purpose: event.target.value })}
          />
        </label>
      </div>

      {error ? <div className="text-[12px] text-red-400">{error}</div> : null}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className={button}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={quiet} onClick={onDone}>
          Cancel
        </button>
        <span className="flex-1" />
        {onDelete ? (
          confirmDelete ? (
            <span className="flex items-center gap-2 text-[12px] text-content/60">
              Delete for good?
              <button
                type="button"
                className="rounded-lg bg-red-500/15 px-3 py-2 text-[13px] font-medium text-red-400 hover:bg-red-500/25"
                onClick={onDelete}
              >
                Delete
              </button>
              <button type="button" className={quiet} onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className={`${quiet} text-red-400/80`} onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}

function SecretRow({ secret, onEdit }: { secret: SecretMeta; onEdit?: () => void }) {
  const Icon = secret.kind === "login" ? Lock : Key;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="size-4 shrink-0 text-content/45" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="truncate font-medium">{secret.label}</span>
          <code className="shrink-0 rounded bg-content/[0.06] px-1.5 py-px font-mono text-[11px] text-content/60">
            {secret.name}
          </code>
          {secret.policy === "ask" && secret.sessionId === null ? (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-500">
              Asks first
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-content/45">
          {[
            secret.kind === "login" && secret.username ? secret.username : "",
            secret.hosts.join(", "),
            secret.sessionId ? secretScopeLabel(secret) : "",
            secret.purpose ? `only for ${secret.purpose}` : "",
            secret.maxUses
              ? `${Math.max(0, secret.maxUses - secret.uses)} use left`
              : `${secret.uses} ${secret.uses === 1 ? "use" : "uses"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {onEdit ? (
        <button className={button} onClick={onEdit}>
          Edit
        </button>
      ) : null}
    </div>
  );
}

/** Settings → Vault: what agents may use, how, and where it went. */
export function SecretsSettings() {
  const [secrets, setSecrets] = useState<SecretMeta[] | null>(null);
  const [audit, setAudit] = useState<SecretAudit[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // null: no form; "new": adding; otherwise the id being edited.
  const [form, setForm] = useState<string | null>(null);

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

  const saved = useMemo(
    () =>
      (secrets ?? [])
        .filter((secret) => secret.sessionId === null && matchesSecret(secret, query))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [secrets, query],
  );
  const inChats = useMemo(
    () => (secrets ?? []).filter((secret) => secret.sessionId !== null && matchesSecret(secret, query)),
    [secrets, query],
  );
  const editing = form && form !== "new" ? (secrets ?? []).find((s) => s.id === form) ?? null : null;

  const done = () => {
    setForm(null);
    refresh();
  };
  const remove = (id: string) =>
    revokeSecret(id)
      .then(done)
      .catch((e) => setError(String(e)));

  return (
    <div data-setting-id="secrets" className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-content/45">
        API keys and logins agents may use without seeing them. An agent only
        knows the name; Irgatos fills the value in for the sites listed, and it
        never appears in a chat, a log or the agent's output. Values are
        encrypted, with the key in your Keychain.
      </p>

      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-stroke px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-content/40" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
            placeholder="Search the vault"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className={`${button} shrink-0`} onClick={() => setForm(form === "new" ? null : "new")}>
          {form === "new" ? "Cancel" : "Add"}
        </button>
      </div>

      {form === "new" ? <SecretForm key="new" editing={null} onDone={done} /> : null}

      <div className="flex flex-col divide-y divide-stroke rounded-xl border border-stroke">
        {secrets === null ? (
          <div className="px-4 py-3 text-[12px] text-content/45">Loading…</div>
        ) : saved.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-content/45">
            {query
              ? "Nothing matches."
              : "The vault is empty. Add an API key or a login, or save one for all chats when an agent asks."}
          </div>
        ) : (
          saved.map((secret) =>
            editing?.id === secret.id ? (
              <div key={secret.id} className="p-2">
                <SecretForm
                  key={secret.id}
                  editing={secret}
                  onDone={done}
                  onDelete={() => void remove(secret.id)}
                />
              </div>
            ) : (
              <SecretRow key={secret.id} secret={secret} onEdit={() => setForm(secret.id)} />
            ),
          )
        )}
      </div>

      {inChats.length ? (
        <div className="mt-2">
          <h2 className="text-[13px] font-semibold text-content">In chats</h2>
          <p className="mt-1 text-[12px] text-content/45">
            Entered when an agent asked; each ends with its chat.
          </p>
          <div className="mt-2 flex flex-col divide-y divide-stroke rounded-xl border border-stroke">
            {inChats.map((secret) => (
              <div key={secret.id} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <SecretRow secret={secret} />
                </div>
                <button className={`${button} mr-4`} onClick={() => void remove(secret.id)}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
                  className={`shrink-0 ${entry.outcome === "blocked" || entry.outcome === "denied" ? "text-red-400" : "text-content/70"}`}
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
