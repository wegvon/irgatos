import { describe, expect, it } from "vitest";
import { displayAddress, resolveAddress } from "./browserAddress";

describe("resolveAddress", () => {
  it("keeps full web addresses", () => {
    expect(resolveAddress(" https://example.com/a?b=1 ")).toEqual({
      url: "https://example.com/a?b=1",
    });
    expect(resolveAddress("HTTP://Example.com")).toEqual({
      url: "http://example.com/",
    });
  });

  it("opens bare hosts over HTTPS and loopback servers over HTTP", () => {
    expect(resolveAddress("github.com/hardbeat920")).toEqual({
      url: "https://github.com/hardbeat920",
    });
    expect(resolveAddress("docs.example.co.uk:8443")).toEqual({
      url: "https://docs.example.co.uk:8443/",
    });
    expect(resolveAddress("localhost:3000/app")).toEqual({
      url: "http://localhost:3000/app",
    });
    expect(resolveAddress("127.0.0.1:5173")).toEqual({
      url: "http://127.0.0.1:5173/",
    });
  });

  it("searches for anything that isn't an address", () => {
    expect(resolveAddress("tauri child webview")).toEqual({
      url: "https://www.google.com/search?q=tauri%20child%20webview",
    });
    expect(resolveAddress("readme")).toEqual({
      url: "https://www.google.com/search?q=readme",
    });
  });

  it("refuses other schemes and ignores blank input", () => {
    for (const value of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "tauri://localhost",
    ]) {
      expect(resolveAddress(value)).toHaveProperty("error");
    }
    expect(resolveAddress("https://")).toHaveProperty("error");
    expect(resolveAddress("   ")).toBeNull();
  });
});

describe("displayAddress", () => {
  it("drops the trailing slash on a bare origin only", () => {
    expect(displayAddress("https://example.com/")).toBe("https://example.com");
    expect(displayAddress("https://example.com/a/")).toBe(
      "https://example.com/a/",
    );
    expect(displayAddress("about:blank")).toBe("about:blank");
  });
});
