import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // cargo's build output lives in ./target and holds locked files; Vite must not watch it.
    watch: { ignored: ["**/target/**", "**/src-tauri/**"] },
  },
  build: { target: "es2020", outDir: "dist" },
});
