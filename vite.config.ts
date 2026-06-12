import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Every top-level .html file is a page. Adding a post never touches this file.
const root = fileURLToPath(new URL(".", import.meta.url));
const input = Object.fromEntries(
  readdirSync(root)
    .filter((f) => f.endsWith(".html"))
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
