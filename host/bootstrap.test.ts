import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { version } from "../package.json";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const base64Lines = (bytes: Buffer) =>
  bytes.toString("base64").replace(/.{76}(?=.)/g, "$&\n");
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
// Mirrors bootstrap_script_from_template in src-tauri/src/remote_ssh.rs.
function fixture({ badNode = false, badHost = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "irgat-bootstrap-"));
  directories.push(dir);
  const base = join(dir, "host with spaces ' and $data");
  const nodeVersion = "24.0.0-test";
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const stem = `node-v${nodeVersion}-${os}-${arch}`;
  const source = join(dir, "source");
  const bin = join(dir, "tools");
  mkdirSync(join(source, stem, "bin"), { recursive: true });
  mkdirSync(bin);
  // A stand-in Node runtime that answers the host commands setup runs.
  writeFileSync(
    join(source, stem, "bin/node"),
    `#!/bin/sh\ncase "$2" in\n--version) printf '%s\\n' ${quote(version)} ;;\nservice) printf 'service %s\\n' "$3" >> "$IRGAT_TEST_EVENTS" ;;\nconnection-info) printf '{"port":3774,"pid":123}\\n' ;;\n*) exit 1 ;;\nesac\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(source, stem, "LICENSE"), "license\n");
  const archive = join(dir, "node.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", source, stem]);
  const nodeHash = badNode ? "0".repeat(64) : sha256(readFileSync(archive));
  const host = Buffer.from("// host bundle\n".repeat(200));
  // A local download fixture: run the real installer shell, without network or
  // a user service. Never change the test runner's HOME or installed services.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh\nfor arg do previous="$last"; last="$arg"; done\ncase "$previous" in -o) ;; *) exit 1 ;; esac\ncp "$IRGAT_TEST_ARCHIVE" "$last"\nprintf '%s\\n' "$*" >> "$IRGAT_TEST_DOWNLOADS"\n`,
    { mode: 0o755 },
  );
  const cases = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
    .map((target) => `    ${target}) NODE_SHA256=${nodeHash} ;;`)
    .join("\n");
  const script = readFileSync("src-tauri/src/remote_bootstrap.sh", "utf8")
    .replace('BASE="$HOME/.irgat-host"', `BASE=${quote(base)}`)
    .replace("@@VERSION@@", quote(version))
    .replace("@@NODE_VERSION@@", quote(nodeVersion))
    .replace("@@HOST_SHA256@@", quote(badHost ? "0".repeat(64) : sha256(host)))
    .replace("@@NODE_SHA256@@", cases)
    .replace("@@PROVIDER_GUARD@@", base64Lines(Buffer.from("// guard\n")))
    .replace("@@HOST_BUNDLE@@", base64Lines(host));
  const run = (forceUpgrade = false) =>
    new Promise<{ code: number | null; out: string; error: string }>(
      (resolve, reject) => {
        const child = spawn("sh", ["-s"], {
          env: {
            ...process.env,
            PATH: `${bin}:/usr/bin:/bin`,
            IRGAT_TEST_ARCHIVE: archive,
            IRGAT_TEST_EVENTS: join(dir, "events"),
            IRGAT_TEST_DOWNLOADS: join(dir, "downloads"),
            IRGAT_HOST_FORCE_UPGRADE: forceUpgrade ? "1" : "0",
          },
          signal: AbortSignal.timeout(10_000),
        });
        let out = "";
        let error = "";
        child.stdout.on("data", (data) => {
          out += data;
        });
        child.stderr.on("data", (data) => {
          error += data;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, out, error }));
        child.stdin.end(script);
      },
    );
  return { dir, base, host, run };
}
it.skipIf(process.platform === "win32")(
  "installs the host sent with the script, handles unusual home paths, and reuses its host on reconnect",
  async () => {
    const { dir, base, host, run } = fixture();
    const first = await run();
    expect(first.error).toBe("");
    expect(first.code).toBe(0);
    expect(JSON.parse(first.out).port).toBe(3774);
    expect(existsSync(join(base, "bin/irgat-host"))).toBe(true);
    const runtime = readFileSync(join(base, "runtime-path"), "utf8").trim();
    expect(readFileSync(join(runtime, "host.mjs"))).toEqual(host);
    expect(readFileSync(join(runtime, "provider-guard.mjs"), "utf8")).toBe(
      "// guard\n",
    );
    expect((await run()).code).toBe(0);
    const downloads = readFileSync(join(dir, "downloads"), "utf8").trim();
    expect(downloads.split("\n")).toHaveLength(1);
    expect(downloads).toContain("https://nodejs.org/dist/v24.0.0-test/");
    expect(downloads).not.toContain("github.com");
  },
);
it.skipIf(process.platform === "win32")(
  "updates an existing host only when requested, reusing the cached Node runtime",
  async () => {
    const { dir, base, run } = fixture();
    expect((await run()).code).toBe(0);
    const oldRuntime = readFileSync(join(base, "runtime-path"), "utf8");
    expect((await run(true)).code).toBe(0);
    expect(readFileSync(join(base, "runtime-path"), "utf8")).not.toBe(
      oldRuntime,
    );
    expect(
      readFileSync(join(dir, "events"), "utf8").trim().split("\n"),
    ).toEqual(["service install", "service uninstall", "service install"]);
    expect(
      readFileSync(join(dir, "downloads"), "utf8").trim().split("\n"),
    ).toHaveLength(1);
  },
);
it.skipIf(process.platform === "win32")(
  "rejects a corrupted Node runtime before executing or publishing it",
  async () => {
    const { dir, base, run } = fixture({ badNode: true });
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("checksum mismatch");
    expect(existsSync(join(base, "bin/irgat-host"))).toBe(false);
    expect(existsSync(join(dir, "events"))).toBe(false);
  },
);
it.skipIf(process.platform === "win32")(
  "rejects an incomplete host transfer",
  async () => {
    const { dir, base, run } = fixture({ badHost: true });
    const result = await run();
    expect(result.code).not.toBe(0);
    expect(result.error).toContain("transfer was incomplete");
    expect(existsSync(join(base, "bin/irgat-host"))).toBe(false);
    expect(existsSync(join(dir, "events"))).toBe(false);
  },
);
