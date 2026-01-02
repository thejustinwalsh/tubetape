#!/usr/bin/env bun
// Download and setup deno binary for Tauri bundling

import { mkdir, unlink, chmod, exists } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import Extract from "unzipper";

const ROOT_DIR = join(import.meta.dir, "..");
const TARGET_DIR = join(ROOT_DIR, "src-tauri", "binaries", "deno");
const IS_PROD = process.env.NODE_ENV === "production";
console.log(`📦 Build mode: ${IS_PROD ? "PRODUCTION" : "DEVELOPMENT"}`);

type Platform = "darwin" | "linux" | "win32";
type Arch = "arm64" | "x64";

interface DenoAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: DenoAsset[];
}

interface DenoRelease {
  version: string;
  zipAsset: DenoAsset;
  checksumAsset: DenoAsset;
}

interface PlatformInfo {
  binaryName: string;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  executable: string;
}

function getPlatformInfo(platform: Platform, arch: Arch): PlatformInfo {
  const isWindows = platform === "win32";
  const isMacOS = platform === "darwin";
  const isLinux = platform === "linux";

  let binaryName: string;
  if (isMacOS) {
    binaryName = arch === "arm64" ? "deno-aarch64-apple-darwin" : "deno-x86_64-apple-darwin";
  } else if (isLinux) {
    binaryName = "deno-x86_64-unknown-linux-gnu";
  } else if (isWindows) {
    binaryName = "deno-x86_64-pc-windows-msvc";
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return {
    binaryName,
    isWindows,
    isMacOS,
    isLinux,
    executable: isWindows ? "deno.exe" : "deno",
  };
}

async function getLatestDenoRelease(binaryName: string): Promise<DenoRelease> {
  console.log("🔍 Fetching latest Deno release info from GitHub API...");
  
  const response = await fetch("https://api.github.com/repos/denoland/deno/releases/latest");
  if (!response.ok) {
    throw new Error(`Failed to fetch release info: ${response.statusText}`);
  }

  const data: GitHubRelease = await response.json() as GitHubRelease;
  const version = data.tag_name.replace(/^v/, "");
  
  console.log(`   Latest version: ${version}`);

  // Find the zip asset and its corresponding checksum file
  const zipName = `${binaryName}.zip`;
  const checksumName = `${zipName}.sha256sum`;
  
  const zipAsset = data.assets.find((a) => a.name === zipName);
  const checksumAsset = data.assets.find((a) => a.name === checksumName);

  if (!zipAsset) {
    throw new Error(`Binary asset not found: ${zipName}`);
  }

  if (!checksumAsset) {
    throw new Error(`Checksum asset not found: ${checksumName}`);
  }

  console.log(`   Found assets:`);
  console.log(`     - ${zipAsset.name} (${(zipAsset.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`       GitHub API digest: ${zipAsset.digest}`);
  console.log(`     - ${checksumAsset.name}`);
  console.log(`       GitHub API digest: ${checksumAsset.digest}`);

  return { version, zipAsset, checksumAsset };
}

async function computeChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  return hash;
}

async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<void> {
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

function parseDigest(digest: string): string {
  // Parse "sha256:hash" format
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  if (!match) {
    throw new Error(`Invalid digest format: ${digest}`);
  }
  return match[1].toLowerCase();
}

async function setupDeno(): Promise<void> {
  const platform = process.platform as Platform;
  const arch = process.arch as Arch;
  const platformInfo = getPlatformInfo(platform, arch);
  const denoPath = join(TARGET_DIR, platformInfo.executable);

  // Check if deno already exists and works
  if (await exists(denoPath)) {
    try {
      const result = await $`${denoPath} --version`.quiet();
      const versionLine = result.stdout.toString().split("\n")[0];
      console.log(`✅ Deno binary already exists: ${versionLine}`);
      console.log(`   Path: ${denoPath}`);
      return;
    } catch {
      console.log(`⚠️  Existing binary is broken, re-downloading...`);
      await unlink(denoPath);
    }
  }

  // Fetch latest release info
  const release = await getLatestDenoRelease(platformInfo.binaryName);

  // Ensure target directory exists
  await mkdir(TARGET_DIR, { recursive: true });

  const zipPath = join(TARGET_DIR, release.zipAsset.name);
  const checksumPath = join(TARGET_DIR, release.checksumAsset.name);

  try {
    // Step 1: Download the checksum file
    console.log(`📥 Downloading checksum file...`);
    const checksumResponse = await fetch(release.checksumAsset.browser_download_url);
    if (!checksumResponse.ok) {
      throw new Error(`Checksum download failed: ${checksumResponse.statusText}`);
    }
    
    const checksumText = await checksumResponse.text();
    await Bun.write(checksumPath, checksumText);
    
    // Step 2: Verify checksum file's digest against GitHub API
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
    
    // Step 3: Parse the expected checksum from the verified file
    const lines = checksumText.trim().split(/\r?\n/);
    let expectedChecksum: string | null = null;
    
    for (const line of lines) {
      // Try format 1: "hash  filename"
      const format1Match = line.match(/^([a-f0-9]{64})\s+/i);
      if (format1Match) {
        expectedChecksum = format1Match[1].toLowerCase();
        break;
      }
      // Try format 2: "sha256:hash"
      const format2Match = line.match(/sha256:([a-f0-9]{64})/i);
      if (format2Match) {
        expectedChecksum = format2Match[1].toLowerCase();
        break;
      }
    }
    
    if (!expectedChecksum) {
      throw new Error(`Invalid checksum format in ${release.checksumAsset.name}`);
    }
    
    console.log(`   Expected zip checksum: ${expectedChecksum}`);
    
    // Step 4: Verify this matches the GitHub API digest for the zip
    const zipApiDigest = parseDigest(release.zipAsset.digest);
    console.log(`   GitHub API digest:     ${zipApiDigest}`);
    
    if (zipApiDigest !== expectedChecksum) {
      throw new Error(
        `🚨 SECURITY ALERT: Checksum mismatch between GitHub API and .sha256sum file!\n` +
        `  GitHub API digest: ${zipApiDigest}\n` +
        `  .sha256sum file:   ${expectedChecksum}\n` +
        `  Release data may be inconsistent or tampered with!`
      );
    }
    console.log(`   ✅ GitHub API digest matches .sha256sum file`);

    // Step 5: Download the binary zip
    console.log(`📥 Downloading binary (${(release.zipAsset.size / 1024 / 1024).toFixed(2)} MB)...`);
    const zipResponse = await fetch(release.zipAsset.browser_download_url);
    if (!zipResponse.ok) {
      throw new Error(`Binary download failed: ${zipResponse.statusText}`);
    }

    await Bun.write(zipPath, await zipResponse.blob());

    // Step 6: Compute and verify the downloaded zip's checksum
    console.log(`🔐 Computing checksum of downloaded file...`);
    const actualChecksum = await computeChecksum(zipPath);
    console.log(`   Computed checksum: ${actualChecksum}`);

    // Step 7: Verify we match the final expected checksum
    console.log(`🔐 Performing final integrity verification...`);
    await verifyChecksum(zipPath, expectedChecksum);
    console.log(`   ✅ Downloaded file checksum verified`);

    // Clean up checksum file
    await unlink(checksumPath);

    // Extract (cross-platform)
    console.log(`📂 Extracting...`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(Extract.Extract({ path: TARGET_DIR }))
        .on('close', () => resolve())
        .on('error', reject);
    });

    // Clean up zip
    await unlink(zipPath);

    // Make executable on Unix
    if (!platformInfo.isWindows) {
      await chmod(denoPath, 0o755);
    }

    // Code-signing on macOS if in production mode
    if (IS_PROD && platformInfo.isMacOS && process.env.APPLE_SIGNING_IDENTITY) {
      console.log(`🔏 Code-signing deno binary for macOS...`);

      const codesignCmd = `codesign -s "${process.env.APPLE_SIGNING_IDENTITY}" --options=runtime --force "${denoPath}"`;
      await $`sh -c ${codesignCmd}`;

      console.log(`   ✅ Code-signed deno binary`);
    }

    // Verify installation
    console.log(`🔍 Verifying installation...`);
    const result = await $`${denoPath} --version`;
    console.log(result.stdout.toString());

    console.log(`✨ Done! Deno v${release.version} ready at:`);
    console.log(`   ${denoPath}`);
  } catch (error) {
    console.error(`❌ Failed to setup deno: ${error}`);
    process.exit(1);
  }
}

// Main execution
try {
  await setupDeno();
} catch (error) {
  console.error(`❌ Error: ${error}`);
  process.exit(1);
}
