import { useEffect, useState } from "react";
import {
  rotateWebAccessToken,
  setWebAccessEnabled,
  webAccessStatus,
  type WebAccessStatus,
} from "../model/webAccess";

const button =
  "rounded-lg bg-selection px-3 py-2 text-[13px] font-medium hover:bg-selection-hover disabled:opacity-40";

/** Settings → Connections: open this Irgatos from a browser on your other devices. */
export function WebAccessSettings() {
  const [status, setStatus] = useState<WebAccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    webAccessStatus()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  const run = async (action: () => Promise<WebAccessStatus>) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await action());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1500);
  };

  const link = status?.urls[0];

  return (
    <div
      data-setting-id="browser-access"
      className="mt-8 flex flex-col gap-3 border-t border-stroke pt-6"
    >
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-content">
            Browser access
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            Follow and answer your chats from a browser on your other devices.
            The page talks to this running Irgatos, so it always shows the same
            chats. Only this Mac and devices on your Tailscale network can
            connect, and they need the access token.
          </p>
        </div>
        <button
          className={`${button} shrink-0`}
          disabled={busy || !status}
          onClick={() => run(() => setWebAccessEnabled(!status?.enabled))}
        >
          {status?.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {status?.enabled ? (
        <div className="flex flex-col gap-3 rounded-xl border border-stroke px-4 py-4 text-[12px]">
          <div className="text-content/60">
            {status.running
              ? status.tailscale
                ? "Running. Open the first address on any device signed in to your Tailscale."
                : "Running on this Mac only. Install Tailscale on this Mac and your other devices to open it from them."
              : "Not running."}
          </div>
          {status.urls.map((url) => (
            <div key={url} className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-content/5 px-2 py-1.5 text-[12px]">
                {url}
              </code>
              <button className={button} onClick={() => copy(url, url)}>
                {copied === url ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-content/5 px-2 py-1.5 text-[12px]">
              {"•".repeat(24)}
            </code>
            <button
              className={button}
              onClick={() => copy("token", status.token)}
            >
              {copied === "token" ? "Copied" : "Copy token"}
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => run(rotateWebAccessToken)}
            >
              New token
            </button>
          </div>
          {link ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-content/45">
                A sign-in link with the token built in. Open it once per device;
                it stays signed in until you make a new token.
              </span>
              <button
                className={button}
                onClick={() =>
                  copy(
                    "link",
                    `${link}?token=${encodeURIComponent(status.token)}`,
                  )
                }
              >
                {copied === "link" ? "Copied" : "Copy sign-in link"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {status?.error || error ? (
        <div className="text-[12px] text-red-400">{status?.error || error}</div>
      ) : null}
    </div>
  );
}
