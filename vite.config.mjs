import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resurfaceApi } from "./server/api.mjs";

const archiveProxy = { "/api/import_youtube": { target: "http://127.0.0.1:4175", changeOrigin: false } };

export default defineConfig(({ mode }) => ({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local", ".ts.net"],
    proxy: archiveProxy,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  preview: { proxy: archiveProxy },
  plugins: [
    react(),
    resurfaceApi({
      apiKey: loadEnv(mode, process.cwd(), "YOU_COM_").YOU_COM_API_KEY,
    }),
  ],
}));
