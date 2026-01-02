#!/usr/bin/env bun
import { setupBinary, type BinaryConfig } from "./fetch-github-release";

const DENO_CONFIG: BinaryConfig = {
  name: "Deno",
  repo: "denoland/deno",
  targetDir: "src-tauri/binaries/deno",
  hasChecksumFiles: true,
  platforms: {
    darwin: {
      arm64: { assetName: "deno-aarch64-apple-darwin.zip", isZipped: true, executableName: "deno" },
      x64: { assetName: "deno-x86_64-apple-darwin.zip", isZipped: true, executableName: "deno" },
    },
    linux: {
      arm64: { assetName: "deno-aarch64-unknown-linux-gnu.zip", isZipped: true, executableName: "deno" },
      x64: { assetName: "deno-x86_64-unknown-linux-gnu.zip", isZipped: true, executableName: "deno" },
    },
    win32: {
      arm64: { assetName: "deno-x86_64-pc-windows-msvc.zip", isZipped: true, executableName: "deno.exe" },
      x64: { assetName: "deno-x86_64-pc-windows-msvc.zip", isZipped: true, executableName: "deno.exe" },
    },
  },
};

try {
  await setupBinary(DENO_CONFIG);
} catch (error) {
  console.error(`❌ Error: ${error}`);
  process.exit(1);
}
