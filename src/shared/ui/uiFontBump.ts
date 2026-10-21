/**
 * The px every fixed UI font size grows by (`--ui-font-bump` in index.css),
 * for sizes set from script: xterm and fit-to-width text.
 */
export function uiFontBump(): number {
  if (typeof document === "undefined") return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    "--ui-font-bump",
  );
  return Number.parseFloat(value) || 0;
}

/** A CSS size that grows with the UI font bump, for CSS-in-JS themes. */
export function bumpedFontSize(px: number): string {
  return `calc(${px}px + var(--ui-font-bump, 0px))`;
}
