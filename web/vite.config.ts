import { defineConfig } from "vite";
import { resolve } from "node:path";

// GitHub Pages serves the site at https://<user>.github.io/<repo>/
export default defineConfig({
  base: process.env.VITE_BASE ?? "/igcse-tutor/",
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
