#!/usr/bin/env bun
import { mkdir, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { $ } from "bun";

export interface SourceConfig {
  name: string;
  repo: string;
  targetDir: string;
}

export interface FetchResult {
  sha: string;
  sourcePath: string;
  downloaded: boolean;
}

const ROOT_DIR = join(import.meta.dir, "..");

export async function readPackageJson(): Promise<{
  binaryDeps?: Record<string, { type: string; repo: string; sha?: string; tag?: string }>;
  [key: string]: unknown;
}> {
  const packageJsonPath = join(ROOT_DIR, "package.json");
  const content = await Bun.file(packageJsonPath).text();
  return JSON.parse(content);
}

export async function updatePackageJsonSha(depName: string, sha: string): Promise<void> {
  const packageJsonPath = join(ROOT_DIR, "package.json");
  const packageJson = await readPackageJson();
  
  if (!packageJson.binaryDeps) {
    packageJson.binaryDeps = {};
  }
  
  if (!packageJson.binaryDeps[depName]) {
    throw new Error(`Dependency "${depName}" not found in package.json binaryDeps`);
  }
  
  packageJson.binaryDeps[depName].sha = sha;
  
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
  console.log(`   Updated package.json with SHA: ${sha.substring(0, 12)}...`);
}

export async function computeChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export async function getConfiguredSha(depName: string): Promise<string | undefined> {
  const packageJson = await readPackageJson();
  return packageJson.binaryDeps?.[depName]?.sha;
}

export async function getLatestCommitSha(repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`);
  if (!response.ok) {
    throw new Error(`Failed to fetch latest commit: ${response.statusText}`);
  }
  const data = await response.json() as { sha: string };
  return data.sha;
}

export async function fetchGitHubSource(
  config: SourceConfig,
  sha?: string,
  forceDownload = false
): Promise<FetchResult> {
  const targetDir = join(ROOT_DIR, config.targetDir);
  
  console.log(`📦 Fetching ${config.name} source`);
  
  let targetSha: string;
  if (sha) {
    targetSha = sha;
    console.log(`   Using provided SHA: ${targetSha.substring(0, 12)}...`);
  } else {
    const configuredSha = await getConfiguredSha(config.name.toLowerCase());
    if (configuredSha) {
      targetSha = configuredSha;
      console.log(`   Using SHA from package.json: ${targetSha.substring(0, 12)}...`);
    } else {
      console.log(`   No SHA configured, fetching latest...`);
      targetSha = await getLatestCommitSha(config.repo);
      console.log(`   Latest commit: ${targetSha.substring(0, 12)}...`);
    }
  }
  
  const shaMarkerPath = join(targetDir, ".git-sha");
  const sourcePath = targetDir;
  
  if (!forceDownload) {
    const existingSha = await Bun.file(shaMarkerPath).text().catch(() => "");
    if (existingSha.trim() === targetSha) {
      console.log(`✅ ${config.name} source already exists at correct SHA`);
      console.log(`   Path: ${sourcePath}`);
      return { sha: targetSha, sourcePath, downloaded: false };
    }
    if (existingSha) {
      console.log(`   Existing SHA differs, re-downloading...`);
    }
  }
  
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
  
  await mkdir(targetDir, { recursive: true });
  
  const tarballUrl = `https://github.com/${config.repo}/archive/${targetSha}.tar.gz`;
  const tarballPath = join(targetDir, `${basename(config.repo)}-${targetSha.substring(0, 12)}.tar.gz`);
  
  console.log(`📥 Downloading source tarball...`);
  console.log(`   URL: ${tarballUrl}`);
  
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`Failed to download tarball: ${response.statusText}`);
  }
  
  await Bun.write(tarballPath, await response.blob());
  
  const tarballChecksum = await computeChecksum(tarballPath);
  console.log(`   Downloaded: ${(await Bun.file(tarballPath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   SHA256: ${tarballChecksum}`);
  
  console.log(`📂 Extracting...`);
  
  await $`tar -xzf ${tarballPath} -C ${targetDir}`.quiet();
  
  const repoName = config.repo.split("/")[1];
  const extractedDir = join(targetDir, `${repoName}-${targetSha}`);
  
  await $`sh -c 'mv ${extractedDir}/* ${extractedDir}/.[!.]* ${targetDir}/ 2>/dev/null || mv ${extractedDir}/* ${targetDir}/'`.quiet().nothrow();
  await rm(extractedDir, { recursive: true, force: true });
  await rm(tarballPath);
  
  await Bun.write(shaMarkerPath, targetSha);
  
  const configuredSha = await getConfiguredSha(config.name.toLowerCase());
  if (configuredSha !== targetSha) {
    await updatePackageJsonSha(config.name.toLowerCase(), targetSha);
  }
  
  console.log(`✅ ${config.name} source ready at:`);
  console.log(`   ${sourcePath}`);
  
  return { sha: targetSha, sourcePath, downloaded: true };
}

export { ROOT_DIR };

if (import.meta.main) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: fetch-github-source.ts <name> <repo> [sha]");
    console.error("Example: fetch-github-source.ts quickjs bellard/quickjs abc123...");
    process.exit(1);
  }
  
  const [name, repo, sha] = args;
  
  const config: SourceConfig = {
    name,
    repo,
    targetDir: `src-tauri/source/${name.toLowerCase()}`,
  };
  
  try {
    await fetchGitHubSource(config, sha);
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
}
