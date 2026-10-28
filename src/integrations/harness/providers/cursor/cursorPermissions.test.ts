import { describe, expect, it } from "vitest";
import { runtimeModeHint } from "../../../../features/sessions/model/session";
import { pickAutoOption } from "./cursor";

const OPTIONS = ["allow-once", "allow-always", "reject-once"];

describe("Cursor Auto access", () => {
  it("never approves a command on its own: Cursor has no AI reviewer", () => {
    expect(pickAutoOption("auto", "execute", OPTIONS)).toBeNull();
    expect(pickAutoOption("auto", "other", OPTIONS)).toBeNull();
    expect(pickAutoOption("auto", "fetch", OPTIONS)).toBeNull();
    expect(pickAutoOption("auto", undefined, OPTIONS)).toBeNull();
  });

  it("still lets reads and file edits run", () => {
    for (const kind of ["read", "search", "edit", "delete", "move"])
      expect(pickAutoOption("auto", kind, OPTIONS)).toBe("allow-once");
  });

  it("leaves the other access levels unchanged", () => {
    expect(pickAutoOption("supervised", "edit", OPTIONS)).toBeNull();
    expect(pickAutoOption("auto-accept-edits", "execute", OPTIONS)).toBeNull();
    expect(pickAutoOption("auto-accept-edits", "edit", OPTIONS)).toBe(
      "allow-once",
    );
    expect(pickAutoOption("full-access", "execute", OPTIONS)).toBe(
      "allow-always",
    );
  });

  it("describes Auto for what Cursor actually does", () => {
    expect(runtimeModeHint("auto", "cursor")).toMatch(/no AI reviewer/);
    expect(runtimeModeHint("auto", "claude")).toBe(
      "An AI reviewer can approve or deny actions.",
    );
    expect(runtimeModeHint("supervised", "cursor")).toBe(
      runtimeModeHint("supervised"),
    );
  });
});
