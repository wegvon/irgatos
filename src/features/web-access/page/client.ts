import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Talks to the running Irgatos on the Mac. Reads are GETs; writes are POSTs
 * with the header the Mac requires, so another site can never post a form
 * into it. The session cookie rides along on both.
 */
export class SignedOut extends Error {}
export class Unreachable extends Error {}

const signedOutListeners = new Set<() => void>();
const refreshListeners = new Set<() => void>();

export function onSignedOut(listener: () => void) {
  signedOutListeners.add(listener);
  return () => void signedOutListeners.delete(listener);
}

/** Every open view reloads now, e.g. right after an action. */
export function refreshAll() {
  for (const listener of refreshListeners) listener();
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Unreachable("Can't reach your Mac.");
  }
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
    error?: string;
  } | null;
  if (response.status === 401) {
    for (const listener of signedOutListeners) listener();
    throw new SignedOut(body?.error ?? "Signed out");
  }
  if (!body?.ok) throw new Error(body?.error ?? `Error ${response.status}`);
  return body.result as T;
}

export function read<T>(
  action: string,
  query: Record<string, string> = {},
): Promise<T> {
  const search = new URLSearchParams(query).toString();
  return call<T>(`/api/${action}${search ? `?${search}` : ""}`, {});
}

/** `refresh: false` skips reloading every view, e.g. for each upload piece. */
export async function write<T = unknown>(
  action: string,
  body: Record<string, unknown>,
  refresh = true,
): Promise<T> {
  try {
    return await call<T>(`/api/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Irgatos-Web": "1",
      },
      body: JSON.stringify(body),
    });
  } finally {
    if (refresh) refreshAll();
  }
}

export function signIn(token: string) {
  location.href = `/?token=${encodeURIComponent(token.trim())}`;
}

type Poll<T> = {
  data: T | null;
  error: Error | null;
  /** Loaded at least once for the current key. */
  ready: boolean;
  reload: () => void;
  /** Shows a change right away; the next load replaces it with the Mac's state. */
  mutate: (update: (data: T) => T) => void;
};

/**
 * Loads `key` now and again every `every(data)` ms while the page is visible.
 * A hidden tab stops polling and catches up the moment it comes back, so a
 * phone in a pocket costs the Mac nothing.
 */
export function usePoll<T>(
  key: string | null,
  load: () => Promise<T>,
  every: (data: T | null) => number,
): Poll<T> {
  const [state, setState] = useState<{
    key: string | null;
    data: T | null;
    error: Error | null;
  }>({ key, data: null, error: null });
  const loadRef = useRef(load);
  const everyRef = useRef(every);
  loadRef.current = load;
  everyRef.current = every;
  const tick = useRef<() => void>(() => {});

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    let timer = 0;
    let inFlight = false;
    let again = false;
    let last: T | null = null;

    const run = async () => {
      window.clearTimeout(timer);
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const data = await loadRef.current();
        last = data;
        if (alive) setState({ key, data, error: null });
      } catch (error) {
        if (alive)
          setState((current) => ({
            key,
            data: current.key === key ? current.data : null,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
        if (error instanceof SignedOut) alive = false;
      } finally {
        inFlight = false;
      }
      if (!alive) return;
      if (again) {
        again = false;
        void run();
      } else if (!document.hidden)
        timer = window.setTimeout(run, everyRef.current(last));
    };
    const onVisible = () => {
      if (!document.hidden) void run();
    };

    tick.current = () => void run();
    setState((current) =>
      current.key === key ? current : { key, data: null, error: null },
    );
    void run();
    refreshListeners.add(tick.current);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      refreshListeners.delete(tick.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [key]);

  const reload = useCallback(() => tick.current(), []);
  const mutate = useCallback(
    (update: (data: T) => T) =>
      setState((current) =>
        current.key === key && current.data !== null
          ? { ...current, data: update(current.data) }
          : current,
      ),
    [key],
  );
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    ready: current && (state.data !== null || state.error !== null),
    reload,
    mutate,
  };
}
