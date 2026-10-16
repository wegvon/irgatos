import { useCallback, useEffect, useState } from "react";

/**
 * Hash routes, so the Mac only ever serves one page and a reload or a Home
 * Screen launch lands where the user was. Sheets (new chat, services, an
 * idea) open over the screen underneath, which stays mounted.
 */
export type Route =
  | { name: "today" }
  | { name: "chats" }
  | { name: "chat"; id: string }
  | { name: "ideas" }
  | { name: "idea"; id: string }
  | { name: "new" }
  | { name: "services" };

export type Screen = Extract<
  Route,
  { name: "today" | "chats" | "chat" | "ideas" }
>;
export type Sheet = Exclude<Route, Screen>;

export function parseRoute(hash: string): Route {
  const [name = "", id = ""] = hash.replace(/^#\/?/, "").split("/");
  const value = decodeURIComponent(id);
  switch (name) {
    case "chats":
      return { name };
    case "chat":
      return value ? { name, id: value } : { name: "chats" };
    case "ideas":
      return { name };
    case "idea":
      return value ? { name, id: value } : { name: "ideas" };
    case "new":
    case "services":
      return { name };
    default:
      return { name: "today" };
  }
}

export function href(route: Route): string {
  return "id" in route
    ? `#/${route.name}/${encodeURIComponent(route.id)}`
    : `#/${route.name}`;
}

export function isSheet(route: Route): route is Sheet {
  return (
    route.name === "new" || route.name === "services" || route.name === "idea"
  );
}

/** The screen a sheet opens over when the page is opened straight onto it. */
function screenUnder(route: Sheet): Screen {
  return route.name === "idea" ? { name: "ideas" } : { name: "today" };
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
