#!/usr/bin/env bun
import { fetchGitHubSource, updatePackageJsonSha, type SourceConfig } from "./fetch-github-source";
import { buildQuickJS, type BuildConfig } from "./build-quickjs";

const REPO = "bellard/quickjs";

const SOURCE_CONFIG: SourceConfig = {
  name: "quickjs",
  repo: REPO,
  targetDir: "src-tauri/vendor/quickjs",
};

const BUILD_CONFIG: BuildConfig = {
  sourceDir: "src-tauri/vendor/quickjs",
  targetDir: "src-tauri/binaries/qjs",
  executableName: process.platform === "win32" ? "qjs.exe" : "qjs",
};

async function getLatestVersionCommit(): Promise<{ sha: string; date: string }> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/commits?path=VERSION&per_page=1`
  );
  
  if (!response.ok) {
    throw new Error(`Failed to fetch VERSION history: ${response.statusText}`);
  }
  
  const commits = await response.json() as Array<{
    sha: string;
    commit: { committer: { date: string } };
  }>;
  
  if (commits.length === 0) {
    throw new Error("No commits found for VERSION file");
  }
  
  return {
    sha: commits[0].sha,
    date: commits[0].commit.committer.date,
  };
}

function printUsage() {
  console.log(`
Usage: setup-qjs.ts [options]

Options:
  --update    Update package.json to latest VERSION commit, then build.
  --help      Show this help message

Without options, builds QuickJS from the SHA already configured in package.json.
`);
}

async function handleUpdate() {
  console.log(`🔍 Finding latest VERSION commit for ${REPO}...`);
  
  const { sha, date } = await getLatestVersionCommit();
  const shortSha = sha.substring(0, 12);
  
  console.log(`\n📋 Latest VERSION update:`);
  console.log(`   SHA:  ${sha}`);
  console.log(`   Date: ${new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long", 
    day: "numeric",
  })}`);
  
  await updatePackageJsonSha("quickjs", sha);
  
  const historyUrl = `https://github.com/${REPO}/commits/${sha}`;
  console.log(`\n🔗 View commit history: ${historyUrl}`);
  console.log(`✅ package.json updated with SHA ${shortSha}\n`);
}

async function handleBuild() {
  await fetchGitHubSource(SOURCE_CONFIG);
  await buildQuickJS(BUILD_CONFIG);
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
