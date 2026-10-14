import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const LEGACY_HOST_DIR = ".monocode-host";
const MARKER = ".imported-from-monocode-host";
// Runtime state of a process that is not this one, and the launcher the
// bootstrap installs afresh.
const SKIPPED = new Set([
  "running.json",
  "owner.db",
  "owner.db-wal",
  "owner.db-shm",
  "owner.lock",
  "host.log",
  "bin",
  MARKER,
]);

function copyMissing(from: string, to: string, skip: Set<string>): number {
  let copied = 0;
  mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(from)) {
    if (skip.has(name)) continue;
    const source = join(from, name);
    const target = join(to, name);
    const info = statSync(source);
    if (info.isDirectory()) copied += copyMissing(source, target, new Set());
    else if (!existsSync(target)) {
      copyFileSync(source, target);
      copied += 1;
    }
  }
  return copied;
}

/**
 * Brings sessions and device credentials kept by a host installed under the
 * old name into the current data directory. Files already there win, the old
 * directory is left untouched, and this happens once. Returns files copied.
 */
export function importLegacyHostData(directory: string, legacy: string): number {
  try {
    if (!existsSync(legacy) || existsSync(join(directory, MARKER))) return 0;
    const hasDatabase = existsSync(join(directory, "host.db"));
    // A database is only ever taken whole, never merged into another.
    const skip = new Set(SKIPPED);
    if (hasDatabase)
      for (const name of ["host.db", "host.db-wal", "host.db-shm"])
        skip.add(name);
    const copied = copyMissing(legacy, directory, skip);
    writeFileSync(join(directory, MARKER), "1\n", { mode: 0o600 });
    return copied;
  } catch {
    return 0;
  }
}
