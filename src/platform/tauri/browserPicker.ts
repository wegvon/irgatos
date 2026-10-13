import { invoke } from "@tauri-apps/api/core";

/** CSS pixels in the page's viewport. */
export type PageRect = { x: number; y: number; width: number; height: number };

export type PageElement = {
  label: string;
  selector: string;
  tag: string;
  text: string;
  rect: PageRect;
};

export type PageElementDetails = PageElement & {
  attributes: [string, string][];
  styles: [string, string][];
  parent: { label: string; styles: [string, string][] } | null;
};

/** A picked element or dragged region, already bounded by the native side. */
export type PageSelection = {
  kind: "element" | "region";
  url: string;
  title: string;
  viewport: { width: number; height: number };
  rect: PageRect;
  element: PageElementDetails | null;
  container: PageElement | null;
  elements: PageElement[];
};

export type PickerPoll =
  | { state: "active" }
  | { state: "cancelled" }
  | { state: "picked"; selection: PageSelection };

/** Draw the picker over the page. It stays until a pick, a cancel or stop. */
export function startPicker(id: string) {
  return invoke<void>("browser_picker_start", { id });
}

export function stopPicker(id: string) {
  return invoke<void>("browser_picker_stop", { id });
}

export function pollPicker(id: string) {
  return invoke<PickerPoll>("browser_picker_poll", { id });
}

/** A base64 PNG of `rect` as the page shows it now. */
export function capturePage(id: string, rect: PageRect, viewportWidth: number) {
  return invoke<string>("browser_capture", {
    id,
    rect: { ...rect, viewportWidth },
  });
}
