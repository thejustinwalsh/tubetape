#!/usr/bin/env bun
import { mkdir, rm, exists } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { $ } from "bun";

export interface SourceForgeConfig {
  name: string;
  project: string;
  targetDir: string;
}

export interface SourceForgeRelease {
  version: string;
  filename: string;
  md5sum: string;
  url: string;
  date: string;
}

export interface FetchResult {
  version: string;
  md5sum: string;
  sourcePath: string;
  downloaded: boolean;
}

const ROOT_DIR = join(import.meta.dir, "..");

export async function readPackageJson(): Promise<{
  binaryDeps?: Record<string, { 
    type: string; 
    project?: string;
    repo?: string; 
    version?: string;
    md5?: string;
    sha?: string;
  }>;
  [key: string]: unknown;
}> {
  const packageJsonPath = join(ROOT_DIR, "package.json");
  const content = await Bun.file(packageJsonPath).text();
  return JSON.parse(content);
}

export async function updatePackageJsonSourceForge(
  depName: string, 
  version: string, 
  md5: string
): Promise<void> {
  const packageJsonPath = join(ROOT_DIR, "package.json");
  const packageJson = await readPackageJson();
  
  if (!packageJson.binaryDeps) {
    packageJson.binaryDeps = {};
  }
  
  if (!packageJson.binaryDeps[depName]) {
    throw new Error(`Dependency "${depName}" not found in package.json binaryDeps`);
  }
  
  packageJson.binaryDeps[depName].version = version;
  packageJson.binaryDeps[depName].md5 = md5;
  
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
  console.log(`   Updated package.json: version=${version}, md5=${md5.substring(0, 8)}...`);
}

export async function getLatestRelease(project: string): Promise<SourceForgeRelease> {
  const apiUrl = `https://sourceforge.net/projects/${project}/best_release.json`;
  
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch release info: ${response.statusText}`);
  }
  
  const data = await response.json() as {
    release: {
      filename: string;
      md5sum: string;
      url: string;
      date: string;
    };
  };
  
  const release = data.release;
  const versionMatch = release.filename.match(/(\d+\.\d+(?:\.\d+)?)/);
  const version = versionMatch ? versionMatch[1] : "unknown";
  
  return {
    version,
    filename: release.filename,
    md5sum: release.md5sum,
    url: release.url,
    date: release.date,
  };
}

export async function getConfiguredVersion(depName: string): Promise<{ version?: string; md5?: string }> {
  const packageJson = await readPackageJson();
  const dep = packageJson.binaryDeps?.[depName];
  return {
    version: dep?.version,
    md5: dep?.md5,
  };
}

async function computeMd5(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  return createHash("md5").update(Buffer.from(buffer)).digest("hex");
}

export async function fetchSourceForgeSource(
  config: SourceForgeConfig,
  version?: string,
  forceDownload = false
): Promise<FetchResult> {
  const targetDir = join(ROOT_DIR, config.targetDir);
  
  console.log(`📦 Fetching ${config.name} source from SourceForge`);
  
  let targetVersion: string;
  let expectedMd5: string;
  let downloadUrl: string;
  
  if (version) {
    const latest = await getLatestRelease(config.project);
    if (latest.version !== version) {
      console.warn(`   ⚠️  Requested version ${version} but latest is ${latest.version}`);
    }
    targetVersion = version;
    expectedMd5 = latest.md5sum;
    downloadUrl = latest.url;
  } else {
    const configured = await getConfiguredVersion(config.name.toLowerCase());
    if (configured.version && configured.md5) {
      targetVersion = configured.version;
      expectedMd5 = configured.md5;
      console.log(`   Using version from package.json: ${targetVersion}`);
      
      const baseUrl = `https://downloads.sourceforge.net/project/${config.project}`;
      downloadUrl = `${baseUrl}/${config.name}/${targetVersion}/${config.name}-${targetVersion}.tar.gz`;
    } else {
      console.log(`   No version configured, fetching latest...`);
      const latest = await getLatestRelease(config.project);
      targetVersion = latest.version;
      expectedMd5 = latest.md5sum;
      downloadUrl = latest.url;
      console.log(`   Latest version: ${targetVersion}`);
    }
  }
  
  const sourceDir = join(targetDir, `${config.name}-${targetVersion}`);
  const versionMarker = join(sourceDir, ".sourceforge-version");
  
  if (!forceDownload && await exists(versionMarker)) {
    const existingVersion = await Bun.file(versionMarker).text().catch(() => "");
    if (existingVersion.trim() === targetVersion) {
      console.log(`✅ ${config.name} ${targetVersion} source already exists`);
      return { version: targetVersion, md5sum: expectedMd5, sourcePath: sourceDir, downloaded: false };
    }
  }
  
  await rm(sourceDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(targetDir, { recursive: true });
  
  const tarballPath = join(targetDir, `${config.name}-${targetVersion}.tar.gz`);
  
  console.log(`📥 Downloading ${config.name} ${targetVersion}...`);
  
  const result = await $`curl -L -o ${tarballPath} ${downloadUrl}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Failed to download: curl exited with ${result.exitCode}`);
  }
  
  const size = (await Bun.file(tarballPath).size / 1024 / 1024).toFixed(2);
  console.log(`   Downloaded: ${size} MB`);
  
  const actualMd5 = await computeMd5(tarballPath);
  console.log(`   MD5: ${actualMd5}`);
  
  if (actualMd5 !== expectedMd5) {
    await rm(tarballPath).catch(() => {});
    throw new Error(`Checksum mismatch!\n   Expected: ${expectedMd5}\n   Got: ${actualMd5}`);
  }
  console.log(`   ✅ Checksum verified`);
  
  console.log(`📂 Extracting...`);
  await $`tar -xzf ${tarballPath} -C ${targetDir}`.quiet();
  await rm(tarballPath);
  
  await Bun.write(versionMarker, targetVersion);
  
  const configured = await getConfiguredVersion(config.name.toLowerCase());
  if (configured.version !== targetVersion || configured.md5 !== expectedMd5) {
    await updatePackageJsonSourceForge(config.name.toLowerCase(), targetVersion, expectedMd5);
  }
  
  console.log(`✅ ${config.name} source ready at: ${sourceDir}`);
  
  return { version: targetVersion, md5sum: expectedMd5, sourcePath: sourceDir, downloaded: true };
}

export { ROOT_DIR };

if (import.meta.main) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: fetch-sourceforge-source.ts <name> <project> [version]");
    console.error("Example: fetch-sourceforge-source.ts lame lame 3.100");
    process.exit(1);
  }
  
  const [name, project, version] = args;
  
  const config: SourceForgeConfig = {
    name,
    project,
    targetDir: `src-tauri/vendor`,
  };
  
  try {
    await fetchSourceForgeSource(config, version);
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
}
