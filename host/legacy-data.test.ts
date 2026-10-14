import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { importLegacyHostData } from "./legacy-data";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "irgat-host-legacy-"));
  const legacy = join(root, ".monocode-host");
  const current = join(root, ".irgat-host");
  mkdirSync(join(legacy, "attachments"), { recursive: true });
  mkdirSync(join(legacy, "bin"));
  writeFileSync(join(legacy, "host.db"), "legacy-db");
  writeFileSync(join(legacy, "attachments", "a.png"), "png");
  writeFileSync(join(legacy, "running.json"), "{}");
  writeFileSync(join(legacy, "bin", "monocode-host"), "launcher");
  mkdirSync(current);
  return { legacy, current };
}

it("copies the old host data when the new directory has none and keeps the old", () => {
  const { legacy, current } = fixture();
  expect(importLegacyHostData(current, legacy)).toBe(2);
  expect(readFileSync(join(current, "host.db"), "utf8")).toBe("legacy-db");
  expect(existsSync(join(current, "attachments", "a.png"))).toBe(true);
  expect(existsSync(join(current, "running.json"))).toBe(false);
  expect(existsSync(join(current, "bin"))).toBe(false);
  expect(readFileSync(join(legacy, "host.db"), "utf8")).toBe("legacy-db");
});

it("keeps the new database when both exist and imports only once", () => {
  const { legacy, current } = fixture();
  writeFileSync(join(current, "host.db"), "new-db");
  importLegacyHostData(current, legacy);
  expect(readFileSync(join(current, "host.db"), "utf8")).toBe("new-db");
  expect(existsSync(join(current, "attachments", "a.png"))).toBe(true);
  writeFileSync(join(legacy, "later.txt"), "x");
  expect(importLegacyHostData(current, legacy)).toBe(0);
  expect(existsSync(join(current, "later.txt"))).toBe(false);
});

it("does nothing without an old directory", () => {
  const { current } = fixture();
  expect(importLegacyHostData(current, join(current, "missing"))).toBe(0);
});
