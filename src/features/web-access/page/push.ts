import { read, write } from "./client";

/**
 * Web Push on this device. The browser offers it only on a secure page, and
 * an iPhone or iPad only to the page opened from its Home Screen.
 */
export type PushState =
  "unsupported" | "insecure" | "install" | "denied" | "off" | "on";

const WORKER = "/sw.js";

function appleTouchDevice(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function fromHomeScreen(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function decodeKey(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return "insecure";
  if (!supported())
    return appleTouchDevice() && !fromHomeScreen() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await subscription()) ? "on" : "off";
}

/** Runs from the tap itself: iOS shows the permission prompt only then. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.register(WORKER, {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  const key = decodeKey(
    (await read<{ publicKey: string }>("pushKey")).publicKey,
  );
  let current = await registration.pushManager.getSubscription();
  if (current && !sameKey(current, key)) {
    await current.unsubscribe();
    current = null;
  }
  current ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await write("pushSubscribe", current.toJSON() as Record<string, unknown>);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const current = await subscription();
  if (current) {
    await write("pushUnsubscribe", { endpoint: current.endpoint });
    await current.unsubscribe();
  }
  return "off";
}

/** On every launch, so a Mac that lost its list learns this device again. */
export async function resyncPush(): Promise<void> {
  if (!window.isSecureContext || !supported()) return;
  await navigator.serviceWorker.register(WORKER, { scope: "/" });
  if (Notification.permission !== "granted") return;
  const current = await subscription();
  if (current)
    await write("pushSubscribe", current.toJSON() as Record<string, unknown>);
}
