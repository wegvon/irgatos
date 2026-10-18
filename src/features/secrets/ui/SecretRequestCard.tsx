import { useRef, useState } from "react";
import { Lock } from "../../../shared/ui/icons";
import {
  DEFAULT_TTL_HOURS,
  parseHosts,
  SECRET_ANSWERED_EVENT,
  saveSecret,
  type SecretAnswer,
  type SecretRequest,
} from "../model/secrets";

/**
 * The masked input an agent's `secrets.request` puts in a chat. The value is
 * read from the input only when Save is pressed, handed to the vault, and
 * cleared; it never enters React state, the chat or the agent's turn.
 */
export function SecretRequestCard({
  blockId,
  request,
  embedded,
}: {
  blockId: string;
  request: SecretRequest;
  embedded?: boolean;
}) {
  const valueRef = useRef<HTMLInputElement>(null);
  const [hosts, setHosts] = useState(request.hosts.join(", "));
  const [persistent, setPersistent] = useState(false);
  const [once, setOnce] = useState(request.once);
  const [purpose, setPurpose] = useState(request.purpose ?? "");
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = embedded ? "" : "px-4";

  const answer = (next: SecretRequest) =>
    window.dispatchEvent(
      new CustomEvent<SecretAnswer>(SECRET_ANSWERED_EVENT, {
        detail: { blockId, request: next },
      }),
    );

  if (request.state !== "pending") {
    return (
      <div className={`${pad} py-2`}>
        <div className="flex items-center gap-2 text-xs text-content/55">
          <Lock className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>
            {request.state === "saved"
              ? `${request.name} saved ${request.persistent ? "for all chats" : "for this chat"} · usable only at ${request.hosts.join(", ")}`
              : `${request.name} was not entered`}
          </span>
        </div>
      </div>
    );
  }

  const save = async () => {
    const input = valueRef.current;
    const value = input?.value ?? "";
    if (!value.trim()) {
      setError("Enter the value first.");
      return;
    }
    const list = parseHosts(hosts);
    if (!list.length) {
      setError("Name at least one host it may be sent to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const meta = await saveSecret({
        sessionId: request.sessionId,
        name: request.name,
        label: request.label,
        description: request.description,
        hosts: list,
        allowIn: request.allowIn,
        purpose: purpose.trim() || undefined,
        once,
        persistent,
        ttlHours: DEFAULT_TTL_HOURS,
        value,
      });
      if (input) input.value = "";
      answer({
        ...request,
        hosts: meta.hosts,
        purpose: meta.purpose,
        once: meta.maxUses === 1,
        state: "saved",
        persistent: meta.sessionId === null,
        expiresAt: meta.expiresAt,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${pad} py-2`} data-secret-request={request.name}>
      <form
        className="rounded-lg border border-content/12 bg-content/[0.03] p-3 text-sm"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-2">
          <Lock className="size-4 shrink-0 text-content/60" strokeWidth={1.75} />
          <span className="font-medium">{request.label}</span>
          <code className="rounded bg-content/8 px-1.5 py-px text-[11px] text-content/60">
            {request.name}
          </code>
        </div>
        {request.description && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-content/60">
            {request.description}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <input
            ref={valueRef}
            type={shown ? "text" : "password"}
            name={`secret-${request.requestId}`}
            aria-label={`Value for ${request.name}`}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder="Paste or type the value"
            className="min-w-0 flex-1 rounded-md border border-content/15 bg-background-base px-2 py-1 font-mono text-xs outline-none focus:border-content/40"
          />
          <button
            type="button"
            className="rounded-md bg-content/10 px-2 py-0.5 text-[11px] text-content/70 hover:bg-content/20"
            onClick={() => setShown((value) => !value)}
          >
            {shown ? "Hide" : "Show"}
          </button>
        </div>
        <label className="mt-2 block text-[11px] text-content/55">
          May only be sent to
          <input
            value={hosts}
            onChange={(event) => setHosts(event.target.value)}
            spellCheck={false}
            className="mt-0.5 block w-full rounded-md border border-content/15 bg-background-base px-2 py-1 text-xs text-content outline-none focus:border-content/40"
          />
        </label>
        <p className="mt-1 text-[11px] text-content/45">
          Used only inside the request{" "}
          {request.allowIn.length ? request.allowIn.join(", ") : "header"}; the agent never sees it.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-content/70">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />
            Use once
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={persistent}
              onChange={(e) => setPersistent(e.target.checked)}
            />
            Keep for all chats (encrypted)
          </label>
          <label className="flex items-center gap-1.5">
            Only for
            <input
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="any action"
              className="w-28 rounded-md border border-content/15 bg-background-base px-1.5 py-px text-[11px] text-content outline-none focus:border-content/40"
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-content/45">
          {persistent
            ? "Kept until you revoke it in Settings > Secrets."
            : `Removed when this chat is archived or deleted, or after ${DEFAULT_TTL_HOURS} hours.`}
        </p>
        {error && <p className="mt-1.5 text-[11px] text-red-500">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-content px-2.5 py-0.5 text-[11px] text-background-base hover:bg-content/80 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-md bg-content/10 px-2.5 py-0.5 text-[11px] text-content/70 hover:bg-content/20"
            onClick={() => {
              if (valueRef.current) valueRef.current.value = "";
              answer({ ...request, state: "declined" });
            }}
          >
            Decline
          </button>
        </div>
      </form>
    </div>
  );
}
