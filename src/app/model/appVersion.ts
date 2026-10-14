/** `0.1.0` → `v0.1.0`. Placeholders such as `…` pass through untouched. */
export function formatVersion(version: string | null | undefined): string {
  const trimmed = (version ?? "").trim().replace(/^v/i, "");
  if (!/^\d/.test(trimmed)) return trimmed || "…";
  return `v${trimmed}`;
}

/**
 * Compact badge form: a zero patch is dropped (`v0.1.0` → `v0.1`), anything
 * more specific (`v0.1.3`, `v0.2.0-beta.1`) is kept whole.
 */
export function shortVersion(version: string | null | undefined): string {
  const full = formatVersion(version);
  return full.replace(/^(v\d+\.\d+)\.0$/, "$1");
}

export function shortCommit(commit: string | null | undefined): string | undefined {
  const trimmed = commit?.trim();
  return trimmed ? trimmed.slice(0, 7) : undefined;
}
