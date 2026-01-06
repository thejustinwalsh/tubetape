#!/usr/bin/env bun
import { mkdir, chmod, exists, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { $ } from "bun";

export type Platform = "darwin" | "linux" | "win32";
export type Arch = "arm64" | "x64" | "x86";

export interface BuildConfig {
  sourceDir: string;
  targetDir: string;
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

function getDylibExtension(): string {
  const { isMacOS, isLinux } = getPlatformInfo();
  return isMacOS ? "dylib" : isLinux ? "so" : "dll";
}

async function buildFFmpegLibraries(sourceDir: string, outputDir: string): Promise<string[]> {
  const { isMacOS, arch } = getPlatformInfo();

  console.log("   Configuring FFmpeg build...");

  const configureFlags = [
    `--prefix=${outputDir}`,
    "--enable-shared",
    "--disable-static",
    "--disable-programs",
    "--disable-doc",
    "--disable-htmlpages",
    "--disable-manpages",
    "--disable-podpages",
    "--disable-txtpages",
    "--enable-gpl",
    "--enable-pic",
    "--enable-pthreads",
    "--enable-libmp3lame",
    "--enable-encoder=flac",
    "--enable-encoder=aac",
    "--enable-decoder=flac",
    "--enable-decoder=aac",
    "--enable-decoder=mp3",
  ];

  if (isMacOS && arch === "arm64") {
    configureFlags.push("--arch=arm64", "--enable-neon");
  }

  await $`./configure ${configureFlags}`.cwd(sourceDir);

  console.log("   Building FFmpeg libraries (this may take a while)...");
  const cpuCount = navigator?.hardwareConcurrency ?? 4;
  await $`make -j${cpuCount}`.cwd(sourceDir);
  await $`make install`.cwd(sourceDir);

  const ext = getDylibExtension();
  const libDir = join(outputDir, "lib");
  
  const libraries = [
    `libavformat.${ext}`,
    `libavcodec.${ext}`,
    `libavutil.${ext}`,
    `libswresample.${ext}`,
    `libswscale.${ext}`,
    `libavfilter.${ext}`,
  ];

  const builtLibs: string[] = [];
  for (const lib of libraries) {
    const libPath = join(libDir, lib);
    if (await exists(libPath)) {
      builtLibs.push(libPath);
    }
  }

  console.log(`   Built ${builtLibs.length} libraries`);
  return builtLibs;
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

async function verifyLibraries(libDir: string): Promise<void> {
  console.log(`🔍 Verifying FFmpeg libraries...`);

  const { isMacOS } = getPlatformInfo();
  const ext = getDylibExtension();

  const requiredLibs = [
    `libavformat.${ext}`,
    `libavcodec.${ext}`,
    `libavutil.${ext}`,
    `libswresample.${ext}`,
  ];

  for (const lib of requiredLibs) {
    const libPath = join(libDir, lib);
    if (!(await exists(libPath))) {
      throw new Error(`Required library not found: ${libPath}`);
    }
  }

  const avformatPath = join(libDir, `libavformat.${ext}`);
  const symbolsToCheck = [
    "avformat_open_input",
    "avformat_find_stream_info",
    "avformat_close_input",
    "av_read_frame",
  ];

  for (const symbol of symbolsToCheck) {
    const nmFlag = isMacOS ? "-g" : "-D";
    const result = await $`nm ${nmFlag} ${avformatPath} | grep ${symbol}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      console.warn(`   ⚠️  Symbol ${symbol} not found in libavformat`);
    }
  }

  console.log(`   ✅ FFmpeg libraries verified`);
}

export async function buildFFmpeg(config: BuildConfig): Promise<string[]> {
  const { isMacOS, isLinux, isWindows } = getPlatformInfo();
  const sourceDir = join(ROOT_DIR, config.sourceDir);
  const targetDir = join(ROOT_DIR, config.targetDir);

  console.log(`🔨 Building FFmpeg shared libraries from source`);
  console.log(`   Source: ${sourceDir}`);

  if (!(await exists(sourceDir))) {
    throw new Error(`Source directory not found: ${sourceDir}. Run fetch-github-source first.`);
  }

  await mkdir(targetDir, { recursive: true });

  const outputDir = join(sourceDir, `build-${isMacOS ? "macos" : isLinux ? "linux" : "windows"}`);
  await mkdir(outputDir, { recursive: true });

  const builtLibs = await buildFFmpegLibraries(sourceDir, outputDir);

  const copiedLibs: string[] = [];
  const ext = getDylibExtension();

  for (const libPath of builtLibs) {
    const libName = basename(libPath);
    const targetPath = join(targetDir, libName);
    
    await copyFile(libPath, targetPath);

    if (!isWindows) {
      await chmod(targetPath, 0o755);
    }

    if (IS_PROD && isMacOS && libName.endsWith(".dylib")) {
      await signBinary(targetPath, libName);
    }

    copiedLibs.push(targetPath);
  }

  const libDir = join(outputDir, "lib");
  const versionedLibs = await $`ls -la ${libDir}/*.${ext}* 2>/dev/null || true`.quiet().text();
  console.log(`   Library files in output: ${versionedLibs.split('\n').filter(l => l).length} files`);

  await verifyLibraries(targetDir);

  console.log(`✨ Done! FFmpeg libraries ready at: ${targetDir}`);
  console.log(`   Libraries: ${copiedLibs.map(l => basename(l)).join(', ')}`);

  return copiedLibs;
}

export { ROOT_DIR, IS_PROD };

if (import.meta.main) {
  const config: BuildConfig = {
    sourceDir: "src-tauri/vendor/ffmpeg",
    targetDir: "src-tauri/binaries/ffmpeg",
  };

  try {
    await buildFFmpeg(config);
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    process.exit(1);
  }
}
