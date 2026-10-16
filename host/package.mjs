import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  copyFile,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

// Official Node release checksums, pinned so release builds are reproducible.
// https://nodejs.org/dist/v24.21.0/SHASUMS256.txt. The desktop's SSH setup
// reads the same file, so both install paths use the same runtime.
const { nodeVersion, sha256: runtimes } = JSON.parse(
  await readFile(new URL("./runtimes.json", import.meta.url), "utf8"),
);
const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
const ps = (script) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference = 'Stop'; ${script}`,
        "utf16le",
      ).toString("base64"),
    ],
    {
      // Avoid loading inherited PowerShell 7 modules in Windows PowerShell 5.1.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.toUpperCase() !== "PSMODULEPATH",
        ),
      ),
    },
  );
const args = process.argv.slice(2);
const target = args.includes("--target")
  ? args[args.indexOf("--target") + 1]
  : `${process.platform}-${process.arch}`;
const targets = args.includes("--all") ? Object.keys(runtimes) : [target];
const output = resolve("build/host-packages");
const cache = resolve("build/host-runtime-cache");
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
for (const target of targets) {
  if (!(target in runtimes))
    throw new Error(`Unsupported host target: ${target}`);
  const windows = target.startsWith("win32-");
  const extension = windows ? "zip" : "tar.gz";
  const stem = `node-v${nodeVersion}-${target.replace("win32-", "win-")}`;
  const archive = join(cache, `${stem}.${extension}`);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {
    /* first download */
  }
  if (
    !bytes ||
    createHash("sha256").update(bytes).digest("hex") !== runtimes[target]
  ) {
    const response = await fetch(
      `https://nodejs.org/dist/v${nodeVersion}/${stem}.${extension}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok)
      throw new Error(`Runtime download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== runtimes[target])
      throw new Error("Node runtime checksum mismatch");
    await writeFile(archive, bytes);
  }
  const folder = join(output, target);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  if (windows) {
    if (process.platform === "win32") {
      const unpacked = join(folder, "runtime");
      ps(
        `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(unpacked)}`,
      );
      await copyFile(
        join(unpacked, stem, "node.exe"),
        join(folder, "node.exe"),
      );
      await copyFile(join(unpacked, stem, "LICENSE"), join(folder, "LICENSE"));
      await rm(unpacked, { recursive: true, force: true });
    } else {
      execFileSync("unzip", [
        "-q",
        "-j",
        archive,
        `${stem}/node.exe`,
        `${stem}/LICENSE`,
        "-d",
        folder,
      ]);
    }
  } else
    execFileSync("tar", [
      "-xzf",
      archive,
      "-C",
      folder,
      "--strip-components=1",
      `${stem}/bin/node`,
      `${stem}/LICENSE`,
    ]);
  await copyFile("build/host/irgat-host.mjs", join(folder, "host.mjs"));
  await copyFile("host/provider-guard.mjs", join(folder, "provider-guard.mjs"));
  await copyFile("LICENSE", join(folder, "IRGAT-LICENSE"));
  await writeFile(
    join(folder, "version.json"),
    JSON.stringify({ version, nodeVersion, target }),
  );
  if (windows) {
    await writeFile(
      join(folder, "irgat-host.cmd"),
      '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0node.exe" "%~dp0host.mjs" %*\r\nexit /b %errorlevel%\r\n',
    );
  } else {
    await writeFile(
      join(folder, "irgat-host"),
      '#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/bin/node" "$DIR/host.mjs" "$@"\n',
    );
    await chmod(join(folder, "irgat-host"), 0o755);
  }
  if (target === `${process.platform}-${process.arch}`) {
    const executable = windows
      ? join(folder, "node.exe")
      : join(folder, "bin/node");
    const actual = execFileSync(
      executable,
      [join(folder, "host.mjs"), "--version"],
      {
        encoding: "utf8",
      },
    ).trim();
    if (actual !== version)
      throw new Error("Packaged host failed its executable smoke test");
  }
  const filename = `irgat-host-${target}.${extension}`;
  await rm(join(output, filename), { force: true });
  if (windows) {
    if (process.platform === "win32")
      ps(
        `Compress-Archive -Path ${psQuote(join(folder, "*"))} -DestinationPath ${psQuote(join(output, filename))}`,
      );
    else
      execFileSync("zip", ["-q", "-r", join(output, filename), "."], {
        cwd: folder,
      });
  } else
    execFileSync("tar", ["-czf", join(output, filename), "-C", folder, "."]);
  const hash = createHash("sha256")
    .update(await readFile(join(output, filename)))
    .digest("hex");
  await writeFile(join(output, `${filename}.sha256`), `${hash}  ${filename}\n`);
  console.log(`${filename} (${version}, Node ${nodeVersion})`);
}
