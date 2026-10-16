import { useEffect, useState } from "react";

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
