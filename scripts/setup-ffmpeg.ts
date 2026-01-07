#!/usr/bin/env bun
import { exists, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { fetchGitHubSource, updatePackageJsonSha, type SourceConfig } from "./fetch-github-source";
import { fetchSourceForgeSource, getLatestRelease, type SourceForgeConfig } from "./fetch-sourceforge-source";
import { buildFFmpeg, type BuildConfig } from "./build-ffmpeg";

const ROOT_DIR = join(import.meta.dir, "..");
const FFMPEG_REPO = "FFmpeg/FFmpeg";
const BINARIES_DIR = join(ROOT_DIR, "src-tauri/binaries/ffmpeg");

const FFMPEG_SOURCE_CONFIG: SourceConfig = {
  name: "ffmpeg",
  repo: FFMPEG_REPO,
  targetDir: "src-tauri/vendor/ffmpeg",
};

const LAME_SOURCE_CONFIG: SourceForgeConfig = {
  name: "lame",
  project: "lame",
  targetDir: "src-tauri/vendor",
};

const REQUIRED_LIBS = [
  "libavformat.dylib",
  "libavcodec.dylib", 
  "libavutil.dylib",
  "libswresample.dylib",
];

async function verifyExistingLibraries(): Promise<boolean> {
  console.log(`🔍 Checking existing FFmpeg libraries...`);
  
  for (const lib of REQUIRED_LIBS) {
    const libPath = join(BINARIES_DIR, lib);
    if (!(await exists(libPath))) {
      console.log(`   ✗ Missing: ${lib}`);
      return false;
    }
  }
  
  const avcodecPath = join(BINARIES_DIR, "libavcodec.dylib");
  const strings = await $`strings ${avcodecPath} | grep -c "libmp3lame"`.quiet().nothrow();
  if (strings.exitCode !== 0 || parseInt(strings.stdout.toString().trim()) === 0) {
    console.log(`   ✗ LAME encoder not found in libavcodec`);
    return false;
  }
  
  const otool = await $`otool -L ${avcodecPath} | grep "@loader_path"`.quiet().nothrow();
  if (otool.exitCode !== 0) {
    console.log(`   ✗ Library paths not using @loader_path`);
    return false;
  }
  
  console.log(`   ✅ All libraries present and valid`);
  return true;
}

async function getLatestFFmpegTag(): Promise<{ sha: string; date: string }> {
  const response = await fetch(`https://api.github.com/repos/${FFMPEG_REPO}/tags?per_page=1`);

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
  --update         Update FFmpeg to latest release tag
  --update-lame    Update LAME to latest release
  --update-all     Update both FFmpeg and LAME
  --clean          Remove built artifacts and rebuild
  --help           Show this help message

Dependencies:
  - FFmpeg source (from GitHub, SHA tracked in package.json)
  - LAME (from SourceForge, version/MD5 tracked in package.json)

Without options, skips build if valid artifacts exist.
`);
}

async function handleClean() {
  console.log(`🧹 Cleaning FFmpeg artifacts...`);
  await rm(BINARIES_DIR, { recursive: true, force: true });
  await rm(join(ROOT_DIR, "src-tauri/vendor/lame-build"), { recursive: true, force: true });
  await rm(join(ROOT_DIR, "src-tauri/vendor/ffmpeg/build-macos"), { recursive: true, force: true });
  await rm(join(ROOT_DIR, "src-tauri/vendor/ffmpeg/build-linux"), { recursive: true, force: true });
  await rm(join(ROOT_DIR, "src-tauri/vendor/ffmpeg/build-windows"), { recursive: true, force: true });
  console.log(`   ✅ Artifacts cleaned\n`);
}

async function handleUpdateFFmpeg() {
  console.log(`🔍 Finding latest release tag for ${FFMPEG_REPO}...`);

  const { sha, date } = await getLatestFFmpegTag();
  const shortSha = sha.substring(0, 12);

  console.log(`\n📋 Latest FFmpeg release:`);
  console.log(`   SHA:  ${sha}`);
  console.log(`   Date: ${new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`);

  await updatePackageJsonSha("ffmpeg", sha);

  const historyUrl = `https://github.com/${FFMPEG_REPO}/commits/${sha}`;
  console.log(`\n🔗 View commit history: ${historyUrl}`);
  console.log(`✅ package.json updated with SHA ${shortSha}\n`);
}

async function handleUpdateLame() {
  console.log(`🔍 Finding latest LAME release...`);

  const latest = await getLatestRelease("lame");

  console.log(`\n📋 Latest LAME release:`);
  console.log(`   Version: ${latest.version}`);
  console.log(`   MD5:     ${latest.md5sum}`);
  console.log(`   Date:    ${latest.date}`);

  const { updatePackageJsonSourceForge } = await import("./fetch-sourceforge-source");
  await updatePackageJsonSourceForge("lame", latest.version, latest.md5sum);

  console.log(`✅ package.json updated with LAME ${latest.version}\n`);
}

async function handleBuild(forceRebuild: boolean) {
  if (!forceRebuild && await exists(BINARIES_DIR)) {
    const isValid = await verifyExistingLibraries();
    if (isValid) {
      const size = await $`du -sh ${BINARIES_DIR}`.quiet();
      console.log(`   Size: ${size.stdout.toString().split('\t')[0].trim()}`);
      console.log(`\n✅ FFmpeg libraries already built. Use --clean to rebuild.\n`);
      return;
    }
    console.log(`\n⚠️  Libraries invalid or incomplete. Rebuilding...\n`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  TUBETAPE FFMPEG BUILD`);
  console.log(`${"=".repeat(60)}\n`);

  const lameResult = await fetchSourceForgeSource(LAME_SOURCE_CONFIG);

  console.log("");
  await fetchGitHubSource(FFMPEG_SOURCE_CONFIG);

  console.log("");
  const buildConfig: BuildConfig = {
    sourceDir: "src-tauri/vendor/ffmpeg",
    targetDir: "src-tauri/binaries/ffmpeg",
    lameDir: "src-tauri/vendor/lame-build",
    lameSourceDir: lameResult.sourcePath,
  };

  await buildFFmpeg(buildConfig);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

try {
  const shouldClean = args.includes("--clean");
  const shouldUpdate = args.includes("--update") || args.includes("--update-all") || args.includes("--update-lame");

  if (shouldClean) {
    await handleClean();
  }

  if (args.includes("--update-all")) {
    await handleUpdateFFmpeg();
    await handleUpdateLame();
  } else {
    if (args.includes("--update")) {
      await handleUpdateFFmpeg();
    }
    if (args.includes("--update-lame")) {
      await handleUpdateLame();
    }
  }

  await handleBuild(shouldClean || shouldUpdate);
} catch (error) {
  console.error(`❌ Error: ${error}`);
  process.exit(1);
}
