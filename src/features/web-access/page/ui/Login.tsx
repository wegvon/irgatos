import { useState } from "react";
import { signIn } from "../client";
import { SparkleBubble, primaryButton } from "./parts";

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
        <SparkleBubble size="size-[84px]" glyph="size-11" />
        <h1 className="mt-7 text-[30px] font-semibold tracking-[-0.025em] text-(--ink)">
          Welcome to <span className="accent-text">Irgatos</span>
        </h1>
        <p className="mt-2 max-w-[32ch] text-[15px] leading-snug text-(--ink-2)">
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
          className="glass web-field mt-8 h-14 w-full rounded-full px-5 text-center text-(--ink) outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent),var(--shadow-card)]"
        />
        {invalid ? (
          <div className="mt-2.5 text-[14px] font-medium text-(--bad)">
            That token did not work. Copy it again on your Mac.
          </div>
        ) : null}
        <button
          className={`${primaryButton} mt-3 h-14 w-full text-[16px]`}
          disabled={!token.trim()}
        >
          Sign in
        </button>
        <p className="glass mt-8 rounded-[22px] px-5 py-4 text-[13px] leading-relaxed text-(--ink-2)">
          On your Mac, open Irgatos Settings, then Connections, then Browser
          access, and tap Copy token.
          <br />
          Tip: Share, then Add to Home Screen, makes this a full-screen app.
        </p>
      </form>
    </div>
  );
}
