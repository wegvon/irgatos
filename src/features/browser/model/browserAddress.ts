const SEARCH_URL = "https://www.google.com/search?q=";

const LOOPBACK =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d{1,5})?([/?#].*)?$/i;
const HOST_LIKE =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{1,5})?([/?#].*)?$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export type AddressResult = { url: string } | { error: string };

/**
 * What the address bar opens for typed text: a full web address, a bare host
 * (`example.com`, `localhost:3000`), or otherwise a web search.
 */
export function resolveAddress(input: string): AddressResult | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      return { url: new URL(text).href };
    } catch {
      return { error: "That address isn't valid" };
    }
  }
  if (LOOPBACK.test(text)) return { url: new URL(`http://${text}`).href };
  if (!/\s/.test(text) && HOST_LIKE.test(text)) {
    return { url: new URL(`https://${text}`).href };
  }
  if (SCHEME.test(text) && !/\s/.test(text)) {
    return { error: "Only web addresses (http or https) can be opened" };
  }
  return { url: SEARCH_URL + encodeURIComponent(text) };
}

/** The address bar shows pages without a trailing slash on the bare origin. */
export function displayAddress(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // Pages report whatever the engine loaded; show it unchanged.
  }
  return url;
}
