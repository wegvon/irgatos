/**
 * Chats shown side by side in the Irgat and Chat views. The view's own chat
 * stays on the left; "Open beside" adds another one to its right, up to
 * MAX_SIDE_PANES, each with a draggable edge. Every Irgat keeps its own row,
 * and so does the Chat page, so they survive switching views and restarts.
 */

export type SidePaneKey = "chats" | `irgat:${string}`;

export type SidePanes = {
  /** Chats right of the main one, left to right. */
  ids: string[];
  /** Width shares of the main chat and then each of `ids`; they add to 1. */
  sizes: number[];
};

export type SidePaneMap = Partial<Record<SidePaneKey, SidePanes>>;

export const MAX_SIDE_PANES = 3;
/** The narrowest share a pane may be dragged to. */
export const MIN_SIDE_PANE_SHARE = 0.15;

const STORAGE_KEY = "irgatos.sidePanes.v1";

export function irgatSidePaneKey(irgatId: string): SidePaneKey {
  return `irgat:${irgatId}`;
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

/** Opens `id` right of the main chat; one already shown stays where it is. */
export function openBeside(
  panes: SidePanes | undefined,
  mainId: string | undefined,
  id: string,
): SidePanes {
  const current = panes ?? { ids: [], sizes: [1] };
  if (id === mainId || current.ids.includes(id)) return current;
  // A full row trades its rightmost chat for the new one.
  const ids = [...current.ids.slice(0, MAX_SIDE_PANES - 1), id];
  return { ids, sizes: equalSizes(ids.length + 1) };
}

export function closeSidePane(
  panes: SidePanes | undefined,
  id: string,
): SidePanes | undefined {
  if (!panes?.ids.includes(id)) return panes;
  const ids = panes.ids.filter((entry) => entry !== id);
  if (ids.length === 0) return undefined;
  return { ids, sizes: equalSizes(ids.length + 1) };
}

/**
 * Moves the edge right of pane `index` (0 is the main chat) to `ratio` of the
 * row's width, keeping both neighbours at least MIN_SIDE_PANE_SHARE wide.
 */
export function resizeSidePanes(
  panes: SidePanes,
  index: number,
  ratio: number,
): SidePanes {
  const sizes = normalizedSizes(panes);
  if (index < 0 || index >= sizes.length - 1) return panes;
  const before = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
  const pair = sizes[index] + sizes[index + 1];
  const left = Math.min(
    Math.max(ratio - before, MIN_SIDE_PANE_SHARE),
    pair - MIN_SIDE_PANE_SHARE,
  );
  if (!Number.isFinite(left)) return panes;
  const next = [...sizes];
  next[index] = left;
  next[index + 1] = pair - left;
  return { ids: panes.ids, sizes: next };
}

/** Sizes that match `ids` and add to 1, whatever was stored. */
export function normalizedSizes(panes: SidePanes): number[] {
  const count = panes.ids.length + 1;
  const sizes = panes.sizes;
  if (
    sizes.length !== count ||
    sizes.some((size) => !Number.isFinite(size) || size <= 0)
  ) {
    return equalSizes(count);
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => size / total);
}

/**
 * What a view shows: its side chats without the main one and without chats
 * that no longer exist, with the sizes of the ones kept.
 */
export function shownSidePanes(
  panes: SidePanes | undefined,
  mainId: string | undefined,
  exists: (id: string) => boolean,
): SidePanes | undefined {
  if (!panes || panes.ids.length === 0) return undefined;
  const sizes = normalizedSizes(panes);
  const keep = panes.ids
    .map((id, index) => ({ id, size: sizes[index + 1] }))
    .filter(({ id }) => id !== mainId && exists(id));
  if (keep.length === 0) return undefined;
  if (keep.length === panes.ids.length) return { ids: panes.ids, sizes };
  const kept = [sizes[0], ...keep.map(({ size }) => size)];
  const total = kept.reduce((sum, size) => sum + size, 0);
  return {
    ids: keep.map(({ id }) => id),
    sizes: kept.map((size) => size / total),
  };
}

/** Drops `id` from every view, for a chat that was deleted. */
export function forgetSidePane(map: SidePaneMap, id: string): SidePaneMap {
  let changed = false;
  const next: SidePaneMap = {};
  for (const [key, panes] of Object.entries(map) as [
    SidePaneKey,
    SidePanes,
  ][]) {
    const after = closeSidePane(panes, id);
    if (after !== panes) changed = true;
    if (after) next[key] = after;
  }
  return changed ? next : map;
}

export function loadSidePanes(): SidePaneMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return parseSidePanes(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveSidePanes(map: SidePaneMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be full or blocked; the row still works for this run.
  }
}

export function parseSidePanes(value: unknown): SidePaneMap {
  if (!value || typeof value !== "object") return {};
  const map: SidePaneMap = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "chats" && !key.startsWith("irgat:")) continue;
    if (!entry || typeof entry !== "object") continue;
    const { ids, sizes } = entry as { ids?: unknown; sizes?: unknown };
    if (!Array.isArray(ids)) continue;
    const cleanIds = [
      ...new Set(
        ids.filter((id): id is string => typeof id === "string" && !!id),
      ),
    ].slice(0, MAX_SIDE_PANES);
    if (cleanIds.length === 0) continue;
    const cleanSizes = Array.isArray(sizes)
      ? sizes.filter((size): size is number => typeof size === "number")
      : [];
    map[key as SidePaneKey] = {
      ids: cleanIds,
      sizes: normalizedSizes({ ids: cleanIds, sizes: cleanSizes }),
    };
  }
  return map;
}
