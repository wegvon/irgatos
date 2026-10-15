import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { type AppWindow, type WindowSelection } from "../model/appWindows";

export function useAppWindows(
  sessionId: string | undefined,
  open: boolean,
  query: string,
  enabled = true,
) {
  const [windows, setWindows] = useState<AppWindow[]>([]);
  const [selection, setSelection] = useState<WindowSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    revision.current++;
    setSelection(null);
    setSelecting(false);
    if (enabled && sessionId)
      void invoke<WindowSelection | null>("computer_use_selected", {
        sessionId,
      })
        .then((next) => {
          if (!cancelled) setSelection(next ?? null);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
      revision.current++;
    };
  }, [enabled, sessionId]);
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const listening = listen<string>("computer-use-stopped", ({ payload }) => {
      if (payload === sessionId) {
        revision.current++;
        setSelection(null);
        setSelecting(false);
      }
    }).catch(() => () => {});
    return () => {
      void listening.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [enabled, sessionId]);
  useEffect(() => {
    if (!enabled || !sessionId || !open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void invoke<AppWindow[]>("computer_use_windows")
      .then((next) => {
        if (!cancelled) setWindows(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setWindows([]);
          setError(String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId, open]);
  const select = async (window: AppWindow, allowControl = false) => {
    if (!sessionId || selecting) return null;
    const current = ++revision.current;
    setSelecting(true);
    setError("");
    try {
      const next = await invoke<WindowSelection>("computer_use_select", {
        sessionId,
        window,
        allowControl,
      });
      if (current !== revision.current) return null;
      setSelection(next);
      return next;
    } catch (cause) {
      if (current === revision.current) {
        setSelection(null);
        setError(String(cause));
      }
      return null;
    } finally {
      if (current === revision.current) setSelecting(false);
    }
  };
  const revoke = async () => {
    if (!sessionId) return;
    revision.current++;
    setSelecting(true);
    try {
      await invoke("computer_use_revoke", { sessionId });
      setSelection(null);
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSelecting(false);
    }
  };
  const search = query
    .replace(/^app\//, "")
    .replace(/-/g, " ")
    .toLocaleLowerCase();
  return {
    windows: windows.filter((w) =>
      `${w.app_name} ${w.title}`.toLocaleLowerCase().includes(search),
    ),
    selection,
    loading,
    error,
    selecting,
    select,
    revoke,
  };
}
