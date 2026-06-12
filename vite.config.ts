import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Every top-level .html file is a page. Adding a post never touches this file.
// ONLY=slug1,slug2 narrows the build to those pages (per-series verification
// builds while other series are still in progress).
const root = fileURLToPath(new URL(".", import.meta.url));
const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const input = Object.fromEntries(
  readdirSync(root)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => !only || only.includes(f.replace(/\.html$/, "")))
    .map((f) => [f.replace(/\.html$/, ""), fileURLToPath(new URL(f, import.meta.url))]),
);

export default defineConfig({
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  build: {
    target: "esnext",
    outDir: process.env.OUT_DIR || "dist",
    rollupOptions: { input },
  },
});
