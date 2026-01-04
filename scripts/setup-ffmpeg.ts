#!/usr/bin/env bun
import { fetchGitHubSource, updatePackageJsonSha, type SourceConfig } from "./fetch-github-source";
import { buildFFmpeg, type BuildConfig } from "./build-ffmpeg";

const REPO = "FFmpeg/FFmpeg";

const SOURCE_CONFIG: SourceConfig = {
  name: "ffmpeg",
  repo: REPO,
  targetDir: "src-tauri/vendor/ffmpeg",
};

const BUILD_CONFIG: BuildConfig = {
  sourceDir: "src-tauri/vendor/ffmpeg",
  targetDir: "src-tauri/binaries/ffmpeg",
};

async function getLatestVersionCommit(): Promise<{ sha: string; date: string }> {
  // FFmpeg uses tags for releases, let's get the latest tag commit
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/tags?per_page=1`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch latest tag: ${response.statusText}`);
  }

  const tags = await response.json() as Array<{
    commit: { sha: string; url: string };
    name: string;
  }>;

  if (tags.length === 0) {
    throw new Error("No tags found");
  }

  const tag = tags[0];

  // Get commit details
  const commitResponse = await fetch(tag.commit.url);
  if (!commitResponse.ok) {
    throw new Error(`Failed to fetch commit details: ${commitResponse.statusText}`);
  }

  const commit = await commitResponse.json() as {
    sha: string;
    commit: { committer: { date: string } };
  };

  return {
    sha: commit.sha,
    date: commit.commit.committer.date,
  };
}

function printUsage() {
  console.log(`
Usage: setup-ffmpeg.ts [options]

Options:
  --update    Update package.json to latest release tag commit, then build.
  --help      Show this help message

Without options, builds FFmpeg from the SHA already configured in package.json.
`);
}

async function handleUpdate() {
  console.log(`🔍 Finding latest release tag for ${REPO}...`);

  const { sha, date } = await getLatestVersionCommit();
  const shortSha = sha.substring(0, 12);

  console.log(`\n📋 Latest release:`);
  console.log(`   SHA:  ${sha}`);
  console.log(`   Date: ${new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`);

  await updatePackageJsonSha("ffmpeg", sha);

  const historyUrl = `https://github.com/${REPO}/commits/${sha}`;
  console.log(`\n🔗 View commit history: ${historyUrl}`);
  console.log(`✅ package.json updated with SHA ${shortSha}\n`);
}

async function handleBuild() {
  await fetchGitHubSource(SOURCE_CONFIG);
  await buildFFmpeg(BUILD_CONFIG);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

try {
  if (args.includes("--update")) {
    await handleUpdate();
  }
  await handleBuild();
} catch (error) {
  console.error(`❌ Error: ${error}`);
  process.exit(1);
}