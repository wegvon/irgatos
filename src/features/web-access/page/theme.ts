import { useEffect, useState } from "react";
import {
  applyAccentColor,
  applyThemePalette,
  THEME_PALETTE_DEFAULT,
  THEME_PALETTES,
} from "../../settings/model/appearance";
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
  applyThemePalette(
    appearance.palette && THEME_PALETTES.includes(appearance.palette)
      ? appearance.palette
      : THEME_PALETTE_DEFAULT,
  );
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
 * Opened from the Home Screen with a translucent status bar, iOS draws the
 * page over the whole screen but reports a window (and visual viewport) short
 * by the status bar, which leaves an empty strip under the composer. Returns
 * the missing height, or 0 in Safari, split view or when nothing is missing.
 */
export function standaloneHeightGap(view: {
  standalone: boolean;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
}): number {
  if (!view.standalone) return 0;
  const portrait = view.innerHeight >= view.innerWidth;
  const long = Math.max(view.screenWidth, view.screenHeight);
  const short = Math.min(view.screenWidth, view.screenHeight);
  const [fullWidth, fullHeight] = portrait ? [short, long] : [long, short];
  // Split view or Stage Manager: the window is not the screen.
  if (Math.abs(view.innerWidth - fullWidth) > 1) return 0;
  const gap = fullHeight - view.innerHeight;
  // Only ever a status bar's worth; anything else is not this bug.
  return gap > 0 && gap <= 80 ? gap : 0;
}

/**
 * iOS lays the keyboard over the page instead of resizing it. Size the app to
 * the visible area so the composer stays right above the keyboard, and drop
 * the home-indicator gap while the keyboard covers it.
 */
export function trackVisualViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const update = () => {
    const gap = standaloneHeightGap({
      standalone,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    });
    const height = (viewport?.height ?? window.innerHeight) + gap;
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
