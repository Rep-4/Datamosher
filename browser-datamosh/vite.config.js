// File: vite.config.js

import { defineConfig } from "vite";

export default defineConfig({
  base: "/Datamosher/",
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util"
    ]
  },

  worker: {
    format: "es"
  }
});
