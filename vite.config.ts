import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `--mode demo` swaps in the demo entry (sample job + built-in imagery).
const demoEntry: Plugin = {
  name: "demo-entry",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => html.replace("/src/main.ts", "/src/entry-demo.ts"),
  },
};

// Single-file build so dist/index.html can be opened straight from disk.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [...(mode === "demo" ? [demoEntry] : []), viteSingleFile()],
  build: mode === "demo" ? { outDir: "dist-demo" } : {},
  server: { port: mode === "demo" ? 5181 : 5180 },
}));
