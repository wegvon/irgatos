#!/usr/bin/env node
// Keeps every place that carries the app version in step.
//
//   npm run version:bump -- 0.2.0        set an explicit version
//   npm run version:bump -- patch        0.1.0 -> 0.1.1 (also minor, major)
//   npm run version:bump -- 0.2.0 --dry-run
//   npm run version:check [-- 0.2.0]     fail if the files disagree
//
// Files are rewritten only after every edit has been computed, through a
// temp file and rename, so a failed pattern never leaves a half-bumped tree.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function parseArgs(argv) {
  const options = {
    root: join(dirname(fileURLToPath(import.meta.url)), ".."),
    dryRun: false,
    check: false,
    lockfiles: true,
    changelog: true,
    target: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--no-lockfiles") options.lockfiles = false;
    else if (arg === "--no-changelog") options.changelog = false;
    else if (arg === "--root") options.root = argv[++i];
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else if (options.target) throw new Error(`unexpected argument ${arg}`);
    else options.target = arg.replace(/^v/, "");
  }
  return options;
}

// `required` files define the version; lockfiles only mirror it.
function versionFiles(root, lockfiles) {
  const files = [
    {
      path: "package.json",
      required: true,
      pattern: /^(\{\n\s*(?:"[^"]+": [^\n]+\n\s*)*?"version": ")([^"]+)(")/,
    },
    {
      path: "src-tauri/tauri.conf.json",
      required: true,
      pattern: /^(\{\n\s*(?:"[^"]+": [^\n]+\n\s*)*?"version": ")([^"]+)(")/,
    },
    {
      path: "Cargo.toml",
      required: true,
      pattern: /(\[workspace\.package\][^[]*?\nversion = ")([^"]+)(")/,
    },
  ];
  if (lockfiles) {
    // npm's lockfile repeats the version at the top and on the root package.
    files.push(
      {
        path: "package-lock.json",
        pattern: /^(\{\n\s*"name": "[^"]+",\n\s*"version": ")([^"]+)(")/,
      },
      {
        path: "package-lock.json",
        pattern: /("packages": \{\n\s*"": \{\n\s*"name": "[^"]+",\n\s*"version": ")([^"]+)(")/,
      },
      { path: "Cargo.lock", pattern: /(\nname = "irgat"\nversion = ")([^"]+)(")/ },
    );
  }
  return files.filter((file) => file.required || existsSync(join(root, file.path)));
}

function readVersions(root, files) {
  return files.map((file) => {
    const text = readFileSync(join(root, file.path), "utf8");
    const match = text.match(file.pattern);
    if (!match) throw new Error(`no version found in ${file.path}`);
    return { ...file, version: match[2] };
  });
}

export function nextVersion(current, target) {
  if (SEMVER.test(target)) return target;
  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  if (target === "major") return `${major + 1}.0.0`;
  if (target === "minor") return `${major}.${minor + 1}.0`;
  if (target === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`expected x.y.z, major, minor or patch, got "${target}"`);
}

function compare(a, b) {
  const left = a.split("-")[0].split(".").map(Number);
  const right = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function addChangelogSection(text, version, date) {
  if (new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(text)) return text;
  const unreleased = /^## \[Unreleased\][^\n]*\n/m;
  if (!unreleased.test(text)) throw new Error("CHANGELOG.md has no ## [Unreleased] heading");
  // Whatever was collected under Unreleased becomes this version's notes.
  return text.replace(unreleased, (heading) => `${heading}\n## [${version}] - ${date}\n`);
}

function writeAtomically(path, text) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export function run(argv, log = console.log) {
  const options = parseArgs(argv);
  const { root } = options;
  const required = readVersions(root, versionFiles(root, false));
  const current = required[0].version;

  if (options.check) {
    const expected = options.target ?? current;
    const wrong = required.filter((file) => file.version !== expected);
    for (const file of wrong) log(`${file.path}: ${file.version} (expected ${expected})`);
    if (wrong.length) throw new Error("version files disagree");
    const changelog = join(root, "CHANGELOG.md");
    if (
      options.target &&
      existsSync(changelog) &&
      !new RegExp(`^## \\[${expected.replace(/\./g, "\\.")}\\]`, "m").test(
        readFileSync(changelog, "utf8"),
      )
    ) {
      throw new Error(`CHANGELOG.md has no ## [${expected}] section`);
    }
    log(`v${expected}`);
    return expected;
  }

  if (!options.target) {
    throw new Error("usage: npm run version:bump -- <x.y.z|major|minor|patch> [--dry-run]");
  }
  const version = nextVersion(current, options.target);
  if (compare(version, current) < 0) log(`warning: ${version} is older than ${current}`);

  const edits = new Map();
  for (const file of readVersions(root, versionFiles(root, options.lockfiles))) {
    const path = join(root, file.path);
    const text = edits.get(path) ?? readFileSync(path, "utf8");
    edits.set(path, text.replace(file.pattern, `$1${version}$3`));
  }
  const changelog = join(root, "CHANGELOG.md");
  if (options.changelog && existsSync(changelog)) {
    const date = new Date().toISOString().slice(0, 10);
    edits.set(changelog, addChangelogSection(readFileSync(changelog, "utf8"), version, date));
  }

  const changed = [...edits].filter(([path, text]) => readFileSync(path, "utf8") !== text);
  for (const [path] of changed) log(`${options.dryRun ? "would update" : "updated"} ${relative(root, path)}`);
  if (!options.dryRun) for (const [path, text] of changed) writeAtomically(path, text);

  log(`${current} -> ${version}`);
  if (!options.dryRun) {
    log(
      [
        "",
        "Next:",
        "  fill in CHANGELOG.md, then",
        `  git commit -am "release: v${version}" && git tag v${version}`,
        `  git push origin HEAD v${version}   # the Release workflow builds the update assets`,
      ].join("\n"),
    );
  }
  return version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
