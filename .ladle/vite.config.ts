import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: resolve(__dirname, "../public"),
  resolve: {
    alias: {
      "@tauri-apps/api/core": resolve(__dirname, "../src/test/mocks/tauri-browser.ts"),
      "@tauri-apps/plugin-dialog": resolve(__dirname, "../src/test/mocks/tauri-browser.ts"),
      "@tauri-apps/plugin-fs": resolve(__dirname, "../src/test/mocks/tauri-browser.ts"),
      "@tauri-apps/plugin-opener": resolve(__dirname, "../src/test/mocks/tauri-browser.ts"),
    }
  }
});
