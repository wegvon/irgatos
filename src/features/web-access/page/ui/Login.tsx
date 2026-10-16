import { useState } from "react";
import { signIn } from "../client";
import { primaryButton } from "./parts";

/** First visit on a device, or after a new token: paste the token once. */
export function Login({ invalid }: { invalid: boolean }) {
  const [token, setToken] = useState("");
  return (
    <div className="web-scroll flex h-full flex-col items-center justify-center px-6 pb-(--safe-bottom) pt-(--safe-top)">
      <form
        className="web-pop-in flex w-full max-w-[400px] flex-col items-center text-center"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) signIn(token);
        }}
      >
        <img
          src="/irgat.png"
          alt=""
          className="mb-5 size-20 rounded-[22px] shadow-xl shadow-black/30"
        />
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">Irgatos</h1>
        <p className="mt-2 text-[15px] leading-snug text-content/55">
          Your Mac's chats, ideas and approvals, wherever you are.
        </p>
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Access token"
          className="web-field mt-8 h-12 w-full rounded-[14px] bg-(--surface) px-4 text-center shadow-[0_0_0_0.5px_var(--color-stroke)] outline-none focus:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
        />
        {invalid ? (
          <div className="mt-2 text-[14px] text-(--bad)">
            That token did not work. Copy it again on your Mac.
          </div>
        ) : null}
        <button
          className={`${primaryButton} mt-3 h-12 w-full text-[16px]`}
          disabled={!token.trim()}
        >
          Sign in
        </button>
        <p className="mt-8 text-[13px] leading-relaxed text-content/45">
          On your Mac, open Irgatos Settings, then Connections, then Browser
          access, and tap Copy token.
          <br />
          Tip: Share, then Add to Home Screen, makes this a full-screen app.
        </p>
      </form>
    </div>
  );
}
