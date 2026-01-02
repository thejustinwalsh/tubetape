#!/usr/bin/env bun
/**
 * Determines the next release version based on conventional commits.
 * Outputs GitHub Actions variables: tag, version, next_version, needs_release, sha
 */

// @ts-expect-error - untyped module
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { $ } from "bun";
import { inc as semverInc, valid as semverValid, gt as semverGt } from "semver";

type AnalyzeCommits = (
  config: { preset?: string },
  context: {
    commits: Array<{ hash: string; message: string }>;
    logger: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  }
) => Promise<"major" | "minor" | "patch" | null>;

const analyze = analyzeCommits as AnalyzeCommits;

// Disable shell escaping for git commands
$.throws(false);

interface Commit {
  hash: string;
  message: string;
}

/**
 * Find the highest version tag, handling both app-v* and v* formats
 */
async function findLatestTag(): Promise<{ tag: string; version: string; sha: string }> {
  const result = await $`git tag -l 'v*' 'app-v*'`.text();
  const tags = result.trim().split("\n").filter(Boolean);

  let highestVersion = "0.0.0";
  let latestTag = "";

  for (const tag of tags) {
    // Strip app-v or v prefix
    const version = tag.replace(/^(app-v|v)/, "");
    if (semverValid(version) && semverGt(version, highestVersion)) {
      highestVersion = version;
      latestTag = tag;
    }
  }

  // Get commit SHA for the tag
  let sha = "";
  if (latestTag) {
    sha = (await $`git rev-list -n 1 ${latestTag}`.text()).trim();
  }

  return { tag: latestTag, version: highestVersion, sha };
}

/**
 * Get commits since a given SHA (or all commits if no SHA)
 */
async function getCommitsSince(sha: string): Promise<Commit[]> {
  const range = sha ? `${sha}..HEAD` : "HEAD";
  const result = await $`git log ${range} --format=%H%n%B%n---COMMIT_SEPARATOR---`.text();
  
  return result
    .split("---COMMIT_SEPARATOR---")
    .filter(Boolean)
    .map((block) => {
      const lines = block.trim().split("\n");
      const hash = lines[0];
      const message = lines.slice(1).join("\n").trim();
      return { hash, message };
    })
    .filter((c) => c.hash && c.message);
}

/**
 * Determine bump type using semantic-release commit-analyzer
 */
async function determineBumpType(commits: Commit[]): Promise<"major" | "minor" | "patch" | null> {
  if (commits.length === 0) return null;

  const releaseType = await analyze(
    { preset: "conventionalcommits" },
    {
      commits,
      logger: { log: () => {}, error: () => {} },
    }
  );

  return releaseType;
}

async function main(): Promise<void> {
  const { tag, version, sha } = await findLatestTag();

  console.error(`Found tag: ${tag || "(none)"}`);
  console.error(`Current version: ${version}`);

  const commits = await getCommitsSince(sha);
  console.error(`Commits since last tag: ${commits.length}`);

  const bumpType = await determineBumpType(commits);

  if (!bumpType) {
    console.error("No releasable commits found");
    console.log(JSON.stringify({ tag, version, sha, nextVersion: "", needsRelease: false }));
    return;
  }

  console.error(`Bump type: ${bumpType}`);

  const nextVersion = semverInc(version, bumpType);
  if (!nextVersion) {
    console.error(`Failed to calculate next version from ${version}`);
    process.exit(1);
  }

  console.error(`Next version: ${nextVersion}`);
  console.log(JSON.stringify({ tag, version, sha, nextVersion, needsRelease: true }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
