#!/usr/bin/env bun
import { mkdir, chmod, exists, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

export type Platform = "darwin" | "linux" | "win32";
export type Arch = "arm64" | "x64";

export interface BuildConfig {
  sourceDir: string;
  targetDir: string;
  executableName: string;
}

const ROOT_DIR = join(import.meta.dir, "..");
const IS_PROD = process.env.NODE_ENV === "production";

function getPlatformInfo(): { platform: Platform; arch: Arch; isMacOS: boolean; isLinux: boolean; isWindows: boolean } {
  const platform = process.platform as Platform;
  const arch = process.arch as Arch;
  return {
    platform,
    arch,
    isMacOS: platform === "darwin",
    isLinux: platform === "linux",
    isWindows: platform === "win32",
  };
}

async function buildForArch(sourceDir: string, arch: "arm64" | "x86_64"): Promise<string> {
  const outputName = `qjs-${arch}`;
  const archFlag = arch === "arm64" ? "-arch arm64" : "-arch x86_64";
  
  console.log(`   Building for ${arch}...`);
  
  await $`make clean`.cwd(sourceDir).quiet().nothrow();
  await $`sh -c ${"CFLAGS='" + archFlag + "' LDFLAGS='" + archFlag + "' make -j4 qjs CONFIG_LTO=y"}`.cwd(sourceDir).quiet();
  
  const builtBinary = join(sourceDir, "qjs");
  const archBinary = join(sourceDir, outputName);
  await copyFile(builtBinary, archBinary);
  
  return archBinary;
}

async function createUniversalBinary(sourceDir: string, arm64Path: string, x64Path: string): Promise<string> {
  const universalPath = join(sourceDir, "qjs-universal");
  
  console.log(`   Creating universal binary...`);
  await $`lipo -create ${arm64Path} ${x64Path} -output ${universalPath}`.quiet();
  
  const verifyResult = await $`lipo -info ${universalPath}`.quiet();
  console.log(`   ${verifyResult.stdout.toString().trim()}`);
  
  return universalPath;
}

async function signBinary(binaryPath: string, name: string): Promise<void> {
  if (!process.env.APPLE_SIGNING_IDENTITY) {
    console.log(`   ⚠️  No APPLE_SIGNING_IDENTITY set, skipping code signing`);
    return;
  }
  
  console.log(`🔏 Code-signing ${name} binary for macOS...`);
  const codesignCmd = `codesign -s "${process.env.APPLE_SIGNING_IDENTITY}" --options=runtime --force "${binaryPath}"`;
  await $`sh -c ${codesignCmd}`;
  console.log(`   ✅ Code-signed ${name} binary`);
}

export async function buildQuickJS(config: BuildConfig): Promise<string> {
  const { isMacOS, isLinux, isWindows, arch } = getPlatformInfo();
  const sourceDir = join(ROOT_DIR, config.sourceDir);
  const targetDir = join(ROOT_DIR, config.targetDir);
  const binaryPath = join(targetDir, config.executableName);
  
  console.log(`🔨 Building QuickJS from source`);
  console.log(`   Source: ${sourceDir}`);
  
  if (await exists(binaryPath)) {
    const result = await $`${binaryPath} -e "console.log('ok')"`.quiet().nothrow();
    if (result.exitCode === 0 && result.stdout.toString().trim() === "ok") {
      console.log(`✅ QuickJS binary already exists`);
      console.log(`   Path: ${binaryPath}`);
      return binaryPath;
    }
    console.log(`   Existing binary is broken, rebuilding...`);
    await rm(binaryPath);
  }
  
  if (!(await exists(sourceDir))) {
    throw new Error(`Source directory not found: ${sourceDir}. Run fetch-github-source first.`);
  }
  
  await mkdir(targetDir, { recursive: true });
  
  let finalBinaryPath: string;
  
  if (isMacOS) {
    const arm64Binary = await buildForArch(sourceDir, "arm64");
    const x64Binary = await buildForArch(sourceDir, "x86_64");
    finalBinaryPath = await createUniversalBinary(sourceDir, arm64Binary, x64Binary);
    
    await rm(arm64Binary);
    await rm(x64Binary);
  } else if (isLinux) {
    console.log(`   Building for Linux ${arch}...`);
    await $`make clean`.cwd(sourceDir).quiet().nothrow();
    await $`make -j4 qjs CONFIG_LTO=y`.cwd(sourceDir).quiet();
    finalBinaryPath = join(sourceDir, "qjs");
  } else if (isWindows) {
    console.log(`   Building for Windows ${arch}...`);
    await $`make clean`.cwd(sourceDir).quiet().nothrow();
    await $`make -j4 qjs CONFIG_LTO=y`.cwd(sourceDir).quiet();
    finalBinaryPath = join(sourceDir, "qjs.exe");
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  
  await copyFile(finalBinaryPath, binaryPath);
  
  if (!isWindows) {
    await chmod(binaryPath, 0o755);
    console.log(`   Stripping debug symbols...`);
    await $`strip ${binaryPath}`.quiet();
  }
  
  if (IS_PROD && isMacOS) {
    await signBinary(binaryPath, "QuickJS");
  }
  
  console.log(`🔍 Verifying installation...`);
  const verifyResult = await $`${binaryPath} -e "console.log('ok')"`.quiet().nothrow();
  if (verifyResult.exitCode === 0 && verifyResult.stdout.toString().trim() === "ok") {
    console.log(`   ✅ QuickJS binary verified`);
  } else {
    throw new Error(`QuickJS binary verification failed`);
  }
  
  console.log(`✨ Done! QuickJS ready at:`);
  console.log(`   ${binaryPath}`);
  
  return binaryPath;
}

export { ROOT_DIR, IS_PROD };

if (import.meta.main) {
  const config: BuildConfig = {
    sourceDir: "src-tauri/vendor/quickjs",
    targetDir: "src-tauri/binaries/qjs",
    executableName: process.platform === "win32" ? "qjs.exe" : "qjs",
  };
  
  try {
    await buildQuickJS(config);
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
}
