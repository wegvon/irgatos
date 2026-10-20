import { useEffect, useState } from "react";
import { applyAccentColor } from "../../settings/model/appearance";
import type { WebAppearance } from "../model/protocol";

const STORED = "irgatos.web.appearance";

/** The Mac's theme, so the phone looks like the same app. "System" follows the phone. */
export function applyAppearance(appearance: WebAppearance) {
  const root = document.documentElement;
  const light =
    appearance.preference === "light" ||
    (appearance.preference === "system" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  root.classList.toggle("theme-light", light);
  root.style.setProperty("--theme-hue", String(appearance.hue));
  root.style.setProperty("--theme-saturation", `${appearance.saturation}%`);
  root.classList.toggle("has-theme-tint", appearance.saturation > 0);
  root.style.setProperty(
    "--theme-dark-lightness",
    `${appearance.darkLightness}%`,
  );
  applyAccentColor(appearance.accent);
  const background = getComputedStyle(root)
    .getPropertyValue("--color-background-base")
    .trim();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background || (light ? "#f4f1ec" : "#161616"));
  try {
    localStorage.setItem(STORED, JSON.stringify(appearance));
  } catch {
    // private mode
  }
}

/** Last theme seen, so a cold start does not flash the default. */
export function restoreAppearance() {
  try {
    const stored = localStorage.getItem(STORED);
    if (stored) applyAppearance(JSON.parse(stored) as WebAppearance);
  } catch {
    // ignore
  }
}

/**
 * iOS lays the keyboard over the page instead of resizing it. Size the app to
 * the visible area so the composer stays right above the keyboard, and drop
 * the home-indicator gap while the keyboard covers it.
 */
export function trackVisualViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const update = () => {
    const height = viewport?.height ?? window.innerHeight;
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.classList.toggle(
      "keyboard-open",
      !!viewport && window.innerHeight - viewport.height > 120,
    );
    // iOS scrolls the whole page to reveal a focused field; the layout
    // already did that, so put it back.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
