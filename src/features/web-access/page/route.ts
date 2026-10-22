import { useCallback, useEffect, useState } from "react";
import { FLEET_BUCKETS, type FleetBucket } from "../../fleet/model/fleet";

/**
 * Hash routes, so the Mac only ever serves one page and a reload or a Home
 * Screen launch lands where the user was. Sheets (new chat, services, an
 * idea) open over the screen underneath, which stays mounted.
 */
export type Route =
  /** The phone's start: what waits on you, then a new chat. */
  | { name: "home" }
  | { name: "today" }
  /** `filter` keeps the list to one Fleet bucket. */
  | { name: "chats"; filter?: FleetBucket }
  | { name: "chat"; id: string }
  | { name: "irgats" }
  | { name: "ideas" }
  | { name: "idea"; id: string }
  | { name: "mail" }
  /** `id` is `mailThreadId(account, thread)`: a thread is unique per account. */
  | { name: "mailThread"; id: string }
  | { name: "new" }
  | { name: "services" }
  /** Fleet's Agent Tree, and Claude Code running outside Irgatos. */
  | { name: "agents" }
  | { name: "automations" }
  | { name: "automation"; id: string }
  /** An Irgat's settings, agents and memory, over the Irgats screen. */
  | { name: "irgat"; id: string }
  /** The desktop rail's Feed, Notes, Board and Artifacts. */
  | { name: "feed" }
  | { name: "notes" }
  | { name: "board" }
  | { name: "artifacts" };

export type Screen = Extract<
  Route,
  {
    name:
      | "home"
      | "today"
      | "chats"
      | "chat"
      | "irgats"
      | "ideas"
      | "mail"
      | "mailThread"
      | "agents"
      | "automations"
      | "feed"
      | "notes"
      | "board"
      | "artifacts";
  }
>;
export type Sheet = Exclude<Route, Screen>;

export function parseRoute(hash: string): Route {
  const [name = "", id = ""] = hash.replace(/^#\/?/, "").split("/");
  const value = decodeURIComponent(id);
  switch (name) {
    case "chats":
      return (FLEET_BUCKETS as readonly string[]).includes(value)
        ? { name, filter: value as FleetBucket }
        : { name };
    case "chat":
      return value ? { name, id: value } : { name: "chats" };
    case "today":
    case "irgats":
    case "ideas":
    case "feed":
    case "notes":
    case "board":
    case "artifacts":
      return { name };
    case "idea":
      return value ? { name, id: value } : { name: "ideas" };
    case "mail":
      return { name };
    case "mailThread":
      return value ? { name, id: value } : { name: "mail" };
    case "new":
    case "services":
    case "agents":
    case "automations":
      return { name };
    case "automation":
      return value ? { name, id: value } : { name: "automations" };
    case "irgat":
      return value ? { name, id: value } : { name: "irgats" };
    default:
      return { name: "home" };
  }
}

export function href(route: Route): string {
  if ("id" in route) return `#/${route.name}/${encodeURIComponent(route.id)}`;
  if (route.name === "chats" && route.filter) return `#/chats/${route.filter}`;
  return `#/${route.name}`;
}

export function isSheet(route: Route): route is Sheet {
  return (
    route.name === "new" ||
    route.name === "services" ||
    route.name === "idea" ||
    route.name === "automation" ||
    route.name === "irgat"
  );
}

/** The screen a sheet opens over when the page is opened straight onto it. */
function screenUnder(route: Sheet): Screen {
  if (route.name === "idea") return { name: "ideas" };
  if (route.name === "automation") return { name: "automations" };
  if (route.name === "irgat") return { name: "irgats" };
  return { name: "home" };
}

export const mailThreadId = (account: string, thread: string) =>
  `${account}\n${thread}`;

export function parseMailThreadId(id: string) {
  const at = id.lastIndexOf("\n");
  return { account: id.slice(0, Math.max(0, at)), thread: id.slice(at + 1) };
}

let openedSheetHere = false;

export function navigate(route: Route, replace = false) {
  const next = href(route);
  if (location.hash === next) return;
  if (replace) history.replaceState(null, "", next);
  else location.hash = next;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function openSheet(route: Sheet) {
  openedSheetHere = true;
  navigate(route);
}

/** Swaps an open sheet for another screen, e.g. a new chat once it starts. */
export function leaveSheetFor(route: Route) {
  openedSheetHere = false;
  navigate(route, true);
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [screen, setScreen] = useState<Screen>(() =>
    isSheet(route) ? screenUnder(route) : route,
  );

  useEffect(() => {
    const onChange = () => {
      const next = parseRoute(location.hash);
      setRoute(next);
      if (!isSheet(next)) setScreen(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const closeSheet = useCallback(() => {
    if (openedSheetHere) {
      openedSheetHere = false;
      history.back();
    } else navigate(screen, true);
  }, [screen]);

  return {
    route,
    screen,
    sheet: isSheet(route) ? route : null,
    closeSheet,
  };
}
