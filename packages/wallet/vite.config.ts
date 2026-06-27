import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api 代理到 issuer-verifier（避免 CORS）。可用 IV_URL 覆寫。
const IV_URL = process.env.IV_URL ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: IV_URL, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});
