import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addChangelogSection, nextVersion, run } from "./bump-version.mjs";

function fixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "bump-version-"));
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(
    join(root, "package.json"),
    `{\n  "name": "irgat-desktop",\n  "private": true,\n  "version": "${version}",\n  "dependencies": {\n    "x": {\n      "version": "9.9.9"\n    }\n  }\n}\n`,
  );
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    `{\n  "$schema": "https://schema.tauri.app/config/2",\n  "productName": "Irgatos",\n  "version": "${version}",\n  "identifier": "com.irgatos.desktop"\n}\n`,
  );
  writeFileSync(
    join(root, "Cargo.toml"),
    `[workspace]\nmembers = ["src-tauri"]\n\n[workspace.package]\nversion = "${version}"\nedition = "2021"\n\n[workspace.dependencies]\nfoo = { version = "1" }\n`,
  );
  writeFileSync(
    join(root, "package-lock.json"),
    `{\n  "name": "irgat-desktop",\n  "version": "${version}",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "irgat-desktop",\n      "version": "${version}"\n    }\n  }\n}\n`,
  );
  writeFileSync(
    join(root, "Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "irgat"\nversion = "${version}"\n\n[[package]]\nname = "other"\nversion = "${version}"\n`,
  );
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A thing.\n");
  return root;
}

const read = (root, path) => readFileSync(join(root, path), "utf8");
const quiet = () => {};

test("nextVersion understands keywords and explicit versions", () => {
  assert.equal(nextVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(nextVersion("0.1.3", "minor"), "0.2.0");
  assert.equal(nextVersion("0.9.3", "major"), "1.0.0");
  assert.equal(nextVersion("0.1.0", "2.3.4"), "2.3.4");
  assert.throws(() => nextVersion("0.1.0", "next"));
});

test("bump rewrites every version file and nothing else", () => {
  const root = fixture();
  assert.equal(run(["--root", root, "0.2.0"], quiet), "0.2.0");
  assert.match(read(root, "package.json"), /"version": "0.2.0"/);
  assert.match(read(root, "package.json"), /"version": "9.9.9"/);
  assert.match(read(root, "src-tauri/tauri.conf.json"), /"version": "0.2.0"/);
  assert.match(read(root, "Cargo.toml"), /\[workspace\.package\]\nversion = "0.2.0"/);
  assert.match(read(root, "Cargo.toml"), /foo = \{ version = "1" \}/);
  assert.equal(read(root, "package-lock.json").match(/"version": "0.2.0"/g).length, 2);
  assert.match(read(root, "Cargo.lock"), /name = "irgat"\nversion = "0.2.0"/);
  assert.match(read(root, "Cargo.lock"), /name = "other"\nversion = "0.1.0"/);
  assert.match(read(root, "CHANGELOG.md"), /## \[Unreleased\]\n\n## \[0.2.0\] - \d{4}-\d{2}-\d{2}\n\n### Added/);
  assert.equal(run(["--root", root, "--check", "0.2.0"], quiet), "0.2.0");
});

test("dry run and --no-lockfiles leave files alone", () => {
  const root = fixture();
  run(["--root", root, "patch", "--dry-run"], quiet);
  assert.match(read(root, "package.json"), /"version": "0.1.0"/);
  run(["--root", root, "patch", "--no-lockfiles", "--no-changelog"], quiet);
  assert.match(read(root, "package.json"), /"version": "0.1.1"/);
  assert.match(read(root, "package-lock.json"), /"version": "0.1.0"/);
  assert.doesNotMatch(read(root, "CHANGELOG.md"), /0\.1\.1/);
});

test("check reports disagreeing files and missing changelog sections", () => {
  const root = fixture();
  writeFileSync(join(root, "Cargo.toml"), read(root, "Cargo.toml").replace('"0.1.0"', '"0.1.5"'));
  const lines = [];
  assert.throws(() => run(["--root", root, "--check"], (line) => lines.push(line)), /disagree/);
  assert.deepEqual(lines, ["Cargo.toml: 0.1.5 (expected 0.1.0)"]);
  const clean = fixture();
  assert.throws(() => run(["--root", clean, "--check", "0.1.0"], quiet), /no ## \[0.1.0\] section/);
});

test("addChangelogSection keeps an existing section", () => {
  const text = "## [Unreleased]\n\n## [0.1.0] - 2026-10-14\n";
  assert.equal(addChangelogSection(text, "0.1.0", "2026-10-15"), text);
});
