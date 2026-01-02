#!/usr/bin/env bun
import { mkdir, unlink, chmod, exists, rename } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import Extract from "unzipper";

export type Platform = "darwin" | "linux" | "win32";
export type Arch = "arm64" | "x64";

export interface BinaryAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string;
}

export interface GitHubRelease {
  tag_name: string;
  assets: BinaryAsset[];
}

export interface ReleaseInfo {
  version: string;
  binaryAsset: BinaryAsset;
  checksumAsset?: BinaryAsset;
}

export interface PlatformBinaryConfig {
  assetName: string;
  isZipped: boolean;
  executableName: string;
}

export interface BinaryConfig {
  name: string;
  repo: string;
  targetDir: string;
  hasChecksumFiles: boolean;
  platforms: {
    darwin: { arm64: PlatformBinaryConfig; x64: PlatformBinaryConfig };
    linux: { arm64: PlatformBinaryConfig; x64: PlatformBinaryConfig };
    win32: { arm64: PlatformBinaryConfig; x64: PlatformBinaryConfig };
  };
}

const ROOT_DIR = join(import.meta.dir, "..");
const IS_PROD = process.env.NODE_ENV === "production";

export function getPlatformConfig(
  config: BinaryConfig,
  platform: Platform,
  arch: Arch
): PlatformBinaryConfig & { isWindows: boolean; isMacOS: boolean; isLinux: boolean } {
  const platformConfig = config.platforms[platform]?.[arch];
  if (!platformConfig) {
    throw new Error(`Unsupported platform/arch combination: ${platform}/${arch}`);
  }
  
  return {
    ...platformConfig,
    isWindows: platform === "win32",
    isMacOS: platform === "darwin",
    isLinux: platform === "linux",
  };
}

export async function getLatestRelease(
  config: BinaryConfig,
  platformConfig: PlatformBinaryConfig
): Promise<ReleaseInfo> {
  console.log(`🔍 Fetching latest ${config.name} release info from GitHub API...`);
  
  const response = await fetch(`https://api.github.com/repos/${config.repo}/releases/latest`);
  if (!response.ok) {
    throw new Error(`Failed to fetch release info: ${response.statusText}`);
  }

  const data: GitHubRelease = await response.json() as GitHubRelease;
  const version = data.tag_name.replace(/^v/, "");
  
  console.log(`   Latest version: ${version}`);

  const binaryAsset = data.assets.find((a) => a.name === platformConfig.assetName);
  if (!binaryAsset) {
    console.error(`   Available assets: ${data.assets.map(a => a.name).join(", ")}`);
    throw new Error(`Binary asset not found: ${platformConfig.assetName}`);
  }

  console.log(`   Found assets:`);
  console.log(`     - ${binaryAsset.name} (${(binaryAsset.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`       GitHub API digest: ${binaryAsset.digest}`);

  let checksumAsset: BinaryAsset | undefined;
  if (config.hasChecksumFiles) {
    const checksumName = `${platformConfig.assetName}.sha256sum`;
    checksumAsset = data.assets.find((a) => a.name === checksumName);
    if (checksumAsset) {
      console.log(`     - ${checksumAsset.name}`);
      console.log(`       GitHub API digest: ${checksumAsset.digest}`);
    }
  }

  return { version, binaryAsset, checksumAsset };
}

export async function computeChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  return hash;
}

export async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<void> {
  const actualChecksum = await computeChecksum(filePath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch!\n` +
      `  Expected: ${expectedChecksum}\n` +
      `  Got:      ${actualChecksum}\n` +
      `  File may be corrupted or tampered with.`
    );
  }
}

// SHA256 digest format from GitHub API: "sha256:<64-char-hex>"
export function parseDigest(digest: string): string {
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  if (!match) {
    throw new Error(`Invalid digest format: ${digest}`);
  }
  return match[1].toLowerCase();
}

export async function verifyWithChecksumFile(
  release: ReleaseInfo,
  targetDir: string
): Promise<string> {
  if (!release.checksumAsset) {
    throw new Error("No checksum asset available");
  }

  const checksumPath = join(targetDir, release.checksumAsset.name);

  console.log(`📥 Downloading checksum file...`);
  const checksumResponse = await fetch(release.checksumAsset.browser_download_url);
  if (!checksumResponse.ok) {
    throw new Error(`Checksum download failed: ${checksumResponse.statusText}`);
  }
  
  const checksumText = await checksumResponse.text();
  await Bun.write(checksumPath, checksumText);
  
  console.log(`🔐 Verifying checksum file integrity...`);
  const checksumFileDigest = parseDigest(release.checksumAsset.digest);
  console.log(`   GitHub API digest: ${checksumFileDigest}`);
  
  const checksumFileActual = await computeChecksum(checksumPath);
  console.log(`   Computed digest:   ${checksumFileActual}`);
  
  if (checksumFileDigest !== checksumFileActual) {
    throw new Error(
      `🚨 SECURITY ALERT: Checksum file digest mismatch!\n` +
      `  GitHub API: ${checksumFileDigest}\n` +
      `  Downloaded: ${checksumFileActual}\n` +
      `  The .sha256sum file may have been tampered with!`
    );
  }
  console.log(`   ✅ Checksum file verified - authentic from GitHub`);
  
  // Checksum file formats: "hash  filename" or "sha256:hash"
  const lines = checksumText.trim().split(/\r?\n/);
  let expectedChecksum: string | null = null;
  
  for (const line of lines) {
    const format1Match = line.match(/^([a-f0-9]{64})\s+/i);
    if (format1Match) {
      expectedChecksum = format1Match[1].toLowerCase();
      break;
    }
    const format2Match = line.match(/sha256:([a-f0-9]{64})/i);
    if (format2Match) {
      expectedChecksum = format2Match[1].toLowerCase();
      break;
    }
  }
  
  if (!expectedChecksum) {
    throw new Error(`Invalid checksum format in ${release.checksumAsset.name}`);
  }
  
  console.log(`   Expected binary checksum: ${expectedChecksum}`);
  
  const binaryApiDigest = parseDigest(release.binaryAsset.digest);
  console.log(`   GitHub API digest:        ${binaryApiDigest}`);
  
  if (binaryApiDigest !== expectedChecksum) {
    throw new Error(
      `🚨 SECURITY ALERT: Checksum mismatch between GitHub API and .sha256sum file!\n` +
      `  GitHub API digest: ${binaryApiDigest}\n` +
      `  .sha256sum file:   ${expectedChecksum}\n` +
      `  Release data may be inconsistent or tampered with!`
    );
  }
  console.log(`   ✅ GitHub API digest matches .sha256sum file`);

  await unlink(checksumPath);

  return expectedChecksum;
}

export async function setupBinary(config: BinaryConfig): Promise<void> {
  const platform = process.platform as Platform;
  const arch = process.arch as Arch;
  const platformConfig = getPlatformConfig(config, platform, arch);
  const targetDir = join(ROOT_DIR, config.targetDir);
  const binaryPath = join(targetDir, platformConfig.executableName);

  console.log(`📦 Setting up ${config.name}`);
  console.log(`   Build mode: ${IS_PROD ? "PRODUCTION" : "DEVELOPMENT"}`);

  if (await exists(binaryPath)) {
    try {
      const result = await $`${binaryPath} --version`.quiet().nothrow();
      const output = result.stdout.toString() + result.stderr.toString();
      const versionMatch = output.match(/version\s+(\d+\.\d+\.\d+)/i) || 
                           output.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        console.log(`✅ ${config.name} binary already exists: v${versionMatch[1]}`);
        console.log(`   Path: ${binaryPath}`);
        return;
      }
    } catch {
      console.log(`⚠️  Existing binary is broken, re-downloading...`);
      await unlink(binaryPath);
    }
  }

  const release = await getLatestRelease(config, platformConfig);

  await mkdir(targetDir, { recursive: true });

  let expectedChecksum: string;
  if (config.hasChecksumFiles && release.checksumAsset) {
    expectedChecksum = await verifyWithChecksumFile(release, targetDir);
  } else {
    expectedChecksum = parseDigest(release.binaryAsset.digest);
    console.log(`🔐 Using GitHub API digest for verification: ${expectedChecksum}`);
  }

  const downloadPath = join(targetDir, release.binaryAsset.name);
  console.log(`📥 Downloading binary (${(release.binaryAsset.size / 1024 / 1024).toFixed(2)} MB)...`);
  const binaryResponse = await fetch(release.binaryAsset.browser_download_url);
  if (!binaryResponse.ok) {
    throw new Error(`Binary download failed: ${binaryResponse.statusText}`);
  }

  await Bun.write(downloadPath, await binaryResponse.blob());

  console.log(`🔐 Computing checksum of downloaded file...`);
  const actualChecksum = await computeChecksum(downloadPath);
  console.log(`   Computed checksum: ${actualChecksum}`);

  console.log(`🔐 Performing final integrity verification...`);
  await verifyChecksum(downloadPath, expectedChecksum);
  console.log(`   ✅ Downloaded file checksum verified`);

  if (platformConfig.isZipped) {
    console.log(`📂 Extracting...`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(downloadPath)
        .pipe(Extract.Extract({ path: targetDir }))
        .on('close', () => resolve())
        .on('error', reject);
    });
    await unlink(downloadPath);
  } else if (downloadPath !== binaryPath) {
    await rename(downloadPath, binaryPath);
  }

  if (!platformConfig.isWindows) {
    await chmod(binaryPath, 0o755);
  }

  if (IS_PROD && platformConfig.isMacOS && process.env.APPLE_SIGNING_IDENTITY) {
    console.log(`🔏 Code-signing ${config.name} binary for macOS...`);
    const codesignCmd = `codesign -s "${process.env.APPLE_SIGNING_IDENTITY}" --options=runtime --force "${binaryPath}"`;
    await $`sh -c ${codesignCmd}`;
    console.log(`   ✅ Code-signed ${config.name} binary`);
  }

  console.log(`🔍 Verifying installation...`);
  const verifyResult = await $`${binaryPath} --version`.quiet().nothrow();
  const verifyOutput = verifyResult.stdout.toString() + verifyResult.stderr.toString();
  const versionMatch = verifyOutput.match(/version\s+(\d+\.\d+\.\d+)/i) || 
                       verifyOutput.match(/(\d+\.\d+\.\d+)/);
  if (versionMatch) {
    console.log(`   ✅ Verified: v${versionMatch[1]}`);
  } else {
    console.log(`   ⚠️  Version check inconclusive, but binary exists`);
  }

  console.log(`✨ Done! ${config.name} v${release.version} ready at:`);
  console.log(`   ${binaryPath}`);
}

export { ROOT_DIR, IS_PROD };
