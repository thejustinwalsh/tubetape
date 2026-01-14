#!/usr/bin/env bun
import { mkdir, chmod, exists, copyFile, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { $ } from "bun";

export type Platform = "darwin" | "linux" | "win32";
export type Arch = "arm64" | "x64" | "x86";

export interface BuildConfig {
  sourceDir: string;
  targetDir: string;
  lameDir: string;
  lameSourceDir?: string;
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

async function buildLame(sourceDir: string, outputDir: string): Promise<string> {
  const { isMacOS, arch } = getPlatformInfo();

  console.log(`🔨 Building LAME (optimized static library)...`);
  console.log(`   Source: ${sourceDir}`);
  console.log(`   Output: ${outputDir}`);

  await mkdir(outputDir, { recursive: true });

  const configureFlags = [
    `--prefix=${outputDir}`,
    "--disable-shared",
    "--enable-static",
    "--disable-frontend",
    "--disable-decoder",
    "--disable-debug",
    "--enable-nasm",
    "--with-pic",
  ];

  if (isMacOS && arch === "arm64") {
    configureFlags.push("--build=aarch64-apple-darwin");
  }

  const env = {
    ...process.env,
    CFLAGS: "-O3 -DNDEBUG",
  };

  console.log(`   Configuring LAME (release)...`);
  await $`./configure ${configureFlags}`.cwd(sourceDir).env(env).quiet();

  console.log(`   Compiling LAME...`);
  const cpuCount = navigator?.hardwareConcurrency ?? 4;
  await $`make -j${cpuCount}`.cwd(sourceDir).env(env).quiet();

  console.log(`   Installing LAME...`);
  await $`make install`.cwd(sourceDir).quiet();

  const staticLibPath = join(outputDir, "lib", "libmp3lame.a");
  if (!(await exists(staticLibPath))) {
    throw new Error(`LAME static library not found at ${staticLibPath}`);
  }

  console.log(`   ✅ LAME built: ${staticLibPath}`);
  return outputDir;
}

async function buildFFmpegLibraries(
  sourceDir: string,
  outputDir: string,
  lameDir: string
): Promise<string[]> {
  const { isMacOS, arch } = getPlatformInfo();

  console.log(`🔨 Building FFmpeg shared libraries (optimized)...`);
  console.log(`   Source: ${sourceDir}`);
  console.log(`   LAME: ${lameDir}`);

  const lameInclude = join(lameDir, "include");
  const lameLib = join(lameDir, "lib");
  const lameStaticLib = join(lameLib, "libmp3lame.a");

  const { isMacOS: isMac } = getPlatformInfo();
  
  const lameExports = [
    "lame_init", "lame_init_params", "lame_close",
    "lame_encode_buffer", "lame_encode_buffer_float", "lame_encode_buffer_int",
    "lame_encode_buffer_interleaved", "lame_encode_flush", "lame_encode_flush_nogap",
    "lame_set_in_samplerate", "lame_set_out_samplerate", "lame_set_num_channels",
    "lame_set_mode", "lame_set_quality", "lame_set_brate",
    "lame_set_VBR", "lame_set_VBR_q", "lame_set_VBR_quality",
    "lame_set_copyright", "lame_set_original", "lame_set_disable_reservoir",
    "lame_set_lowpassfreq", "lame_get_framesize", "lame_get_encoder_delay",
    "lame_get_lametag_frame",
  ];
  
  const exportFlags = isMac 
    ? lameExports.map(s => `-Wl,-exported_symbol,_${s}`).join(" ")
    : "";
  
  const forceLoadFlag = isMac 
    ? `-Wl,-force_load,${lameStaticLib} ${exportFlags}` 
    : `-Wl,--whole-archive ${lameStaticLib} -Wl,--no-whole-archive`;
  
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
    "--disable-debug",
    "--enable-stripping",
    "--enable-gpl",
    "--enable-pic",
    "--enable-pthreads",
    "--enable-libmp3lame",
    `--extra-cflags=-I${lameInclude} -O3 -DNDEBUG`,
    `--extra-ldflags=-L${lameLib} ${forceLoadFlag}`,
    `--extra-libs=-lm`,
    "--enable-encoder=libmp3lame",
    "--enable-encoder=flac",
    "--enable-encoder=aac",
    "--enable-encoder=pcm_s16le",
    "--enable-decoder=flac",
    "--enable-decoder=aac",
    "--enable-decoder=mp3",
    "--enable-decoder=pcm_s16le",
    "--enable-muxer=mp3",
    "--enable-muxer=flac",
    "--enable-muxer=adts",
    "--enable-muxer=wav",
    "--enable-demuxer=mp3",
    "--enable-demuxer=flac",
    "--enable-demuxer=aac",
    "--enable-demuxer=wav",
    "--enable-demuxer=mov",
  ];

  if (isMacOS && arch === "arm64") {
    configureFlags.push("--arch=arm64", "--enable-neon");
  }

  console.log(`   Configuring FFmpeg (release)...`);
  await $`./configure ${configureFlags}`.cwd(sourceDir);

  console.log(`   Compiling FFmpeg (this may take a while)...`);
  const cpuCount = navigator?.hardwareConcurrency ?? 4;
  await $`make -j${cpuCount}`.cwd(sourceDir);

  console.log(`   Installing FFmpeg...`);
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

  console.log(`   ✅ Built ${builtLibs.length} FFmpeg libraries`);
  return builtLibs;
}

async function fixLibraryPaths(libDir: string): Promise<void> {
  const { isMacOS, isLinux } = getPlatformInfo();
  
  if (!isMacOS && !isLinux) return;
  
  console.log(`🔧 Fixing library paths...`);
  const ext = getDylibExtension();
  
  const libs = [
    `libavformat.${ext}`,
    `libavcodec.${ext}`,
    `libavutil.${ext}`,
    `libswresample.${ext}`,
    `libswscale.${ext}`,
    `libavfilter.${ext}`,
  ];
  
  if (isMacOS) {
    for (const lib of libs) {
      const libPath = join(libDir, lib);
      if (!(await exists(libPath))) continue;
      
      await $`install_name_tool -id @loader_path/${lib} ${libPath}`.quiet().nothrow();
      
      for (const dep of libs) {
        const oldPath = await $`otool -L ${libPath}`.quiet().text();
        const match = oldPath.match(new RegExp(`(/[^\\s]+/${dep.replace('.dylib', '')}[^\\s]*\\.dylib)`));
        if (match) {
          await $`install_name_tool -change ${match[1]} @loader_path/${dep} ${libPath}`.quiet().nothrow();
        }
      }
    }
    console.log(`   ✅ Updated install names to @loader_path`);
  }
  
  if (isLinux) {
    for (const lib of libs) {
      const libPath = join(libDir, lib);
      if (!(await exists(libPath))) continue;
      await $`patchelf --set-rpath '$ORIGIN' ${libPath}`.quiet().nothrow();
    }
    console.log(`   ✅ Updated rpath to $ORIGIN`);
  }
}

async function signBinary(binaryPath: string, name: string): Promise<void> {
  if (!process.env.APPLE_SIGNING_IDENTITY) {
    console.log(`   ⚠️  No APPLE_SIGNING_IDENTITY set, skipping code signing`);
    return;
  }

  console.log(`🔏 Code-signing ${name}...`);
  const codesignCmd = `codesign -s "${process.env.APPLE_SIGNING_IDENTITY}" --options=runtime --force "${binaryPath}"`;
  await $`sh -c ${codesignCmd}`;
  console.log(`   ✅ Code-signed ${name}`);
}

async function verifyLibraries(libDir: string, ffmpegSourceDir: string): Promise<void> {
  console.log(`🔍 Verifying FFmpeg libraries...`);

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

  const configMakPath = join(ffmpegSourceDir, "ffbuild", "config.mak");
  if (await exists(configMakPath)) {
    const configMak = await readFile(configMakPath, "utf-8");
    
    if (!configMak.includes("CONFIG_LIBMP3LAME=yes")) {
      throw new Error("FFmpeg was not configured with libmp3lame support!");
    }
    console.log(`   ✅ LAME encoder enabled in FFmpeg config`);
    
    if (!configMak.includes("CONFIG_LIBMP3LAME_ENCODER=yes")) {
      throw new Error("FFmpeg libmp3lame encoder not enabled!");
    }
    console.log(`   ✅ libmp3lame encoder enabled`);
  }

  const avcodecPath = join(libDir, `libavcodec.${ext}`);
  const fileInfo = await $`file ${avcodecPath}`.quiet().text();
  if (fileInfo.includes("arm64") || fileInfo.includes("x86_64")) {
    console.log(`   ✅ Library architecture verified`);
  }

  console.log(`   ✅ FFmpeg libraries verified`);
}

export async function buildFFmpeg(config: BuildConfig): Promise<string[]> {
  const { isMacOS, isLinux, isWindows } = getPlatformInfo();
  const sourceDir = join(ROOT_DIR, config.sourceDir);
  const targetDir = join(ROOT_DIR, config.targetDir);
  const lameOutputDir = join(ROOT_DIR, config.lameDir);

  console.log(`\n${"─".repeat(50)}`);
  console.log(`  FFmpeg Build Pipeline (Release)`);
  console.log(`${"─".repeat(50)}`);

  if (!(await exists(sourceDir))) {
    throw new Error(`FFmpeg source not found: ${sourceDir}. Run setup-ffmpeg first.`);
  }

  const lameSourceDir = config.lameSourceDir;
  if (!lameSourceDir || !(await exists(lameSourceDir))) {
    throw new Error(`LAME source not found: ${lameSourceDir}. Run setup-ffmpeg first.`);
  }

  await mkdir(targetDir, { recursive: true });

  console.log("");
  const lameDir = await buildLame(lameSourceDir, lameOutputDir);

  const ffmpegOutputDir = join(sourceDir, `build-${isMacOS ? "macos" : isLinux ? "linux" : "windows"}`);
  await mkdir(ffmpegOutputDir, { recursive: true });

  console.log("");
  const builtLibs = await buildFFmpegLibraries(sourceDir, ffmpegOutputDir, lameDir);

  console.log("");
  console.log(`📦 Copying libraries to target...`);

  const copiedLibs: string[] = [];
  const ext = getDylibExtension();

  for (const libPath of builtLibs) {
    const libName = basename(libPath);
    const targetPath = join(targetDir, libName);

    await copyFile(libPath, targetPath);

    if (!isWindows) {
      await chmod(targetPath, 0o755);
    }

    copiedLibs.push(targetPath);
  }

  await fixLibraryPaths(targetDir);

  if (IS_PROD && isMacOS) {
    console.log(`🔏 Code-signing dylibs...`);
    for (const libPath of copiedLibs) {
      const libName = basename(libPath);
      if (libName.endsWith(".dylib")) {
        await signBinary(libPath, libName);
      }
    }
  }

  const libDir = join(ffmpegOutputDir, "lib");
  const versionedLibs = await $`ls -la ${libDir}/*.${ext}* 2>/dev/null || true`.quiet().text();
  console.log(`   Library files in build output: ${versionedLibs.split('\n').filter(l => l).length} files`);

  console.log(`📦 Copying headers for bindgen...`);
  const includeSourceDir = join(ffmpegOutputDir, "include");
  const includeTargetDir = join(targetDir, "include");
  await $`rm -rf ${includeTargetDir}`.quiet().nothrow();
  await $`cp -R ${includeSourceDir} ${includeTargetDir}`.quiet();
  
  const wrapperContent = /*c*/`
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
`;
  await writeFile(join(includeTargetDir, "wrapper.h"), wrapperContent);
  console.log(`   ✅ Headers copied`);

  await verifyLibraries(targetDir, sourceDir);

  console.log(`\n✨ Done! FFmpeg libraries ready at: ${targetDir}`);
  console.log(`   Libraries: ${copiedLibs.map(l => basename(l)).join(', ')}`);

  return copiedLibs;
}

export { ROOT_DIR, IS_PROD };

if (import.meta.main) {
  console.error("This script should be run via setup-ffmpeg.ts");
  console.error("Run: bun run scripts/setup-ffmpeg.ts");
  process.exit(1);
}
