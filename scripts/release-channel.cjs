const fs = require("node:fs");

function releaseChannel(tag) {
  const match = /^v\d+\.\d+\.\d+(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag || "");
  if (!match) throw new Error("Expected a release tag such as v0.9.1 or v0.9.1-beta.1");
  const prerelease = Boolean(match[1]);
  return { prerelease, feedKey: prerelease ? "beta/latest.json" : "latest.json" };
}

function releaseTag(env) {
  return (env.RELEASE_TAG || env.GITHUB_REF_NAME || "").trim();
}

// Where the Tauri updater looks for latest.json. Stable releases default to
// the feed the Release workflow attaches to the GitHub Release itself.
function updaterEndpoint(env) {
  const { prerelease, feedKey } = releaseChannel(releaseTag(env));
  const base = (env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const configured = (env.TAURI_UPDATER_ENDPOINT || "").trim();
  const repo = (env.GITHUB_REPOSITORY || "").trim();
  const github = repo ? `https://github.com/${repo}/releases/latest/download/latest.json` : "";
  // Beta builds must never retain a configured production endpoint, and
  // GitHub's "latest" release skips prereleases, so betas need R2.
  const endpoint = prerelease
    ? base
      ? `${base}/${feedKey}`
      : ""
    : configured || (base ? `${base}/${feedKey}` : github);
  if (!endpoint) {
    throw new Error(
      prerelease
        ? "R2_PUBLIC_BASE_URL is required for beta updates"
        : "Set TAURI_UPDATER_ENDPOINT, R2_PUBLIC_BASE_URL or GITHUB_REPOSITORY",
    );
  }
  if (new URL(endpoint).protocol !== "https:") throw new Error("Release updater endpoints must use HTTPS");
  return endpoint;
}

module.exports = { releaseChannel, releaseTag, updaterEndpoint };

if (require.main === module) {
  const { prerelease, feedKey } = releaseChannel(releaseTag(process.env));
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required");
  fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_PRERELEASE=${prerelease}\nUPDATER_FEED_KEY=${feedKey}\n`);
  console.log(`Release channel: ${prerelease ? "beta" : "stable"} (${feedKey})`);
}
