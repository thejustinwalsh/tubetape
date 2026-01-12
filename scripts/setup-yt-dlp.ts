#!/usr/bin/env bun
import { mkdir, writeFile, rm, exists, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";

const ROOT_DIR = join(import.meta.dir, "..");
const BUNDLE_DIR = join(ROOT_DIR, "public/pyodide");

interface FileIntegrity {
  sha256: string;
}

interface PyodideConfig {
  version: string;
  ytDlpVersion: string;
  integrity: {
    pyodideCore: Record<string, FileIntegrity>;
    sslWheel: FileIntegrity;
    opensslZip: FileIntegrity;
    ytDlpWheel: FileIntegrity;
  };
}

const PYODIDE_CORE_FILES = [
  "pyodide.js",
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "python_stdlib.zip",
];

const REQUIRED_WHEELS = [
  { name: "ssl", version: "1.0.0", platform: "cp312-cp312-pyodide_2024_0_wasm32" },
];

async function computeSHA256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  
  return new Promise((resolve, reject) => {
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function verifySHA256(filePath: string, expectedHash: string): Promise<boolean> {
  const actualHash = await computeSHA256(filePath);
  return actualHash === expectedHash;
}

async function readPackageJson(): Promise<{
  pyodideDeps?: PyodideConfig;
  [key: string]: unknown;
}> {
  const pkgPath = join(ROOT_DIR, "package.json");
  const content = await Bun.file(pkgPath).text();
  return JSON.parse(content);
}

async function updatePackageJson(config: PyodideConfig): Promise<void> {
  const pkg = await readPackageJson();
  pkg.pyodideDeps = config;
  await writeFile(
    join(ROOT_DIR, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n"
  );
}

async function getConfig(): Promise<PyodideConfig | null> {
  const pkg = await readPackageJson();
  const config = pkg.pyodideDeps;
  
  if (!config?.integrity) {
    return null;
  }
  
  return config as PyodideConfig;
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  
  if (!response.body) {
    throw new Error("Response body is null");
  }
  
  const fileStream = createWriteStream(targetPath);
  await pipeline(response.body, fileStream);
}

async function downloadAndVerify(
  url: string, 
  targetPath: string, 
  expectedHash: string | null,
  fileName: string
): Promise<string> {
  console.log(`   Downloading ${fileName}...`);
  await downloadFile(url, targetPath);
  
  const actualHash = await computeSHA256(targetPath);
  
  if (expectedHash) {
    if (actualHash !== expectedHash) {
      await rm(targetPath);
      throw new Error(
        `Integrity check failed for ${fileName}\n` +
        `   Expected: ${expectedHash}\n` +
        `   Actual:   ${actualHash}`
      );
    }
    console.log(`   ✓ Verified ${fileName}`);
  }
  
  return actualHash;
}

async function fetchPyodideLockHashes(version: string): Promise<Record<string, string>> {
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/pyodide-lock.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pyodide-lock.json: ${response.statusText}`);
  }
  
  const data = await response.json() as {
    packages: Record<string, { sha256: string; file_name: string }>;
  };
  
  const hashes: Record<string, string> = {};
  for (const [, pkg] of Object.entries(data.packages)) {
    hashes[pkg.file_name] = pkg.sha256;
  }
  
  return hashes;
}

async function fetchPyPIHash(packageName: string, version: string): Promise<{ filename: string; sha256: string; url: string }> {
  const url = `https://pypi.org/pypi/${packageName}/${version}/json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${packageName} metadata: ${response.statusText}`);
  }
  
  const data = await response.json() as {
    urls?: Array<{ 
      packagetype: string; 
      url: string; 
      filename: string;
      digests: { sha256: string };
    }>;
  };
  
  const wheelInfo = data.urls?.find(u => u.packagetype === "bdist_wheel");
  if (!wheelInfo) {
    throw new Error(`No wheel found for ${packageName} ${version}`);
  }
  
  return {
    filename: wheelInfo.filename,
    sha256: wheelInfo.digests.sha256,
    url: wheelInfo.url,
  };
}

async function fetchLatestVersionFromPyPI(packageName: string): Promise<string> {
  const url = `https://pypi.org/pypi/${packageName}/json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${packageName} metadata: ${response.statusText}`);
  }
  const data = (await response.json()) as { info?: { version?: string } };
  const version = data.info?.version;
  if (!version) {
    throw new Error(`Missing version info for ${packageName}`);
  }
  return version;
}

async function downloadPyodideCore(
  version: string, 
  targetDir: string,
  expectedHashes: Record<string, FileIntegrity> | null
): Promise<Record<string, FileIntegrity>> {
  console.log(`📦 Downloading Pyodide ${version} core files...`);
  
  const baseUrl = `https://cdn.jsdelivr.net/pyodide/v${version}/full`;
  const computedHashes: Record<string, FileIntegrity> = {};
  
  for (const file of PYODIDE_CORE_FILES) {
    const url = `${baseUrl}/${file}`;
    const targetPath = join(targetDir, file);
    const expectedHash = expectedHashes?.[file]?.sha256 ?? null;
    
    const actualHash = await downloadAndVerify(url, targetPath, expectedHash, file);
    computedHashes[file] = { sha256: actualHash };
  }
  
  console.log(`   ✅ Pyodide core files downloaded${expectedHashes ? " and verified" : ""}`);
  return computedHashes;
}

async function downloadOpenSSL(
  targetDir: string,
  expectedHash: FileIntegrity | null
): Promise<FileIntegrity> {
  console.log(`📦 Downloading OpenSSL shared libraries...`);
  
  const opensslDir = join(targetDir, "openssl-1.1.1w");
  await mkdir(opensslDir, { recursive: true });
  
  const baseUrl = "https://cdn.jsdelivr.net/pyodide/v0.27.4/full";
  const opensslZipUrl = `${baseUrl}/openssl-1.1.1w.zip`;
  const zipPath = join(targetDir, "openssl-1.1.1w.zip");
  
  const actualHash = await downloadAndVerify(
    opensslZipUrl, 
    zipPath, 
    expectedHash?.sha256 ?? null,
    "openssl-1.1.1w.zip"
  );
  
  console.log(`   Extracting OpenSSL...`);
  await $`unzip -q -o ${zipPath} -d ${opensslDir}`.quiet();
  
  console.log(`   ✅ OpenSSL libraries ready`);
  return { sha256: actualHash };
}

async function downloadSSLWheel(
  targetDir: string,
  expectedHash: FileIntegrity | null,
  pyodideLockHashes: Record<string, string> | null
): Promise<FileIntegrity> {
  console.log(`📦 Downloading SSL wheel...`);
  
  const wheel = REQUIRED_WHEELS.find(w => w.name === "ssl")!;
  const wheelName = `${wheel.name}-${wheel.version}-${wheel.platform}.whl`;
  const url = `https://cdn.jsdelivr.net/pyodide/v0.27.4/full/${wheelName}`;
  const targetPath = join(targetDir, wheelName);
  
  const lockHash = pyodideLockHashes?.[wheelName];
  const expected = expectedHash?.sha256 ?? lockHash ?? null;
  
  const actualHash = await downloadAndVerify(url, targetPath, expected, wheelName);
  
  console.log(`   ✅ SSL wheel downloaded`);
  return { sha256: actualHash };
}

async function downloadYtDlpWheel(
  version: string, 
  targetDir: string,
  expectedHash: FileIntegrity | null
): Promise<{ filename: string; integrity: FileIntegrity }> {
  console.log(`📦 Downloading yt-dlp ${version} wheel...`);
  
  const wheelInfo = await fetchPyPIHash("yt-dlp", version);
  const targetPath = join(targetDir, wheelInfo.filename);
  
  const expectedSha = expectedHash?.sha256 ?? wheelInfo.sha256;
  
  const actualHash = await downloadAndVerify(
    wheelInfo.url, 
    targetPath, 
    expectedSha,
    wheelInfo.filename
  );
  
  console.log(`   ✅ yt-dlp wheel downloaded`);
  return { 
    filename: wheelInfo.filename, 
    integrity: { sha256: actualHash } 
  };
}

async function createPatches(targetDir: string) {
  console.log(`📝 Creating patches...`);
  
  const patchesDir = join(targetDir, "patches");
  await mkdir(patchesDir, { recursive: true });
  
  const sourcePatchesDir = join(import.meta.dir, "patches");
  const patchFiles = ["http_adapter.py", "dlopen_adapter.py", "loader.py", "jsc_provider.py"];
  
  for (const file of patchFiles) {
    const sourcePath = join(sourcePatchesDir, file);
    const targetPath = join(patchesDir, file);
    try {
      await copyFile(sourcePath, targetPath);
    } catch {
      console.warn(`   ⚠️ Patch file not found: ${file}`);
    }
  }
  
  console.log(`   ✅ Patches created`);
}

async function validateBundle(bundleDir: string) {
  console.log(`🔍 Validating bundle structure...`);
  
  const requiredFiles = [
    "pyodide.js",
    "pyodide.mjs",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "pyodide-lock.json",
    "patches/pyodide/loader.py",
    "patches/pyodide/http_adapter.py",
  ];
  
  const files = await $`ls ${bundleDir}`.quiet();
  const hasYtDlpWheel = files.stdout.toString().includes("yt_dlp-");
  
  if (!hasYtDlpWheel) {
    throw new Error("Missing yt-dlp wheel");
  }
  
  const missing: string[] = [];
  
  for (const file of requiredFiles) {
    const path = join(bundleDir, file);
    if (!(await exists(path))) {
      missing.push(file);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Missing required files:\n  - ${missing.join("\n  - ")}`);
  }
  
  console.log(`   ✅ All required files present`);
}

async function verifyExistingBundle(bundleDir: string, config: PyodideConfig): Promise<boolean> {
  console.log(`🔐 Verifying bundle integrity...`);
  
  try {
    for (const [file, expected] of Object.entries(config.integrity.pyodideCore)) {
      const filePath = join(bundleDir, file);
      if (!(await exists(filePath))) {
        console.log(`   ✗ Missing: ${file}`);
        return false;
      }
      if (!(await verifySHA256(filePath, expected.sha256))) {
        console.log(`   ✗ Hash mismatch: ${file}`);
        return false;
      }
    }
    
    const sslWheelPath = join(bundleDir, "ssl-1.0.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
    if (!(await verifySHA256(sslWheelPath, config.integrity.sslWheel.sha256))) {
      console.log(`   ✗ Hash mismatch: ssl wheel`);
      return false;
    }
    
    const ytDlpPattern = `yt_dlp-${config.ytDlpVersion}-py3-none-any.whl`;
    const ytDlpPath = join(bundleDir, ytDlpPattern);
    if (!(await exists(ytDlpPath))) {
      console.log(`   ✗ Missing: ${ytDlpPattern}`);
      return false;
    }
    if (!(await verifySHA256(ytDlpPath, config.integrity.ytDlpWheel.sha256))) {
      console.log(`   ✗ Hash mismatch: yt-dlp wheel`);
      return false;
    }
    
    console.log(`   ✅ All integrity checks passed`);
    return true;
  } catch (error) {
    console.log(`   ✗ Verification failed: ${error}`);
    return false;
  }
}

async function handleClean() {
  console.log(`🧹 Cleaning yt-dlp bundle...`);
  await rm(BUNDLE_DIR, { recursive: true, force: true });
  console.log(`   ✅ Bundle cleaned\n`);
}

async function bundleYtDlp(existingConfig: PyodideConfig | null, update: boolean, forceRebuild: boolean) {
  const pyodideVersion = existingConfig?.version ?? "0.27.4";
  let ytDlpVersion = existingConfig?.ytDlpVersion ?? "2025.10.22";
  
  if (update) {
    try {
      ytDlpVersion = await fetchLatestVersionFromPyPI("yt-dlp");
      console.log(`📡 Latest yt-dlp version: ${ytDlpVersion}`);
    } catch (error) {
      console.warn(`⚠️ Failed to fetch latest version: ${error}`);
    }
  }
  
  console.log(`\n🚀 Bundling Pyodide + yt-dlp`);
  console.log(`   Pyodide version: ${pyodideVersion}`);
  console.log(`   yt-dlp version: ${ytDlpVersion}`);
  
  if (!forceRebuild && await exists(BUNDLE_DIR) && existingConfig && !update) {
    console.log(`\n   Bundle exists at: ${BUNDLE_DIR}`);
    
    const isValid = await verifyExistingBundle(BUNDLE_DIR, existingConfig);
    if (isValid) {
      const bundleSize = await $`du -sh ${BUNDLE_DIR}`.quiet();
      console.log(`   ✅ Bundle valid (${bundleSize.stdout.toString().split('\t')[0].trim()})`);
      console.log(`\n✅ yt-dlp bundle already built. Use --clean to rebuild.\n`);
      return;
    }
    
    console.warn(`   ⚠️ Bundle integrity check failed. Rebuilding...`);
  }
  
  if (!existingConfig && !update) {
    console.warn(`\n⚠️ No integrity hashes found in package.json.`);
    console.warn(`   Run with --update to fetch and store hashes.`);
    throw new Error("Missing integrity configuration. Run: bun run bundle:yt-dlp:update");
  }
  
  console.log(`\n🧹 Cleaning bundle directory...`);
  await rm(BUNDLE_DIR, { recursive: true, force: true });
  await mkdir(BUNDLE_DIR, { recursive: true });
  
  const expectedHashes = existingConfig?.integrity ?? null;
  
  const pyodideLockHashes = await fetchPyodideLockHashes(pyodideVersion);
  
  const coreHashes = await downloadPyodideCore(
    pyodideVersion, 
    BUNDLE_DIR,
    expectedHashes?.pyodideCore ?? null
  );
  
  const opensslHash = await downloadOpenSSL(
    BUNDLE_DIR,
    expectedHashes?.opensslZip ?? null
  );
  
  const sslHash = await downloadSSLWheel(
    BUNDLE_DIR,
    expectedHashes?.sslWheel ?? null,
    pyodideLockHashes
  );
  
  const ytDlpResult = await downloadYtDlpWheel(
    ytDlpVersion, 
    BUNDLE_DIR,
    update ? null : expectedHashes?.ytDlpWheel ?? null
  );
  
  await createPatches(BUNDLE_DIR);
  await validateBundle(BUNDLE_DIR);
  
  const newConfig: PyodideConfig = {
    version: pyodideVersion,
    ytDlpVersion: ytDlpVersion,
    integrity: {
      pyodideCore: coreHashes,
      sslWheel: sslHash,
      opensslZip: opensslHash,
      ytDlpWheel: ytDlpResult.integrity,
    },
  };
  
  console.log(`\n📝 Updating package.json with versions and hashes...`);
  await updatePackageJson(newConfig);
  console.log(`   ✅ package.json updated`);
  
  const bundleSize = await $`du -sh ${BUNDLE_DIR}`.quiet();
  const sizeStr = bundleSize.stdout.toString().split('\t')[0].trim();
  
  console.log(`\n✨ Done! Bundle ready with integrity verification`);
  console.log(`   Location: ${BUNDLE_DIR}`);
  console.log(`   Size: ${sizeStr}`);
  console.log(`\n💡 What's included:`);
  console.log(`   • Pyodide ${pyodideVersion} core runtime`);
  console.log(`   • ${ytDlpResult.filename} (SHA256 verified)`);
  console.log(`   • SSL wheel + OpenSSL libs`);
  console.log(`   • HTTP & FFmpeg patches`);
  console.log(`\n🔐 All files verified with SHA256 checksums stored in package.json`);
  console.log(`🚀 Next: bun run tauri dev`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: bundle-yt-dlp.ts [options]

Bundles minimal Pyodide runtime + yt-dlp wheel with integrity verification.

Options:
  --update    Fetch latest yt-dlp version and update hashes in package.json
  --clean     Remove existing bundle and rebuild from scratch
  --help      Show this help message

Without --update:
  - Requires existing hashes in package.json
  - Verifies all downloads against stored SHA256 hashes
  - Fails if any integrity check fails

With --update:
  - Fetches latest yt-dlp version from PyPI
  - Computes SHA256 hashes for all files
  - Updates package.json with new versions and hashes
`);
  process.exit(0);
}

const shouldUpdate = args.includes("--update");
const shouldClean = args.includes("--clean");

try {
  if (shouldClean) {
    await handleClean();
  }
  const config = await getConfig();
  await bundleYtDlp(config, shouldUpdate, shouldClean);
} catch (error) {
  console.error(`❌ Error: ${error}`);
  process.exit(1);
}
