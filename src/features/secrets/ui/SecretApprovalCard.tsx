import { useState } from "react";
import { Lock } from "../../../shared/ui/icons";
import {
  SECRET_KIND_LABEL,
  settleSecretApproval,
  type SecretApproval,
} from "../model/secrets";

const ANSWERED: Record<Exclude<SecretApproval["state"], "pending">, string> = {
  once: "allowed once",
  chat: "allowed for this chat",
  deny: "not allowed",
};

/**
 * An agent wants a vault value the user set to "Ask each time". The user
 * allows it once, for the rest of the chat, or not at all; the agent never
 * sees the value either way.
 */
export function SecretApprovalCard({
  blockId,
  approval,
  embedded,
}: {
  blockId: string;
  approval: SecretApproval;
  embedded?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = embedded ? "" : "px-4";

  if (approval.state !== "pending") {
    return (
      <div className={`${pad} py-2`}>
        <div className="flex items-center gap-2 text-xs text-content/55">
          <Lock className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>
            {approval.label} {ANSWERED[approval.state]}
            {approval.target ? ` · ${approval.target}` : ""}
          </span>
        </div>
      </div>
    );
  }

  const answer = async (state: "once" | "chat" | "deny") => {
    setBusy(true);
    setError(null);
    try {
      await settleSecretApproval(blockId, approval, state);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const chip =
    "rounded-md px-2.5 py-0.5 text-[11px] disabled:opacity-50";
  return (
    <div className={`${pad} py-2`} data-secret-approval={approval.name}>
      <div className="rounded-lg border border-content/12 bg-content/[0.03] p-3 text-sm">
        <div className="flex items-center gap-2">
          <Lock className="size-4 shrink-0 text-content/60" strokeWidth={1.75} />
          <span className="font-medium">Use {approval.label}?</span>
          <code className="rounded bg-content/8 px-1.5 py-px text-[11px] text-content/60">
            {approval.name}
          </code>
        </div>
        <p className="mt-1 text-xs text-content/60">
          The agent wants this {SECRET_KIND_LABEL[approval.kind].toLowerCase()} for{" "}
          {[approval.method, approval.target].filter(Boolean).join(" ") || approval.action}. Irgatos
          fills it in; the agent never sees it.
        </p>
        {error && <p className="mt-1.5 text-[11px] text-red-500">{error}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className={`${chip} bg-content text-background-base hover:bg-content/80`}
            onClick={() => void answer("once")}
          >
            Allow once
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${chip} bg-content/10 text-content/80 hover:bg-content/20`}
            onClick={() => void answer("chat")}
          >
            Allow in this chat
          </button>
          <span className="flex-1" />
          <button
            type="button"
            disabled={busy}
            className={`${chip} bg-content/10 text-content/70 hover:bg-content/20`}
            onClick={() => void answer("deny")}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
