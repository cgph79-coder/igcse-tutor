import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) ?? String(Date.now());

/** Writes version.json so open copies of the app can notice a newer deploy and reload. */
function versionFile(): Plugin {
  return {
    name: "version-file",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

// GitHub Pages serves the site at https://<user>.github.io/<repo>/
export default defineConfig({
  base: process.env.VITE_BASE ?? "/igcse-tutor/",
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile()],
  server: { fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        parent: resolve(__dirname, "parent/index.html"),
      },
    },
  },
});
