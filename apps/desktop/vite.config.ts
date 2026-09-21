import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const host = process.env["TAURI_DEV_HOST"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/` is what shadcn components import each other by; without it every
  // added component needs hand-editing before it resolves.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Tauri owns the console; Vite's own error overlay is the useful signal.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Spread rather than `: undefined`, which exactOptionalPropertyTypes rejects.
    ...(host ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // The engine worker imports youtubei.js, which code-splits; only ES workers
  // can hold more than one chunk.
  worker: { format: "es" },
  build: {
    // WebView2 and WebKitGTK 4.1 are both evergreen enough to skip legacy output.
    target: "es2022",
    sourcemap: true,
  },
});
