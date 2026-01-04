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

interface PatchResult {
  file: string;
  replacements: number;
}

async function patchFile(
  filePath: string,
  replacements: Array<{ pattern: RegExp | string; replacement: string }>
): Promise<PatchResult> {
  if (!(await exists(filePath))) {
    return { file: filePath, replacements: 0 };
  }

  let content = await Bun.file(filePath).text();
  let count = 0;

  for (const { pattern, replacement } of replacements) {
    const regex = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : pattern;
    const matches = content.match(regex);
    if (matches) {
      count += matches.length;
      content = content.replace(regex, replacement);
    }
  }

  if (count > 0) {
    await Bun.write(filePath, content);
  }

  return { file: filePath, replacements: count };
}

async function copyLibraryFiles(fftoolsDir: string): Promise<void> {
  console.log("   Copying ffmpeg_lib files to fftools...");
  
  const sourceLibDir = join(ROOT_DIR, "scripts", "patches", "ffmpeg", "fftools");
  const libH = join(sourceLibDir, "ffmpeg_lib.h");
  const libC = join(sourceLibDir, "ffmpeg_lib.c");
  const graphStubH = join(sourceLibDir, "graph", "graphprint_stub.h");
  const graphStubC = join(sourceLibDir, "graph", "graphprint_stub.c");
  
  if (await exists(libH)) {
    await copyFile(libH, join(fftoolsDir, "ffmpeg_lib.h"));
  } else {
    throw new Error(`ffmpeg_lib.h not found at ${libH}`);
  }
  
  if (await exists(libC)) {
    await copyFile(libC, join(fftoolsDir, "ffmpeg_lib.c"));
  } else {
    throw new Error(`ffmpeg_lib.c not found at ${libC}`);
  }
  
  await mkdir(join(fftoolsDir, "graph"), { recursive: true });
  if (await exists(graphStubH)) {
    await copyFile(graphStubH, join(fftoolsDir, "graph", "graphprint_stub.h"));
  }
  if (await exists(graphStubC)) {
    await copyFile(graphStubC, join(fftoolsDir, "graph", "graphprint_stub.c"));
  }
}

async function applyLibraryPatches(fftoolsDir: string): Promise<void> {
  console.log("   Applying library patches to fftools...");

  const ffmpegC = join(fftoolsDir, "ffmpeg.c");
  const ffprobeC = join(fftoolsDir, "ffprobe.c");
  const cmdutilsC = join(fftoolsDir, "cmdutils.c");
  const optCommonC = join(fftoolsDir, "opt_common.c");
  const ffmpegOptC = join(fftoolsDir, "ffmpeg_opt.c");
  const twStdoutC = join(fftoolsDir, "textformat", "tw_stdout.c");

  const commonRedirections = [
    { pattern: /\bprintf\s*\(/g, replacement: "fprintf(ffmpeg_lib_get_stdout(), " },
    { pattern: /\bvprintf\s*\(/g, replacement: "vfprintf(ffmpeg_lib_get_stdout(), " },
    { pattern: /\bfprintf\s*\(\s*stdout\s*,/g, replacement: "fprintf(ffmpeg_lib_get_stdout()," },
    { pattern: /\bvfprintf\s*\(\s*stdout\s*,/g, replacement: "vfprintf(ffmpeg_lib_get_stdout()," },
    { pattern: /\bfprintf\s*\(\s*stderr\s*,/g, replacement: "fprintf(ffmpeg_lib_get_stderr()," },
    { pattern: /\bvfprintf\s*\(\s*stderr\s*,/g, replacement: "vfprintf(ffmpeg_lib_get_stderr()," },
    { pattern: /\bfflush\s*\(\s*stdout\s*\)/g, replacement: "fflush(ffmpeg_lib_get_stdout())" },
    { pattern: /\bfflush\s*\(\s*stderr\s*\)/g, replacement: "fflush(ffmpeg_lib_get_stderr())" },
  ];

  const filesToRedir = [ffmpegC, ffprobeC, cmdutilsC, optCommonC, ffmpegOptC, twStdoutC];

  for (const file of filesToRedir) {
    if (await exists(file)) {
      let content = await Bun.file(file).text();
      const fileName = basename(file);

      let externs = "";
      if (fileName === "ffmpeg.c") {
        externs = `
extern void ffmpeg_lib_exit_handler(int code);
extern FILE *ffmpeg_lib_get_stdout(void);
extern FILE *ffmpeg_lib_get_stderr(void);
extern int ffmpeg_lib_check_cancel(void);`;
      } else if (fileName === "ffprobe.c") {
        externs = `
extern void ffmpeg_lib_exit_handler(int code);
extern FILE *ffmpeg_lib_get_stdout(void);
extern FILE *ffmpeg_lib_get_stderr(void);`;
      } else if (fileName === "cmdutils.c" || fileName === "opt_common.c" || fileName === "ffmpeg_opt.c" || fileName === "tw_stdout.c") {
        externs = `
extern FILE *ffmpeg_lib_get_stdout(void);
extern FILE *ffmpeg_lib_get_stderr(void);`;
      }

      if (!content.includes("ffmpeg_lib.h")) {
        const injection = `#include "ffmpeg_lib.h"\n${externs}\n`;
        if (content.includes('#include "config.h"')) {
          content = content.replace('#include "config.h"', `#include "config.h"\n${injection}`);
        } else {
          content = injection + content;
        }
        await Bun.write(file, content);
      }
      await patchFile(file, commonRedirections);
    }
  }

  const ffmpegPatches = await patchFile(ffmpegC, [
    { pattern: /int\s+main\s*\(\s*int\s+argc\s*,\s*char\s*\*\*\s*argv\s*\)/g, replacement: "int ffmpeg_main_internal(int argc, char **argv)" },
    { pattern: /\bexit\s*\(\s*(\d+)\s*\)/g, replacement: "ffmpeg_lib_exit_handler($1)" },
    { pattern: /\bexit\s*\(\s*([^)]+)\s*\)/g, replacement: "ffmpeg_lib_exit_handler($1)" },
  ]);

  const ffprobePatches = await patchFile(ffprobeC, [
    { pattern: /int\s+main\s*\(\s*int\s+argc\s*,\s*char\s*\*\*\s*argv\s*\)/g, replacement: "int ffprobe_main_internal(int argc, char **argv)" },
    { pattern: /\bexit\s*\(\s*(\d+)\s*\)/g, replacement: "ffmpeg_lib_exit_handler($1)" },
    { pattern: /\bexit\s*\(\s*([^)]+)\s*\)/g, replacement: "ffmpeg_lib_exit_handler($1)" },
    { pattern: /\bprogram_name\b/g, replacement: "ffprobe_program_name" },
    { pattern: /\bprogram_birth_year\b/g, replacement: "ffprobe_program_birth_year" },
    { pattern: /\bshow_help_default\b/g, replacement: "ffprobe_show_help_default" },
    { pattern: /av_log_set_callback\s*\(\s*log_callback\s*\)\s*;/g, replacement: "/* av_log_set_callback(log_callback); */" },
    { pattern: /av_log_set_callback\s*\(\s*log_callback_help\s*\)\s*;/g, replacement: "/* av_log_set_callback(log_callback_help); */" },
  ]);

  console.log(`      ffmpeg.c: ${ffmpegPatches.replacements} patches`);
  console.log(`      ffprobe.c: ${ffprobePatches.replacements} patches`);
}



async function addCleanupFunctions(fftoolsDir: string): Promise<void> {
  const ffmpegC = join(fftoolsDir, "ffmpeg.c");

  let ffmpegContent = await Bun.file(ffmpegC).text();
  if (!ffmpegContent.includes("ffmpeg_cleanup_internal")) {
    const cleanupFunc = /*c*/`

void ffmpeg_cleanup_internal(int ret);
int ffmpeg_main_internal(int argc, char **argv);

void ffmpeg_cleanup_internal(int ret) {
    term_exit();
    if (filtergraphs) {
        for (int i = 0; i < nb_filtergraphs; i++)
            fg_free(&filtergraphs[i]);
        av_freep(&filtergraphs);
        nb_filtergraphs = 0;
    }
    if (output_files) {
        for (int i = 0; i < nb_output_files; i++)
            of_free(&output_files[i]);
        av_freep(&output_files);
        nb_output_files = 0;
    }
    if (input_files) {
        for (int i = 0; i < nb_input_files; i++)
            ifile_close(&input_files[i]);
        av_freep(&input_files);
        nb_input_files = 0;
    }
    if (decoders) {
        for (int i = 0; i < nb_decoders; i++)
            dec_free(&decoders[i]);
        av_freep(&decoders);
        nb_decoders = 0;
    }
    uninit_opts();
    if (vstats_file) {
        fclose(vstats_file);
        vstats_file = NULL;
    }
}
`;
    ffmpegContent = ffmpegContent.replace(
      /int ffmpeg_main_internal\(/,
      cleanupFunc + "\nint ffmpeg_main_internal("
    );
    await Bun.write(ffmpegC, ffmpegContent);
    console.log("      Added ffmpeg_cleanup_internal()");
  }
}

async function addFFprobeCleanupFunction(fftoolsDir: string): Promise<void> {
  const ffprobeC = join(fftoolsDir, "ffprobe.c");

  let ffprobeContent = await Bun.file(ffprobeC).text();
  if (!ffprobeContent.includes("ffprobe_cleanup_internal")) {
    const cleanupFunc = /*c*/`
void ffprobe_cleanup_internal(void);
int ffprobe_main_internal(int argc, char **argv);

void ffprobe_cleanup_internal(void) {
}
`;
    ffprobeContent = ffprobeContent.replace(
      /int ffprobe_main_internal\(/,
      cleanupFunc + "\nint ffprobe_main_internal("
    );
    await Bun.write(ffprobeC, ffprobeContent);
    console.log("      Added ffprobe_cleanup_internal()");
  }
}


async function buildSharedLibrary(sourceDir: string, outputDir: string): Promise<string> {
  const { isMacOS, isLinux, arch } = getPlatformInfo();
  const fftoolsDir = join(sourceDir, "fftools");
  const libName = isMacOS ? "libffmpeg.dylib" : isLinux ? "libffmpeg.so" : "ffmpeg.dll";
  const libPath = join(outputDir, "lib", libName);

  console.log("   Configuring FFmpeg build (libraries only)...");

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
  ];

  if (isMacOS && arch === "arm64") {
    configureFlags.push("--arch=arm64", "--enable-neon");
  }

  await $`./configure ${configureFlags}`.cwd(sourceDir);

  console.log("   Building FFmpeg libraries (this may take a while)...");
  const cpuCount = navigator?.hardwareConcurrency ?? 4;
  await $`make -j${cpuCount}`.cwd(sourceDir);
  await $`make install`.cwd(sourceDir);

  console.log("   Reading FFmpeg build configuration...");
  const configMak = await Bun.file(join(sourceDir, "ffbuild/config.mak")).text();
  
  const getCflag = (name: string): string => {
    const match = configMak.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match ? match[1].trim() : "";
  };
  
  const cc = getCflag("CC") || "cc";
  const cflags = getCflag("CFLAGS");
  const cppflags = getCflag("CPPFLAGS");
  
  const compileFlags = [
    "-c", "-fPIC",
    ...cflags.split(/\s+/).filter(f => f && !f.includes("-Werror")),
    ...cppflags.split(/\s+/).filter(f => f),
    `-I${sourceDir}`,
    `-I${join(sourceDir, "compat/stdbit")}`,
    `-I${join(sourceDir, "compat")}`,
    `-I${fftoolsDir}`,
    `-I${join(fftoolsDir, "textformat")}`,
    `-I${join(fftoolsDir, "graph")}`,
    `-I${join(fftoolsDir, "resources")}`,
  ];

  console.log("   Compiling fftools sources...");
  
  const sourcesToCompile = [
    "ffmpeg_lib.c",
    "ffmpeg.c",
    "ffmpeg_dec.c",
    "ffmpeg_demux.c",
    "ffmpeg_enc.c",
    "ffmpeg_filter.c",
    "ffmpeg_hw.c",
    "ffmpeg_mux.c",
    "ffmpeg_mux_init.c",
    "ffmpeg_opt.c",
    "ffmpeg_sched.c",
    "sync_queue.c",
    "thread_queue.c",
    "cmdutils.c",
    "opt_common.c",
    "graph/graphprint_stub.c",
    "ffprobe.c",
    "textformat/avtextformat.c",
    "textformat/tf_compact.c",
    "textformat/tf_default.c",
    "textformat/tf_flat.c",
    "textformat/tf_ini.c",
    "textformat/tf_json.c",
    "textformat/tf_mermaid.c",
    "textformat/tf_xml.c",
    "textformat/tw_avio.c",
    "textformat/tw_buffer.c",
    "textformat/tw_stdout.c",
  ];
  
  const objectFiles: string[] = [];
  
  for (const src of sourcesToCompile) {
    const srcPath = join(fftoolsDir, src);
    const objName = src.replace(/\//g, "_").replace(".c", ".o");
    const objPath = join(fftoolsDir, objName);
    
    if (!(await exists(srcPath))) {
      console.log(`      Skipping ${src} (not found)`);
      continue;
    }
    
    const result = await $`${cc} ${compileFlags} -o ${objPath} ${srcPath}`.cwd(sourceDir).nothrow();
    if (result.exitCode === 0) {
      objectFiles.push(objPath);
    } else {
      console.error(`      Failed to compile ${src}:`);
      console.error(result.stderr.toString());
    }
  }
  
  console.log(`   Compiled ${objectFiles.length}/${sourcesToCompile.length} object files`);
  console.log("   Linking shared library...");

  const linkLibs = [
    "-lavdevice",
    "-lavcodec",
    "-lavformat",
    "-lavfilter",
    "-lavutil",
    "-lswscale",
    "-lswresample",
    "-lz",
  ];

  const linkFlags = isMacOS
    ? ["-dynamiclib", "-install_name", `@rpath/${libName}`]
    : isLinux
      ? ["-shared", `-Wl,-soname,${libName}`]
      : ["-shared"];

  await mkdir(join(outputDir, "lib"), { recursive: true });

  await $`cc ${linkFlags} -o ${libPath} ${objectFiles} -L${join(outputDir, "lib")} ${linkLibs} -lpthread`.cwd(sourceDir);

  return libPath;
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

async function verifyLibrary(libPath: string): Promise<void> {
  console.log(`🔍 Verifying FFmpeg library...`);

  if (!(await exists(libPath))) {
    throw new Error(`Library not found: ${libPath}`);
  }

  const symbolsToCheck = [
    "ffmpeg_lib_init",
    "ffmpeg_lib_main",
    "ffprobe_lib_main",
    "ffmpeg_lib_cleanup",
    "ffmpeg_lib_set_io",
  ];

  const { isMacOS } = getPlatformInfo();

  for (const symbol of symbolsToCheck) {
    const nmFlag = isMacOS ? "-g" : "-D";
    const result = await $`nm ${nmFlag} ${libPath} | grep ${symbol}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      console.warn(`   ⚠️  Symbol ${symbol} not found`);
    }
  }

  console.log(`   ✅ FFmpeg library verified`);
}

export async function buildFFmpeg(config: BuildConfig): Promise<string[]> {
  const { isMacOS, isLinux, isWindows } = getPlatformInfo();
  const sourceDir = join(ROOT_DIR, config.sourceDir);
  const targetDir = join(ROOT_DIR, config.targetDir);
  const fftoolsDir = join(sourceDir, "fftools");

  console.log(`🔨 Building FFmpeg shared library from source`);
  console.log(`   Source: ${sourceDir}`);

  if (!(await exists(sourceDir))) {
    throw new Error(`Source directory not found: ${sourceDir}. Run fetch-github-source first.`);
  }

  await mkdir(targetDir, { recursive: true });

  const outputDir = join(sourceDir, `build-${isMacOS ? "macos" : isLinux ? "linux" : "windows"}`);
  await mkdir(outputDir, { recursive: true });

  await copyLibraryFiles(fftoolsDir);
  await applyLibraryPatches(fftoolsDir);
  await addCleanupFunctions(fftoolsDir);
  await addFFprobeCleanupFunction(fftoolsDir);

  const libPath = await buildSharedLibrary(sourceDir, outputDir);

  const libName = basename(libPath);
  const targetPath = join(targetDir, libName);
  await copyFile(libPath, targetPath);

  if (!isWindows) {
    await chmod(targetPath, 0o755);
  }

  if (IS_PROD && isMacOS && libName.endsWith(".dylib")) {
    await signBinary(targetPath, "FFmpeg");
  }

  await verifyLibrary(targetPath);

  const headerSrc = join(fftoolsDir, "ffmpeg_lib.h");
  const headerDst = join(targetDir, "ffmpeg_lib.h");
  if (await exists(headerSrc)) {
    await copyFile(headerSrc, headerDst);
  }

  console.log(`✨ Done! FFmpeg library ready at: ${targetPath}`);

  return [targetPath];
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
